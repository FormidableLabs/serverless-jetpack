"use strict";

const os = require("os");
const path = require("path");
const { log } = console;
const PQueue = require("p-queue");
const chalk = require("chalk");
const { gray } = chalk;
const execa = require("execa");
const globby = require("globby");
const fs = require("fs-extra");
const table = require("markdown-table");
const strip = require("strip-ansi");

const { TEST_MODE, TEST_SCENARIO, TEST_LOCKFILE, TEST_PARALLEL } = process.env;
const IS_PARALLEL = TEST_PARALLEL === "true";

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
  { mode: "yarn", lockfile: "true" },
  { mode: "npm", lockfile: "true" },
  { mode: "yarn", lockfile: "false" },
  { mode: "npm", lockfile: "false" }
]
  .filter(({ mode }) => !TEST_MODE || TEST_MODE.split(",").includes(mode))
  .filter(({ lockfile }) => !TEST_LOCKFILE || TEST_LOCKFILE === lockfile);

const SCENARIOS = [
  "simple",
  "individually",
  "plugins",
  "huge"
]
  .filter((s) => !TEST_SCENARIO || TEST_SCENARIO.split(",").includes(s));

const MATRIX = SCENARIOS
  .map((scenario) => CONFIGS.map((c) => ({ ...c, scenario })))
  .reduce((m, a) => m.concat(a), []);

const ENV = {
  STAGE: "sandbox",
  AWS_REGION: "us-east-1",
  ...process.env
};

const TABLE_OPTS = {
  align: ["l", "l", "l", "l", "r", "r"],
  stringLength: (cell) => strip(cell).length // fix alignment with chalk.
};

const h2 = (msg) => log(chalk `\n{cyan ## ${msg}}`);

const build = async () => {
  const clean = [
    "**",
    "!node_modules/**",
    "!package-lock.json"
  ];
  const patterns = [
    "package.json",
    "serverless.*",
    "src/**",
    "*.js"
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
      await fs.ensureDir(path.dirname(dest));
      await fs.copy(path.resolve(`${srcDir}/${f}`), dest);
    }));
  }
};

const install = async () => {
  for (const { scenario, mode } of MATRIX) {
    const execOpts = {
      cwd: path.resolve(`test/packages/${scenario}/${mode}`),
      stdio: "inherit"
    };

    log(chalk `{cyan ${scenario}/${mode}}: Installing`);
    await execa(mode, ["install"], execOpts);

    log(chalk `{cyan ${scenario}/${mode}}: Removing bad symlinks`);
    await execa("sh", ["-c",
      "find . -type l ! -exec sh -c \"test -e {} || (echo removing {}; rm -rf {})\" \\;"
    ], execOpts);
  }
};

// eslint-disable-next-line max-statements
const benchmark = async () => {
  const pkgData = [
    ["Scenario", "Mode", "Lockfile", "Type", "Time", "vs Base"].map((t) => gray(t))
  ];

  const archiveRoot = path.join(__dirname, "../.test-zips");
  await execa("mkdir", ["-p", archiveRoot]);

  // Execute scenarios in parallel for scenario + mode.
  // We have to execute `lockfile: true|false` in serial because they both
  // mutate the same directory.
  h2(chalk `Packaging scenarios`);
  const queues = {};
  const results = {};
  await Promise.all(MATRIX
    .map(({ scenario, mode, lockfile }) => {
      // Use only _one_ concurrency = 1 queue if not parallel.
      const key = IS_PARALLEL ? `${scenario}/${mode}` : "all";
      queues[key] = queues[key] || new PQueue({ concurrency: 1 });
      const logTask = (msg) =>
        log(chalk `{green ${msg}}: ${JSON.stringify({ scenario, mode, lockfile })}`);

      logTask("[task:queued]");
      // eslint-disable-next-line max-statements
      return queues[key].add(async () => {
        logTask("[task:start]");

        const exec = async (cmd, args, opts) => {
          const start = Date.now();

          await execa(cmd, args, {
            cwd: path.resolve(`test/packages/${scenario}/${mode}`),
            stdio: "inherit",
            env: ENV,
            ...opts
          });

          return Date.now() - start;
        };


        logTask("[task:start:jetpack]");
        const pluginTime = await exec("node_modules/.bin/serverless", ["package"], {
          env: {
            ...ENV,
            MODE: mode,
            LOCKFILE: lockfile
          }
        });
        logTask("[task:end:jetpack]");

        const pluginArchive = path.join(archiveRoot, scenario, mode, lockfile, "jetpack");
        await exec("rm", ["-rf", pluginArchive]);
        await exec("mkdir", ["-p", pluginArchive]);
        await exec("cp", ["-rp", ".serverless/*.zip", pluginArchive], {
          shell: true
        });

        logTask("[task:start:baseline]");
        const baselineTime = await exec("serverless", ["package"]);
        logTask("[task:end:baseline]");

        const baselineArchive = path.join(__dirname,
          "../.test-zips", scenario, mode, lockfile, "baseline");
        await exec("rm", ["-rf", baselineArchive]);
        await exec("mkdir", ["-p", baselineArchive]);
        await exec("cp", ["-rp", ".serverless/*.zip", baselineArchive], {
          shell: true
        });

        // Data.
        // eslint-disable-next-line no-magic-numbers
        const pct = ((pluginTime - baselineTime) / baselineTime * 100).toFixed(2);
        let pluginRow = [scenario, mode, lockfile, "jetpack", pluginTime, `${pct} %`];

        // Bold out preferred configurations.
        if (lockfile === "true") {
          pluginRow = pluginRow.map((c) => chalk `**{bold ${c}}**`);
        }

        const resultsKey = `${scenario}/${mode}/${lockfile}`;
        results[resultsKey] = (results[resultsKey] || []).concat([
          pluginRow,
          [scenario, mode, lockfile, "baseline", baselineTime, ""]
        ]);
      });
    })
  );

  h2(chalk `Benchmark: {gray system information}`);
  log(chalk `* {gray os}:   \`${os.platform()} ${os.release()} ${os.arch()}\``);
  log(chalk `* {gray node}: \`${process.version}\``);
  log(chalk `* {gray yarn}: \`${(await execa("yarn", ["--version"])).stdout}\``);
  log(chalk `* {gray npm}:  \`${(await execa("npm", ["--version"])).stdout}\``);

  h2(chalk `Benchmark: {gray package}`);
  // Recreate results in starting order.
  const datas = MATRIX
    .map(({ scenario, mode, lockfile }) => results[`${scenario}/${mode}/${lockfile}`])
    .reduce((m, a) => m.concat(a), []);
  log(table(pkgData.concat(datas), TABLE_OPTS));

  // Generate file lists.
  await execa("find", [
    ".test-zips", "-name", "\"*.zip\"",
    "-exec", "sh", "-c", "\"zipinfo -1 {} | sort > {}.files.txt\"", "\\;"
  ], {
    stdio: "inherit",
    shell: true
  });
};

const main = async () => {
  const actionStr = process.argv[2]; // eslint-disable-line no-magic-numbers
  const actions = {
    build,
    install,
    benchmark
  };

  const action = actions[actionStr];
  if (!action) {
    throw new Error(`Invalid action: ${actionStr}`);
  }

  return action();
};

module.exports = {
  MATRIX
};

if (require.main === module) {
  main().catch((err) => {
    log(err);
    process.exit(1); // eslint-disable-line no-process-exit
  });
}
