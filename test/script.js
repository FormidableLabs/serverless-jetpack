"use strict";

const path = require("path");
const { log } = console;
const chalk = require("chalk");
const { gray } = chalk;
const execa = require("execa");
const table = require("markdown-table");
const strip = require("strip-ansi");

const { TEST_MODE, TEST_SCENARIO } = process.env;

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
].filter(({ mode }) => !TEST_MODE || TEST_MODE.split(",").includes(mode));
const SCENARIOS = [
  "simple",
  "individually",
  "huge"
].filter((s) => !TEST_SCENARIO || TEST_SCENARIO.split(",").includes(s));

const MATRIX = CONFIGS
  .map((c) => SCENARIOS.map((scenario) => ({ ...c, scenario })))
  .reduce((m, a) => m.concat(a), []);

const ENV = {
  STAGE: "sandbox",
  AWS_REGION: "us-east-1",
  ...process.env
};

const TABLE_OPTS = {
  align: ["l", "l", "r"],
  stringLength: (cell) => strip(cell).length // fix alignment with chalk.
};

const h2 = (msg) => log(chalk `\n{cyan ## ${msg}}`);
const h3 = (msg) => log(chalk `\n{green ### ${msg}}`);

const build = async () => {
  const files = [
    "package.json",
    "serverless.yml",
    "serverless.js",
    "src"
  ];

  for (const scenario of SCENARIOS) {
    const execOpts = {
      cwd: path.resolve(`test/packages/${scenario}/yarn`),
      stdio: "inherit"
    };

    log(chalk `{cyan ${scenario}}: Copying files`);
    await execa("cp", [].concat("-rp", files, "../npm"), execOpts);
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
    await execa("sh", ["-c", "find . -type l ! -exec test -e {} \\; -print | xargs rm"], execOpts);
  }
};

// eslint-disable-next-line max-statements
const benchmark = async () => {
  const pkgData = [
    ["Scenario", "Mode", "Time"].map((t) => gray(t))
  ];

  // Execute scenarios in serial.
  for (const { scenario, mode } of MATRIX) {
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

    h2(chalk `Scenario: {gray ${JSON.stringify({ scenario, mode })}}`);

    // Remove bad symlinks.
    await exec("sh", ["-c", "find . -type l ! -exec test -e {} \\; -print | xargs rm"]);

    // TODO: relative bin path to serverless.
    // TODO: Implement `mode` (figure out `npm ci` for 5.7.0 or just npm install)
    h3("Plugin");
    const pluginTime = await exec("serverless", ["package"], {
      env: {
        ...ENV,
        MODE: mode
      }
    });
    pkgData.push([scenario, mode, pluginTime]);

    h3("Baseline");
    const baselineTime = await exec("serverless", ["package"]);
    pkgData.push([scenario, `base (${mode})`, baselineTime]);
  }

  h2(chalk `Benchmark: {gray package}`);
  log(table(pkgData, TABLE_OPTS));
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

if (require.main === module) {
  main().catch((err) => {
    log(err);
    process.exit(1); // eslint-disable-line no-process-exit
  });
}