"use strict";

const pkg = require("./package.json");
const { tmpdir } = require("os");
const path = require("path");
const { access, copy, constants, createWriteStream, mkdir, remove } = require("fs-extra");
const archiver = require("archiver");
const execa = require("execa");
const uuidv4 = require("uuid/v4");
const globby = require("globby");

const SLS_TMP_DIR = ".serverless";
const PLUGIN_NAME = pkg.name;

const dirExists = async (dirPath) => {
  try {
    await access(dirPath, constants.W_OK);
    return true;
  } catch (_) {
    return false;
  }
};

// Create new temp build directory, return path.
const createBuildDir = async () => {
  // Create and verify a unique temp directory path.
  let tmpPath;
  do {
    tmpPath = path.join(tmpdir(), uuidv4());
  } while (await !dirExists(tmpPath));

  // Create directory.
  await mkdir(tmpPath);

  return tmpPath;
};

const createZip = ({ buildPath, bundlePath }) => {
  // Use Serverless-analogous library + logic to create zipped artifact.
  const zip = archiver.create("zip");
  const output = createWriteStream(bundlePath);

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
      zip.directory(buildPath, false);

      zip.finalize();
    });
  });
};

// Simple, stable union.
const union = (arr1, arr2) => {
  const set1 = new Set(arr1);
  return arr1.concat(arr2.filter((o) => !set1.has(o)));
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

    this.commands = {
      jetpack: {
        usage: pkg.description,
        options: {
          mode: {
            usage: "Installation mode (default: `yarn`)",
            shortcut: "m"
          },
          lockfile: {
            usage:
              "Path to lockfile (default: `yarn.lock` for `mode: yarn`, "
              + "`package-lock.json` for `mode: npm`)",
            shortcut: "l"
          },
          stdio: {
            usage:
              "`child_process` stdio mode for our shell commands like "
              + "yarn|npm installs (default: `null`)",
            shortcut: "s"
          }
        }
      }
    };

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

  get _options() {
    if (this.__options) { return this.__options; }

    const { service } = this.serverless;

    // Static defaults.
    const defaults = {
      mode: "yarn",
      stdio: null
    };

    // TODO(OPTIONS): How are we getting `custom` off functions?
    const custom = (service.custom || {})[pkg.name];
    this.__options = Object.assign({}, defaults, custom, this.options);

    // Dynamic defaults
    if (typeof this.__options.lockfile === "undefined") {
      this.__options.lockfile = this.__options.mode === "yarn" ? "yarn.lock" : "package-lock.json";
    }

    // Validation
    if (!["yarn", "npm"].includes(this.__options.mode)) {
      throw new Error(`[${pkg.name}] Invalid 'mode' option: ${this.__options.mode}`);
    }

    return this.__options;
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
    //
    // Start with serverless excludes, plus a few refinements.
    const slsDefaultExcludePatterns = [
      ".git/**",
      ".gitignore",
      ".DS_Store",
      ".serverless/**",
      ".serverless_plugins/**",

      // The serverless configuration file. It _should_ be this function:
      // https://github.com/serverless/serverless/blob/79eff80cab58c8494dbb02d65e20d1920f1bfd6e/lib/utils/getServerlessConfigFile.js#L9-L34
      // but as it reduces to a glob and we don't have that function easily usable
      // we take this shortcut.
      "serverless.{json,yml,yaml,js}",

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
  // entirely and then add it to the `build` directory and re-pattern-match
  // files there.
  //
  // See: `resolveFilePathsFromPatterns` in
  // https://github.com/serverless/serverless/blob/master/lib/plugins/package/lib/packageService.js#L212-L254
  async resolveProjectFilePathsFromPatterns({ include, exclude }) {
    const { config } = this.serverless;

    // The `ignore` is **never even read**, which is how we gain a speedup over
    // serverless which does read everything, then limit later.
    const ignore = [
      "node_modules/**"
    ];

    // _Now_, start globbing like serverless does.
    // 1. Everything
    // 2. Excludes
    // 3. Includes (to bring things back).
    //
    // TODO: **TEST** that the everything + exclude + include works like sls.
    const patterns = ["**"]
      // Negate the excludes...
      .concat((exclude || []).map((e) => e[0] === "!" ? e.substring(1) : `!${e}`))
      .concat(include || []);

    const globbed = await globby(patterns, {
      cwd: config.servicePath || ".",
      dot: true,
      filesOnly: true,
      ignore
    });

    return globbed;
  }

  async installDeps({ buildPath }) {
    const { mode, lockfile, stdio } = this._options;

    // Determine if can use npm ci.
    let install = "install";
    if (mode === "npm" && lockfile) {
      const { stdout } = await execa("npm", ["--version"]);

      const version = stdout.split(".");
      if (version.length < 3) { // eslint-disable-line no-magic-numbers
        throw new Error(`Found unparsable npm versions: ${stdout}`);
      }

      const major = parseInt(version[0], 10);
      const minor = parseInt(version[1], 10);

      // `npm ci` is not available prior to 5.7.0
      if (major > 5 || major === 5 && minor >= 7) { // eslint-disable-line no-magic-numbers
        install = "ci";
      } else {
        this._logDebug(`Found old npm version ${stdout}. Unable to use 'npm ci'.`);
      }
    }

    // npm/yarn install.
    const installArgs = [
      install,
      "--production",
      mode === "yarn" && !!lockfile ? "--frozen-lockfile" : null,
      mode === "yarn" ? "--non-interactive" : null
    ].filter(Boolean);

    this._logDebug(`Performing production install: ${mode} ${installArgs.join(" ")}`);
    await execa(mode, installArgs, {
      stdio,
      cwd: buildPath
    });
  }

  async buildPackage({ bundleName }) {
    const { config } = this.serverless;
    const servicePath = config.servicePath || ".";
    const bundlePath = path.resolve(servicePath || ".", bundleName);

    const buildPath = await createBuildDir();

    // Gather options.
    this._logDebug(`Options: ${JSON.stringify(this._options)}`);
    const { mode, lockfile } = this._options;
    const srcs = [
      "package.json",
      lockfile
    ]
      .concat(["src"]) // TODO(OPTIONS): use options
      .filter(Boolean);

    // Copy over npm/yarn files.
    this._logDebug(`Copying sources ('${srcs.join("', '")}') to build directory`);
    await Promise.all(srcs.map((f) => copy(
      path.resolve(servicePath, f),
      path.resolve(buildPath, f)
    )));

    // Install into build directory.
    try {
      await this.installDeps({ buildPath });
    } catch (err) {
      throw new this.serverless.classes.Error(
        `[${pkg.name}] ${mode} installation failed with message: `
        + `'${(err.message || err.toString()).trim()}'`
      );
    }

    // Create package zip.
    this._logDebug(`Zipping build directory ${buildPath} to artifact location: ${bundlePath}`);
    await createZip({ buildPath, bundlePath });

    // Clean up
    await remove(buildPath);
  }

  async packageFunction({ functionName, functionObject }) {
    // Mimic built-in serverless naming.
    // **Note**: We _do_ append ".serverless" in path skipping serverless'
    // internal copying logic.
    const bundleName = path.join(SLS_TMP_DIR, `${functionName}.zip`);

    // Get sources.
    const { include, exclude } = this.filePatterns({ functionObject });
    const files = await this.resolveProjectFilePathsFromPatterns({ include, exclude });
    // TODO HERE - IMPLEMENT COPYING
    // eslint-disable-next-line no-console
    console.log("TODO HERE PKG FUNCTION", JSON.stringify({ include, exclude, files }));

    // Build.
    this._log(`Packaging function: ${bundleName}`);
    await this.buildPackage({ bundleName });

    // Mutate serverless configuration to use our artifacts.
    functionObject.package = functionObject.package || {};
    functionObject.package.artifact = bundleName;
  }

  async packageService() {
    const { service } = this.serverless;
    const serviceName = service.service;
    const servicePackage = service.package;

    // Mimic built-in serverless naming.
    const bundleName = path.join(SLS_TMP_DIR, `${serviceName}.zip`);

    // Get sources.
    const { include, exclude } = this.filePatterns({});
    const files = await this.resolveProjectFilePathsFromPatterns({ include, exclude });
    // TODO HERE - IMPLEMENT COPYING
    // eslint-disable-next-line no-console
    console.log("TODO HERE PKG FUNCTION", JSON.stringify({ include, exclude, files }));

    // Build.
    this._log(`Packaging service: ${bundleName}`);
    await this.buildPackage({ bundleName });

    // Mutate serverless configuration to use our artifacts.
    servicePackage.artifact = bundleName;
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

    // Now, iterate all functions and decide if this plugin should package them.
    await Promise.all(fnsPkgs
      .filter((obj) =>
        (servicePackage.individually || obj.individually) && !(obj.disable || obj.artifact)
      )
      .map((obj) => this.packageFunction(obj))
    );

    // We recreate the logic from `packager#packageService` for deciding whether
    // to package the service or not.
    const shouldPackageService = !servicePackage.individually
      && fnsPkgs.some((obj) => !(obj.disable || obj.individually || obj.artifact));

    // Package entire service if applicable.
    if (shouldPackageService && !servicePackage.artifact) {
      await this.packageService();
    }
  }
}

module.exports = Jetpack;
