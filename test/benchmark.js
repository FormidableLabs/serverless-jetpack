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
const { MATRIX } = require("./script");
const BASELINE_COMP_MATRIX = MATRIX.filter(({ scenario }) => scenario !== "monorepo");

// Filter known false positives.
//
// Serverless does a traversal and inference of prod vs. dev dependencies
// throughout installed `node_modules`, but this is tricky to get right and
// there are known cases of bad matches that we exclude from consideration.
const PKG_IGNORE_ALL = new Set([
  // All metafiles.
  "node_modules/.yarn-integrity"
]);

// Windows does poorly with false positives for the basic `serverless` +
// `serverless-offline` dependencies.
const SLS_FALSE_POSITIVES_WIN_BASE = [
  // yarn why atob -> jest#jest-cli#@jest/core#micromatch#snapdragon#source-map-resolve
  "node_modules/.bin/atob",
  // yarn why esparse -> esprima serverless#js-yaml
  "node_modules/.bin/esparse",
  // yarn why esvalidate -> esprima serverless#js-yaml
  "node_modules/.bin/esvalidate",
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
  // yarn why yamljs -> serverless#@serverless#enterprise-plugin
  "node_modules/.bin/yaml2json",
  "node_modules/.bin/json2yaml"
];

// ... and the huge scenario has even more false positives
const SLS_FALSE_POSITIVES_WIN_HUGE = [
  // yarn why acorn -> next#webpack
  "node_modules/.bin/acorn",
  // yarn why amphtml-validator -> next
  "node_modules/.bin/amphtml-validator",
  // yarn why ansi-html -> next#webpack-hot-middleware
  "node_modules/.bin/ansi-html",
  // yarn why browserslist -> @babel/preset-env
  "node_modules/.bin/browserslist",
  // yarn why cypress -> devDependencies
  "node_modules/.bin/cypress",
  // yarn why errno -> next#recursive-copy
  "node_modules/.bin/errno",
  // yarn why escodegen -> jest#jest-cli#jest-config#jest-environment-jsdom#jsdom
  "node_modules/.bin/escodegen",
  // yarn why esgenerate -> escodegen jest#jest-cli#jest-config#jest-environment-jsdom#jsdom
  "node_modules/.bin/esgenerate",
  // yarn why extract-zip -> cypress
  "node_modules/.bin/extract-zip",
  // yarn why handlebars -> jest#jest-cli#@jest/core#@jest/reporters#istanbul-api#istanbul-reports
  "node_modules/.bin/handlebars",
  // yarn why import-local-fixture -> import-local jest
  "node_modules/.bin/import-local-fixture",
  // yarn why jest-runtime -> jest#jest-cli#@jest/core
  "node_modules/.bin/jest-runtime",
  // yarn why jest -> devDependencies
  "node_modules/.bin/jest",
  // yarn why jsesc -> @babel/preset-env...
  "node_modules/.bin/jsesc",
  // yarn why json5 -> next#@babel/core
  "node_modules/.bin/json5",
  // yarn why miller-rabin -> next#webpack#node-libs-browser#crypto-browserify#diffie-hellman
  "node_modules/.bin/miller-rabin",
  // yarn why next -> devDependencies
  "node_modules/.bin/next",
  // yarn why regexp-tree -> @babel/preset-env#@babel/plugin-transform-named-capturing-groups-regex
  "node_modules/.bin/regexp-tree",
  // yarn why regjsparser -> @babel/preset-env#...
  "node_modules/.bin/regjsparser",
  // yarn why sane -> jest#jest-cli#@jest/core#jest-haste-map
  "node_modules/.bin/sane",
  // yarn why sha.js -> next#webpack#node-libs-browser#crypto-browserify#create-hash
  "node_modules/.bin/sha.js",
  // yarn why terser -> next
  "node_modules/.bin/terser",
  // yarn why tsc -> devDependencies
  "node_modules/.bin/tsc",
  // yarn why tsserver -> devDependencies
  "node_modules/.bin/tsserver",
  // yarn why uglifyjs -> uglify-js jest#jest-cli#@jest/core...
  "node_modules/.bin/uglifyjs",
  // yarn why uuid -> cypress#request
  "node_modules/.bin/uuid",
  // yarn why webpack -> next
  "node_modules/.bin/webpack"
];

