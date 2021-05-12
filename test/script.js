"use strict";

const os = require("os");
const path = require("path");
const { log } = console;
const { "default": PQueue } = require("p-queue");
const pLimit = require("p-limit");
const chalk = require("chalk");
const { gray } = chalk;
const AdmZip = require("adm-zip");
const execa = require("execa");
const globby = require("globby");
const fs = require("fs-extra");
const table = require("markdown-table");
const strip = require("strip-ansi");
const del = require("del");
const { exists } = require("../util/bundle");

const { TEST_PKG, TEST_MODE, TEST_SCENARIO } = process.env;
const IS_WIN = process.platform === "win32";
const SLS_CMD = `node_modules/.bin/serverless${IS_WIN ? ".cmd" : ""}`;
const IS_SLS_ENTERPRISE = !!process.env.SERVERLESS_ACCESS_KEY;
const numCpus = os.cpus().length;

/**
 * Test script helper.
 *
 * Drive all the various scenarios. To limit packagers or scenario, try:
 *
 * ```sh
 * $ TEST_PKG=yarn TEST_SCENARIO=simple      node test/script.js install
 * $ TEST_PKG=yarn TEST_SCENARIO=simple,huge node test/script.js build
 * $ TEST_PKG=yarn,npm TEST_SCENARIO=simple  node test/script.js benchmark
 * $ TEST_MODE=trace TEST_SCENARIO=simple    node test/script.js benchmark
 * ```
 */
const PKGS = [
  "yarn",
  "npm"
]
  .filter((pkg) => !TEST_PKG || TEST_PKG.split(",").includes(pkg));

const MODES = [
  "trace",
  "deps"
]
  .filter((mode) => !TEST_MODE || TEST_MODE.split(",").includes(mode));

const SCENARIOS = [
  "simple",
  "complex"
]
  .filter((s) => !TEST_SCENARIO || TEST_SCENARIO.split(",").includes(s));

// Only some scenarios are part of our timing benchmark.
const TIMING_SCENARIOS = new Set([
  "simple",
  "complex"
]);

// Some scenarios are only feasible in Jetpack
const JETPACK_ONLY_SCENARIOS = new Set([
]);

// Tests to exclude from correctness tests.
const SKIP_CORRECTNESS_SCENARIOS = new Set([
]);

// Some scenarios allow failures in executing `serverless`
// (Due to AWS creds we're not going to provide).
const ALLOW_FAILURE_SCENARIOS = new Set([
]);

// All scenario to run.
const MATRIX = SCENARIOS
  .map((scenario) => PKGS.map((pkg) => ({ pkg, scenario })))
  .reduce((m, a) => m.concat(a), []);

// All scenarios to test.
const TEST_MATRIX = MATRIX.filter(({ scenario }) => {
  if (SKIP_CORRECTNESS_SCENARIOS.has(scenario)) {
    return false;
  }

  // SFE-only scenarios.
  if (scenario === "dashboard" && !IS_SLS_ENTERPRISE) {
    return false;
  }

  return true;
});

const ENV = {
  STAGE: "sandbox",
  AWS_REGION: "us-east-1",
  ...process.env
};

const execMode = (pkg, args, opts) => execa(`${pkg}${IS_WIN ? ".cmd" : ""}`, args, opts);

const h2 = (msg) => log(chalk `\n{cyan ## ${msg}}`);

