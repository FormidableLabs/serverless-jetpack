"use strict";

const { tmpdir } = require("os");
const path = require("path");
const { promisify } = require("util");
const { access, copy, constants, mkdir, remove } = require("fs-extra");
const execa = require("execa");
const uuidv4 = require("uuid/v4");

// TODO const accessP = promisify(accessP);

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

const buildPkg = async ({ bundlePath }) => {
  const buildDir = await createBuildDir();

  // TEMP TODO
  await copy(
    "/Users/rye/Desktop/TMP_SLS/sls-packager-examples-simple.zip",
    bundlePath
  );

  // Clean up
  await remove(buildDir);
};

/**
 * Package Serverless applications manually.
 *
 * ## Configuration
 *
 * TODO
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
class PackagerPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.hooks = {
      "before:package:createDeploymentArtifacts": this.package.bind(this)
    };
  }

  async packageFunction({ functionName, functionObject }) {
    const { config: { servicePath } } = this.serverless;

    // Mimic built-in serverless naming.
    const bundleName = `${functionName}.zip`;
    const bundlePath = path.join(servicePath, bundleName);

    // Build.
    const buildDir = await buildPkg({ bundlePath });

    // Mutate serverless configuration to use our artifacts.
    functionObject.package = functionObject.package || {};
    functionObject.package.artifact = bundleName;

    // eslint-disable-next-line no-console
    console.log("TODO HERE packageFunction", {
      functionName,
      bundlePath,
      buildDir,
      functionObject
    });
  }

  async packageService() {
    const { service, config: { servicePath } } = this.serverless;
    const servicePackage = service.package;

    // Mimic built-in serverless naming.
    const serviceName = service.service;
    const bundleName = `${serviceName}.zip`;
    const bundlePath = path.join(servicePath, bundleName);

    // Build.
    const buildDir = await buildPkg({ bundlePath });

    // Mutate serverless configuration to use our artifacts.
    servicePackage.artifact = bundleName;

    // eslint-disable-next-line no-console
    console.log("TODO HERE packageService", {
      serviceName,
      bundlePath,
      buildDir,
      servicePackage
    });
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

module.exports = PackagerPlugin;