// False positives from serverless by scenario.
// In general, it appears that `serverless` doesn't correctly detect
// a lot of `jest` dependencies are `devDependencies` when installing with
// `yarn` (although `npm` looks correct).
const SLS_FALSE_POSITIVES = {
  "simple/yarn": new Set([
    ...SLS_FALSE_POSITIVES_WIN_BASE,

    // $ yarn why uuid -> serverless
    "node_modules/.bin/uuid",

    // $ yarn why abbrev
    // - "jest#jest-cli#@jest/core#jest-haste-map#fsevents#node-pre-gyp#nopt"
    "node_modules/abbrev",

    // Hoisted to `node_modules/.bin/mime`
    "node_modules/send/node_modules/.bin/mime"
  ]),

  "simple/npm": new Set([
    ...SLS_FALSE_POSITIVES_WIN_BASE
  ]),

  "complex/yarn": new Set([
    ...SLS_FALSE_POSITIVES_WIN_BASE,

    // Hoisted to `node_modules/.bin/mime`
    "node_modules/send/node_modules/.bin/mime",

    // devDependency
    // (`manual_test_websocket/scripts/serverless..yml`)
    "node_modules/serverless-offline",

    // Only fails in `with-deps-root.zip` build with baseline improperly
    // including.
    // $ yarn why uuid -> serverless, raven
    "node_modules/uuid",

    // Jetpack properly excludes with `roots` (not availabel in Serverless)
    "nodejs/node_modules/.yarn-integrity",
    "nodejs/node_modules/.bin/uuid",
    "nodejs/node_modules/uuid"
  ]),

  "complex/npm": new Set([
    ...SLS_FALSE_POSITIVES_WIN_BASE,

    // devDependency
    // (`manual_test_websocket/scripts/serverless..yml`)
    "node_modules/serverless-offline",

    // Jetpack properly excludes with `roots` (not availabel in Serverless)
    "nodejs/node_modules/.bin/uuid",
    "nodejs/node_modules/uuid"
  ]),

  "individually/yarn": new Set([
    ...SLS_FALSE_POSITIVES_WIN_BASE,

    // $ yarn why uuid -> serverless
    "node_modules/.bin/uuid",

    // Hoisted to `node_modules/.bin/mime`
    "node_modules/send/node_modules/.bin/mime"
  ]),

  "individually/npm": new Set([
    ...SLS_FALSE_POSITIVES_WIN_BASE
  ]),

  "huge/npm": new Set([
    ...SLS_FALSE_POSITIVES_WIN_BASE,
    ...SLS_FALSE_POSITIVES_WIN_HUGE,

    // $ yarn why raven -> serverless
    "node_modules/.bin/parser",
    // $ yarn why @cnakazawa/watch -> jest#jest-cli#@jest/core#jest-haste-map#sane
    "node_modules/.bin/watch",
    // $ yarn why sshpk -> cypress#request#http-signature
    "node_modules/.bin/sshpk-conv",
    "node_modules/.bin/sshpk-sign",
    "node_modules/.bin/sshpk-verify"
  ]),

  "huge/yarn": new Set([
    ...SLS_FALSE_POSITIVES_WIN_BASE,
    ...SLS_FALSE_POSITIVES_WIN_HUGE,

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

    // Hoisted to `node_moduels/.bin/loose-envify`
    "node_modules/react-dom/node_modules/.bin/loose-envify",
    "node_modules/react-dom/node_modules/prop-types/node_modules/.bin/loose-envify",
    "node_modules/react/node_modules/.bin/loose-envify",
    "node_modules/react/node_modules/prop-types/node_modules/.bin/loose-envify",
    "node_modules/scheduler/node_modules/.bin/loose-envify",

    // Hoisted to `node_modules/.bin/mime`
    "node_modules/send/node_modules/.bin/mime",

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
    "node_modules/node-pre-gyp/node_modules/.bin/detect-libc",
    "node_modules/node-pre-gyp/node_modules/.bin/mkdirp",
    "node_modules/node-pre-gyp/node_modules/.bin/needle",
    "node_modules/node-pre-gyp/node_modules/.bin/nopt",
    "node_modules/node-pre-gyp/node_modules/.bin/rc",
    "node_modules/node-pre-gyp/node_modules/.bin/rimraf",
    "node_modules/node-pre-gyp/node_modules/.bin/semver",

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
    "node_modules/tar/node_modules/.bin/mkdirp",

    // $ yarn why wide-align
    // - "jest#jest-cli#@jest/core#jest-haste-map#fsevents#node-pre-gyp#npmlog#gauge"
    "node_modules/wide-align"
  ])
};