const build = async () => {
  const clean = [
    "**",
    "!**/node_modules/**",
    "!**/package-lock.json",
    "!**/lerna.json"
  ];
  const patterns = [
    "package.json",
    "serverless.*",
    "src/**",
    "*.js",
    "*.py",
    "functions/*/src/**",
    "functions/*/package.json",
    // TODO(LAYERS): reenable this?
    // "layers/*/*.js",
    // "layers/*/nodejs/package.json",
    "lib/*/src/**",
    "lib/*/package.json"
  ];

  for (const scenario of SCENARIOS) {
    const srcDir = `test/packages/${scenario}/yarn`;
    const destDir = `test/packages/${scenario}/npm`;

    const destFiles = await globby(clean, {
      cwd: path.resolve(destDir),
      dot: true
    });
    log(chalk `{cyan ${scenario}}: Cleaning files: {gray ${JSON.stringify(destFiles)}}`);
    await Promise.all(destFiles.map((f) => fs.remove(path.resolve(`${destDir}/${f}`))));

    const srcFiles = await globby(patterns, {
      cwd: path.resolve(srcDir),
      dot: true
    });

    log(chalk `{cyan ${scenario}}: Copying files {gray ${JSON.stringify(srcFiles)}}`);
    await Promise.all(srcFiles.map(async (f) => {
      const dest = path.resolve(`${destDir}/${f}`);
      await fs.mkdirp(path.dirname(dest));
      await fs.copy(path.resolve(`${srcDir}/${f}`), dest);
    }));
  }
};

const createInstall = ({ installCmd }) => async ({ skipIfExists }) => {
  for (const { scenario, pkg } of MATRIX) {
    const cwd = path.resolve(`test/packages/${scenario}/${pkg}`);
    const execOpts = {
      cwd,
      stdio: "inherit"
    };

    if (skipIfExists && await exists(path.resolve(cwd, "node_modules"))) {
      log(chalk `{cyan ${scenario}/${pkg}}: Found existing node_modules. {yellow Skipping}`);
      continue;
    }

    log(chalk `{cyan ${scenario}/${pkg}}: Installing`);
    await installCmd({ pkg, execOpts });

    // Symlinks don't exist on Windows, so only on UNIX-ish.
    if (!IS_WIN) {
      log(chalk `{cyan ${scenario}/${pkg}}: Removing bad symlinks`);
      await execa("sh", ["-c",
        "find . -type l ! -exec sh -c \"test -e {} || (echo removing {}; rm -rf {})\" \\;"
      ], execOpts);
    }
  }
};

const install = createInstall({
  installCmd: async ({ pkg, execOpts }) => {
    await execMode(pkg, ["install", "--no-progress"], execOpts);
  }
});

const ci = createInstall({
  installCmd: async ({ pkg, execOpts }) => {
    if (pkg === "yarn") {
      await execMode(
        pkg,
        ["install", "--prefer-offline", "--frozen-lockfile", "--non-interactive", "--no-progress"],
        execOpts
      );
    } else if (pkg === "npm") {
      await execMode(pkg, ["ci", "--no-progress"], execOpts);
    }
  }
});

const _logTask = (obj) => (msg) => log(chalk `{green ${msg}}: ${JSON.stringify(obj)}`);

