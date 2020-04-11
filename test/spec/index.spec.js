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
            "node_modules/one-pkg/index.js",
            "node_modules/one-pkg/package.json"
          ] });
      });

      it("excludes ignores and package include when tracing", async () => {
        mock({
          "serverless.yml": `
            service: sls-mocked

            custom:
              jetpack:
                preInclude:
                  - "!**"
                trace:
                  ignores:
                    - two-pkg

            provider:
              name: aws
              runtime: nodejs12.x

            functions:
              numbers:
                handler: numbers.handler
              has-ignores:
                handler: has-ignores.handler
                package:
                  individually: true
                jetpack:
                  trace:
                    ignores:
                      - should-be-ignored
          `,
          "numbers.js": `
            exports.handler = async () => ({
              body: JSON.stringify({ one: require("one-pkg"), two: require("two-pkg") })
            });
          `,
          "has-ignores.js": `
            exports.handler = async () => ({
              body: JSON.stringify({ ignoreMe: require("should-be-ignored") })
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
          .to.have.callCount(2).and
          .to.be.calledWithMatch({ traceInclude: ["numbers.js"] }).and
          .to.be.calledWithMatch({ traceInclude: ["has-ignores.js"] });
        expect(bundle.createZip)
          .to.have.callCount(2).and
          .to.be.calledWithMatch({ files: [
            "numbers.js",
            "node_modules/one-pkg/index.js",
            "node_modules/one-pkg/package.json"
          ] }).and
          .to.be.calledWithMatch({ files: [
            "has-ignores.js"
          ] });
      });

      it("allows missing when tracing", async () => {
        mock({
          "serverless.yml": `
            service: sls-mocked

            custom:
              jetpack:
                preInclude:
                  - "!**"
                trace:
                  allowMissing:
                    all-missing:
                      - one-missing
                    partially-missing:
                      - one-missing

            provider:
              name: aws
              runtime: nodejs12.x

            functions:
              numbers:
                handler: numbers.handler
              has-missings:
                handler: has-missings.handler
                package:
                  individually: true
                jetpack:
                  trace:
                    allowMissing:
                      partially-missing:
                        - two-missing
                        - three-actually-on-disk
          `,
          "numbers.js": `
            exports.handler = async () => ({
              body: JSON.stringify({
                one: require("one-pkg"),
                oneMissing: require("all-missing"),
                two: require("two-pkg")
              })
            });
          `,
          "has-missings.js": `
            exports.handler = async () => ({
              body: JSON.stringify({
                someMissing: require("partially-missing")
              })
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
            },
            "all-missing": {
              "package.json": stringify({
                main: "index.js"
              }),
              "index.js": `
                module.exports = {
                  oneMissing: require("one-missing")
                };
              `
            },
            "partially-missing": {
              "package.json": stringify({
                main: "index.js"
              }),
              "index.js": `
                module.exports = {
                  oneMissing: require("one-missing"),
                  twoMissing: require("two-missing"),
                  threeFound: require("three-actually-on-disk")
                };
              `
            },
            "three-actually-on-disk": {
              "package.json": stringify({
                main: "index.js"
              }),
              "index.js": "module.exports = 'Here I am!';"
            }
          }
        });

        const plugin = new Jetpack(await createServerless());
        await plugin.package();
        expect(Jetpack.prototype.globAndZip)
          .to.have.callCount(2).and
          .to.be.calledWithMatch({ traceInclude: ["numbers.js"] }).and
          .to.be.calledWithMatch({ traceInclude: ["has-missings.js"] });
        expect(bundle.createZip)
          .to.have.callCount(2).and
          .to.be.calledWithMatch({ files: [
            "numbers.js",
            "node_modules/all-missing/index.js",
            "node_modules/all-missing/package.json",
            "node_modules/one-pkg/index.js",
            "node_modules/one-pkg/package.json",
            "node_modules/two-pkg/index.js",
            "node_modules/two-pkg/package.json"
          ] }).and
          .to.be.calledWithMatch({ files: [
            "has-missings.js",
            "node_modules/partially-missing/index.js",
            "node_modules/partially-missing/package.json",
            "node_modules/three-actually-on-disk/index.js",
            "node_modules/three-actually-on-disk/package.json"
          ] });
      });

      it("traces with various trace.include options", async () => {
        mock({
          "serverless.yml": `
            service: sls-mocked

            custom:
              jetpack:
                preInclude:
                  - "!**"
                trace:
                  include:
                    # Additional trace files for all service + individually packages
                    - "additional.*"

            provider:
              name: aws
              runtime: nodejs12.x

            functions:
              # Service functions
              one:
                handler: one.handler
                jetpack:
                  trace:
                    include:
                      # Additional source file to trace.
                      - "extra*"
              two:
                handler: two.handler
              # Individually functions
              red:
                handler: red.handler
                package:
                  individually: true
                jetpack:
                  trace:
                    include:
                      - "green.*"
              dont-include:
                handler: dont-include.handler
                package:
                  individually: true
                  disable: true
          `,
          "additional.js": `
            exports.handler = async () => ({
              body: JSON.stringify({ addl: require("additional-pkg") })
            });
          `,
          "one.js": `
            exports.handler = async () => ({
              body: JSON.stringify({ one: require("one-pkg") })
            });
          `,
          "extra.js": `
            exports.handler = async () => ({
              body: JSON.stringify({ extra: require.resolve("extra-pkg") })
            });
          `,
          "two.js": `
            exports.handler = async () => ({
              body: JSON.stringify({ two: require("two-pkg") })
            });
          `,
          "red.js": `
            exports.handler = async () => ({
              body: JSON.stringify({ one: require("red-pkg") })
            });
          `,
          "green.js": `
            exports.handler = async () => ({
              body: JSON.stringify({ one: require("green-pkg") })
            });
          `,
          "dont-include.js": `
            exports.handler = async () => ({
              body: JSON.stringify({ one: require("dont-include-pkg") })
            });
          `,
          node_modules: {
            "additional-pkg": {
              "package.json": stringify({
                main: "index.js"
              }),
              "index.js": "module.exports = 'additional';"
            },
            "one-pkg": {
              "package.json": stringify({
                main: "index.js"
              }),
              "index.js": "module.exports = 'one';"
            },
            "extra-pkg": {
              "package.json": stringify({
                main: "index.js"
              }),
              "index.js": "module.exports = 'extra';"
            },
            "two-pkg": {
              "package.json": stringify({
                main: "index.js"
              }),
              "index.js": "module.exports = 'two';"
            },
            "red-pkg": {
              "package.json": stringify({
                main: "index.js"
              }),
              "index.js": "module.exports = 'red';"
            },
            "green-pkg": {
              "package.json": stringify({
                main: "index.js"
              }),
              "index.js": "module.exports = 'green';"
            },
            "dont-include-pkg": {
              "package.json": stringify({
                main: "index.js"
              }),
              "index.js": "module.exports = 'dont-include';"
            }
          }
        });

        const plugin = new Jetpack(await createServerless());
        await plugin.package();
        expect(Jetpack.prototype.globAndZip)
          .to.have.callCount(2).and
          // service package
          .to.be.calledWithMatch({ traceInclude: [
            "one.js", "two.js", "additional.*", "extra*"
          ] }).and
          // function package
          .to.be.calledWithMatch({ traceInclude: [
            "red.js", "additional.*", "green.*"
          ] });
        expect(bundle.createZip)
          .to.have.callCount(2).and
          // service package
          .to.be.calledWithMatch({ files: [
            "one.js",
            "two.js",
            "additional.js",
            "extra.js",
            "node_modules/additional-pkg/index.js",
            "node_modules/additional-pkg/package.json",
            "node_modules/extra-pkg/index.js",
            "node_modules/extra-pkg/package.json",
            "node_modules/one-pkg/index.js",
            "node_modules/one-pkg/package.json",
            "node_modules/two-pkg/index.js",
            "node_modules/two-pkg/package.json"
          ] }).and
          // function package
          .to.be.calledWithMatch({ files: [
            "red.js",
            "additional.js",
            "green.js",
            "node_modules/additional-pkg/index.js",
            "node_modules/additional-pkg/package.json",
            "node_modules/green-pkg/index.js",
            "node_modules/green-pkg/package.json",
            "node_modules/red-pkg/index.js",
            "node_modules/red-pkg/package.json"
          ] });
      });
    });

    describe("configurations", () => {
      beforeEach(() => {
        // Don't actually read disk and bundle.
        sandbox.stub(Jetpack.prototype, "globAndZip").returns(Promise.resolve({
          buildTime: 0,
          collapsed: { srcs: {}, pkgs: {} }
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

  describe("collapsed zip", () => {
    beforeEach(() => {
      // Don't actually read disk and bundle.
      sandbox.stub(Jetpack.prototype, "globAndZip").returns(Promise.resolve({
        buildTime: 0,
        collapsed: { srcs: {}, pkgs: {} }
      }));
    });

    it("warns on collapsed files", async () => {
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
            body: JSON.stringify({ message: "one" })
          });
        `
      });

      const collapsed = {
        srcs: {
          "src/foo": {
            numUniquePaths: 2,
            numTotalFiles: 4
          },
          "src/foo/one": {
            numUniquePaths: 1,
            numTotalFiles: 2
          }
        },
        pkgs: {
          lodash: {
            packages: [
              {
                path: "node_modules/lodash",
                version: "4.17.11"
              },
              {
                path: "../node_modules/lodash",
                version: "4.17.15"
              }
            ],
            numUniquePaths: 108,
            numTotalFiles: 216
          }
        }
      };
      const plugin = new Jetpack(await createServerless());
      plugin._handleCollapsed({ collapsed, bundleName: "one.zip" });
      /* eslint-disable max-len*/
      expect(serverless.cli.log)
        .to.have.callCount(4).and // eslint-disable-line no-magic-numbers
        .to.be.calledWithMatch("WARNING: Found 2 collapsed source files in one.zip!").and
        .to.be.calledWithMatch(`one.zip collapsed source files:
        - src/foo (2 unique, 4 total)
        - src/foo/one (1 unique, 2 total)`.replace(/^[ ]*/gm, "")).and
        .to.be.calledWithMatch("WARNING: Found 1 collapsed dependencies in one.zip!").and
        .to.be.calledWithMatch(
          `one.zip collapsed dependencies:
          - lodash (108 unique, 216 total): [node_modules/lodash@4.17.11, ../node_modules/lodash@4.17.15]`
            .replace(/^[ ]*/gm, "")
        );
      /* eslint-enable max-len*/
    });
  });
});
