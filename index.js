"use strict";

const pkg = require("./package.json");

const path = require("path");
const { createWriteStream } = require("fs");

const makeDir = require("make-dir");
const archiver = require("archiver");
const globby = require("globby");
const nanomatch = require("nanomatch");
const pLimit = require("p-limit");
const { findProdInstalls } = require("inspectdep");

const SLS_TMP_DIR = ".serverless";
const PLUGIN_NAME = pkg.name;
const IS_WIN = process.platform === "win32";

// Timer and formatter.
// eslint-disable-next-line no-magic-numbers
const elapsed = (start) => ((new Date() - start) / 1000).toFixed(2);

// Simple, stable union.
const union = (arr1, arr2) => {
  const set1 = new Set(arr1);
  return arr1.concat(arr2.filter((o) => !set1.has(o)));
};

// Filter list of files like serverless.
const filterFiles = ({ files, include, exclude }) => {
  const patterns = []
    // Create a list of patterns with (a) negated excludes, (b) includes.
    .concat((exclude || []).map((e) => e[0] === "!" ? e.substring(1) : `!${e}`))
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

/**
 * Package Serverless applications manually.
 *
 * ## How it works
 *
 * Essentially, the plugin "tricks" Serverless into thinking that an artifact
 * is specified, which skips all normal Serverless packaging, and then does
 * the packaging manually.
 *
 * Functionally, this looks something like:
 * 1. Looks for any services and/or functions that the Serverless framework
 *    would publish with its built-in logic,
 * 2. Disables this by setting `service|function.pacakge.artifact` fields in
 *    the runtime Serverless configuration object, and;
 * 3. Invoking scripts to create an artifact that matches the newly-set
 *    `.artifact` paths in configuration
 *
 * ## Application
 *
 * This plugin only is invoked to create custom packages if default Serverless
 * packaging would apply. Notably, this means this plugin is a noop for
 * scenarios including:
 * - `service.package.artifact`
 * - `function.package.artifact`
 * - `function.package.disable`
 *
 * The plugin does apply and follows the logic of configurations that include:
 * - `service.package.individually`
 * - `function.package.individually`
 */
class Jetpack {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;

    this.hooks = {
      "before:package:createDeploymentArtifacts": this.package.bind(this)
    };
  }

  _log(msg) {
    const { cli } = this.serverless;
    cli.log(`[${PLUGIN_NAME}] ${msg}`);
  }

  _logDebug(msg) {
    if (process.env.SLS_DEBUG) {
      this._log(msg);
    }
  }

  // Root options.
  get _serviceOptions() {
    if (this.__options) { return this.__options; }

    const { service } = this.serverless;
    const defaults = {
      base: ".",
      roots: null
    };

    const custom = (service.custom || {}).jetpack;
    this.__options = Object.assign({}, defaults, custom, this.options);

    // Coerce CLI roots into array.
    if (typeof this.__options.roots === "string") {
      this.__options.roots = this.__options.roots.split(",");
    }

    return this.__options;
  }

  // Function overrides, etc.
  _functionOptions({ functionObject }) {
    if (!functionObject) {
      return this._serviceOptions;
    }

    const opts = Object.assign({}, this._serviceOptions);
    const fnOpts = functionObject.jetpack || {};
    if (fnOpts.roots) {
      opts.roots = (opts.roots || []).concat(fnOpts.roots);
    }

    return opts;
  }

  filePatterns({ functionObject }) {
    const { service, pluginManager } = this.serverless;
    const servicePackage = service.package;
    const serviceInclude = servicePackage.include || [];
    const serviceExclude = servicePackage.exclude || [];

    const functionPackage = (functionObject || {}).package || {};
    const functionInclude = functionPackage.include || [];
    const functionExclude = functionPackage.exclude || [];

    // Combined, unique patterns, in stable sorted order (remove _later_ instances).
    // This is `_.union` in serverless built-in.
    const include = union(serviceInclude, functionInclude);

    // Packaging logic.
    //
    // We essentially recreate what `serverless` does:
    // - Default excludes
    // - Exclude serverless config files
    // - Exclude plugin local paths
    // - Apply service package excludes
    // - Apply function package excludes
    //
    // https://serverless.com/framework/docs/providers/aws/guide/packaging#exclude--include
    // > At first it will apply the globs defined in exclude. After that it'll
    // > add all the globs from include. This way you can always re-include
    // > previously excluded files and directories.
    //
    // Start with serverless excludes, plus a few refinements.
    const slsDefaultExcludePatterns = [
      ".git/**",
      ".gitignore",
      ".DS_Store",
      ".serverless/**",
      ".serverless_plugins/**",

      // Additional things no-one wants.
      "npm-debug.log*",
      "yarn-error.log*"
    ];

    // Get plugin local path.
    const pluginsLocalPath = pluginManager.parsePluginsObject(service.plugins).localPath;

    // Unify in similar order to serverless.
    const exclude = [
      slsDefaultExcludePatterns,
      pluginsLocalPath ? [pluginsLocalPath] : null,
      serviceExclude,
      functionExclude
    ]
      .filter((arr) => !!arr && arr.length)
      .reduce((memo, arr) => union(memo, arr), []);

    return {
      include,
      exclude
    };
  }

  // Analogous file resolver to built-in serverless.
  //
  // The main difference is that we exclude the root project `node_modules`
  // except for production dependencies.
  //
  // See: `resolveFilePathsFromPatterns` in
  // https://github.com/serverless/serverless/blob/master/lib/plugins/package/lib/packageService.js#L212-L254
  async resolveFilePathsFromPatterns({ depInclude, include, exclude }) {
    const { config } = this.serverless;
    const servicePath = config.servicePath || ".";

    // _Now_, start globbing like serverless does.
    // 1. Glob everything on disk using only _includes_ (except `node_modules`).
    //    This is loosely, what serverless would do with the difference that
    //    **everything** in `node_modules` is globbed first and then files
    //    excluded manually by `nanomatch` after. We get the same result here
    //    without reading from disk.
    const globInclude = ["**"]
      // Remove all node_modules.
      .concat(["!node_modules"])
      // ... except for the production node_modules
      .concat(depInclude || [])
      // ... then normal include like serverless does.
      .concat(include || []);

    const files = await globby(globInclude, {
      cwd: servicePath,
      dot: true,
      silent: true,
      follow: true,
      nodir: true
    });

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
      .map((ext) => path.relative(servicePath, `serverless.${ext}`))
      .filter((f) => slsConfigMap[f])[0];
    // Add to excludes like serverless does.
    // _Note_: Mutates `exclude`, but this is really like a "late fixing" of
    // what would happen anyways in serverless.
    if (cfgToRemove) {
      exclude.push(cfgToRemove);
    }

    // Filter as Serverless does.
    const filtered = filterFiles({ files, exclude, include });
    if (!filtered.length) {
      throw new this.serverless.classes.Error("No file matches include / exclude patterns");
    }

    return filtered;
  }

  async createZip({ files, filesRoot, bundlePath }) {
    // Use Serverless-analogous library + logic to create zipped artifact.
    const zip = archiver.create("zip");

    // Ensure full path to bundle exists before opening stream.
    await makeDir(path.dirname(bundlePath));
    const output = createWriteStream(bundlePath);

    this._logDebug(
      `Zipping ${files.length} sources from ${filesRoot} to artifact location: ${bundlePath}`
    );

    return new Promise((resolve, reject) => { // eslint-disable-line promise/avoid-new
      output.on("close", () => resolve());
      output.on("error", reject);
      zip.on("error", reject);

      output.on("open", () => {
        zip.pipe(output);

        // Serverless framework packages up files individually with various tweaks
        // (setting file times to epoch, chmod-ing things, etc.) that we don't do
        // here. Instead we just zip up the whole build directory.
        // See: https://github.com/serverless/serverless/blob/master/lib/plugins/package/lib/zipService.js#L91-L104
        files.forEach((name) => {
          zip.file(path.join(filesRoot, name), { name });
        });

        zip.finalize();
      });
    });
  }

  async globAndZip({ bundleName, functionObject }) {
    const { config } = this.serverless;
    const servicePath = config.servicePath || ".";
    const bundlePath = path.resolve(servicePath, bundleName);
    const { base, roots } = this._functionOptions({ functionObject });
    const { include, exclude } = this.filePatterns({ functionObject });

    // Iterate all dependency roots to gather production dependencies.
    const rootPath = path.resolve(servicePath, base);
    const depInclude = await Promise
      .all((roots || ["."])
        // Relative to servicePath.
        .map((depRoot) => path.resolve(servicePath, depRoot))
        // Find deps.
        .map((curPath) => findProdInstalls({ rootPath, curPath }))
      )
      .then((found) => found
        // Flatten.
        .reduce((m, a) => m.concat(a), [])
        // Relativize to servicePath / CWD.
        .map((dep) => path.relative(servicePath, path.join(rootPath, dep)))
        // Sort for proper glob order.
        .sort()
        // Add excludes for node_modules in every discovered pattern dep dir.
        // This allows us to exclude devDependencies because **later** include
        // patterns should have all the production deps already and override.
        .map((dep) => dep.indexOf(path.join("node_modules", ".bin")) === -1
          ? [dep, `!${path.join(dep, "node_modules")}`]
          : [dep]
        )
        // Re-flatten the temp arrays we just introduced.
        .reduce((m, a) => m.concat(a), [])
      );

    // Glob and filter all files in package.
    const files = await this.resolveFilePathsFromPatterns({ depInclude, include, exclude });

    // Create package zip.
    await this.createZip({
      files,
      filesRoot: servicePath,
      bundlePath
    });
  }

  async packageFunction({ functionName, functionObject }) {
    // Mimic built-in serverless naming.
    // **Note**: We _do_ append ".serverless" in path skipping serverless'
    // internal copying logic.
    const bundleName = path.join(SLS_TMP_DIR, `${functionName}.zip`);

    // Package.
    const start = new Date();
    this._logDebug(`Start packaging function: ${bundleName}`);
    await this.globAndZip({ bundleName, functionObject });

    // Mutate serverless configuration to use our artifacts.
    functionObject.package = functionObject.package || {};
    functionObject.package.artifact = bundleName;

    this._log(`Packaged function: ${bundleName} (${elapsed(start)}s)`);
  }

  async packageService() {
    const { service } = this.serverless;
    const serviceName = service.service;
    const servicePackage = service.package;

    // Mimic built-in serverless naming.
    const bundleName = path.join(SLS_TMP_DIR, `${serviceName}.zip`);

    // Package.
    const start = new Date();
    this._logDebug(`Start packaging service: ${bundleName}`);
    await this.globAndZip({ bundleName });

    // Mutate serverless configuration to use our artifacts.
    servicePackage.artifact = bundleName;

    this._log(`Packaged service: ${bundleName} (${elapsed(start)}s)`);
  }

  async package() {
    const { service } = this.serverless;
    const servicePackage = service.package;

    // Gather internal configuration.
    const fnsPkgs = service.getAllFunctions()
      .map((functionName) => ({
        functionName,
        functionObject: service.getFunction(functionName)
      }))
      .map((obj) => ({
        ...obj,
        functionPackage: obj.functionObject.package || {}
      }))
      .map((obj) => ({
        ...obj,
        disable: !!obj.functionPackage.disable,
        individually: !!obj.functionPackage.individually,
        artifact: obj.functionPackage.artifact
      }));

    const fnsPkgsToPackage = fnsPkgs.filter((obj) =>
      (servicePackage.individually || obj.individually) && !(obj.disable || obj.artifact)
    );

    // Process functions in serial.
    if (fnsPkgsToPackage.length) {
      this._log(`Packaging ${fnsPkgsToPackage.length} functions`);
      const limit = pLimit(1);
      await Promise.all(fnsPkgsToPackage.map((obj) => limit(() => this.packageFunction(obj))));
    }

    // We recreate the logic from `packager#packageService` for deciding whether
    // to package the service or not.
    const shouldPackageService = !servicePackage.individually
      && fnsPkgs.some((obj) => !(obj.disable || obj.individually || obj.artifact));

    // Package entire service if applicable.
    if (shouldPackageService && !servicePackage.artifact) {
      await this.packageService();
    } else if (!fnsPkgsToPackage.length) {
      // Detect if we did nothing...
      this._logDebug("No matching service or functions to package.");
    }
  }
}

module.exports = Jetpack;
