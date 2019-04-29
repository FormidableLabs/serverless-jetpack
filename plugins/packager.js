"use strict";

class PackagerPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.hooks = {
      "before:package:createDeploymentArtifacts": this.package.bind(this)
    };
  }

  async package() {
    const { service } = this.serverless;
    const pkg = service.package;
    const serviceName = service.service;

    // Gather internal configuration.
    const pkgArtifact = pkg.artifact;
    const pkgIndividually = pkg.individually;
    const fnsPkgs = service.getAllFunctions()
      .map((name) => ({
        name,
        functionObject: service.getFunction(name)
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

    // We recreate the logic from `packager#packageService`.
    const shouldPackageService = !pkgIndividually
      && fnsPkgs.some((obj) => !(obj.disable || obj.individually || obj.artifact));

    // Now, iterate all functions and decide if this plugin should package them.
    fnsPkgs
      .filter((obj) => (pkgIndividually || obj.individually) && !(obj.disable || obj.artifact))
      .forEach((obj) => {
        // eslint-disable-next-line no-console
        console.log("TODO HERE FN PACKAGE", obj);

        // TODO(EXPERIMENT): Check faster with no bundle.
        if (process.env.TEMP_NO_PACKAGE) {
          obj.functionObject.package = obj.functionObject.package || {};
          obj.functionObject.package.artifact = "../../sls-packager-examples-simple.zip";
        }
      });

    // Package entire service if applicable.
    if (shouldPackageService && !pkgArtifact) {
      // TODO(EXPERIMENT): Check faster with no bundle.
      if (process.env.TEMP_NO_PACKAGE) {
        pkg.artifact = "../../sls-packager-examples-simple.zip";
      }

      // eslint-disable-next-line no-console
      console.log("TODO HERE SERVICE PACKAGE", {
        pkgArtifact,
        pkgIndividually,
        shouldPackageService,
        serviceName
      });
    }
  }
}

module.exports = PackagerPlugin;