// eslint-disable-next-line max-statements
const benchmark = async ({ concurrency }) => {
  const TABLE_OPTS = {
    align: ["l", "l", "l", "l", "r", "r"],
    stringLength: (cell) => strip(cell).length // fix alignment with chalk.
  };
  const HEADER = ["Scenario", "Pkg", "Type", "Mode", "Time", "vs Base"].map((t) => gray(t));
  const timedData = [HEADER];
  const otherData = [HEADER];

  const matrix = MATRIX.filter(({ scenario }) => {
    if (scenario === "dashboard" && !IS_SLS_ENTERPRISE) {
      _logTask({ scenario })("[task:skipping:scenario]");
      return false;
    }

    return true;
  });

  const archiveRoot = path.join(__dirname, "../.test-zips");
  await fs.mkdirp(archiveRoot);

  // Create max limit on concurrency.
  const limit = pLimit(concurrency);

  // Execute scenarios in parallel for scenario + pkg.
  h2(chalk `Packaging Scenarios: {gray ${JSON.stringify({ concurrency, numCpus })}}`);
  const queues = {};
  const results = {};
  await Promise.all(matrix
    .map(({ scenario, pkg }) => {
      // Environment for combination.
      const cwd = path.resolve(`test/packages/${scenario}/${pkg}`);
      const logTask = _logTask({ scenario, pkg });
      const key = `${scenario}/${pkg}`;
      queues[key] = queues[key] || new PQueue({ concurrency: 1 });

      logTask("[task:queued]");
      // eslint-disable-next-line max-statements
      return queues[key].add(() => limit(async () => {
        logTask("[task:start]");

        // Timing convenience wrapper.
        const runPackage = async (opts) => {
          const start = Date.now();

          try {
            await execa(SLS_CMD, ["package"], {
              cwd,
              stdio: "inherit",
              env: ENV,
              ...opts
            });
          } catch (err) {
            if (ALLOW_FAILURE_SCENARIOS.has(scenario)) {
              logTask("[task:end:allowed-failure");
            } else {
              throw err;
            }
          }

          return Date.now() - start;
        };

        // Run each mode in serial because
        const jpLimit = pLimit(1);
        const jetpackTimes = await Promise.all(MODES.map((mode) => jpLimit(async () => {
          logTask(`[task:start:jetpack:${mode}]`);
          const jetpackTime = await runPackage({
            env: {
              ...ENV,
              PKG: pkg,
              MODE: mode
            }
          });
          logTask(`[task:end:jetpack:${mode}]`);

          const jetpackArchive = path.join(archiveRoot, scenario, pkg, "jetpack", mode);
          await del(jetpackArchive);
          await fs.mkdirp(jetpackArchive);
          const jetpackZips = await globby(".serverless/*.zip", { cwd });
          await Promise.all(jetpackZips.map((zipFile) => fs.copy(
            path.join(cwd, zipFile),
            path.join(jetpackArchive, path.basename(zipFile))
          )));

          return jetpackTime;
        })));

        let baseTime;
        if (JETPACK_ONLY_SCENARIOS.has(scenario)) {
          logTask("[task:skipping:baseline]");
        } else {
          logTask("[task:start:baseline]");
          baseTime = await runPackage({
            env: {
              ...ENV,
              MODE: "baseline"
            }
          });
          logTask("[task:end:baseline]");

          const baselineArchive = path.join(archiveRoot, scenario, pkg, "baseline");
          await del(baselineArchive);
          await fs.mkdirp(baselineArchive);
          const baselineZips = await globby(".serverless/*.zip", { cwd });
          await Promise.all(baselineZips.map((zipFile) => fs.copy(
            path.join(cwd, zipFile),
            path.join(baselineArchive, path.basename(zipFile))
          )));
        }

        // Report.
        const jetpackRows = MODES.map((mode, i) => {
          // eslint-disable-next-line no-magic-numbers
          const pct = baseTime ? ((jetpackTimes[i] - baseTime) / baseTime * 100).toFixed(2) : "";
          return [scenario, pkg, "jetpack", mode, jetpackTimes[i], pct ? `**${pct} %**` : ""];
        });

        const resultsKey = `${scenario}/${pkg}`;
        results[resultsKey] = (results[resultsKey] || []).concat([
          ...jetpackRows,
          baseTime ? [scenario, pkg, "baseline", "", baseTime, ""] : null
        ].filter(Boolean));
      }));
    })
  );

  h2(chalk `Benchmark: {gray System Information}`);
  log(chalk `* {gray os}:   \`${os.platform()} ${os.release()} ${os.arch()}\``);
  log(chalk `* {gray node}: \`${process.version}\``);
  log(chalk `* {gray yarn}: \`${(await execMode("yarn", ["--version"])).stdout}\``);
  log(chalk `* {gray npm}:  \`${(await execMode("npm", ["--version"])).stdout}\``);

  // Recreate results in starting order.
  const timedRows = matrix
    .filter(({ scenario }) => TIMING_SCENARIOS.has(scenario))
    .map(({ scenario, pkg }) => results[`${scenario}/${pkg}`])
    .reduce((m, a) => m.concat(a), []);
  h2(chalk `Benchmark: {gray Timed Packages}`);
  log(table(timedData.concat(timedRows), TABLE_OPTS));

  const otherRows = matrix
    .filter(({ scenario }) => !TIMING_SCENARIOS.has(scenario))
    .map(({ scenario, pkg }) => results[`${scenario}/${pkg}`])
    .reduce((m, a) => m.concat(a), []);
  h2(chalk `Benchmark: {gray Other Packages}`);
  log(table(otherData.concat(otherRows), TABLE_OPTS));
};

