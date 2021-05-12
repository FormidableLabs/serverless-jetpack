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

const { TEST_SCENARIO } = process.env;
const { TEST_MATRIX } = require("./script");

// Filter known false positives.
//
// Serverless does a traversal and inference of prod vs. dev dependencies
// throughout installed `node_modules`, but this is tricky to get right and
// there are known cases of bad matches that we exclude from consideration.
const PKG_IGNORE_ALL = new Set([
  // All metafiles.
  "node_modules/.package-lock.json",
  "node_modules/.yarn-integrity"
]);

// Handle many false positives for the basic `serverless` +
// `serverless-offline` dependencies.
const SLS_FALSE_POSITIVES_BASE = [
  // yarn why atob -> jest#jest-cli#@jest/core#micromatch#snapdragon#source-map-resolve
  "node_modules/.bin/atob",
  // yarn why esparse -> esprima serverless#js-yaml
  "node_modules/.bin/esparse",
  // yarn why esvalidate -> esprima serverless#js-yaml
  "node_modules/.bin/esvalidate",
  // yarn why find-requires -> serverless#ncjsm
  "node_modules/.bin/find-requires",
  // yarn why @serverless/cli -> serverless#@serverless#cli
  "node_modules/.bin/components",
  // yarn why flat -> serverless#@serverless#enterprise-plugin
  "node_modules/.bin/flat",
  // yarn why is-ci -> serverless#update-notifier
  "node_modules/.bin/is-ci",
  // yarn why js-yaml -> serverless
  "node_modules/.bin/js-yaml",
  // yarn why json-refs -> serverless
  "node_modules/.bin/json-refs",
  // yarn why mkdirp -> serverless
  "node_modules/.bin/mkdirp",
  // yarn why prettyoutput -> serverless#@serverless#cli
  "node_modules/.bin/prettyoutput",
  // yarn why raven -> serverless
  "node_modules/.bin/raven",
  // yarn why rc -> serverless
  "node_modules/.bin/rc",
  // yarn why rimraf -> serverless#fs-extra
  "node_modules/.bin/rimraf",
  // yarn why seek-bunzip -> seek-bzip serverless#download#decompress#decompress-tarbz2
  "node_modules/.bin/seek-bunzip",
  // yarn why seek-table -> seek-bzip serverless#download#decompress#decompress-tarbz2
  "node_modules/.bin/seek-table",
  // yarn why semver -> serverless
  "node_modules/.bin/semver",
  // yarn why serverless -> devDependencies
  "node_modules/.bin/serverless",
  // yarn why sls -> serverless
  "node_modules/.bin/sls",
  // yarn why slss -> serverless
  "node_modules/.bin/slss",
  // yarn why tabtab -> serverless
  "node_modules/.bin/tabtab",
  // $ yarn why uuid -> serverless
  "node_modules/.bin/uuid",
  // yarn why velocity -> velocityjs serverless-offline
  "node_modules/.bin/velocity",
  // yarn why which -> serverless#update-notifier#boxen#term-size#execa#cross-spawn
  "node_modules/.bin/which",
  "node_modules/.bin/node-which",
  // yarn why yamljs -> serverless#@serverless#enterprise-plugin
  "node_modules/.bin/yaml2json",
  "node_modules/.bin/json2yaml",

  // Even more .bin's...
  "node_modules/.bin/autoprefixer",
  "node_modules/.bin/css-blank-pseudo",
  "node_modules/.bin/css-has-pseudo",
  "node_modules/.bin/css-prefers-color-scheme",
  "node_modules/.bin/cssesc",
  "node_modules/.bin/dependency-tree",
  "node_modules/.bin/detective-amd",
  "node_modules/.bin/errno",
  "node_modules/.bin/escodegen",
  "node_modules/.bin/esgenerate",
  "node_modules/.bin/filing-cabinet",
  "node_modules/.bin/find-process",
  "node_modules/.bin/gonzales",
  "node_modules/.bin/java-invoke-local",
  "node_modules/.bin/lookup-amd",
  "node_modules/.bin/module-definition",
  "node_modules/.bin/msgpack",
  "node_modules/.bin/precinct",
  "node_modules/.bin/r_js",
  "node_modules/.bin/r.js",
  "node_modules/.bin/sass-lookup",
  "node_modules/.bin/stylus-lookup",
  "node_modules/.bin/tsc",
  "node_modules/.bin/tsserver",

  // Not exactly sure why, but consistently getting:
  // `node_modules/bin/<NAME>.ps1` extras. Just ignore.
  "node_modules/.bin/mime",
  "node_modules/.bin/loose-envify"
];

