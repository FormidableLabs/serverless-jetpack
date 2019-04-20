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
    // eslint-disable-next-line no-console
    console.log(`ECHO: ${msg}`);
  }
}

module.exports = EchoPlugin;
