"use strict";

const path = require("path");
const fs = require("fs");
const { promisify } = require("util");

const makeDir = require("make-dir");
const archiver = require("archiver");
const globby = require("globby");
const nanomatch = require("nanomatch");
const { traceFiles } = require("trace-deps");
const { findProdInstalls } = require("inspectdep");

const IS_WIN = process.platform === "win32";
const EPOCH = new Date(0);

// Stubbable container object.
let bundle = {};

// File helpers
const readStat = promisify(fs.stat);
const exists = (filePath) => readStat(filePath)
  .then(() => true)
  .catch((err) => {
    if (err.code === "ENOENT") { return false; }
    throw err;
  });
const readFile = promisify(fs.readFile);

// Filter list of files like serverless.
const filterFiles = ({ files, preInclude, depInclude, include, exclude }) => {
  const patterns = []
    // Jetpack: Start with our custom config + dynamic includes
    .concat(preInclude || [])
    .concat(depInclude || [])
    // Serverless: insert built-in excludes
    .concat((exclude || []).map((e) => e[0] === "!" ? e.substring(1) : `!${e}`))
    // Serverless: and finish with built-in includes
    .concat(include || [])
    // Follow sls here: globby returns forward slash only, so mutate patterns
    // always be forward.
    // https://github.com/serverless/serverless/issues/5609#issuecomment-452219161
    .map((p) => IS_WIN ? p.replace(/\\/g, "/") : p);

  // Now, iterate all the patterns individually, tracking state like sls.
  // The _last_ "exclude" vs. "include" wins.
  const filesMap = files.reduce((memo, file) => ({ ...memo, [file]: true }), []);
  patterns.forEach((pattern) => {
    // Do a positive match, but track "keep" or "remove".
    const includeFile = !pattern.startsWith("!");
    const positivePattern = includeFile ? pattern : pattern.slice(1);
    nanomatch(files, [positivePattern], { dot: true }).forEach((file) => {
      filesMap[file] = includeFile;
    });
  });

  // Convert the state map of `true` into our final list of files.
  return Object.keys(filesMap).filter((f) => filesMap[f]);
};

// Analogous file resolver to built-in serverless.
//
// The main difference is that we exclude the root project `node_modules`
// except for production dependencies.
//
// See: `resolveFilePathsFromPatterns` in
// https://github.com/serverless/serverless/blob/master/lib/plugins/package/lib/packageService.js#L212-L254
const resolveFilePathsFromPatterns = async ({
  cwd,
  servicePath,
  preInclude,
  depInclude,
  include,
  exclude
}) => {
  // ==========================================================================
  // **Phase One** (`globby()`): Read files from disk into a list of files.
  // ==========================================================================

  // Glob everything on disk using only _includes_ (except `node_modules`).
  // This is loosely, what serverless would do with the difference that
  // **everything** in `node_modules` is globbed first and then files
  // excluded manually by `nanomatch` after. We get the same result here
  // without reading from disk.
  const globInclude = ["**"]
    // Start with Jetpack custom preInclude
    .concat(preInclude || [])
    // ... hone to the production node_modules
    .concat(depInclude || [])
    // ... then normal include like serverless does.
    .concat(include || []);

  // Read files from disk matching include patterns.
  const files = await globby(globInclude, {
    cwd,
    dot: true,
    silent: true,
    follow: true,
    nodir: true
  });

  // ==========================================================================
  // **Phase Two** (`nanomatch()`): Filter list of files.
  // ==========================================================================

  // Find and exclude serverless config file. It _should_ be this function:
  // https://github.com/serverless/serverless/blob/79eff80cab58c8494dbb02d65e20d1920f1bfd6e/lib/utils/getServerlessConfigFile.js#L9-L34
  // but we instead just find and remove matched files from the glob results
  // post-hoc to recreate the order of only removing **one** rather than
  // something like the glob: `serverless.{json,yml,yaml,js}`.
  const slsConfigMap = files
    .filter((f) => (/serverless.(json|yml|yaml|js)$/i).test(f))
    .reduce((m, f) => ({ ...m, [f]: true }), {});
  // These extensions are specifically ordered. First wins.
  const cfgToRemove = ["json", "yml", "yaml", "js"]
    .map((ext) => path.join(path.relative(servicePath, cwd), `serverless.${ext}`))
    .filter((f) => slsConfigMap[f])[0];
  // Add to excludes like serverless does.
  // _Note_: Mutates `exclude`, but this is really like a "late fixing" of
  // what would happen anyways in serverless.
  if (cfgToRemove) {
    exclude.push(cfgToRemove);
  }

  // Filter list of files like Serverless does.
  const filtered = filterFiles({ files, preInclude, depInclude, include, exclude });
  if (!filtered.length) {
    throw new Error("No file matches include / exclude patterns");
  }

  return {
    included: filtered,
    excluded: files.filter((f) => !filtered.includes(f))
  };
};

