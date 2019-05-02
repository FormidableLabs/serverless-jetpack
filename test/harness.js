"use strict";

const path = require("path");
const { log } = console;
const chalk = require("chalk");
const { gray } = chalk;
const execa = require("execa");
const table = require("markdown-table");
const strip = require("strip-ansi");

const { MODE, SCENARIO } = process.env;

/**
 * Test harness.
 *
 * Drive all the various scenarios. To limit modes or scenario, try:
 *
 * ```sh
 * $ MODE=yarn SCENARIO=simple node test/harness.js
 * $ MODE=yarn SCENARIO=simple,huge node test/harness.js
 * $ MODE=yarn,npm SCENARIO=simple node test/harness.js
 * ```
 */
const CONFIGS = [
  { mode: "yarn" },
  { mode: "npm" }
].filter(({ mode }) => !MODE || MODE.indexOf(mode) > -1);
const SCENARIOS = [
  "simple",
  "individually",
  "huge"
].filter((s) => !SCENARIO || SCENARIO.indexOf(s) > -1);

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

// eslint-disable-next-line max-statements
const main = async () => {
  const installData = [
    ["Scenario", "Mode", "Elapsed (ms)"].map((t) => gray(t))
  ];
  const pkgData = [
    ["Scenario", "Mode", "Elapsed (ms)"].map((t) => gray(t))
  ];

  // Execute scenarios in serial (so we don't clobber shared resources like
  // `node_modules`, etc.).
  for (const { mode, scenario } of MATRIX) {
    const exec = async (cmd, args, opts) => {
      const start = Date.now();

      await execa(cmd, args, {
        cwd: path.resolve(`test/packages/${scenario}`),
        stdio: "inherit",
        env: ENV,
        ...opts
      });

      return Date.now() - start;
    };

    h2(chalk `Scenario: {gray ${JSON.stringify({ mode, scenario })}}`);
    h3("Install");
    await exec("rm", ["-rf", "node_modules"]);
    const installTime = await exec(mode, ["install"]);
    installData.push([scenario, mode, installTime]);

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
    pkgData.push([scenario, "baseline", baselineTime]);
  }

  h2(chalk `Benchmark: {gray install}`);
  log(table(installData, TABLE_OPTS));

  h2(chalk `Benchmark: {gray package}`);
  log(table(pkgData, TABLE_OPTS));
};

if (require.main === module) {
  main().catch((err) => {
    log(err);
    process.exit(1); // eslint-disable-line no-process-exit
  });
}
