"use strict";

const pkg = require("./package.json");
const { tmpdir } = require("os");
const path = require("path");
const { access, copy, constants, createWriteStream, mkdir, remove } = require("fs-extra");
const archiver = require("archiver");
const execa = require("execa");
const uuidv4 = require("uuid/v4");

const SLS_TMP_DIR = ".serverless";
const PLUGIN_NAME = pkg.name;

const dirExists = async (dirPath) => {
  try {
    await access(dirPath, constants.W_OK);
    return true;
  } catch (_) {
    return false;
  }
};

// Create new temp build directory, return path.
const createBuildDir = async () => {
  // Create and verify a unique temp directory path.
  let tmpPath;
  do {
    tmpPath = path.join(tmpdir(), uuidv4());
  } while (await !dirExists(tmpPath));

  // Create directory.
  await mkdir(tmpPath);

  return tmpPath;
};

const createZip = ({ buildPath, bundlePath }) => {
  // Use Serverless-analogous library + logic to create zipped artifact.
  const zip = archiver.create("zip");
  const output = createWriteStream(bundlePath);

  return new Promise((resolve, reject) => { // eslint-disable-line promise/avoid-new
    output.on("close", () => resolve());
    output.on("error", reject);
    zip.on("error", reject);

    output.on("open", () => {
      zip.pipe(output);

      // Serverless framework packages up files individually with various tweaks
      // (setting file times to epoch, chmod-ing things, etc.) that we don't do
      // here. Instead we just zip up the whole build directory.
      // See: https://github.com/serverless/serverless/blob/master/lib/plugins/package/lib/zipService.js#L91-L104
      zip.directory(buildPath, false);

      zip.finalize();
    });
  });
};

/**
 * Package Serverless applications manually.
 *
 * ## How it works
 *
 * Essentially, the plugin "tricks" Serverless into thinking that an artifact
 * is specified, which skips all normal Serverless packaging, and then does
 * the packaging manually.
 *
 * Functionally, this looks something like:
 * 1. Looks for any services and/or functions that the Serverless framework
 *    would publish with its built-in logic,
 * 2. Disables this by setting `service|function.pacakge.artifact` fields in
 *    the runtime Serverless configuration object, and;
 * 3. Invoking scripts to create an artifact that matches the newly-set
 *    `.artifact` paths in configuration
 *
 * ## Application
 *
 * This plugin only is invoked to create custom packages if default Serverless
 * packaging would apply. Notably, this means this plugin is a noop for
 * scenarios including:
 * - `service.package.artifact`
 * - `function.package.artifact`
 * - `function.package.disable`
 *
 * The plugin does apply and follows the logic of configurations that include:
 * - `service.package.individually`
 * - `function.package.individually`
 */
class Jetpack {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;

    this.commands = {
      jetpack: {
        usage: pkg.description,
        options: {
          mode: {
            usage: "Installation mode (default: `yarn`)",
            shortcut: "m"
          },
          lockfile: {
            usage:
              "Path to lockfile (default: `yarn.lock` for `mode: yarn`, "
              + "`package-lock.json` for `mode: npm`)",
            shortcut: "l"
          }
        }
      }
    };

    this.hooks = {
      "before:package:createDeploymentArtifacts": this.package.bind(this)
    };
  }

  _log(msg) {
    const { cli } = this.serverless;
    cli.log(`[${PLUGIN_NAME}] ${msg}`);
  }

  _logDebug(msg) {
    if (process.env.SLS_DEBUG) {
      this._log(msg);
    }
  }

  async installDeps({ mode, buildPath }) {
    // Determine if can use npm ci.
    const haveLockfile = true; // TODO(OPTIONS): Take lockfile path or null.
    const install = "install";
    if (mode === "npm" && haveLockfile) {
      // TODO HERE

      // await execa("npm", ["--version"])
    }

    // TODO(OPTIONS): enable/disable stdio.
    // npm/yarn install.
    const installArgs = [
      mode === "yarn" ? "install" : "ci",
      "--production",
      mode === "yarn" ? "--frozen-lockfile" : null
    ].filter(Boolean);

    this._logDebug(`Performing production install: ${mode} ${installArgs.join(" ")}`);
    await execa(mode, installArgs, {
      stdio: "inherit",
      cwd: buildPath
    });
  }

  async buildPackage({ bundleName }) {
    const { config } = this.serverless;
    const servicePath = config.servicePath || ".";
    const bundlePath = path.resolve(servicePath || ".", bundleName);

    const buildPath = await createBuildDir();

    // TODO(OPTIONS): use options
    const mode = process.env.MODE || "yarn";
    const srcs = ["src"];

    // Copy over npm/yarn files.
    this._logDebug("Copying source files and package data to build directory");
    await Promise.all([
      "package.json",
      mode === "yarn" ? "yarn.lock" : "package-lock.json"
    ]
      .concat(srcs)
      .map((f) => copy(
        path.resolve(servicePath, f),
        path.resolve(buildPath, f)
      ))
    );

    // Install into build directory.
    await this.installDeps({ mode, buildPath });

    // Create package zip.
    this._logDebug(`Zipping build directory ${buildPath} to artifact location: ${bundlePath}`);
    await createZip({ buildPath, bundlePath });

    // Clean up
    await remove(buildPath);
  }

  async packageFunction({ functionName, functionObject }) {
    // Mimic built-in serverless naming.
    // **Note**: We _do_ appened ".serverless" in path skipping serverless'
    // internal copying logic.
    const bundleName = path.join(SLS_TMP_DIR, `${functionName}.zip`);

    // Build.
    this._log(`Packaging function: ${bundleName}`);
    await this.buildPackage({ bundleName });

    // Mutate serverless configuration to use our artifacts.
    functionObject.package = functionObject.package || {};
    functionObject.package.artifact = bundleName;
  }

  async packageService() {
    const { service } = this.serverless;
    const serviceName = service.service;
    const servicePackage = service.package;

    // Mimic built-in serverless naming.
    const bundleName = path.join(SLS_TMP_DIR, `${serviceName}.zip`);

    // Build.
    this._log(`Packaging service: ${bundleName}`);
    await this.buildPackage({ bundleName });

    // Mutate serverless configuration to use our artifacts.
    servicePackage.artifact = bundleName;
  }

  async package() {
    const { service } = this.serverless;
    const servicePackage = service.package;

    // Gather internal configuration.
    const fnsPkgs = service.getAllFunctions()
      .map((functionName) => ({
        functionName,
        functionObject: service.getFunction(functionName)
      }))
      .map((obj) => ({
        ...obj,
        functionPackage: obj.functionObject.package || {}
      }))
      .map((obj) => ({
        ...obj,
        disable: !!obj.functionPackage.disable,
        individually: !!obj.functionPackage.individually,
        artifact: obj.functionPackage.artifact
      }));

    // Now, iterate all functions and decide if this plugin should package them.
    await Promise.all(fnsPkgs
      .filter((obj) =>
        (servicePackage.individually || obj.individually) && !(obj.disable || obj.artifact)
      )
      .map((obj) => this.packageFunction(obj))
    );

    // We recreate the logic from `packager#packageService` for deciding whether
    // to package the service or not.
    const shouldPackageService = !servicePackage.individually
      && fnsPkgs.some((obj) => !(obj.disable || obj.individually || obj.artifact));

    // Package entire service if applicable.
    if (shouldPackageService && !servicePackage.artifact) {
      await this.packageService();
    }
  }
}

module.exports = Jetpack;
