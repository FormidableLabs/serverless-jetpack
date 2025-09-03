"use strict";

const path = require("path");
const { remove } = require("fs-extra");
const execa = require("execa");
const { exists } = require("../../util/bundle");

// Constants.
// We're doing real builds, so these tests are **slow** (particularly on Win).
const TIMEOUT = 60000;

// Helpers.
const IS_WIN = process.platform === "win32";
const SLS_CMD = `node_modules/.bin/serverless${IS_WIN ? ".cmd" : ""}`;

describe("jetpack package", function () {
  this.timeout(TIMEOUT); // eslint-disable-line no-invalid-this

  let mode;
  const sls = (args, opts) => execa(SLS_CMD, args, {
    env: {
      ...process.env,
      PKG: "yarn",
      MODE: mode
    },
    ...opts
  });

  beforeEach(() => {
    mode = "deps"; // default
  });

  describe("simple", () => {
    const cwd = path.resolve(__dirname, "../packages/simple");
    const PKG_DIR = path.join(cwd, ".serverless");

    beforeEach(async () => {
      await remove(PKG_DIR);
    });

    it("displays CLI usage", async () => {
      const { stdout } = await sls(["jetpack", "package", "-h"], { cwd });
      expect(stdout)
        .to.contain("jetpack package").and
        .to.contain("--function / -f");
    });

    it("packages the entire service with no options", async () => {
      const { stdout } = await sls(["jetpack", "package"], { cwd });
      const pkg = path.normalize(".serverless/serverless-jetpack-simple.zip");
      expect(stdout).to.contain(`Packaged service (dependency mode): ${pkg}`);

      const pkgExists = await exists(path.join(PKG_DIR, "serverless-jetpack-simple.zip"));
      expect(pkgExists).to.equal(true);
    });

    it("packages the entire service with no options in trace mode", async () => {
      mode = "trace";
      const { stdout } = await sls(["jetpack", "package"], { cwd });
      const pkg = path.normalize(".serverless/serverless-jetpack-simple.zip");
      expect(stdout).to.contain(`Packaged service (trace mode): ${pkg}`);

      const pkgExists = await exists(path.join(PKG_DIR, "serverless-jetpack-simple.zip"));
      expect(pkgExists).to.equal(true);
    });

    it("packages the entire service with -f base", async () => {
      const { stdout } = await sls(["jetpack", "package", "-f", "base"], { cwd });
      const pkg = path.normalize(".serverless/serverless-jetpack-simple.zip");
      expect(stdout).to.contain(`Packaged service (dependency mode): ${pkg}`);

      expect(await exists(path.join(PKG_DIR, "serverless-jetpack-simple.zip"))).to.equal(true);
    });
  });
});