// False positives from serverless by scenario.
// In general, it appears that `serverless` doesn't correctly detect
// a lot of `jest` dependencies are `devDependencies` when installing with
// `yarn` (although `npm` looks correct).
const SLS_FALSE_POSITIVES = {
  "simple/yarn": new Set([
    ...SLS_FALSE_POSITIVES_BASE,

    // $ yarn why @babel/parser -> serverless
    "node_modules/.bin/parser",
    // $ yarn why uuid -> serverless
    "node_modules/.bin/uuid",

    // $ $ yarn why @serverless/platform-client
    // - "serverless#@serverless#components#@serverless#platform-client"
    "node_modules/@serverless/platform-client",
    "node_modules/@serverless/platform-client/node_modules/.bin/js-yaml",

    // $ yarn why abbrev
    // - "jest#jest-cli#@jest/core#jest-haste-map#fsevents#node-pre-gyp#nopt"
    "node_modules/abbrev",

    // $ $ yarn why isomorphic-ws
    // - "serverless#@serverless#components#@serverless#platform-client#isomorphic-ws"
    "node_modules/isomorphic-ws",

    // Hoisted to `node_modules/.bin/mime`
    "node_modules/send/node_modules/.bin/mime"
  ]),

  "simple/npm": new Set([
    ...SLS_FALSE_POSITIVES_BASE,

    // $ yarn why @babel/parser -> serverless
    "node_modules/.bin/parser"
  ]),

  "complex/yarn": new Set([
    ...SLS_FALSE_POSITIVES_BASE,

    // $ yarn why @babel/parser -> serverless
    "node_modules/.bin/parser",

    // Hoisted to `node_modules/.bin/mime`
    "node_modules/send/node_modules/.bin/mime",

    // $ $ yarn why @serverless/platform-client
    // - "serverless#@serverless#components#@serverless#platform-client"
    "node_modules/@serverless/platform-client",
    "node_modules/@serverless/platform-client/node_modules/.bin/js-yaml",

    // $ $ yarn why isomorphic-ws
    // - "serverless#@serverless#components#@serverless#platform-client#isomorphic-ws"
    "node_modules/isomorphic-ws",

    // devDependency
    // (`manual_test_websocket/scripts/serverless..yml`)
    "node_modules/serverless-offline",

    // Only fails in `with-deps-root.zip` build with baseline improperly
    // including.
    // $ yarn why uuid -> serverless, raven
    "node_modules/uuid",

    // Jetpack properly excludes with `roots` (not available in Serverless)
    "nodejs/node_modules/.yarn-integrity",
    "nodejs/node_modules/.bin/uuid",
    "nodejs/node_modules/uuid"
  ]),

  "complex/npm": new Set([
    ...SLS_FALSE_POSITIVES_BASE,

    // $ yarn why @babel/parser -> serverless
    "node_modules/.bin/parser",

    // devDependency
    // (`manual_test_websocket/scripts/serverless.yml`)
    "node_modules/serverless-offline",

    // Jetpack properly excludes with `roots` (not available in Serverless)
    "nodejs/node_modules/.bin/uuid",
    "nodejs/node_modules/uuid"
  ])
};

// General version
const topLevel = (filePath) => {
  const parts = filePath.split("/");
  const nodeModulesIdx = parts.indexOf("node_modules");

  // Get `node_modules` directory and entry after (scoped or normal).
  // eslint-disable-next-line no-magic-numbers
  let pkgParts = parts.slice(0, nodeModulesIdx + 2);
  if (pkgParts[1].startsWith("@")) {
    // eslint-disable-next-line no-magic-numbers
    pkgParts = parts.slice(0, nodeModulesIdx + 3); // Scoped
  }

  return pkgParts.join("/");
};

// Applies to both plugin and baselines
const keepMatchesAll = (f) => !PKG_IGNORE_ALL.has(topLevel(f));

