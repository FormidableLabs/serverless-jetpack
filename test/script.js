"use strict";

const os = require("os");
const path = require("path");
const { log } = console;
const { "default": PQueue } = require("p-queue");
const pLimit = require("p-limit");
const chalk = require("chalk");
const { gray } = chalk;
const execa = require("execa");
const globby = require("globby");
const fs = require("fs-extra");
const table = require("markdown-table");
const strip = require("strip-ansi");
const del = require("del");
const { exists } = require("../util/bundle");

const { TEST_MODE, TEST_SCENARIO, TEST_PARALLEL } = process.env;
let IS_PARALLEL = TEST_PARALLEL === "true";
const IS_WIN = process.platform === "win32";
const SLS_CMD = `node_modules/.bin/serverless${IS_WIN ? ".cmd" : ""}`;
const IS_SLS_ENTERPRISE = !!process.env.SERVERLESS_ACCESS_KEY;

/**
 * Test script helper.
 *
 * Drive all the various scenarios. To limit modes or scenario, try:
 *
 * ```sh
 * $ TEST_MODE=yarn TEST_SCENARIO=simple      node test/script.js install
 * $ TEST_MODE=yarn TEST_SCENARIO=simple,huge node test/script.js build
 * $ TEST_MODE=yarn,npm TEST_SCENARIO=simple  node test/script.js benchmark
 * ```
 */
const CONFIGS = [
  { mode: "yarn" },
  { mode: "npm" }
]
  .filter(({ mode }) => !TEST_MODE || TEST_MODE.split(",").includes(mode));

const SCENARIOS = [
  "simple",
  "dashboard",
  "complex",
  "individually",
  "monorepo",
  "webpack",
  "huge"
]
  .filter((s) => !TEST_SCENARIO || TEST_SCENARIO.split(",").includes(s));

// Only some scenarios are part of our timing benchmark.
const TIMING_SCENARIOS = new Set([
  "simple",
  "complex",
  "individually",
  "huge"
]);

// Some scenarios are only feasible in Jetpack
const JETPACK_ONLY_SCENARIOS = new Set([
  "monorepo"
]);

// Some scenarios allow failures in executing `serverless`
// (Due to AWS creds we're not going to provide).
const ALLOW_FAILURE_SCENARIOS = new Set([
  "dashboard"
]);

const MATRIX = SCENARIOS
  .map((scenario) => CONFIGS.map((c) => ({ ...c, scenario })))
  .reduce((m, a) => m.concat(a), []);

const ENV = {
  STAGE: "sandbox",
  AWS_REGION: "us-east-1",
  ...process.env
};

const TABLE_OPTS = {
  align: ["l", "l", "l", "r", "r"],
  stringLength: (cell) => strip(cell).length // fix alignment with chalk.
};

const execMode = (mode, args, opts) => execa(`${mode}${IS_WIN ? ".cmd" : ""}`, args, opts);

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
    "functions/*/src/**",
    "functions/*/package.json",
    "layers/*/*.js",
    "layers/*/nodejs/package.json",
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

const install = async ({ skipIfExists }) => {
  for (const { scenario, mode } of MATRIX) {
    const cwd = path.resolve(`test/packages/${scenario}/${mode}`);
    const execOpts = {
      cwd,
      stdio: "inherit"
    };

    if (skipIfExists && await exists(path.resolve(cwd, "node_modules"))) {
      log(chalk `{cyan ${scenario}/${mode}}: Found existing node_modules. {yellow Skipping}`);
      continue;
    }

    log(chalk `{cyan ${scenario}/${mode}}: Installing`);
    await execMode(mode, ["install", "--no-progress"], execOpts);

    // Symlinks don't exist on Windows, so only on UNIX-ish.
    if (!IS_WIN) {
      log(chalk `{cyan ${scenario}/${mode}}: Removing bad symlinks`);
      await execa("sh", ["-c",
        "find . -type l ! -exec sh -c \"test -e {} || (echo removing {}; rm -rf {})\" \\;"
      ], execOpts);
    }
  }
};

const _logTask = (obj) => (msg) => log(chalk `{green ${msg}}: ${JSON.stringify(obj)}`);

