"use strict";

const path = require("path");
const { log } = console;
const chalk = require("chalk");
const { gray } = chalk;
const execa = require("execa");
const table = require("markdown-table");
const strip = require("strip-ansi");

const { TEST_MODE, TEST_SCENARIO, TEST_LOCKFILE } = process.env;

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
    ["Scenario", "Mode", "Lockfile", "Type", "Time", "vs Base"].map((t) => gray(t))
  ];

  // Execute scenarios in serial.
  for (const { scenario, mode, lockfile } of MATRIX) {
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

    h2(chalk `Scenario: {gray ${JSON.stringify({ scenario, mode, lockfile })}}`);

    // Remove bad symlinks.
    await exec("sh", ["-c", "find . -type l ! -exec test -e {} \\; -print | xargs rm"]);

    h3("Jetpack");
    const pluginTime = await exec("node_modules/.bin/serverless", ["package"], {
      env: {
        ...ENV,
        MODE: mode,
        LOCKFILE: lockfile
      }
    });

    // Copy zips.
    const pluginArchive = path.join(__dirname,
      "../.test-zips", scenario, mode, lockfile, "jetpack");
    await exec("rm", ["-rf", pluginArchive]);
    await exec("mkdir", ["-p", pluginArchive]);
    await exec("cp", ["-rp", ".serverless/*.zip", pluginArchive], {
      shell: true
    });

    h3("Baseline");
    const baselineTime = await exec("serverless", ["package"]);
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

    pkgData.push(pluginRow);
    pkgData.push([scenario, mode, lockfile, "baseline", baselineTime, ""]);
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
