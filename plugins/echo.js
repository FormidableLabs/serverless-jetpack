"use strict";

class EchoPlugin {
  constructor(serverless, options) {
    // eslint-disable-next-line no-console
    console.log("ECHO: constructor");

    this.serverless = serverless;
    this.options = options;

    this.hooks = {
      "package:cleanup": this.echo.bind(this, "package:cleanup"),
      "package:initialize": this.echo.bind(this, "package:initialize"),
      "package:setupProviderConfiguration":
        this.echo.bind(this, "package:setupProviderConfiguration"),
      "package:createDeploymentArtifacts":
        this.echo.bind(this, "package:createDeploymentArtifacts"),
      "package:compileFunctions":
        this.echo.bind(this, "package:compileFunctions"),
      "package:compileEvents": this.echo.bind(this, "package:compileEvents"),
      "package:finalize": this.echo.bind(this, "package:finalize")
    };
  }

  echo(msg) {
    // const pkg = this.serverless.service.package;
    // console.log("ECHO serverless", serverless);
    // console.log("ECHO pkg", pkg);

    // eslint-disable-next-line no-console
    console.log(`ECHO: ${msg}`, arguments);
  }
}

module.exports = EchoPlugin;