// eslint-disable-next-line max-statements
const benchmark = async () => {
  const HEADER = ["Scenario", "Mode", "Type", "Time", "vs Base"].map((t) => gray(t));
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
  const numCpus = os.cpus().length;
  const concurrency = IS_PARALLEL ? numCpus : 1;
  const limit = pLimit(concurrency);

  // Execute scenarios in parallel for scenario + mode.
  h2(chalk `Packaging Scenarios: {gray ${JSON.stringify({ concurrency, numCpus })}}`);
  const queues = {};
  const results = {};
  await Promise.all(matrix
    .map(({ scenario, mode }) => {
      // Environment for combination.
      const cwd = path.resolve(`test/packages/${scenario}/${mode}`);
      const logTask = _logTask({ scenario, mode });
      const key = `${scenario}/${mode}`;
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

        logTask("[task:start:jetpack]");
        const pluginTime = await runPackage({
          env: {
            ...ENV,
            MODE: mode
          }
        });
        logTask("[task:end:jetpack]");

        const pluginArchive = path.join(archiveRoot, scenario, mode, "jetpack");
        await del(pluginArchive);
        await fs.mkdirp(pluginArchive);
        const pluginZips = await globby(".serverless/*.zip", { cwd });
        await Promise.all(pluginZips.map((zipFile) => fs.copy(
          path.join(cwd, zipFile),
          path.join(pluginArchive, path.basename(zipFile))
        )));

        let baselineTime;
        if (JETPACK_ONLY_SCENARIOS.has(scenario)) {
          logTask("[task:skipping:baseline]");
        } else {
          logTask("[task:start:baseline]");
          baselineTime = await runPackage();
          logTask("[task:end:baseline]");

          const baselineArchive = path.join(archiveRoot, scenario, mode, "baseline");
          await del(baselineArchive);
          await fs.mkdirp(baselineArchive);
          const baselineZips = await globby(".serverless/*.zip", { cwd });
          await Promise.all(baselineZips.map((zipFile) => fs.copy(
            path.join(cwd, zipFile),
            path.join(baselineArchive, path.basename(zipFile))
          )));
        }

        // Report.
        let pct;
        if (baselineTime) {
          // eslint-disable-next-line no-magic-numbers
          pct = ((pluginTime - baselineTime) / baselineTime * 100).toFixed(2);
        }
        const pluginRow = [scenario, mode, "jetpack", pluginTime, pct ? `**${pct} %**` : ""];

        const resultsKey = `${scenario}/${mode}`;
        results[resultsKey] = (results[resultsKey] || []).concat([
          pluginRow,
          baselineTime ? [scenario, mode, "baseline", baselineTime, ""] : null
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
    .map(({ scenario, mode }) => results[`${scenario}/${mode}`])
    .reduce((m, a) => m.concat(a), []);
  h2(chalk `Benchmark: {gray Timed Packages}`);
  log(table(timedData.concat(timedRows), TABLE_OPTS));

  const otherRows = matrix
    .filter(({ scenario }) => !TIMING_SCENARIOS.has(scenario))
    .map(({ scenario, mode }) => results[`${scenario}/${mode}`])
    .reduce((m, a) => m.concat(a), []);
  h2(chalk `Benchmark: {gray Other Packages}`);
  log(table(otherData.concat(otherRows), TABLE_OPTS));
};

const main = async () => {
  const actionStr = process.argv[2]; // eslint-disable-line no-magic-numbers
  const actions = {
    build,
    install,
    benchmark
  };

  const argsList = process.argv.slice(3); // eslint-disable-line no-magic-numbers
  const args = {
    skipIfExists: argsList.includes("--skip-if-exists")
  };

  const action = actions[actionStr];
  if (!action) {
    throw new Error(`Invalid action: ${actionStr}`);
  }

  return action(args);
};

module.exports = {
  MATRIX
};

if (require.main === module) {
  // Allow CLI setting for parallel.
  IS_PARALLEL = IS_PARALLEL || process.argv.includes("--parallel");

  main().catch((err) => {
    log(err);
    process.exit(1); // eslint-disable-line no-process-exit
  });
}
