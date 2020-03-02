"use strict";

const pkg = require("./package.json");
const path = require("path");
const pLimit = require("p-limit");
const Worker = require("jest-worker").default;
const { globAndZip } = require("./util/bundle");
const globby = require("globby");

const SLS_TMP_DIR = ".serverless";
const PLUGIN_NAME = pkg.name;

// Timer and formatter.
// eslint-disable-next-line no-magic-numbers
const toSecs = (time) => (time / 1000).toFixed(2);

// Simple, stable union.
const union = (arr1, arr2) => {
  const set1 = new Set(arr1);
  return arr1.concat(arr2.filter((o) => !set1.has(o)));
};

const dedent = (str, num) => str
  .split("\n")
  .map((l) => l.substring(num))
  .join("\n");

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
 * 2. Disables this by setting `service|function.package.artifact` fields in
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

    this.commands = {
      jetpack: {
        usage: "Alternate Serverless packager",
        commands: {
          "package": {
            usage: "Packages a Serverless service or function",
            lifecycleEvents: [
              "package"
            ],
            options: {
              "function": {
                usage: "Function name. Packages a single function (see 'deploy function')",
                shortcut: "f"
              },
              report: {
                usage: "Generate full bundle report",
                shortcut: "r"
              }
            }
          }
        }
      }
    };

    // The `ServerlessEnterprisePlugin` awkwardly wreaks havoc with alternative
    // packaging.
    //
    // `serverless` special cases it and ensures it's _always_ the last plugin.
    // This means that our plugin order ends up looking like:
    //
    // - ...
    // - 'Package',
    // - ...
    // - 'Jetpack',
    // - 'ServerlessEnterprisePlugin'
    //
    // Unfortunately, the plugin hooks end up like this:
    //
    // - `Jetpack:before:package:createDeploymentArtifacts`:
    //   Bundles all files, creating artifact to avoid `Package` doing it.
    // - `ServerlessEnterprisePlugin:before:package:createDeploymentArtifacts`:
    //   Creates the `s_<NAME>.js` wrapper files.
    // - `Package:package:createDeploymentArtifacts`:
    //   Creates any artifacts that don't already exist.
    //
    // This means that Jetpack can't easily get both the SFE wrappers and still
    // control packaging:
    //
    // - If Jetpack stays with `before:package:createDeploymentArtifacts`
    //   it misses the `s_<NAME>.js` wrapper files.
    // - _But_, if Jetpack hooks to `package:createDeploymentArtifacts` then
    //  `Package` will actually perform real packaging and it's too late.
    //
    // To get around this awkward situation, we create a hooks object that is
    // delayed until the `initialize` lifecycle, then patched in last. This
    // ensures that Jetpack's hooks run absolutely last for these events. This
    // is still a bit hacky, but not nearly as invasive as some of the other
    // approaches we considered. H/T to `@medikoo` for the strategy:
    // https://github.com/FormidableLabs/serverless-jetpack/pull/68#issuecomment-556987101
    const delayedHooks = {
      "before:package:createDeploymentArtifacts": this.package.bind(this),
      "before:package:function:package": this.package.bind(this)
    };

    this.hooks = {
      // Use delayed hooks to guarantee we are **last** to run so other things
      // like the Serverless Enterprise plugin run before us.
      initialize: () => {
        const { hooks } = serverless.pluginManager;
        Object.keys(delayedHooks).forEach((event) => {
          hooks[event] = (hooks[event] || []).concat({
            pluginName: this.constructor.name,
            hook: delayedHooks[event]
          });
        });
      },
      "jetpack:package:package": this.package.bind(this)
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
      roots: null,
      preInclude: [],
      trace: false,
      concurrency: 1
    };

    const custom = (service.custom || {}).jetpack;
    this.__options = Object.assign({}, defaults, custom, this.options);

    return this.__options;
  }

  // Function, layer overrides, etc.
  // eslint-disable-next-line complexity
  _extraOptions({ functionObject, layerObject }) {
    if (!functionObject && !layerObject) {
      return this._serviceOptions;
    }

    const opts = Object.assign({}, this._serviceOptions);

    const fnObj = functionObject || {};
    const fnOpts = fnObj.jetpack || {};
    const layerOpts = (layerObject || {}).jetpack || {};

    if (fnOpts.roots || layerOpts.roots) {
      opts.roots = (opts.roots || [])
        .concat(fnOpts.roots || [])
        .concat(layerOpts.roots || []);
    }

    opts.preInclude = opts.preInclude.concat(fnOpts.preInclude || []);
    opts.trace = fnOpts.trace;

    return opts;
  }

  // Helper for layer patterns we'll need for all packages
  get _layerExcludes() {
    if (this.__layerExcludes) { return this.__layerExcludes; }

    const { service } = this.serverless;
    this.__layerExcludes = service.getAllLayers()
      .map((layer) => service.getLayer(layer))
      .filter((layerObj) => layerObj.path)
      .map((layerObj) => `${layerObj.path}/**`);

    return this.__layerExcludes;
  }

  // // Helper for trace configurations.
  // _traceConfig({ functionObject } = {}) {
  //   const serviceTrace = this._serviceOptions.trace;
  //   const serviceTraceObj = typeof serviceTrace === "object" ?  serviceTrace : {};
  //   const functionTrace = functionObject && this._extraOptions({ functionObject }).trace;
  //   const functionTraceObj = typeof functionTrace === "object" ?  functionTrace : {};

  //   //


  //   return "TODO";
  // }

  async _traceInclude({ functionObject, functionObjects } = {}) {
    // Detect if in tracing mode
    const serviceTrace = this._serviceOptions.trace;
    const functionTrace = functionObject && this._extraOptions({ functionObject }).trace;

    // Filter to only the function objects we should trace.
    let tracedObjects = [];
    if (functionObjects && serviceTrace) {
      // Service-level trace + service package.
      tracedObjects = functionObjects;
    } else if (functionObject && (functionTrace || serviceTrace && functionTrace !== false)) {
      // `individually` function package with service or individual.
      tracedObjects = [functionObject];
    }

    // Extract handler functions to trace and short-circuit if none.
    const handlers = tracedObjects.map((obj) => obj.handler);
    const unit = functionObjects ? "service" : `function: ${functionObject.name}`;
    this._logDebug(
      `Found ${handlers.length} handlers to trace for ${unit}: ${JSON.stringify(handlers)}`
    );

    // Short-circuit if there's nothing to trace.
    if (!handlers.length) { return undefined; }

    // Find the handler files.
    const cwd = this.serverless.config.servicePath || ".";
    const handlerFiles = await Promise.all(handlers.map(async (handler) => {
      // We extract handler file name pretty analogously to how serverless does it.
      let pattern = handler.replace(/\.[^\.]+$/, "");
      // Add pattern glob if not already present.
      if (!(/\.(js|mjs)$/).test(pattern)) {
        pattern += ".{js,mjs}";
      }

      // Find (potentially multiple) matches
      const matched = await globby(pattern, { cwd });
      if (!matched.length) {
        throw new Error(`Could not find file for handler: ${handler} with pattern: ${pattern}`);
      }

      // Choose JS first, else first matched entry.
      const matchedJsFile = matched.filter((file) => (/\.js$/).test(file))[0];
      return matchedJsFile || matched[0];
    }));

    // eslint-disable-next-line consistent-return
    return handlerFiles;
  }

  _report({ results }) {
    const INDENT = 6;
    /* eslint-disable max-len*/
    const bundles = results
      .map(({ bundlePath, roots, patterns, files }) => `
      ## ${path.basename(bundlePath)}

      - Path: ${bundlePath}
      - Roots: ${roots ? "" : "(None)"}
      ${(roots || []).map((p) => `    - '${p}'`).join("\n      ")}

      ### Patterns: Include

      \`\`\`yml
      # Automatically added
      - '**'
      # Jetpack (\`${patterns.preInclude.length}\`): \`custom.jetpack.preInclude\` + \`function.{NAME}.jetpack.preInclude\`
      ${patterns.preInclude.map((p) => `- '${p}'`).join("\n      ")}
      # Jetpack (\`${patterns.depInclude.length}\`): dependency filtering mode additions
      ${patterns.depInclude.map((p) => `- '${p}'`).join("\n      ")}
      # Jetpack (\`${patterns.traceInclude.length}\`): trace mode additions
      ${patterns.traceInclude.map((p) => `- '${p}'`).join("\n      ")}
      # Serverless (\`${patterns.include.length}\`): \`package.include\` + \`function.{NAME}.package.include\` + internal extras
      ${patterns.include.map((p) => `- '${p}'`).join("\n      ")}
      \`\`\`

      ### Patterns: Exclude

      \`\`\`yml
      # Serverless (\`${patterns.exclude.length}\`): \`package.exclude\` + \`function.{NAME}.exclude\` + internal extras
      ${patterns.exclude.map((p) => `- '${p}'`).join("\n      ")}
      \`\`\`

      ### Files (\`${files.included.length}\`): Included

      ${files.included.sort().map((p) => `- ${p}`).join("\n      ")}

      ### Files (\`${files.excluded.length}\`): Excluded

      ${files.excluded.sort().map((p) => `- ${p}`).join("\n      ")}
      `)
      .join("\n");
    /* eslint-enable max-len*/

    this._log(dedent(`
      # Jetpack Bundle Report
      ${bundles}
    `, INDENT));
  }

  // eslint-disable-next-line complexity,max-statements
  filePatterns({ functionObject, layerObject }) {
    const { service, pluginManager } = this.serverless;
    const servicePackage = service.package;
    const serviceInclude = servicePackage.include || [];
    const serviceExclude = servicePackage.exclude || [];

    const functionPackage = (functionObject || {}).package || {};
    const functionInclude = functionPackage.include || [];
    const functionExclude = functionPackage.exclude || [];

    const layerPackage = (layerObject || {}).package || {};
    const layerInclude = layerPackage.include || [];
    const layerExclude = layerPackage.exclude || [];

    // Combined, unique patterns, in stable sorted order (remove _later_ instances).
    // This is `_.union` in serverless built-in.
    let include = serviceInclude;
    if (functionInclude) {
      include = union(include, functionInclude);
    }
    if (layerInclude) {
      include = union(include, layerInclude);
    }

    // Packaging logic.
    //
    // We essentially recreate what `serverless` does:
    // - Default excludes
    // - Exclude serverless config files
    // - Exclude plugin local paths
    // - Exclude all layers
    // - Apply service package excludes
    // - Apply function package excludes
    // - Apply layer package excludes
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
      this._layerExcludes,
      functionExclude,
      layerExclude
    ]
      .filter((arr) => !!arr && arr.length)
      .reduce((memo, arr) => union(memo, arr), []);

    return {
      include,
      exclude
    };
  }

  async globAndZip({ bundleName, functionObject, layerObject, traceInclude, worker, report }) {
    const { config } = this.serverless;
    const servicePath = config.servicePath || ".";
    const layerPath = (layerObject || {}).path;
    const cwd = layerPath ? path.relative(servicePath, layerPath) : servicePath;

    const { base, roots, preInclude } = this._extraOptions({ functionObject, layerObject });
    const { include, exclude } = this.filePatterns({ functionObject, layerObject });

    const buildFn = worker ? worker.globAndZip : globAndZip;
    const results = await buildFn({
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
    });

    const { numFiles, bundlePath } = results;
    this._logDebug(
      `Zipped ${numFiles} sources from ${cwd} to artifact location: ${bundlePath}`
    );

    return results;
  }

  async packageFunction({ functionName, functionObject, worker, report }) {
    // Mimic built-in serverless naming.
    // **Note**: We _do_ append ".serverless" in path skipping serverless'
    // internal copying logic.
    const bundleName = path.join(SLS_TMP_DIR, `${functionName}.zip`);

    // Get traces.
    const traceInclude = await this._traceInclude({ functionObject });
    const mode = traceInclude ? "trace" : "dependency";

    // Package.
    this._logDebug(`Start packaging function: ${bundleName} in mode: ${mode}`);
    const results = await this.globAndZip({
      bundleName, functionObject, traceInclude, worker, report
    });
    const { buildTime } = results;

    // Mutate serverless configuration to use our artifacts.
    functionObject.package = functionObject.package || {};
    functionObject.package.artifact = bundleName;

    this._log(`Packaged function: ${bundleName} (${toSecs(buildTime)}s)`);
    return { packageType: "function", ...results };
  }

  async packageService({ functionObjects, worker, report }) {
    const { service } = this.serverless;
    const serviceName = service.service;
    const servicePackage = service.package;

    // Mimic built-in serverless naming.
    const bundleName = path.join(SLS_TMP_DIR, `${serviceName}.zip`);

    // Get traces.
    const traceInclude = await this._traceInclude({ functionObjects });
    const mode = traceInclude ? "trace" : "dependency";

    // Package.
    this._logDebug(`Start packaging service: ${bundleName} in mode: ${mode}`);
    const results = await this.globAndZip({ bundleName, traceInclude, worker, report });
    const { buildTime } = results;

    // Mutate serverless configuration to use our artifacts.
    servicePackage.artifact = bundleName;

    this._log(`Packaged service: ${bundleName} (${toSecs(buildTime)}s)`);
    return { packageType: "service", ...results };
  }

  async packageLayer({ layerName, layerObject, worker, report }) {
    const bundleName = path.join(SLS_TMP_DIR, `${layerName}.zip`);

    // Package. (Not traced)
    this._logDebug(`Start packaging layer: ${bundleName}`);
    const results = await this.globAndZip({ bundleName, layerObject, worker, report });
    const { buildTime } = results;

    // Mutate serverless configuration to use our artifacts.
    layerObject.package = layerObject.package || {};
    layerObject.package.artifact = bundleName;

    this._log(`Packaged layer: ${bundleName} (${toSecs(buildTime)}s)`);
    return { packageType: "layer", ...results };
  }

  // eslint-disable-next-line max-statements,complexity
  async package() {
    const { service } = this.serverless;
    const servicePackage = service.package;
    const serviceIsNode = (service.provider.runtime || "").startsWith("node");
    const { concurrency } = this._serviceOptions;
    const options = this.options || {};
    const report = !!options.report;

    let tasks = [];
    let worker;

    // ------------------------------------------------------------------------
    // Lambdas
    // ------------------------------------------------------------------------
    // Check if we have a single function limitation from `deploy -f name`.
    const singleFunctionName = options.function;
    if (singleFunctionName) {
      this._logDebug(`Packaging only for function: ${singleFunctionName}`);
    }

    // Functions.
    const fnsPkgs = service.getAllFunctions()
      // Limit to single function if provided.
      .filter((functionName) => !singleFunctionName || singleFunctionName === functionName)
      // Convert to more useful format.
      .map((functionName) => ({
        functionName,
        functionObject: service.getFunction(functionName)
      }))
      .map((obj) =>
        // console.log("TODO functionObject", JSON.stringify(obj.functionObject, null, 2));
        obj
      )
      .map((obj) => ({
        ...obj,
        functionPackage: obj.functionObject.package || {},
        runtime: obj.functionObject.runtime,
        isNode: (obj.functionObject.runtime || "").startsWith("node")
      }))
      .map((obj) => ({
        ...obj,
        disable: !!obj.functionPackage.disable,
        individually: !!obj.functionPackage.individually,
        artifact: obj.functionPackage.artifact
      }));

    // console.log("TODO HERE fnsPkgs", { fnsPkgs });

    // Get list of individual functions to package.
    const individualPkgs = fnsPkgs.filter((obj) => servicePackage.individually || obj.individually);
    const fnsPkgsToPackage = individualPkgs.filter((obj) =>
      // Enabled
      !(obj.disable || obj.artifact)
      // Function runtime is node or unspecified + service-level node.
      && (obj.isNode || !obj.runtime && serviceIsNode)
    );
    const numFns = fnsPkgsToPackage.length;
    tasks = tasks.concat(fnsPkgsToPackage.map((obj) => () =>
      this.packageFunction({ ...obj, worker, report })
    ));
    if (numFns < individualPkgs.length) {
      this._log(`Skipping individual packaging for ${individualPkgs.length - numFns} functions`);
    }

    // We recreate the logic from `packager#packageService` for deciding whether
    // to package the service or not.
    const serviceFnsToPkg = !servicePackage.individually
      && !servicePackage.artifact
      // Service must be Node.js
      && serviceIsNode
      // Don't package service if we specify a single function **and** have a match
      && (!singleFunctionName || !numFns)
      // Otherwise, have some functions left that need to use the service package.
      && fnsPkgs.filter((obj) => !(obj.disable || obj.individually || obj.artifact));
    const shouldPackageService = !!serviceFnsToPkg.length;

    // Package entire service if applicable.
    if (shouldPackageService) {
      tasks.push(() => this.packageService({
        functionObjects: serviceFnsToPkg.map((o) => o.functionObject),
        worker,
        report
      }));
    } else if (!numFns) {
      // Detect if we did nothing...
      this._logDebug("No matching service or functions to package.");
    }

    // ------------------------------------------------------------------------
    // Layers
    // ------------------------------------------------------------------------
    const layersPkgs = service.getAllLayers()
      // Convert to more useful format.
      .map((layerName) => ({
        layerName,
        layerObject: service.getLayer(layerName)
      }))
      .map((obj) => ({
        ...obj,
        layerPackage: obj.layerObject.package || {}
      }))
      .map((obj) => ({
        ...obj,
        disable: !!obj.layerObject.disable,
        artifact: obj.layerObject.artifact
      }));

    // Package layers if not in `-f NAME` single-function mode.
    let numLayers = 0;
    if (!singleFunctionName) {
      // Get list of layers to package.
      const layersPkgsToPackage = layersPkgs.filter((obj) => !(obj.disable || obj.artifact));
      numLayers = layersPkgsToPackage.length;
      tasks = tasks.concat(layersPkgsToPackage.map((obj) => () =>
        this.packageLayer({ ...obj, worker, report })
      ));
    }

    // Run all packaging work.
    this._log(
      `Packaging ${numFns} functions, ${shouldPackageService ? 1 : 0} services, and `
      + `${numLayers} layers with concurrency ${concurrency}`
    );

    let results;
    if (concurrency > 1) {
      // Run concurrently.
      worker = new Worker(require.resolve("./util/bundle"), {
        numWorkers: concurrency
      });
      results = await Promise.all(tasks.map((fn) => fn()));
      worker.end();
    } else {
      // Run serially in-band.
      const limit = pLimit(1);
      results = await Promise.all(tasks.map(limit));
    }

    // Report.
    if (report) {
      this._report({ results });
    }

    return results;
  }
}

module.exports = Jetpack;
