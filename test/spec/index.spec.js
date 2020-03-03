"use strict";

/* eslint no-magic-numbers: ["error", { "ignore": [0, 1, 2, 3] }], camelcase: "off" */

/**
 * Plugin tests.
 */

const mock = require("mock-fs");
const sinon = require("sinon");

const Serverless = require("serverless");
const { getServerlessConfigFile } = require("serverless/lib/utils/getServerlessConfigFile");
const Jetpack = require("../..");
const bundle = require("../../util/bundle");

const INDENT = 2;
const stringify = (val) => JSON.stringify(val, null, INDENT);

describe("index", () => {
  let sandbox;
  let serverless;

  // [BRITTLE]: Create a mostly-real serverless object for config parsing.
  const createServerless = async () => {
    serverless = new Serverless();
    serverless.processedInput = {
      options: {},
      commands: []
    };
    serverless.cli = {
      log: sandbox.stub()
    };
    await serverless.pluginManager.loadConfigFile();
    await serverless.service.load();

    return serverless;
  };

  beforeEach(() => {
    mock({});
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
    mock.restore();

    // [BRITTLE]: Manually reset the serverless lodash cache.
    getServerlessConfigFile.cache = new Map();
  });

  describe("trace mode", () => {
    // Slower tests that go all the way to Zipping.
    describe("packaging", () => {
      beforeEach(() => {
        // Just spy. Do real globbing / tracing in in-memory FS.
        sandbox.spy(Jetpack.prototype, "globAndZip");

        // Take out slow zipping and stub to inspect instead.
        sandbox.stub(bundle, "createZip").returns(Promise.resolve());
      });

      it("traces dependencies", async () => {
        mock({
          "serverless.yml": `
            service: sls-mocked

            custom:
              jetpack:
                trace: true

            provider:
              name: aws
              runtime: nodejs12.x

            functions:
              one:
                handler: one.handler
          `,
          "one.js": `
            exports.handler = async () => ({
              body: JSON.stringify({ message: require("one-pkg") })
            });
          `,
          node_modules: {
            "one-pkg": {
              "package.json": stringify({
                main: "index.js"
              }),
              "index.js": "module.exports = 'one';"
            }
          }
        });

        const plugin = new Jetpack(await createServerless());
        await plugin.package();
        expect(Jetpack.prototype.globAndZip)
          .to.have.callCount(1).and
          .to.be.calledWithMatch({ traceInclude: ["one.js"] });
        expect(bundle.createZip)
          .to.have.callCount(1).and
          .to.be.calledWithMatch({ files: [
            "one.js",
            "node_modules/one-pkg/index.js"
          ] });
      });

      // TODO: HERE -- IMPLEMENT AND PASS TEST
      it.skip("excludes ignores and package include when tracing", async () => {
        mock({
          "serverless.yml": `
            service: sls-mocked

            custom:
              jetpack:
                trace:
                  ignores:
                    - two-pkg

            provider:
              name: aws
              runtime: nodejs12.x

            functions:
              numbers:
                handler: numbers.handler
          `,
          "numbers.js": `
            exports.handler = async () => ({
              body: JSON.stringify({ one: require("one-pkg"), two: require("two-pkg") })
            });
          `,
          node_modules: {
            "one-pkg": {
              "package.json": stringify({
                main: "index.js"
              }),
              "index.js": "module.exports = 'one';"
            },
            "two-pkg": {
              "package.json": stringify({
                main: "index.js"
              }),
              "index.js": "module.exports = 'two';"
            }
          }
        });

        const plugin = new Jetpack(await createServerless());
        await plugin.package();
        expect(Jetpack.prototype.globAndZip)
          .to.have.callCount(1).and
          .to.be.calledWithMatch({ traceInclude: ["numbers.js"] });
        expect(bundle.createZip)
          .to.have.callCount(1).and
          .to.be.calledWithMatch({ files: [
            "numbers.js",
            "node_modules/one-pkg/index.js"
          ] });
      });

      it("traces with trace.include options"); // TODO

      // TODO: service-level include
      // TODO: service-packaged function with additional include
      // TODO: individually include
    });

    describe("configurations", () => {
      beforeEach(() => {
        // Don't actually read disk and bundle.
        sandbox.stub(Jetpack.prototype, "globAndZip").returns(Promise.resolve({
          buildTime: 0
        }));
      });

      it("traces with service config even if non-individually function is false", async () => {
        mock({
          "serverless.yml": `
            service: sls-mocked

            custom:
              jetpack:
                trace: true

            provider:
              name: aws
              runtime: nodejs12.x

            functions:
              one:
                handler: one.handler
              two:
                handler: two.handler
                # Because not individually packaged, trace=false will have no effect.
                jetpack:
                  trace: false
          `,
          "one.js": `
            exports.handler = async () => ({
              body: JSON.stringify({ message: "one" })
            });
          `,
          "two.js": `
            exports.handler = async () => ({
              body: JSON.stringify({ message: "two" })
            });
          `
        });

        const plugin = new Jetpack(await createServerless());
        await plugin.package();
        expect(Jetpack.prototype.globAndZip)
          .to.have.callCount(1).and
          .to.be.calledWithMatch({ traceInclude: ["one.js", "two.js"] });
      });

      it("traces with service config and skips individually + trace=false functions", async () => {
        mock({
          "serverless.yml": `
            service: sls-mocked

            custom:
              jetpack:
                trace: true

            provider:
              name: aws
              runtime: nodejs12.x

            functions:
              one:
                handler: one.handler
              two:
                handler: two.handler
                # Because individually packaged, service trace=true will apply.
                package:
                  individually: true
              three:
                handler: three.handler
                # Because individually packaged, fn trace=false will apply.
                package:
                  individually: true
                jetpack:
                  trace: false
          `,
          "one.js": `
            exports.handler = async () => ({
              body: JSON.stringify({ message: "one" })
            });
          `,
          "two.js": `
            exports.handler = async () => ({
              body: JSON.stringify({ message: "two" })
            });
          `
        });

        const plugin = new Jetpack(await createServerless());
        await plugin.package();
        expect(Jetpack.prototype.globAndZip)
          .to.have.callCount(3).and
          .to.be.calledWithMatch({ traceInclude: ["one.js"] }).and
          .to.be.calledWithMatch({ traceInclude: ["two.js"] }).and
          .to.be.calledWithMatch({ traceInclude: undefined });
      });

      it("pattern matches service and traces individually + trace=true functions", async () => {
        mock({
          "serverless.yml": `
            service: sls-mocked

            package:
              individually: true

            provider:
              name: aws
              runtime: nodejs12.x

            functions:
              one:
                handler: one.handler
              two:
                handler: two.handler
                # Default service-level false for individually. This will trace.
                jetpack:
                  trace: true
              three:
                handler: three.handler
                # Explicit false should also not trace.
                jetpack:
                  trace: false
          `,
          "two.js": `
            exports.handler = async () => ({
              body: JSON.stringify({ message: "two" })
            });
          `
        });

        const plugin = new Jetpack(await createServerless());
        await plugin.package();
        expect(Jetpack.prototype.globAndZip)
          .to.have.callCount(3).and
          .to.be.calledWithMatch({ traceInclude: ["two.js"] }).and
          .to.be.calledWithMatch({ traceInclude: undefined }).and
          .to.not.be.calledWithMatch({ traceInclude: ["one.js"] }).and
          .to.not.be.calledWithMatch({ traceInclude: ["three.js"] });
      });

      it("traces for service-level individually and trace", async () => {
        mock({
          "serverless.yml": `
            service: sls-mocked

            package:
              individually: true

            custom:
              jetpack:
                trace: true

            provider:
              name: aws
              runtime: nodejs12.x

            functions:
              one:
                handler: one.handler
              two:
                handler: two.handler
                # Explicit true should trace.
                jetpack:
                  trace: true
              three:
                handler: three.handler
                # Explicit false should not trace.
                jetpack:
                  trace: false
          `,
          "one.js": `
            exports.handler = async () => ({
              body: JSON.stringify({ message: "one" })
            });
          `,
          "two.js": `
            exports.handler = async () => ({
              body: JSON.stringify({ message: "two" })
            });
          `
        });

        const plugin = new Jetpack(await createServerless());
        await plugin.package();
        expect(Jetpack.prototype.globAndZip)
          .to.have.callCount(3).and
          .to.be.calledWithMatch({ traceInclude: ["one.js"] }).and
          .to.be.calledWithMatch({ traceInclude: ["two.js"] }).and
          .to.be.calledWithMatch({ traceInclude: undefined }).and
          .to.not.be.calledWithMatch({ traceInclude: ["three.js"] });
      });
    });
  });
});
