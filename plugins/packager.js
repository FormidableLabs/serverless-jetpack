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

    // Gather internal configuration.
    const pkgArtifact = pkg.artifact;
    const pkgIndividually = pkg.individually;
    const fnsPkgs = service.getAllFunctions()
      .map((name) => ({ name, pkg: service.getFunction(name).package || {} }))
      .map((obj) => ({
        name: obj.name,
        disable: !!obj.pkg.disable,
        individually: !!obj.pkg.individually,
        artifact: !!obj.pkg.artifact
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
      });

    // Package entire service if applicable.
    if (shouldPackageService) {
      // eslint-disable-next-line no-console
      console.log("TODO HERE SERVICE PACKAGE", {
        pkgArtifact,
        pkgIndividually,
        shouldPackageService
      });
    }
  }
}

module.exports = PackagerPlugin;
