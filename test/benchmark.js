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
  // All metafiles.
  "node_modules/.yarn-integrity"
]);

// False positives from serverless by scenario.
// In general, it appears that `serverless` doesn't correctly detect
// a lot of `jest` dependencies are `devDependencies` when installing with
// `yarn` (although `npm` looks correct).
const SLS_FALSE_POSITIVES = {
  "simple/yarn": new Set([
    // $ yarn why uuid -> serverless
    "node_modules/.bin/uuid",

    // $ yarn why abbrev
    // - "jest#jest-cli#@jest/core#jest-haste-map#fsevents#node-pre-gyp#nopt"
    "node_modules/abbrev"
  ]),

  "individually/yarn": new Set([
    // $ yarn why uuid -> serverless
    "node_modules/.bin/uuid"
  ]),

  "huge/npm": new Set([
    // $ yarn why raven -> serverless
    "node_modules/.bin/parser",
    // $ yarn why @cnakazawa/watch -> jest#jest-cli#@jest/core#jest-haste-map#sane
    "node_modules/.bin/watch"
  ]),

  "huge/yarn": new Set([
    // $ yarn why detect-libc -> jest#jest-cli#@jest/core#jest-haste-map#fsevents#node-pre-gyp
    "node_modules/.bin/detect-libc",
    // $ yarn why needle -> jest#jest-cli#@jest/core#jest-haste-map#fsevents#node-pre-gyp
    "node_modules/.bin/needle",
    // $ yarn why node-pre-gyp -> jest#jest-cli#@jest/core#jest-haste-map#fsevents
    "node_modules/.bin/node-pre-gyp",
    // $ yarn why nopt -> jest#jest-cli#@jest/core#jest-haste-map#fsevents#node-pre-gyp
    "node_modules/.bin/nopt",
    // $ yarn why raven -> serverless
    "node_modules/.bin/parser",
    // $ yarn why sshpk -> cypress#request#http-signature
    "node_modules/.bin/sshpk-conv",
    "node_modules/.bin/sshpk-sign",
    "node_modules/.bin/sshpk-verify",
    // $ yarn why @cnakazawa/watch -> jest#jest-cli#@jest/core#jest-haste-map#sane
    "node_modules/.bin/watch",

    // $ yarn why abbrev
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
  if (!matches) { return true; }

  // Exact match for .bin, top-level for everything else.
  return f.startsWith("node_modules/.bin")
    ? !matches.has(f.replace(/\.cmd$/, "")) // match unix or windows script
    : !matches.has(topLevel(f));
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
      const key = combo.slice(0, 3).join("/"); // eslint-disable-line no-magic-numbers
      const file = combo.slice(3); // eslint-disable-line no-magic-numbers

      memo[key] = memo[key] || {};
      memo[key][file] = data;

      return memo;
    }, {});
  });

  MATRIX.forEach(({ scenario, mode }) => {
    const combo = `${scenario}/${mode}`;

    it(combo, async () => {
      const baselineFixture = fixtures[`${combo}/baseline`];

      // Sanity check baseline exists.
      expect(baselineFixture).to.be.ok;
      const baselineFileNames = Object.keys(baselineFixture);
      expect(baselineFileNames).to.be.ok.and.to.not.eql([]);

      baselineFileNames.forEach((fileName) => {
        // Get all of the lines from our file lists.
        const baselineLines = baselineFixture[fileName];
        const baselineSet = new Set(baselineLines);
        const pluginLines = (fixtures[`${combo}/jetpack`] || {})[fileName];
        const pluginSet = new Set(pluginLines);

        // Sanity check that we _generated_ lines for both jetpack + baseline.
        // These being empty means most likely our test harness messed up
        // and generated empty zips as **all** present scenarios should have
        // at least one file.
        expect(pluginLines).to.be.ok.and.to.not.eql([]);

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