// General version
const topLevel = (filePath) => {
  const parts = filePath.split("/");
  const nodeModulesIdx = parts.indexOf("node_modules");

  // Get `node_modules` directory and entry after.
  // eslint-disable-next-line no-magic-numbers
  return parts.slice(0, nodeModulesIdx + 2).join("/");
};

// Applies to both plugin and baselines
const keepMatchesAll = (f) => !PKG_IGNORE_ALL.has(topLevel(f));

// Applies only to baselines (false positives).
const keepBaselineMatch = ({ scenario, mode }) => (f) => {
  const matches = SLS_FALSE_POSITIVES[`${scenario}/${mode}`];
  if (!matches) { return true; }

  // Exact match for .bin, top-level for everything else.
  return f.indexOf("node_modules/.bin/") !== -1
    ? !matches.has(f.replace(/\.cmd$/, "")) // match unix or windows script
    : !matches.has(topLevel(f));
};

const describeScenario = (scenario, callback) =>
  !TEST_SCENARIO || TEST_SCENARIO.split(",").includes(scenario)
    ? describe(scenario, callback)
    : describe.skip(scenario, callback);

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

  describe("baseline vs jetpack", () => {
    // Baseline sls vs. jetpack validation.
    BASELINE_COMP_MATRIX.forEach(({ scenario, mode }) => {
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

          expect(missingInBaseline, `extra files in jetpack for ${fileName}`).to.eql([]);
          expect(missingInPlugin, `missing files in jetpack for ${fileName}`).to.eql([]);
        });
      });
    });
  });

  describeScenario("monorepo", () => {
    it("has same npm and yarn package contents for base.zip", () => {
      let yarnFiles = fixtures["monorepo/yarn/jetpack"]["base.zip"];
      let npmFiles = fixtures["monorepo/npm/jetpack"]["base.zip"];

      expect(yarnFiles).to.be.ok;
      expect(npmFiles).to.be.ok;

      // Now, normalize file lists before comparing.
      yarnFiles = yarnFiles.sort();

      // This diff dependency is expected to **stay** in place because we test
      // forcing versions to prevent flattening.
      const NESTED_DIFF = "functions/base/node_modules/diff/";

      const NPM_NORMS = {
        // Just differences in installation.
        "functions/base/node_modules/serverless-jetpack-monorepo-lib-camel/node_modules/camelcase/":
          "node_modules/camelcase/",
        "functions/base/node_modules/serverless-jetpack-monorepo-lib-camel/src/":
          "node_modules/serverless-jetpack-monorepo-lib-camel/src/",
        "functions/base/node_modules/cookie/": "node_modules/express/node_modules/cookie/",
        "functions/base/node_modules/send/node_modules/ms/":
          "node_modules/debug/node_modules/ms/",
        // Hoist everything to root (which is what yarn should do), except for
        // `/diff/` which we've engineered to stay in place...
        "functions/base/node_modules/": "node_modules/",
        "lib/camel/node_modules/": "node_modules/"
      };
      npmFiles = npmFiles
        .map((dep) => {
          for (const norm of Object.keys(NPM_NORMS)) {
            if (dep.startsWith(norm) && !dep.startsWith(NESTED_DIFF)) {
              return NPM_NORMS[norm] === null ? null : dep.replace(norm, NPM_NORMS[norm]);
            }
          }

          return dep;
        })
        .filter(Boolean)
        .sort();

      [
        "functions/base/src/base.js",
        "functions/base/node_modules/diff/package.json",
        "node_modules/serverless-jetpack-monorepo-lib-camel/src/camel.js",
        "node_modules/camelcase/package.json",
        "node_modules/ms/package.json"
      ].forEach((f) => {
        expect(yarnFiles).to.include(f);
      });

      [
        "functions/base/src/exclude-me.js",
        "functions/base/node_modules/diff/README.md",
        "node_modules/diff/package.json",
        "node_modules/diff/README.md",
        "functions/base/node_modules/uuid/package.json",
        "node_modules/uuid/package.json"
      ].forEach((f) => {
        expect(yarnFiles).to.not.include(f);
      });

      expect(npmFiles).to.eql(yarnFiles);
    });

    it("has same npm and yarn package contents for another.zip", () => {
      let yarnFiles = fixtures["monorepo/yarn/jetpack"]["another.zip"];
      let npmFiles = fixtures["monorepo/npm/jetpack"]["another.zip"];

      expect(yarnFiles).to.be.ok;
      expect(npmFiles).to.be.ok;

      // Now, normalize file lists before comparing.
      yarnFiles = yarnFiles.sort();

      const NPM_NORMS = {
        // Just differences in installation.
        // eslint-disable-next-line max-len
        "functions/another/node_modules/serverless-jetpack-monorepo-lib-camel/node_modules/camelcase/":
          "node_modules/camelcase/",
        "functions/another/node_modules/serverless-jetpack-monorepo-lib-camel/src/":
          "node_modules/serverless-jetpack-monorepo-lib-camel/src/",
        "functions/another/node_modules/cookie/": "node_modules/express/node_modules/cookie/",
        "functions/another/node_modules/send/node_modules/ms/":
          "node_modules/debug/node_modules/ms/",
        // Hoist everything to root (which is what yarn should do) includeing `diff`.
        "functions/another/node_modules/": "node_modules/",
        "lib/camel/node_modules/": "node_modules/"
      };
      npmFiles = npmFiles
        .map((dep) => {
          for (const norm of Object.keys(NPM_NORMS)) {
            if (dep.startsWith(norm)) {
              return NPM_NORMS[norm] === null ? null : dep.replace(norm, NPM_NORMS[norm]);
            }
          }

          return dep;
        })
        .filter(Boolean)
        .sort();

      [
        "functions/another/src/base.js",
        "node_modules/diff/package.json",
        "node_modules/serverless-jetpack-monorepo-lib-camel/src/camel.js",
        "node_modules/camelcase/package.json",
        "node_modules/ms/package.json"
      ].forEach((f) => {
        expect(yarnFiles).to.include(f);
      });

      [
        "functions/another/src/exclude-me.js",
        "functions/another/node_modules/diff/package.json",
        "functions/another/node_modules/diff/README.md",
        "node_modules/diff/README.md",
        "functions/base/node_modules/uuid/package.json",
        "node_modules/uuid/package.json"
      ].forEach((f) => {
        expect(yarnFiles).to.not.include(f);
      });

      expect(npmFiles).to.eql(yarnFiles);
    });
  });

  describeScenario("complex", () => {
    it("has same npm and yarn layer package contents", () => {
      let yarnFiles = fixtures["complex/yarn/jetpack"]["with-deps-no-dev.zip"];
      let npmFiles = fixtures["complex/npm/jetpack"]["with-deps-no-dev.zip"];

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
        "complex/yarn/jetpack",
        "complex/yarn/baseline",
        "complex/npm/jetpack",
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
