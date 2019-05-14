"use strict";

/**
 * Tests validating jetpack vs. built-in serverless packaging.
 *
 * **Note**: requires a full `yarn benchmark` run first to generate file
 * lists.
 */
const path = require("path");
const globby = require("globby");
const AdmZip = require("adm-zip");
const { MATRIX } = require("./script");

// Filter known false positives.
//
// Serverless does a traversal and inference of prod vs. dev dependencies
// throughout installed `node_modules`, but this is tricky to get right and
// there are known cases of bad matches that we exclude from consideration.
const PKG_IGNORE_ALL = new Set([
  // All binaries.
  "node_modules/.bin"
]);

// False positives from serverless by scenario.
const SLS_FALSE_POSITIVES = {
  // For this scenario, it appears that `serverless` doesn't correctly detect
  // a lot of `jest` dependencies are `devDependencies` when installing with
  // `yarn` (although `npm` looks correct).
  "huge/yarn": new Set([
    // `$ yarn why abbrev`
    // - "jest#jest-cli#@jest/core#jest-haste-map#fsevents#node-pre-gyp#nopt"
    "node_modules/abbrev",

    // $ yarn why console-control-strings
    // - "jest#jest-cli#@jest/core#jest-haste-map#fsevents#node-pre-gyp#npmlog" depends on it
    // - "jest#jest-cli#@jest/core#jest-haste-map#fsevents#node-pre-gyp#npmlog#gauge"
    "node_modules/console-control-strings",

    // $ yarn why detect-libc
    // - "jest#jest-cli#@jest/core#jest-haste-map#fsevents#node-pre-gyp" depends on it.
    "node_modules/detect-libc",

    //  $ yarn why fs-minipass
    // - "jest#jest-cli#@jest/core#jest-haste-map#fsevents#node-pre-gyp#tar"
    "node_modules/fs-minipass",

    // $ yarn why ignore-walk
    // - "jest#jest-cli#@jest/core#jest-haste-map#fsevents#node-pre-gyp#npm-packlist"
    "node_modules/ignore-walk",

    // $ yarn why minipass
    // - "jest#jest-cli#@jest/core#jest-haste-map#fsevents#node-pre-gyp#tar" depends on it
    // - "jest#jest-cli#@jest/core#jest-haste-map#fsevents#node-pre-gyp#tar#fs-minipass"
    "node_modules/minipass",

    // $ yarn why minizlib
    // - "jest#jest-cli#@jest/core#jest-haste-map#fsevents#node-pre-gyp#tar"
    "node_modules/minizlib",

    // $ yarn why needle
    // - "jest#jest-cli#@jest/core#jest-haste-map#fsevents#node-pre-gyp"
    "node_modules/needle",

    // $ yarn why node-pre-gyp
    // - "jest#jest-cli#@jest/core#jest-haste-map#fsevents"
    "node_modules/node-pre-gyp",

    // $ yarn why nopt
    // - "jest#jest-cli#@jest/core#jest-haste-map#fsevents#node-pre-gyp"
    "node_modules/nopt",

    // $ yarn why npm-bundled
    // - "jest#jest-cli#@jest/core#jest-haste-map#fsevents#node-pre-gyp#npm-packlist"
    "node_modules/npm-bundled",

    // $ yarn why npm-packlist
    // - "jest#jest-cli#@jest/core#jest-haste-map#fsevents#node-pre-gyp"
    "node_modules/npm-packlist",

    // $ yarn why osenv
    // - "jest#jest-cli#@jest/core#jest-haste-map#fsevents#node-pre-gyp#nopt"
    "node_modules/osenv",

    // $ yarn why tar
    // - "jest#jest-cli#@jest/core#jest-haste-map#fsevents#node-pre-gyp"
    "node_modules/tar",

    // $ yarn why wide-align
    // - "jest#jest-cli#@jest/core#jest-haste-map#fsevents#node-pre-gyp#npmlog#gauge"
    "node_modules/wide-align"
  ])
};

// General version
// eslint-disable-next-line no-magic-numbers
const topLevel = (f) => f.split("/").slice(0, 2).join("/");

// Applies to both plugin and baselines
const keepMatchesAll = (f) => !PKG_IGNORE_ALL.has(topLevel(f));

// Applies only to baselines (false positives).
const keepBaselineMatch = ({ scenario, mode }) => (f) => {
  const matches = SLS_FALSE_POSITIVES[`${scenario}/${mode}`];
  return !matches || !matches.has(topLevel(f));
};

describe("benchmark", () => {
  let fixtures;

  before(async () => {
    // Read lists of contents from zip files directly.
    const projRoot = path.resolve(__dirname, "..");
    const zipFiles = await globby([".test-zips/**/*.zip"], { cwd: projRoot });
    const contents = zipFiles.map((zipFile) => {
      const zip = new AdmZip(path.resolve(projRoot, zipFile));
      return zip.getEntries().map((e) => e.entryName);
    });

    // Create object of `"combo.file = data"
    fixtures = contents.reduce((memo, data, i) => {
      const combo = zipFiles[i].replace(".test-zips/", "").split("/");
      const key = combo.slice(0, 4).join("/"); // eslint-disable-line no-magic-numbers
      const file = combo.slice(4); // eslint-disable-line no-magic-numbers

      memo[key] = memo[key] || {};
      memo[key][file] = data;

      return memo;
    }, {});
  });

  MATRIX.forEach(({ scenario, mode, lockfile }) => {
    const combo = `${scenario}/${mode}/${lockfile}`;

    it(combo, async () => {
      Object.keys(fixtures[`${combo}/baseline`]).forEach((fileName) => {
        // Get all of the lines from our file lists.
        const baselineLines = fixtures[`${combo}/baseline`][fileName];
        const baselineSet = new Set(baselineLines);
        const pluginLines = fixtures[`${combo}/jetpack`][fileName];
        const pluginSet = new Set(pluginLines);

        // Figure out what is missing from each.
        const missingInBaseline = pluginLines
          .filter((l) => !baselineSet.has(l))
          .filter(keepMatchesAll);

        const missingInPlugin = baselineLines
          .filter((l) => !pluginSet.has(l))
          .filter(keepMatchesAll)
          .filter(keepBaselineMatch({ scenario, mode }));

        expect(missingInBaseline, "extra files in jetpack").to.eql([]);
        expect(missingInPlugin, "missing files in jetpack").to.eql([]);
      });
    });
  });
});