const createDepInclude = async ({ cwd, rootPath, roots }) => {
  // Dependency roots.
  let depRoots = roots;
  if (!depRoots) {
    // Special case: Allow `{CWD}/package.json` to not exist. Any `roots` must.
    const cwdPkgExists = await exists(path.join(cwd, "package.json"));
    depRoots = cwdPkgExists ? [cwd] : [];
  }

  return Promise
    // Find the production install paths
    .all(depRoots
      // Sort for proper glob order.
      .sort()
      // Do async + individual root stuff.
      .map((curPath) => findProdInstalls({ rootPath, curPath })
        .then((deps) => []
          // Dependency root-level exclude (relative to dep root, not root-path + dep)
          .concat([`!${path.relative(cwd, path.join(curPath, "node_modules", "**"))}`])
          // All other includes.
          .concat(deps
            // Relativize to root path for inspectdep results, the cwd for glob.
            .map((dep) => path.relative(cwd, path.join(rootPath, dep)))
            // Sort for proper glob order.
            .sort()
            // 1. Convert to `PATH/**` glob.
            // 2. Add excludes for node_modules in every discovered pattern dep
            //    dir. This allows us to exclude devDependencies because
            //    **later** include patterns should have all the production deps
            //    already and override.
            .map((dep) => dep.indexOf(path.join("node_modules", ".bin")) === -1
              ? [path.join(dep, "**"), `!${path.join(dep, "node_modules", "**")}`]
              : [dep] // **don't** glob bin path (`ENOTDIR: not a directory`)
            )
            // Flatten the temp arrays we just introduced.
            .reduce((m, a) => m.concat(a), [])
          )
        )
      )
    )
    // Flatten to final list with base default patterns applied.
    .then((depsList) => depsList.reduce((m, a) => m.concat(a), []));
};

const createZip = async ({ files, cwd, bundlePath }) => {
  // Sort by name (mutating) to make deterministic.
  files.sort();

  // Get all contents.
  //
  // TODO(75): Review if this is too memmory-intensive or not performant and
  // consider a more concurrency-optimized solution.
  // https://github.com/FormidableLabs/serverless-jetpack/issues/75
  const fileObjs = await Promise.all(files.map(
    (name) => Promise.all([
      readFile(path.join(cwd, name)),
      readStat(path.join(cwd, name))
    ])
      .then(([data, stat]) => ({ name, data, stat }))
  ));

  // Use Serverless-analogous library + logic to create zipped artifact.
  const zip = archiver.create("zip");

  // Ensure full path to bundle exists before opening stream.
  // **Note**: Make sure all `fs`-related work (like file reading above) is done
  // before opening calling `fs.createWriteStream`.
  await makeDir(path.dirname(bundlePath));
  const output = fs.createWriteStream(bundlePath);

  return new Promise((resolve, reject) => { // eslint-disable-line promise/avoid-new
    output.on("close", () => resolve());
    output.on("error", reject);
    zip.on("error", reject);

    output.on("open", () => {
      zip.pipe(output);

      // Serverless framework packages up files individually with various tweaks
      // (setting file times to epoch, chmod-ing things, etc.) that we don't do
      // here.
      //
      // We do _some_ of these, including:
      // - Nuke `mtime` and set it to epoch date.
      // - Sort and append files in sorted order.
      //
      // See: https://github.com/serverless/serverless/blob/master/lib/plugins/package/lib/zipService.js#L91-L104
      fileObjs.forEach(({ name, data, stat: { mode } }) => {
        // We originally did `zip.file` which is more I/O efficient, but doesn't
        // guarantee order. So we manually read files above in one fell swoop
        // into memory to insert in deterministic order.
        //
        // https://github.com/FormidableLabs/serverless-jetpack/issues/7
        zip.append(data, {
          name,
          mode,
          date: EPOCH
        });
      });

      zip.finalize();
    });
  });
};

