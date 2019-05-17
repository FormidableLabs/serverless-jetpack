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
const del = require("del");

const { TEST_MODE, TEST_SCENARIO, TEST_PARALLEL } = process.env;
const IS_PARALLEL = TEST_PARALLEL === "true";
const IS_WIN = process.platform === "win32";
const SLS_CMD = `node_modules/.bin/serverless${IS_WIN ? ".cmd" : ""}`;

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
  "individually",
  "webpack",
  "huge"
]
  .filter((s) => !TEST_SCENARIO || TEST_SCENARIO.split(",").includes(s));

// Only some scenarios are part of our timing benchmark.
const TIMING_SCENARIOS = new Set([
  "simple",
  "individually",
  "huge"
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
  align: ["l", "l", "l", "l", "r", "r"],
  stringLength: (cell) => strip(cell).length // fix alignment with chalk.
};

const execMode = (mode, args, opts) => execa(`${mode}${IS_WIN ? ".cmd" : ""}`, args, opts);

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
      await fs.mkdirp(path.dirname(dest));
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

// eslint-disable-next-line max-statements
const benchmark = async () => {
  const HEADER = ["Scenario", "Mode", "Type", "Time", "vs Base"].map((t) => gray(t));
  const timedData = [HEADER];
  const otherData = [HEADER];

  const archiveRoot = path.join(__dirname, "../.test-zips");
  await fs.mkdirp(archiveRoot);

  // Execute scenarios in parallel for scenario + mode.
  h2(chalk `Packaging Scenarios`);
  const queues = {};
  const results = {};
  await Promise.all(MATRIX
    .map(({ scenario, mode }) => {
      // Environment for combination.
      const cwd = path.resolve(`test/packages/${scenario}/${mode}`);

      // Use only _one_ concurrency = 1 queue if not parallel.
      const key = IS_PARALLEL ? `${scenario}/${mode}` : "all";
      queues[key] = queues[key] || new PQueue({ concurrency: 1 });
      const logTask = (msg) =>
        log(chalk `{green ${msg}}: ${JSON.stringify({ scenario, mode })}`);

      logTask("[task:queued]");
      // eslint-disable-next-line max-statements
      return queues[key].add(async () => {
        logTask("[task:start]");

        // Timing convenience wrapper.
        const runPackage = async (opts) => {
          const start = Date.now();

          await execa(SLS_CMD, ["package"], {
            cwd,
            stdio: "inherit",
            env: ENV,
            ...opts
          });

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

        logTask("[task:start:baseline]");
        const baselineTime = await runPackage();
        logTask("[task:end:baseline]");

        const baselineArchive = path.join(archiveRoot, scenario, mode, "baseline");
        await del(baselineArchive);
        await fs.mkdirp(baselineArchive);
        const baselineZips = await globby(".serverless/*.zip", { cwd });
        await Promise.all(baselineZips.map((zipFile) => fs.copy(
          path.join(cwd, zipFile),
          path.join(baselineArchive, path.basename(zipFile))
        )));

        // Data.
        // eslint-disable-next-line no-magic-numbers
        const pct = ((pluginTime - baselineTime) / baselineTime * 100).toFixed(2);
        const pluginRow = [scenario, mode, "jetpack", pluginTime, `**${pct} %**`];

        const resultsKey = `${scenario}/${mode}`;
        results[resultsKey] = (results[resultsKey] || []).concat([
          pluginRow,
          [scenario, mode, "baseline", baselineTime, ""]
        ]);
      });
    })
  );

  h2(chalk `Benchmark: {gray System Information}`);
  log(chalk `* {gray os}:   \`${os.platform()} ${os.release()} ${os.arch()}\``);
  log(chalk `* {gray node}: \`${process.version}\``);
  log(chalk `* {gray yarn}: \`${(await execMode("yarn", ["--version"])).stdout}\``);
  log(chalk `* {gray npm}:  \`${(await execMode("npm", ["--version"])).stdout}\``);

  // Recreate results in starting order.
  const timedRows = MATRIX
    .filter(({ scenario }) => TIMING_SCENARIOS.has(scenario))
    .map(({ scenario, mode }) => results[`${scenario}/${mode}`])
    .reduce((m, a) => m.concat(a), []);
  h2(chalk `Benchmark: {gray Timed Packages}`);
  log(table(timedData.concat(timedRows), TABLE_OPTS));

  const otherRows = MATRIX
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