// Applies only to baselines (false positives).
const keepBaselineMatch = ({ scenario, pkg }) => (f) => {
  const matches = SLS_FALSE_POSITIVES[`${scenario}/${pkg}`];
  if (!matches) { return true; }

  // Exact match for .bin, top-level for everything else.
  return f.indexOf("node_modules/.bin/") !== -1
    ? !matches.has(f.replace(/\.(cmd|ps1)$/, "")) // match unix or windows script
    : !matches.has(topLevel(f));
};

const describeScenario = (scenario, callback) =>
  !TEST_SCENARIO || TEST_SCENARIO.split(",").includes(scenario)
    ? describe(scenario, callback)
    : describe.skip(scenario, callback);

const SETUP_TIMEOUT = 10000;

describe("benchmark", () => {
  let fixtures;

  before(async function () {
    this.timeout(SETUP_TIMEOUT); // eslint-disable-line no-invalid-this

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
      const dirIdx = combo.length - 1;
      const key = combo.slice(0, dirIdx).join("/");
      const file = combo.slice(dirIdx);

      memo[key] = memo[key] || {};
      memo[key][file] = data;

      return memo;
    }, {});
  });

  describe("dependencies mode", () => {
    describe("baseline vs jetpack", () => {
      // Baseline sls vs. jetpack validation.
      TEST_MATRIX.forEach(({ scenario, pkg }) => {
        const combo = `${scenario}/${pkg}`;

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
            const pluginLines = (fixtures[`${combo}/jetpack/deps`] || {})[fileName];
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
              .filter(keepBaselineMatch({ scenario, pkg }));

            expect(missingInBaseline, `extra files in jetpack for ${fileName}`).to.eql([]);
            expect(missingInPlugin, `missing files in jetpack for ${fileName}`).to.eql([]);
          });
        });
      });
    });


    describeScenario("complex", () => {
      // TODO(LAYERS): REENABLE
      it.skip("has same npm and yarn layer package contents", () => {
        let yarnFiles = fixtures["complex/yarn/jetpack/deps"]["with-deps-no-dev.zip"];
        let npmFiles = fixtures["complex/npm/jetpack/deps"]["with-deps-no-dev.zip"];

        expect(yarnFiles).to.be.ok;
        expect(npmFiles).to.be.ok;

        yarnFiles = yarnFiles.sort();
        npmFiles = npmFiles.sort();

        expect(yarnFiles)
          .to.include.members([
            "nodejs/package.json",
            "nodejs/node_modules/figlet/package.json"
          ]).and
          .to.not.include.members([
            "nodejs/node_modules/uuid/package.json"
          ]);
        expect(npmFiles).to.eql(yarnFiles);
      });

      it("excludes aws-sdk and other patterns from node modules", () => {
        // Regex for expected exclusions in node_modules.
        // These patterns in `serverless.yml` currently happen in `include`
        // and we want to make sure they still hold true across refactoring.
        const EXPECT_EXCLUDED = /(aws-sdk|README\.md$|LICENSE$)/;

        [
          "complex/yarn/jetpack/deps",
          "complex/yarn/baseline",
          "complex/npm/jetpack/deps",
          "complex/npm/baseline"
        ].forEach((fixture) => {
          Object.keys(fixtures[fixture]).forEach((zipName) => {
            const files = fixtures[fixture][zipName];
            const badPatterns = files.filter((f) => EXPECT_EXCLUDED.test(f));

            expect(badPatterns, `failed to exclude files in ${fixture}/${zipName}`).to.eql([]);
          });
        });
      });
    });
  });

  describe("trace mode", () => {
    describe("baseline vs jetpack", () => {
      // Baseline sls vs. jetpack validation.
      //
      // More limited than in dependencies mode. Here we just check:
      // 1. Jetpack trace doesn't have extras
      // 2. Jetpack non-node_modules match baseline
      TEST_MATRIX.forEach(({ scenario, pkg }) => {
        const combo = `${scenario}/${pkg}`;

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
            const pluginLines = (fixtures[`${combo}/jetpack/trace`] || {})[fileName];
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

            // DIFFERENT: Only check **non**-node_modules
            const missingInPlugin = baselineLines
              .filter((l) => l.indexOf("node_modules") === -1)
              .filter((l) => !pluginSet.has(l));

            expect(missingInBaseline, `extra files in jetpack for ${fileName}`).to.eql([]);
            expect(missingInPlugin, `missing files in jetpack for ${fileName}`).to.eql([]);
          });
        });
      });
    });
  });
});
