"use strict";

const path = require("path");
const pLimit = require("p-limit");
const { Worker } = require("jest-worker");
const { globAndZip } = require("./util/bundle");
const globby = require("globby");

const PLUGIN_NAME = require("./package.json").name;
const SLS_TMP_DIR = ".serverless";

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

const uniq = (val, i, arr) => val !== arr[i - 1];

// Concatenate two arrays and produce sorted, unique values.
const smartConcat = (arr1, arr2) => []
  // Aggregate in service-level includes first
  .concat(arr1 || [], arr2 || [])
  // Make unique.
  .sort()
  .filter(uniq);

// Merge two objects of form `{ key: [] }`.
const smartMerge = (obj1 = {}, obj2 = {}) =>
  // Get all unique missing package keys.
  smartConcat(Object.keys(obj1), Object.keys(obj2))
    // Smart merge unique missing values
    .reduce((obj, key) => {
      // Aggregate service and function unique missing values.
      obj[key] = smartConcat(obj1[key], obj2[key]);
      return obj;
    }, {});

const toPosix = (file) => !file ? file : file.replace(/\\/g, "/");

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
                shortcut: "f",
                type: "string"
              },
              report: {
                usage: "Generate full bundle report",
                shortcut: "r",
                type: "boolean"
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

  _log(msg, opts) {
    const { cli } = this.serverless;
    cli.log(`[${PLUGIN_NAME}] ${msg}`, null, opts);
  }

  _logDebug(msg) {
    if (process.env.SLS_DEBUG) {
      this._log(msg);
    }
  }

  _logWarning(msg) {
    const { cli } = this.serverless;
    cli.log(`[${PLUGIN_NAME}] WARNING: ${msg}`, null, { color: "red" });
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
      concurrency: 1,
      collapsed: {}
    };

    const custom = (service.custom || {}).jetpack;
    this.__options = Object.assign({}, defaults, custom, this.options);
    this.__options.collapsed = {
      bail: !!this.__options.collapsed.bail
    };

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

    if (fnOpts.collapsed || layerOpts.collapsed) {
      // Assume only one of function / layer provided.
      const collapsedOpts = {
        ...fnOpts.collapsed,
        ...layerOpts.collapsed
      };
      opts.collapsed = {
        bail: typeof collapsedOpts.bail === "boolean"
          ? collapsedOpts.bail
          : opts.collapsed.bail
      };
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

  // Helper for trace configurations.
  _traceConfig({ functionObject, functionObjects } = {}) {
    // Mode: trace functions via service package
    const serviceTrace = this._serviceOptions.trace;
    const serviceEnabled = typeof serviceTrace === "object" || serviceTrace === true;
    const serviceFnIncludes = (functionObjects || [])
      // Get array of arrays of function trace includes for service-level packaging only.
      .map((obj) => (this._extraOptions({ functionObject: obj }).trace || {}).include || [])
      // Flatten to a single array
      .reduce((m, a) => m.concat(a), []);
    const serviceObj = {
      ignores: [],
      allowMissing: {},
      include: [],
      collapsed: {},
      dynamic: {},
      ...typeof serviceTrace === "object" ? serviceTrace : {}
    };
    // Aggregate with all service-packaged functions.
    serviceObj.include = smartConcat(serviceObj.include, serviceFnIncludes);
    serviceObj.dynamic = {
      bail: false,
      resolutions: {},
      ...serviceObj.dynamic
    };

    // Mode: trace individual function.
    const functionTrace = functionObject && this._extraOptions({ functionObject }).trace;
    const functionObj = {
      ignores: [],
      allowMissing: {},
      include: [],
      collapsed: {},
      dynamic: {},
      ...typeof functionTrace === "object" ? functionTrace : {}
    };
    functionObj.include = smartConcat(serviceObj.include, functionObj.include);
    functionObj.ignores = smartConcat(serviceObj.ignores, functionObj.ignores);
    functionObj.allowMissing = smartMerge(serviceObj.allowMissing, functionObj.allowMissing);
    functionObj.dynamic = {
      ...functionObj.dynamic,
      bail: typeof functionObj.dynamic.bail !== "undefined"
        ? functionObj.dynamic.bail
        : serviceObj.dynamic.bail,
      resolutions: smartMerge(serviceObj.dynamic.resolutions, functionObj.dynamic.resolutions)
    };

    // Convert **relative** paths in allowMissing, resolutions to absolute paths.
    // Anything starting with at dot (`.`) is considered an application path
    // and converted. Remaining relative paths are packages.
    const cwd = this.serverless.config.servicePath || ".";
    [
      serviceObj.allowMissing,
      functionObj.allowMissing,
      serviceObj.dynamic.resolutions,
      functionObj.dynamic.resolutions
    ].forEach((res) => Object.entries(res)
      .filter(([key]) => key.startsWith("."))
      .forEach(([key, val]) => {
        // Replace key and mutate falsey values to an empty array.
        delete res[key];
        res[path.resolve(cwd, key)] = val || [];
      }));

    return {
      service: {
        enabled: serviceEnabled,
        obj: serviceObj
      },
      "function": {
        enabled:
          typeof functionTrace === "object"
          || functionTrace === true
          || serviceEnabled && functionTrace !== false,
        obj: functionObj
      }
    };
  }

  // eslint-disable-next-line max-statements
  async _traceOptions({ functionObject, functionObjects } = {}) {
    // Detect if in tracing mode
    const traceConfig = this._traceConfig({ functionObject, functionObjects });

    // Filter to only the function objects we should trace.
    let fnObjs = [];
    let traceObj;
    if (functionObjects && traceConfig.service.enabled) {
      // Service-level trace + service package.
      fnObjs = functionObjects;
      traceObj = traceConfig.service.obj;
    } else if (functionObject && traceConfig.function.enabled) {
      // `individually` function package with service or individual.
      fnObjs = [functionObject];
      traceObj = traceConfig.function.obj;
    }

    // Extract handler functions to trace and short-circuit if none.
    const handlers = fnObjs.map((obj) => obj.handler);
    const unit = functionObjects ? "service" : `function: ${functionObject.name}`;
    this._logDebug(
      `Found ${handlers.length} handlers to trace for ${unit}: ${JSON.stringify(handlers)}`
    );

    // Short-circuit if there's nothing to trace.
    if (!handlers.length) { return {}; }

    // Create the full list of globs to trace.
    const cwd = this.serverless.config.servicePath || ".";
    const traceInclude = await Promise
      // Find all the handler files in preference order.
      .all(handlers.map(async (handler) => {
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
      }))
      // Add in the user-configured extra includes.
      .then((matchedJsFiles) => [].concat(matchedJsFiles, traceObj.include));

    return {
      traceInclude,
      traceParams: {
        // These are **only** parameters to `traceFiles()`.
        ignores: traceObj.ignores,
        allowMissing: traceObj.allowMissing,
        extraImports: traceObj.dynamic.resolutions
      },
      dynamic: traceObj.dynamic
    };
  }

  _traceMissesReport(misses) {
    return Object.entries(misses)
      .map(([depPath, missList]) => missList
        ? missList.map(({ src, loc: { start: { line, column } } }) =>
          `- ${depPath} [${line}:${column}]: ${src}`
        )
        : [`- ${depPath}`]
      )
      .reduce((arr, missList) => arr.concat(missList), []);
  }

  _traceMissesPkgsReport(pkgMisses) {
    return Object.values(pkgMisses)
      .map((misses) => this._traceMissesReport(misses))
      .reduce((arr, missList) => arr.concat(missList), []);
  }

  // Handle tracing misses.
  // 1. Log / error for trace misses.
  // 2. Generate data for resolutions and remaining misses.
  // eslint-disable-next-line max-statements
  _handleTraceMisses({ bundleName, misses, resolutions, bail }) {
    const cwd = this.serverless.config.servicePath || ".";

    // Full, normalized paths for all resolutions for matching.
    const resSrcs = new Set(Object.keys(resolutions)
      .filter((f) => path.isAbsolute(f))
      .map((f) => toPosix(f))
    );

    const resPkgs = new Set(Object.keys(resolutions)
      .filter((f) => !path.isAbsolute(f))
      .map((f) => toPosix(f))
    );

    // Create a copy of misses and then iterate and mutate to remove the
    // entries that were resolved.
    const { srcs, pkgs } = JSON.parse(JSON.stringify(misses));
    const resolved = { srcs: {}, pkgs: {} };

    // Misses shape: `{ relPath: MISSES_OBJ }`
    Object.keys(srcs).forEach((relPath) => {
      const fullPath = toPosix(path.resolve(cwd, relPath));

      // Remove matches.
      if (resSrcs.has(fullPath)) {
        resolved.srcs[relPath] = ""; // Just report file path
        delete srcs[relPath];
      }
    });

    // Misses shape: `{ pkg: { relpath: MISSES_OBJ } }`
    Object.entries(pkgs).forEach(([pkg, pkgSrcs]) => {
      Object.keys(pkgSrcs).forEach((relPath) => {
        // Convert `misses.pkgs` entries to `resolutions` entries.
        //
        // `resolutions` are in abstract paths (`PKG/path/to/file.js`), whereas
        // `misses.pkgs` entries are in relative paths
        // (`../PKG/node_modules/path/to/file.js`). We need to make them
        // matchable.
        //
        // We can do an abbreviated "last package fragment" because we already
        // have confirmed we have legitimate node_modules packages.
        const parts = toPosix(path.normalize(relPath)).split("/");
        const lastModsIdx = parts.lastIndexOf("node_modules");
        const pkgPath = parts.slice(lastModsIdx + 1).join("/");

        // Remove matches.
        if (resPkgs.has(pkgPath)) {
          resolved.pkgs[pkg] = resolved.pkgs[pkg] || {};
          resolved.pkgs[pkg][relPath] = ""; // Just report file path

          delete pkgs[pkg][relPath];
          if (!Object.keys(pkgs[pkg]).length) {
            delete pkgs[pkg];
          }
        }
      });
    });

    const srcsLen = Object.keys(srcs).length;
    const pkgsLen = Object.keys(pkgs).length;

    if (srcsLen) {
      // Full report if bailing.
      const srcsReport = bail
        ? `\n${this._traceMissesReport(srcs)}`
        : JSON.stringify(Object.keys(srcs));

      this._logWarning(
        `Found ${srcsLen} source files with tracing misses in ${bundleName}! `
        + "Please see logs and read: https://npm.im/serverless-jetpack#handling-dynamic-import-misses"
      );
      this._log(`${bundleName} source file tracing misses: ${srcsReport}`, { color: "gray" });
    }

    if (pkgsLen) {
      // Full report if bailing.
      const pkgReport = bail
        ? `\n${this._traceMissesPkgsReport(pkgs)}`
        : JSON.stringify(Object.keys(pkgs));

      this._logWarning(
        `Found ${pkgsLen} dependency packages with tracing misses in ${bundleName}! `
        + "Please see logs and read: https://npm.im/serverless-jetpack#handling-dynamic-import-misses"
      );
      this._log(`${bundleName} dependency package tracing misses: ${pkgReport}`, { color: "gray" });
    }

    if ((srcsLen || pkgsLen) && bail) {
      throw new Error(
        "Bailing on tracing dynamic import misses. "
        + `Source Files: ${srcsLen}, Dependencies: ${pkgsLen}. `
        + "Please see logs and read: https://npm.im/serverless-jetpack#handling-dynamic-import-misses"
      );
    }

    return {
      missed: { srcs, pkgs },
      resolved
    };
  }

  _collapsedReport(summary) {
    const pkgsSummary = (packages) => packages ? `Packages: ${packages.length}, ` : "";
    const pkgsReport = (packages) => packages ? `: [${
      Object.values(packages).map((obj) => `${obj.path}@${obj.version}`).join(", ")
    }]` : "";

    return Object.entries(summary)
      .map(([group, { packages, numUniquePaths, numTotalFiles }]) =>
        `- ${group} (${pkgsSummary(packages)}`
        + `Files: ${numUniquePaths} unique, ${numTotalFiles} total)${pkgsReport(packages)}`
      );
  }

  // Handle collapsed duplicates.
  _handleCollapsed({ collapsed, bundleName, bail }) {
    const srcsLen = Object.keys(collapsed.srcs).length;
    const pkgsLen = Object.keys(collapsed.pkgs).length;

    // Nothing collapsed. Yay!
    if (!srcsLen && !pkgsLen) { return; }

    if (srcsLen) {
      const srcsReport = this._collapsedReport(collapsed.srcs).join("\n");

      this._logWarning(
        `Found ${srcsLen} collapsed source files in ${bundleName}! `
        + "Please fix, with hints at: "
        + "https://npm.im/serverless-jetpack#packaging-files-outside-cwd"
      );
      this._log(`${bundleName} collapsed source files:\n${srcsReport}`, { color: "gray" });
    }

    if (pkgsLen) {
      const pkgReport = this._collapsedReport(collapsed.pkgs).join("\n");

      this._logWarning(
        `Found ${pkgsLen} collapsed dependencies in ${bundleName}! `
        + "Please fix, with hints at: "
        + "https://npm.im/serverless-jetpack#packaging-files-outside-cwd"
      );
      this._log(`${bundleName} collapsed dependencies:\n${pkgReport}`, { color: "gray" });
    }

    if (bail) {
      throw new Error(
        "Bailing on collapsed files. "
        + `Source Files: ${srcsLen}, Dependencies: ${pkgsLen}. `
        + "Please see logs and read: https://npm.im/serverless-jetpack#packaging-files-outside-cwd"
      );
    }
  }

  _report({ results }) {
    const INDENT = 6;
    const JOIN_STR = `${"\n"}${" ".repeat(INDENT)}`;
    /* eslint-disable max-len*/
    const bundles = results
      .map(({ mode, bundlePath, roots, patterns, files, trace, collapsed }) => `
      ## ${path.basename(bundlePath)}

      - Path: ${bundlePath}
      - Mode: ${mode}
      - Roots: ${roots ? "" : "(None)"}
      ${(roots || []).map((p) => `    - '${p}'`).join(JOIN_STR)}

      ### Tracing: Configuration

      \`\`\`yml
      # Ignores (\`${trace.ignores.length}\`):
      ${trace.ignores.map((p) => `- '${p}'`).join(JOIN_STR)}
      # Allowed Missing (\`${Object.keys(trace.allowMissing).length}\`):
      ${Object.keys(trace.allowMissing).map((k) => `- '${k}': ${JSON.stringify(trace.allowMissing[k])}`).join(JOIN_STR)}
      \`\`\`

      ### Patterns: Include

      \`\`\`yml
      # Automatically added
      - '**'
      # Jetpack (\`${patterns.preInclude.length}\`): \`custom.jetpack.preInclude\` + \`function.{NAME}.jetpack.preInclude\`
      ${patterns.preInclude.map((p) => `- '${p}'`).join(JOIN_STR)}
      # Jetpack (\`${patterns.depInclude.length}\`): dependency filtering mode additions
      ${patterns.depInclude.map((p) => `- '${p}'`).join(JOIN_STR)}
      # Jetpack (\`${patterns.traceInclude.length}\`): trace mode additions
      ${patterns.traceInclude.map((p) => `- '${p}'`).join(JOIN_STR)}
      # Serverless (\`${patterns.include.length}\`): \`package.include\` + \`function.{NAME}.package.include\` + internal extras
      ${patterns.include.map((p) => `- '${p}'`).join(JOIN_STR)}
      \`\`\`

      ### Patterns: Exclude

      \`\`\`yml
      # Serverless (\`${patterns.exclude.length}\`): \`package.exclude\` + \`function.{NAME}.exclude\` + internal extras
      ${patterns.exclude.map((p) => `- '${p}'`).join(JOIN_STR)}
      \`\`\`

      ### Files (\`${files.included.length}\`): Included

      ${files.included.sort().map((p) => `- ${p}`).join(JOIN_STR)}

      ### Files (\`${files.excluded.length}\`): Excluded

      ${files.excluded.sort().map((p) => `- ${p}`).join(JOIN_STR)}

      ### Tracing Dynamic Misses (\`${Object.keys(trace.missed.srcs).length}\` files): Sources

      ${this._traceMissesReport(trace.missed.srcs).join(JOIN_STR)}

      ### Tracing Dynamic Resolved (\`${Object.keys(trace.resolved.srcs).length}\` files): Sources

      ${this._traceMissesReport(trace.resolved.srcs).join(JOIN_STR)}

      ### Tracing Dynamic Misses (\`${Object.keys(trace.missed.pkgs).length}\` packages): Dependencies

      ${this._traceMissesPkgsReport(trace.missed.pkgs).join(JOIN_STR)}

      ### Tracing Dynamic Resolved (\`${Object.keys(trace.resolved.pkgs).length}\` packages): Dependencies

      ${this._traceMissesPkgsReport(trace.resolved.pkgs).join(JOIN_STR)}

      ### Collapsed (\`${Object.keys(collapsed.srcs).length}\`): Sources

      ${this._collapsedReport(collapsed.srcs).join(JOIN_STR)}

      ### Collapsed (\`${Object.keys(collapsed.pkgs).length}\`): Dependencies

      ${this._collapsedReport(collapsed.pkgs).join(JOIN_STR)}
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

  async globAndZip({
    bundleName, functionObject, layerObject, traceInclude, traceParams, worker, report
  }) {
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
      traceParams,
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
    const opts = this._extraOptions({ functionObject });

    // Mimic built-in serverless naming.
    // **Note**: We _do_ append ".serverless" in path skipping serverless'
    // internal copying logic.
    const bundleName = path.join(SLS_TMP_DIR, `${functionName}.zip`);

    // Get traces.
    const { traceInclude, traceParams, dynamic } = await this._traceOptions({ functionObject });
    const mode = traceInclude ? "trace" : "dependency";

    // Package.
    this._logDebug(`Start packaging function: ${bundleName} in mode: ${mode}`);
    const results = await this.globAndZip({
      bundleName, functionObject, traceInclude, traceParams, worker, report
    });
    const { buildTime, collapsed, trace } = results;
    if (mode === "trace") {
      const { missed, resolved } = this._handleTraceMisses({
        bundleName,
        misses: trace.misses,
        resolutions: dynamic.resolutions,
        bail: dynamic.bail
      });

      // Add in results
      Object.assign(trace, { missed, resolved });
    }

    this._handleCollapsed({ collapsed, bundleName, bail: opts.collapsed.bail });

    // Mutate serverless configuration to use our artifacts.
    functionObject.package = functionObject.package || {};
    functionObject.package.artifact = bundleName;

    this._log(`Packaged function (${mode} mode): ${bundleName} (${toSecs(buildTime)}s)`);
    return { packageType: "function", ...results };
  }

  // eslint-disable-next-line max-statements
  async packageService({ functionObjects, worker, report }) {
    const { service } = this.serverless;
    const serviceName = service.service;
    const servicePackage = service.package;
    const opts = this._serviceOptions;

    // Mimic built-in serverless naming.
    const bundleName = path.join(SLS_TMP_DIR, `${serviceName}.zip`);

    // Get traces.
    const { traceInclude, traceParams, dynamic } = await this._traceOptions({ functionObjects });
    const mode = traceInclude ? "trace" : "dependency";

    // Package.
    this._logDebug(`Start packaging service: ${bundleName} in mode: ${mode}`);
    const results = await this.globAndZip({
      bundleName, traceInclude, traceParams, worker, report
    });
    const { buildTime, collapsed, trace } = results;
    if (mode === "trace") {
      const { missed, resolved } = this._handleTraceMisses({
        bundleName,
        misses: trace.misses,
        resolutions: dynamic.resolutions,
        bail: dynamic.bail
      });

      // Add in results
      Object.assign(trace, { missed, resolved });
    }

    this._handleCollapsed({ collapsed, bundleName, bail: opts.collapsed.bail });

    // Mutate serverless configuration to use our artifacts.
    servicePackage.artifact = bundleName;

    this._log(`Packaged service (${mode} mode): ${bundleName} (${toSecs(buildTime)}s)`);
    return { packageType: "service", ...results };
  }

  async packageLayer({ layerName, layerObject, worker, report }) {
    const opts = this._extraOptions({ layerObject });
    const bundleName = path.join(SLS_TMP_DIR, `${layerName}.zip`);

    // Package. (Not traced)
    this._logDebug(`Start packaging layer: ${bundleName}`);
    const results = await this.globAndZip({ bundleName, layerObject, worker, report });
    const { buildTime, collapsed } = results;

    this._handleCollapsed({ collapsed, bundleName, bail: opts.collapsed.bail });

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
      results = await Promise.all(tasks.map((fn) => fn()))
        .catch((err) => {
          worker.end();
          throw err;
        });
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
