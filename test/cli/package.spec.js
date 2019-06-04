"use strict";

const path = require("path");
const { remove, stat } = require("fs-extra");
const execa = require("execa");

// Constants.
// We're doing real builds, so these tests are **slow**...
const TIMEOUT = 5000;

// Helpers.
const exists = (filePath) => stat(filePath)
  .then(() => true)
  .catch((err) => {
    if (err.code === "ENOENT") { return false; }
    throw err;
  });

const IS_WIN = process.platform === "win32";
const SLS_CMD = `node_modules/.bin/serverless${IS_WIN ? ".cmd" : ""}`;
const sls = (args, opts) => execa(SLS_CMD, args, {
  env: {
    ...process.env,
    MODE: "yarn"
  },
  ...opts
});

describe("jetpack package", function () {
  this.timeout(TIMEOUT); // eslint-disable-line no-invalid-this

  describe("simple", () => {
    const cwd = path.resolve(__dirname, "../packages/simple/yarn");
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
      expect(stdout).to.contain("Packaged service: .serverless/serverless-jetpack-simple.zip");

      const pkgExists = await exists(path.join(PKG_DIR, "serverless-jetpack-simple.zip"));
      expect(pkgExists).to.equal(true);
    });

    it("packages the entire service with -f base", async () => {
      const { stdout } = await sls(["jetpack", "package", "-f", "base"], { cwd });
      expect(stdout).to.contain("Packaged service: .serverless/serverless-jetpack-simple.zip");

      const pkgExists = await exists(path.join(PKG_DIR, "serverless-jetpack-simple.zip"));
      expect(pkgExists).to.equal(true);
    });
  });

  describe("individually", () => {
    it("packages all functions with no options"); // TODO
    it("packages 1 function with -f base"); // TODO
  });

  it("TODO MORE TESTS");
});
