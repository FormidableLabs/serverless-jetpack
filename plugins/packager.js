"use strict";

class PackagerPlugin {
  constructor(serverless) {
    this.serverless = serverless;
    this.hooks = {
      "before:package:createDeploymentArtifacts": this.package.bind(this)
    };
  }

  package() {
    // eslint-disable-next-line no-console
    console.log("PKGR: TODO");
  }
}

module.exports = PackagerPlugin;
