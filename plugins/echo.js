"use strict";

const PKG_HOOKS = [
  "package:cleanup",
  "package:initialize",
  "package:setupProviderConfiguration",
  "package:createDeploymentArtifacts",
  "package:compileFunctions",
  "package:compileEvents",
  "package:finalize"
];

const PKG_LIFECYLCES = PKG_HOOKS
  .map((h) => [`before:${h}`, h, `after:${h}`])
  .reduce((m, a) => m.concat(a), []);

class EchoPlugin {
  constructor(serverless, options) {
    // eslint-disable-next-line no-console
    console.log("ECHO: constructor");

    this.serverless = serverless;
    this.options = options;

    this.hooks = PKG_LIFECYLCES.reduce((m, h) => ({ ...m,
      [h]: this.echo.bind(this, h) }), {});
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
