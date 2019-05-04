"use strict";

/**
 * Tests to ensure that serverless-jetpack mostly matches the file exclude and
 * include globbing logic of serverless.
 */

const mock = require("mock-fs");

const Jetpack = require("../..");
const packageService = require("serverless/lib/plugins/package/lib/packageService");

// Serverless mixes in the function, so we do for a mock.
class Sls {
  constructor(serverless) {
    this.serverless = serverless;
    Object.assign(this, packageService);
  }
}

describe("globbing (include/exclude) logic", () => {
  let plugin;
  let sls;

  // Bridge to compare equality between jetpack and serverless.
  // eslint-disable-next-line max-statements
  const compare = async ({ pkgExclude, pkgInclude, fnExclude, fnInclude }) => {
    let pluginFiles;
    let pluginError;

    plugin.serverless.service.package.exclude = pkgExclude;
    plugin.serverless.service.package.include = pkgInclude;

    try {
      pluginFiles = await plugin.resolveProjectFilePathsFromPatterns(
        plugin.filePatterns({
          functionObject: {
            "package": {
              include: fnInclude,
              exclude: fnExclude
            }
          }
        })
      );
    } catch (pluginErr) {
      pluginError = pluginErr;
    }

    // Patch serverless object to do "most" of what normal include/exclude
    // logic is.
    sls.serverless.service.package.exclude = pkgExclude;
    const slsPkgExcludes = await sls.getExcludes(fnExclude || []);

    sls.serverless.service.package.include = pkgInclude;
    const slsPkgIncludes = sls.getIncludes(fnInclude || []);

    let slsFiles;
    let slsError;
    try {
      slsFiles = await sls.resolveFilePathsFromPatterns({
        exclude: slsPkgExcludes,
        include: slsPkgIncludes
      });
    } catch (slsErr) {
      slsError = slsErr;
    }

    // Check errors.
    if (slsError) {
      expect(slsError).to.have.property("message");
      expect(pluginError).to.have.property("message", slsError.message);

      return pluginError;
    }

    // Check files.
    expect(pluginFiles).to.eql(slsFiles);

    return pluginFiles;
  };

  beforeEach(() => {
    mock({});

    const slsBase = {
      config: {
        servicePath: ""
      },
      classes: {
        Error
      },
      pluginManager: {
        parsePluginsObject: () => ({})
      },
      service: {
        "package": {
          exclude: [],
          include: []
        },
        getAllLayers: () => []
      }
    };

    plugin = new Jetpack(slsBase);
    sls = new Sls(slsBase);
  });

  afterEach(() => {
    mock.restore();
  });

  it("should error on no patterns, no matches", async () => {
    expect(await compare({}))
      .to.be.an("Error").and
      .to.have.property("message", "No file matches include / exclude patterns");
  });

  it("should match on no patterns, basic sources", async () => {
    mock({
      src: {
        "index.js": "module.exports = 'foo';"
      }
    });

    expect(await compare({})).to.eql([
      "src/index.js"
    ]);
  });

  it("should handle basic sources and dependencies"); // TODO
  it("should handle basic dependencies"); // TODO

  // TODO: MORE TESTS
});
