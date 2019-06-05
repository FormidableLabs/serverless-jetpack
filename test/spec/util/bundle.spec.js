"use strict";

/**
 * Tests to ensure that serverless-jetpack mostly matches the file exclude and
 * include globbing logic of serverless.
 */

const mock = require("mock-fs");

const Jetpack = require("../../..");
const { resolveFilePathsFromPatterns } = require("../../../util/bundle");
const packageService = require("serverless/lib/plugins/package/lib/packageService");

// Serverless mixes in the function, so we do for a mock.
class Sls {
  constructor(serverless) {
    this.serverless = serverless;
    Object.assign(this, packageService);
  }
}

const pluginAdapter = async ({ plugin, pkgExclude, pkgInclude, fnExclude, fnInclude }) => {
  plugin.serverless.service.package.exclude = pkgExclude;
  plugin.serverless.service.package.include = pkgInclude;

  const servicePath = plugin.serverless.servicePath || ".";
  const { include, exclude } = plugin.filePatterns({
    functionObject: {
      "package": {
        include: fnInclude,
        exclude: fnExclude
      }
    }
  });

  return await resolveFilePathsFromPatterns({ servicePath, include, exclude });
};

const slsAdapter = async ({ sls, pkgExclude, pkgInclude, fnExclude, fnInclude }) => {
  sls.serverless.service.package.exclude = pkgExclude;
  const slsPkgExcludes = await sls.getExcludes(fnExclude || []);

  sls.serverless.service.package.include = pkgInclude;
  const slsPkgIncludes = sls.getIncludes(fnInclude || []);

  return await sls.resolveFilePathsFromPatterns({
    exclude: slsPkgExcludes,
    include: slsPkgIncludes
  });
};

describe("util/bundle#resolveFilePathsFromPatterns", () => {
  let plugin;
  let sls;

  // Bridge to compare equality between jetpack and serverless.
  // eslint-disable-next-line max-statements
  const compare = async ({ pkgExclude, pkgInclude, fnExclude, fnInclude }) => {
    let pluginFiles;
    let pluginError;

    try {
      pluginFiles = await pluginAdapter({ plugin, pkgExclude, pkgInclude, fnExclude, fnInclude });
    } catch (pluginErr) {
      pluginError = pluginErr;
    }

    let slsFiles;
    let slsError;
    try {
      slsFiles = await slsAdapter({ sls, pkgExclude, pkgInclude, fnExclude, fnInclude });
    } catch (slsErr) {
      slsError = slsErr;
    }

    // Check errors.
    if (slsError) {
      expect(slsError).to.be.ok.and.to.have.property("message");
      expect(pluginError).to.be.ok.and.to.have.property("message", slsError.message);

      return pluginError;
    } else if (pluginError) {
      // Should **not** have a plugin error alone.
      throw pluginError;
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

  it("should handle broad exclude and include re-adding in", async () => {
    mock({
      src: {
        "index.js": "module.exports = 'index';",
        "bar.js": "module.exports = 'bar';",
        "baz.js": "module.exports = 'baz';",
        stuff: {
          "what.css": "what",
          "what.svg": "what"
        }
      }
    });

    expect(await compare({
      pkgExclude: [
        "**/b*.js",
        "**/*.svg"
      ],
      pkgInclude: [
        "src/bar.js"
      ]
    })).to.eql([
      "src/bar.js",
      "src/index.js",
      "src/stuff/what.css"
    ]);
  });

  it("doesn't removes appropriate serverless.EXT config file", async () => {
    mock({
      "serverless.js": "",
      "serverless.yml": "",
      src: {
        "index.js": "module.exports = 'index';"
      }
    });

    expect(await compare({})).to.eql([
      "serverless.js",
      "src/index.js"
    ]);
  });

  it("should handle only node_modules"); // TODO(10)
  it("should handle sources and node_modules"); // TODO(10)
});
