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

const GLOBBY_OPTS = {
  dot: true,
  silent: true,
  follow: true,
  nodir: true
};
const NANOMATCH_OPTS = {
  basename: true, // Match if literal pattern matches name.
  dot: true
};

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
    .concat(include || []);

  // Now, iterate all the patterns individually, tracking state like sls.
  // The _last_ "exclude" vs. "include" wins.
  //
  // **Note**: This appears to be faster than the equivalent `.reduce()`
  // See: https://github.com/FormidableLabs/serverless-jetpack/pull/123#issuecomment-648438156
  const filesMap = {};
  files.forEach((file) => {
    filesMap[file] = true;
  });
  patterns.forEach((pattern) => {
    // Do a positive match, but track "keep" or "remove".
    const includeFile = !pattern.startsWith("!");
    const positivePattern = includeFile ? pattern : pattern.slice(1);
    nanomatch(files, [positivePattern], NANOMATCH_OPTS).forEach((file) => {
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
  const files = await globby(globInclude, { ...GLOBBY_OPTS, cwd });

  // ==========================================================================
  // **Phase Two** (`nanomatch()`): Filter list of files.
  // ==========================================================================

  // Find and exclude serverless config file. It _should_ be this function:
  // https://github.com/serverless/serverless/blob/79eff80cab58c8494dbb02d65e20d1920f1bfd6e/lib/utils/getServerlessConfigFile.js#L9-L34
  // but we instead just find and remove matched files from the glob results
  // post-hoc to recreate the order of only removing **one** rather than
  // something like the glob: `serverless.{json,yml,yaml,js}`.
  const slsConfigMap = {};
  files
    .filter((file) => (/serverless.(json|yml|yaml|js)$/i).test(file))
    .forEach((file) => {
      slsConfigMap[file] = true;
    });
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

// Extra highest level node_modules package.
// E.g., `backend/node_modules/pkg1/node_modules/pkg2/index.js` => `pkg2`
const lastPackage = (filePath) => {
  const parts = filePath.split(path.sep);
  const nodeModulesIdx = parts.lastIndexOf("node_modules");
  if (nodeModulesIdx === -1) { return null; }

  // Get first part of package.
  const firstPart = parts[nodeModulesIdx + 1];
  if (!firstPart) { return null; }

  // Unscoped.
  if (firstPart[0] !== "@") { return firstPart; }

  // Scoped.
  const secondPart = parts[nodeModulesIdx + 2]; // eslint-disable-line no-magic-numbers
  if (!secondPart) { return null; }

  return [firstPart, secondPart].join("/");
};

// Remap trace misses to aggregate package names in form of:
// ```
// {
//   srcs: {
//     "backend/src/server.js": [/* misses array */]
//   },
//   pkgs: {
//     "@scoped/pkg": {
//       "../node_modules/@scoped/pkg/index.js": [/* misses array */]
//     }
//   }
// }
// ```
const mapTraceMisses = ({ traced, servicePath } = {}) => {
  const map = { srcs: {}, pkgs: {} };
  if (!(traced || {}).misses) { return map; }

  Object.entries(traced.misses).forEach(([depPath, val]) => {
    depPath = path.relative(servicePath, depPath);
    const depPkg = lastPackage(depPath);
    if (depPkg) {
      map.pkgs[depPkg] = map.pkgs[depPkg] || {};
      map.pkgs[depPkg][depPath] = val;
    } else {
      map.srcs[depPath] = val;
    }
  });

  return map;
};

const PKG_NORMAL_PARTS = 2;
const PKG_SCOPED_PARTS = 3;

// Return what the zip destination _collapsed_ path will be.
const collapsedPath = (filePath) => {
  const parts = path.normalize(filePath).split(path.sep);

  // Remove leading `..`.
  while (parts[0] === "..") {
    parts.shift();
  }

  // Extract base package if present.
  let pkg;
  if (parts[0] === "node_modules") {
    if (parts.length >= PKG_SCOPED_PARTS && parts[1][0] === "@") {
      // Scoped.
      pkg = parts.slice(1, PKG_SCOPED_PARTS).join(path.sep);
    } else if (parts.length >= PKG_NORMAL_PARTS && parts[1][0] !== "@") {
      // Unscoped.
      pkg = parts[1];
    }
  }

  // Reconstitute with new, collapsed path.
  return {
    pkg,
    file: parts.join(path.sep)
  };
};

// Convert to summary object.
const summarizeCollapsed = ({ map, cwd, isPackages = false }) => {
  // Keep only (1) groups with duplicates, (2) duplicate unique paths within group.
  const dupsMap = {};
  Object.entries(map)
    .filter(([, filesMap]) => Object.values(filesMap).some((list) => list.length > 1))
    .forEach(([group, filesMap]) => {
      Object.entries(filesMap)
        .filter(([, list]) => list.length > 1)
        .forEach(([key, list]) => {
          dupsMap[group] = dupsMap[group] || {};
          dupsMap[group][key] = list;
        });
    });

  return Promise
    .all(Object.entries(dupsMap)
      .map(async ([group, filesMap]) => {
        const base = {};
        if (isPackages) {
          const pkgJsonPaths = filesMap[path.join("node_modules", group, "package.json")] || [];
          base.packages = await Promise.all(pkgJsonPaths.map(async (pkgJsonPath) => {
            const version = await readFile(path.resolve(cwd, pkgJsonPath))
              .then((pkgString) => JSON.parse(pkgString).version)
              .catch((err) => {
                // Shouldn't really happen, but allow missing package.json from disk.
                if (err.code === "ENOENT") { return null; }
                throw err;
              });

            return {
              path: path.dirname(pkgJsonPath),
              version
            };
          }));
        }

        const numUniquePaths = Object.keys(filesMap).length;
        const numTotalFiles = Object.values(filesMap)
          .reduce((memo, list) => memo + list.length, 0);

        return [group, {
          ...base,
          numUniquePaths,
          numTotalFiles
        }];
      })
    )
    .then((summaries) => summaries.reduce((memo, [group, summary]) => {
      memo[group] = summary;
      return memo;
    }, {}));
};

// Detect collapsed duplicate packages
const findCollapsed = async ({ files, cwd }) => {
  // E.g.
  //
  // ```
  // const srcsMap = {
  //   // ...
  //   "src/foo": {
  //     "src/foo/bar.js": [
  //       "src/foo/bar.js",
  //       "../src/foo/bar.js"
  //     ],
  //   }
  //   // ...
  // };
  // const pkgsMap = {
  //   "node_modules/lodash": {
  //     // ...
  //     "node_modules/lodash/package.json": [
  //       "node_modules/lodash/package.json",
  //       "../node_modules/lodash/package.json"
  //     ],
  //     // ...
  //   }
  // };
  // ```
  const srcsMap = {};
  const pkgsMap = {};
  files.forEach((filePath) => {
    const { pkg, file } = collapsedPath(filePath);
    if (!pkg) {
      const dir = path.dirname(file);
      srcsMap[dir] = srcsMap[dir] || {};
      srcsMap[dir][file] = srcsMap[dir][file] || [];
      srcsMap[dir][file].push(filePath);
      return;
    }

    pkgsMap[pkg] = pkgsMap[pkg] || {};
    pkgsMap[pkg][file] = pkgsMap[pkg][file] || [];
    pkgsMap[pkg][file].push(filePath);
  });

  // Convert to more useful report object.
  return {
    srcs: await summarizeCollapsed({ map: srcsMap, cwd }),
    pkgs: await summarizeCollapsed({ map: pkgsMap, cwd, isPackages: true })
  };
};

const createZip = async ({ files, cwd, bundlePath }) => {
  // Sort by name (mutating) to make deterministic.
  files.sort();

  // Get all contents.
  //
  // TODO(75): Review if this is too memory-intensive or not performant and
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
 * @param {object}    opts.traceParams  `trace-deps` options (ignores, allowMissing, ...)
 * @param {string[]}  opts.preInclude   glob patterns to include first
 * @param {string[]}  opts.traceInclude glob patterns from tracing mode
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
  traceParams = {},
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
  let traceMisses = mapTraceMisses();
  if (traceInclude) {
    // [Trace Mode] Trace and introspect all individual dependency files.
    // Add them as _patterns_ so that later globbing exclusions can apply.
    const srcPaths = (await globby(traceInclude, { ...GLOBBY_OPTS, cwd }))
      .map((srcPath) => path.resolve(servicePath, srcPath));
    const traced = await traceFiles({ ...traceParams, srcPaths });
    traceMisses = mapTraceMisses({ traced, servicePath });

    depInclude = depInclude
      .concat(srcPaths, traced.dependencies)
      // Convert to relative paths and include in patterns for bundling.
      .map((depPath) => path.relative(servicePath, depPath));
  } else {
    // [Dependency Mode] Iterate all dependency roots to gather production dependencies.
    depInclude = depInclude.concat(
      await createDepInclude({ cwd, rootPath, roots })
    );
  }

  // Normalize files / patterns for globbing and OS specifics.
  depInclude = depInclude
    // Change to all forward slashes for all globbing usage.
    .map((depPath) => IS_WIN ? depPath.replace(/\\/g, "/") : depPath)
    // Escape `[` and `]` as globby won't literally
    // match `[...id].js` but _will_ for `\\[...id\\].js`.
    // **Note**: This needs to happen _after_ we mutate file slashes.
    .map((depPath) => depPath
      .replace(/\[/g, "\\[")
      .replace(/\]/g, "\\]")
    );

  // Glob and filter all files in package.
  const { included, excluded } = await resolveFilePathsFromPatterns(
    { cwd, servicePath, preInclude, depInclude, include, exclude }
  );

  // Detect collapsed duplicates.
  // https://github.com/FormidableLabs/serverless-jetpack/issues/109
  const collapsed = await findCollapsed({ files: included, cwd });

  // Create package zip.
  await bundle.createZip({
    files: included,
    cwd,
    bundlePath
  });

  let results = {
    numFiles: included.length,
    bundlePath,
    mode: traceInclude ? "trace" : "dependency",
    buildTime: new Date() - start,
    collapsed,
    trace: {
      misses: traceMisses
    }
  };

  // Report information.
  if (report) {
    results = {
      ...results,
      roots,
      trace: {
        ...results.trace,
        ignores: traceParams.ignores || [],
        allowMissing: traceParams.allowMissing || {},
        missed: { srcs: {}, pkgs: {} },
        resolved: { srcs: {}, pkgs: {} }
      },
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
  findCollapsed,
  createZip,
  globAndZip,
  exists
};
