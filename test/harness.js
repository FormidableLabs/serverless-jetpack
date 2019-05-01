"use strict";

const path = require("path");
const { log } = console;
const execa = require("execa");

/**
 * Test harness.
 *
 * Drive all the various scenarios.
 */
const CONFIGS = [
  { mode: "yarn" }
  // { mode: "npm" }
];
const SCENARIOS = [
  "simple"
  // "individually",
  // "huge"
];
const MATRIX = CONFIGS
  .map((c) => SCENARIOS.map((scenario) => ({ ...c, scenario })))
  .reduce((m, a) => m.concat(a), []);

const ENV = {
  STAGE: "sandbox",
  AWS_REGION: "us-east-1",
  ...process.env
};

const main = async () => {
  await Promise.all(MATRIX.map(async ({ mode, scenario }) => {
    const exec = (cmd, args, opts) => execa(cmd, args, {
      cwd: path.resolve(`test/packages/${scenario}`),
      stdio: "inherit",
      env: ENV,
      ...opts
    });

    log(`## ${JSON.stringify({ mode, scenario })}`);
    log("### Install");
    await exec("rm", ["-rf", "node_modules"]);
    await exec(mode, ["install"]);
    // Remove bad symlinks.
    await exec("sh", ["-c", "find . -type l ! -exec test -e {} \\; -print | xargs rm"])

    log("### Plugin");
    await exec("serverless", ["package"], {
      env: {
        ...ENV,
        PLUGIN: "true"
      }
    });

    log("### Baseline");
    await exec("serverless", ["package"]);
  }));
};

if (require.main === module) {
  main().catch((err) => {
    log(err);
    process.exit(1); // eslint-disable-line no-process-exit
  });
}
