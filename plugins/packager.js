"use strict";

const path = require("path");

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

    // eslint-disable-next-line no-console
    console.log("TODO HERE packageFunction", {
      functionName,
      bundlePath,
      functionObject
    });

    // TODO(EXPERIMENT): Check faster with no bundle.
    if (process.env.TEMP_NO_PACKAGE) {
      functionObject.package = functionObject.package || {};
      functionObject.package.artifact = "../../sls-packager-examples-simple.zip";
    }
  }

  async packageService() {
    const { service, config: { servicePath } } = this.serverless;
    const servicePackage = service.package;

    // Mimic built-in serverless naming.
    const serviceName = service.service;
    const bundleName = `${serviceName}.zip`;
    const bundlePath = path.join(servicePath, bundleName);

    // eslint-disable-next-line no-console
    console.log("TODO HERE packageService", {
      serviceName,
      bundlePath,
      servicePackage
    });

    // TODO(EXPERIMENT): Check faster with no bundle.
    if (process.env.TEMP_NO_PACKAGE) {
      servicePackage.artifact = "../../sls-packager-examples-simple.zip";
    }
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
