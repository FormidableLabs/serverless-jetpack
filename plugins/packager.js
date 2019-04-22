"use strict";

class PackagerPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.hooks = {
      "before:package:createDeploymentArtifacts": this.package.bind(this)
    };
  }

  package() {
    const { service } = this.serverless;
    const pkg = service.package;

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
      && fnsPkgs.some((o) => !(o.disable || o.individually || o.artifact));

    // eslint-disable-next-line no-console
    console.log("TODO HERE", {
      pkgArtifact,
      pkgIndividually,
      shouldPackageService,
      fnsPkgs
    });
  }

  packageDEBUG() {
    const { hooks } = this.serverless.pluginManager;

    // RESEARCH: value for `sls package --name THIS_NAME`.
    const pkgFunctionName = this.options.function;

    // RESEARCH: Find the built-in package service.
    const slsPackageService = (hooks["package:createDeploymentArtifacts"] || [])
      .filter((obj) => obj.pluginName === "Package")[0];

    const slsFnPackageService = (hooks["package:function:package"] || [])
      .filter((obj) => obj.pluginName === "Package")[0];

    // eslint-disable-next-line no-console
    console.log("PKGR: TODO", {
      slsPackageService,
      slsFnPackageService,
      pkgFunctionName
    });
  }
}

module.exports = PackagerPlugin;