const size = async () => {
  // Get zip file lists and add in size data.
  const projRoot = path.resolve(__dirname, "..");
  const zipFiles = await globby([".test-zips/**/*.zip"], { cwd: projRoot });
  const zipData = await Promise.all(zipFiles.map(async (zipFile) => {
    const zip = new AdmZip(path.resolve(projRoot, zipFile));
    return {
      entries: zip.getEntries().length,
      size: (await fs.stat(path.resolve(projRoot, zipFile))).size
    };
  }));
  const zipObj = zipData.reduce((memo, data, i) => {
    const combo = zipFiles[i].replace(".test-zips/", "").split("/");
    const dirIdx = combo.length - 1;
    const key = combo.slice(0, dirIdx).join("/");
    const file = combo.slice(dirIdx);

    memo[key] = memo[key] || {};
    memo[key][file] = data;

    return memo;
  }, {});

  const matrix = MATRIX.filter(({ scenario }) => {
    if (scenario === "dashboard" && !IS_SLS_ENTERPRISE) {
      return false;
    }

    return true;
  });

  // Format report.
  const TABLE_OPTS = {
    align: ["l", "l", "r", "r", "r", "r"],
    stringLength: (cell) => strip(cell).length // fix alignment with chalk.
  };
  const HEADER = ["Scenario", "Type", "Zips", "Files", "Size", "vs Base"]
    .map((t) => gray(t));
  const SIZE_IDX = 4;
  const PCT_IDX = 5;
  const report = [HEADER];

  matrix
    // Just use yarn stats since timings don't matter.
    .filter(({ pkg }) => pkg === "yarn")
    // Create data.
    .map(({ scenario, pkg }) => ["jetpack/trace", "baseline"].forEach((part) => {
      let data = zipObj[`${scenario}/${pkg}/${part}`];
      if (!data) {
        // Use Jetpack deps data if no baseline (like monorepo, etc.)
        data = zipObj[`${scenario}/${pkg}/jetpack/deps`];
      }
      const zips = Object.values(data);
      const stats = zips.reduce((memo, obj) => ({
        entries: memo.entries + obj.entries,
        size: memo.size + obj.size
      }));

      // Mutate previous entry if have basline stats now.
      if (part === "baseline") {
        const prev = report[report.length - 1];
        // eslint-disable-next-line no-magic-numbers
        prev[PCT_IDX] = `**${((prev[SIZE_IDX] - stats.size) / stats.size * 100).toFixed(2)} %**`;
      }

      report.push([
        scenario, part.split("/")[0], zips.length, stats.entries, stats.size, ""
      ]);
    }));

  h2(chalk `Sizes`);
  log(table(report, TABLE_OPTS));
};

const main = async () => {
  const actionStr = process.argv[2]; // eslint-disable-line no-magic-numbers
  const actions = {
    build,
    ci,
    install,
    benchmark,
    size
  };

  const argsList = process.argv.slice(3); // eslint-disable-line no-magic-numbers
  const isParallel = argsList.includes("--parallel");
  const concNum = (argsList.find((n) => n.startsWith("--concurrency=")) || "").split("=")[1];
  const args = {
    skipIfExists: argsList.includes("--skip-if-exists"),
    concurrency: concNum || isParallel ? parseInt(concNum || numCpus) : 1
  };

  const action = actions[actionStr];
  if (!action) {
    throw new Error(`Invalid action: ${actionStr}`);
  }

  return action(args);
};

module.exports = {
  TEST_MATRIX
};

if (require.main === module) {
  main().catch((err) => {
    log(err);
    process.exit(1); // eslint-disable-line no-process-exit
  });
}
