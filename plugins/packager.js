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