/**
 * Take various configuration inputs and produce a zip bundle.
 *
 * ## Background
 *
 * Built-in Serverless has some weird behavior around the "working directory".
 * For a function, it's pretty straightforward `servicePath` the root of all
 * things to start at.
 *
 * But once you bring in a layer, it ends up  with `layers.*.path` as the new
 * root for globbing and pattern application, which is strange because service-
 * level `include|exclude` are then applied at a **new** root.
 *
 * ## Jetpack
 *
 * We use the `layers.*.path` scenario, which sets an alternate `cwd` to
 * `servicePath` to illustrate how we apply things:
 *
 * * Resolve `cwd` to `servicePath + cwd`
 * * Resolve `base` to `servicePath + base`
 * * Resolve `roots` to `servicePath + root`
 *
 * When searching for dependencies:
 *
 * * Start at a given `root`
 * * Traverse all the way down to `base`
 * * Relativize to `cwd`
 *
 * @param {*}         opts              options object
 * @param {string}    opts.cwd          current working directory
 * @param {string}    opts.servicePath  Serverless project working directory
 * @param {string}    opts.base         optional base directory (relative to `servicePath`)
 * @param {string[]}  opts.roots        optional dependency roots (relative to `servicePath`)
 * @param {string}    opts.bundleName   output bundle name
 * @param {string[]}  opts.preInclude   glob patterns to include first
 * @param {string[]}  opts.include      glob patterns to include
 * @param {string[]}  opts.exclude      glob patterns to exclude
 * @param {Boolean}   opts.report       include extra report information?
 * @returns {Promise<Object>} Various information about the bundle
 */
// eslint-disable-next-line max-statements
const globAndZip = async ({
  cwd,
  servicePath,
  base,
  roots,
  bundleName,
  preInclude,
  traceInclude,
  include,
  exclude,
  report
}) => {
  const start = new Date();

  // Fully resolve paths.
  cwd = path.resolve(servicePath, cwd);
  roots = roots ? roots.map((r) => path.resolve(servicePath, r)) : roots;
  const rootPath = path.resolve(servicePath, base);
  const bundlePath = path.resolve(servicePath, bundleName);

  // Remove all cwd-relative-root node_modules first. Trace/package modes will
  // then bring `node_modules` individual files back in after.
  let depInclude = ["!node_modules/**"];
  if (traceInclude) {
    // [Trace Mode] Trace and introspect all individual dependency files.
    // Add them as _patterns_ so that later globbing exclusions can apply.
    // TODO: Implement `jetpack.trace.include`
    // TODO: Implement `jetpack.trace.ignores`
    const ignores = undefined;
    const traced = await traceFiles({ srcPaths: traceInclude, ignores });

    // Aggregate.
    depInclude = depInclude.concat(
      // Add all handler files first.
      traceInclude,
      // Convert to relative paths and include in patterns for bundling.
      traced.map((depPath) => path.relative(servicePath, depPath))
    );
  } else {
    // [Pattern Mode] Iterate all dependency roots to gather production dependencies.
    depInclude = depInclude.concat(
      await createDepInclude({ cwd, rootPath, roots })
    );
  }

  // Glob and filter all files in package.
  const { included, excluded } = await resolveFilePathsFromPatterns(
    { cwd, servicePath, preInclude, depInclude, include, exclude }
  );

  // Create package zip.
  await bundle.createZip({
    files: included,
    cwd,
    bundlePath
  });

  let results = {
    numFiles: included.length,
    bundlePath,
    buildTime: new Date() - start
  };

  // Report information.
  if (report) {
    results = {
      ...results,
      roots,
      patterns: {
        preInclude,
        include,
        depInclude: traceInclude ? [] : depInclude,
        traceInclude: traceInclude ? depInclude : [],
        exclude
      },
      files: {
        included,
        excluded
      }
    };
  }

  return results;
};

module.exports = bundle = {
  resolveFilePathsFromPatterns,
  createZip,
  globAndZip,
  exists
};
