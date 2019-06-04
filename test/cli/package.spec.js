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
      const pkg = path.normalize(".serverless/serverless-jetpack-simple.zip");
      expect(stdout).to.contain(`Packaged service: ${pkg}`);

      const pkgExists = await exists(path.join(PKG_DIR, "serverless-jetpack-simple.zip"));
      expect(pkgExists).to.equal(true);
    });

    it("packages the entire service with -f base", async () => {
      const { stdout } = await sls(["jetpack", "package", "-f", "base"], { cwd });
      const pkg = path.normalize(".serverless/serverless-jetpack-simple.zip");
      expect(stdout).to.contain(`Packaged service: ${pkg}`);

      expect(await exists(path.join(PKG_DIR, "serverless-jetpack-simple.zip"))).to.equal(true);
    });
  });

  describe("individually", () => {
    const cwd = path.resolve(__dirname, "../packages/individually/yarn");
    const PKG_DIR = path.join(cwd, ".serverless");

    beforeEach(async () => {
      await remove(PKG_DIR);
    });

    it("packages all functions with no options", async () => {
      const { stdout } = await sls(["jetpack", "package"], { cwd });
      expect(stdout)
        .to.contain(`Packaged function: ${path.normalize(".serverless/base.zip")}`).and
        .to.contain(`Packaged function: ${path.normalize(".serverless/another.zip")}`);

      expect(await exists(path.join(PKG_DIR, "base.zip"))).to.equal(true);
      expect(await exists(path.join(PKG_DIR, "another.zip"))).to.equal(true);
    });

    it("packages 1 function with -f base", async () => {
      const { stdout } = await sls(["jetpack", "package", "-f", "base"], { cwd });
      expect(stdout)
        .to.contain(`Packaged function: ${path.normalize(".serverless/base.zip")}`).and
        .to.not.contain(`Packaged function: ${path.normalize(".serverless/another.zip")}`);

      expect(await exists(path.join(PKG_DIR, "base.zip"))).to.equal(true);
      expect(await exists(path.join(PKG_DIR, "another.zip"))).to.equal(false);
    });
  });

  describe("complex", () => {
    const cwd = path.resolve(__dirname, "../packages/complex/yarn");
    const PKG_DIR = path.join(cwd, ".serverless");
    const SERVICE_PKG = path.normalize(".serverless/serverless-jetpack-simple.zip");
    const INDIVIDUALLY_PKG = path.normalize(".serverless/individually.zip");
    const DISABLED_PKG = path.normalize(".serverless/disabled.zip");

    beforeEach(async () => {
      await remove(PKG_DIR);
    });

    it("packages all functions with no options", async () => {
      const { stdout } = await sls(["jetpack", "package"], { cwd });
      expect(stdout)
        .to.contain(`Packaged service: ${SERVICE_PKG}`).and
        .to.contain(`Packaged function: ${INDIVIDUALLY_PKG}`).and
        .to.not.contain(`Packaged function: ${DISABLED_PKG}`);

      expect(await exists(path.join(cwd, SERVICE_PKG))).to.equal(true);
      expect(await exists(path.join(cwd, INDIVIDUALLY_PKG))).to.equal(true);
      expect(await exists(path.join(cwd, DISABLED_PKG))).to.equal(false);
    });

    it("packages 1 function with -f individually", async () => {
      const { stdout } = await sls(["jetpack", "package", "--function", "individually"], { cwd });
      expect(stdout)
        .to.contain(`Packaged function: ${INDIVIDUALLY_PKG}`).and
        .to.not.contain(`Packaged service: ${SERVICE_PKG}`).and
        .to.not.contain(`Packaged function: ${DISABLED_PKG}`);

      expect(await exists(path.join(cwd, INDIVIDUALLY_PKG))).to.equal(true);
      expect(await exists(path.join(cwd, SERVICE_PKG))).to.equal(false);
      expect(await exists(path.join(cwd, DISABLED_PKG))).to.equal(false);
    });

    it("packages service with -f base", async () => {
      const { stdout } = await sls(["jetpack", "package", "--function", "base"], { cwd });
      expect(stdout)
        .to.contain(`Packaged service: ${SERVICE_PKG}`).and
        .to.not.contain(`Packaged function: ${INDIVIDUALLY_PKG}`).and
        .to.not.contain(`Packaged function: ${DISABLED_PKG}`);

      expect(await exists(path.join(cwd, SERVICE_PKG))).to.equal(true);
      expect(await exists(path.join(cwd, INDIVIDUALLY_PKG))).to.equal(false);
      expect(await exists(path.join(cwd, DISABLED_PKG))).to.equal(false);
    });
  });
});
