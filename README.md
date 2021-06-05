Serverless Jetpack 🚀
====================
[![npm version][npm_img]][npm_site]
[![Actions Status][actions_img]][actions_site]
[![MIT license][lic_img]][lic_site]
[![Maintenance Status][maintenance-image]](#maintenance-status)

A faster JavaScript packager for [Serverless][] applications.

- ⚡ Drop-in replacement for `serverless package|deploy`
- 💻 Lambda Functions packaging
- 🍰 Lambda Layers packaging
- 📦 Per-function packaging
- 🐉 Monorepo (`lerna`, `yarn workspace`) support
- 🔀 Tunable, multi-cpu parallelization
- 🔎 Dependency tracing options (faster packaging, slimmer bundles)

## Overview

The Serverless framework is a **fantastic** one-stop-shop for taking your code and packing up all the infrastructure around it to deploy it to the cloud. Unfortunately, for many JavaScript applications, some aspects of packaging are slow, hindering deployment speed and developer happiness.

With the `serverless-jetpack` plugin, many common, slow Serverless packaging scenarios can be dramatically sped up. All with a very easy, seamless integration into your existing Serverless projects.

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->


- [Usage](#usage)
  - [The short, short version](#the-short-short-version)
  - [A little more detail...](#a-little-more-detail)
  - [Configuration](#configuration)
- [How Jetpack's faster dependency filtering works](#how-jetpacks-faster-dependency-filtering-works)
  - [The nitty gritty of why it's faster](#the-nitty-gritty-of-why-its-faster)
  - [Complexities](#complexities)
    - [Other Serverless plugins that set `package.artifact`](#other-serverless-plugins-that-set-packageartifact)
    - [Minor differences vs. Serverless globbing](#minor-differences-vs-serverless-globbing)
    - [Layers](#layers)
    - [Be careful with `include` configurations and `node_modules`](#be-careful-with-include-configurations-and-node_modules)
    - [Packaging files Outside CWD](#packaging-files-outside-cwd)
- [Tracing mode](#tracing-mode)
  - [Tracing configuration](#tracing-configuration)
    - [Tracing options](#tracing-options)
  - [Tracing caveats](#tracing-caveats)
  - [Handling dynamic import misses](#handling-dynamic-import-misses)
  - [Tracing results](#tracing-results)
- [Command Line Interface](#command-line-interface)
- [Benchmarks](#benchmarks)
- [Maintenance status](#maintenance-status)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## Usage

### The short, short version

First, install the plugin:

```sh
$ yarn add --dev serverless-jetpack
$ npm install --save-dev serverless-jetpack
```

Add to `serverless.yml`

```yml
plugins:
  - serverless-jetpack
```

... and you're off to faster packaging awesomeness! 🚀

### A little more detail...

The plugin supports all normal built-in Serverless framework packaging configurations in `serverless.yml` like:

```yml
package:
  # Any `include`, `exclude` logic is applied to the whole service, the same
  # as built-in serverless packaging.
  # include: ...
  exclude:
    - "*"
    - "**/node_modules/aws-sdk/**" # included on Lambda.
    - "!package.json"

plugins:
  # Add the plugin here.
  - serverless-jetpack

functions:
  base:
    # ...
  another:
    # ...
    package:
      # These work just like built-in serverless packaging - added to the
      # service-level exclude/include fields.
      include:
        - "src/**"
        - "!**/node_modules/aws-sdk/**" # Faster way to exclude
        - "package.json"
```

### Configuration

Most Serverless framework projects should be able to use Jetpack without any extra configuration besides the `plugins` entry. However, there are some additional options that may be useful in some projects (e.g., [lerna][] monorepos, [yarn workspaces][])...

**Service**-level configurations available via `custom.jetpack`:

* `base` (`string`): The base directory (relative to `servicePath` / CWD) at which dependencies may be discovered by Jetpack. This is useful in some bespoke monorepo scenarios where dependencies may be hoisted/flattened to a root `node_modules` directory that is the parent of the directory `serverless` is run from. (default: Serverless' `servicePath` / CWD).
    * _WARNING_: See our [discussion below](#packaging-files-outside-cwd) about the dangers of including files below the current working directory / Serverless `servicePath`.
    * **Layers**: Layers are a bit of an oddity with built-in Serverless Framework packaging in that the current working directory is `layer.NAME.path` (and not `servicePath` like usual), yet things like `include|exclude` apply relatively to the layer `path`, not the `servicePath`. Jetpack has a similar choice and applies `base` applies to the root `servicePath` for everything (layers, functions, and service packaging), which seems to be the best approach given that monorepo consumers may well lay out projects like `functions/*` and `layers/*` and need dependency inference to get all the way to the root irrespective of a child layer `path`.
* `roots` (`Array<string>`): A list of paths (relative to `servicePath` / CWD) at which there may additionally declared and/or installed `node_modules`. (default: [Serverless' `servicePath` / CWD]).
    * Setting a value here replaces the default `[servicePath]` with the new array, so if you want to additionally keep the `servicePath` in the roots array, set as: `[".", ADDITION_01, ADDITION_02, ...]`.
    * This typically occurs in a monorepo project, wherein dependencies may be located in e.g. `packages/{NAME}/node_modules` and/or hoisted to the `node_modules` at the project base. It is important to specify these additional dependency roots so that Jetpack can (1) find and include the right dependencies and (2) hone down these directories to just production dependencies when packaging. Otherwise, you risk having a slow `serverless package` execution and/or end up with additional/missing dependencies in your final application zip bundle.
    * You only need to declare roots of things that _aren't_ naturally inferred in a dependency traversal. E.g., if starting at `packages/{NAME}/package.json` causes a traversal down to `node_modules/something` then symlinked up to `lib/something-else/node_modules/even-more` these additional paths don't need to be separately declared because they're just part of the dependency traversal.
    * **Layers**: Similar to `base`, both the project/service- and layer-level `roots` declarations will be relative to the project `servicePath` directory and _not_ the `layers.NAME.path` directory.
* `preInclude` (`Array<string>`): A list of glob patterns to be added _before_ Jetpack's dependency pattern inclusion and Serverless' built-in service-level and then function-level `package.include`s. This option most typically comes up in a monorepo scenario where you want a broad base exclusion like `!functions/**` or `!packages/**` at the service level and then inclusions in later functions.
* `concurrency` (`Number`): The number of independent package tasks (per function and service) to run off the main execution thread. If `1`, then run tasks serially in main thread. If `2+` run off main thread with `concurrency` number of workers. (default: `1`).
    * This option is most useful for Serverless projects that (1) have many individually packaged functions, and (2) large numbers of files and dependencies. E.g., start considering this option if your per-function packaging time takes more than 10 seconds and you have more than one service and/or function package.
* `collapsed.bail` (`Boolean`): Terminate `serverless` program with an error if collapsed file conflicts are detected. See [discussion below](#packaging-files-outside-cwd) regarding collapsed files.

The following **function** and **layer**-level configurations available via `functions.{FN_NAME}.jetpack` and  `layers.{LAYER_NAME}.jetpack`:

* `roots` (`Array<string>`): This option **adds** more dependency roots to the service-level `roots` option.
* `preInclude` (`Array<string>`): This option **adds** more glob patterns to the service-level `preInclude` option.
* `collapsed.bail` (`Boolean`): Terminate `serverless` program with an error if collapsed file conflicts are detected **if** the function is being packaged `individually`.

Here are some example configurations:

**Additional roots**

```yml
# serverless.yml
plugins:
  - serverless-jetpack

functions:
  base:
    # ...
  another:
    # This example monorepo project has:
    # - `packages/another/src`: JS source code to include
    # - `packages/another/package.json`: Declares production dependencies
    # - `packages/another/node_modules`: One location prod deps may be.
    # - `node_modules`: Another location prod deps may be if hoisted.
    # ...
    package:
      individually: true
    jetpack:
      roots:
        # If you want to keep prod deps from servicePath/CWD package.json
        # - "."
        # Different root to infer prod deps from package.json
        - "packages/another"
    include:
      # Ex: Typically you'll also add in sources from a monorepo package.
      - "packages/another/src/**"
```

**Different base root**

```yml
# serverless.yml
plugins:
  - serverless-jetpack

custom:
  jetpack:
    # Search for hoisted dependencies to one parent above normal.
    base: ".."

package:
  # ...
  include:
    # **NOTE**: The include patterns now change to allow the underlying
    # globbing libraries to reach below the working directory to our base,
    # so patterns should be of the format:
    # - "!{BASE/,}{**/,}NORMAL_PATTERN"
    # - "!{BASE/,}{**/,}node_modules/aws-sdk/**"
    # - "!{BASE/,}{**/,}node_modules/{@*/*,*}/README.md"
    #
    # ... here with a BASE of `..` that means:
    # General
    - "!{../,}{**/,}.DS_Store"
    - "!{../,}{**/,}.vscode/**"
    # Dependencies
    - "!{../,}{**/,}node_modules/aws-sdk/**"
    - "!{../,}{**/,}node_modules/{@*/*,*}/CHANGELOG.md"
    - "!{../,}{**/,}node_modules/{@*/*,*}/README.md"

functions:
  base:
    # ...
```

**With custom pre-includes**

```yml
# 1. `preInclude` comes first after internal `**` pattern.
custom:
  jetpack:
    preInclude:
      - "!**" # Start with absolutely nothing (typical in monorepo scenario)

# 2. Jetpack then dynamically adds in production dependency glob patterns.

# 3. Then, we apply the normal serverless `include`s.
package:
  individually: true
  include:
    - "!**/node_modules/aws-sdk/**"

plugins:
  - serverless-jetpack

functions:
  base:
    # ...
  another:
    jetpack:
      roots:
        - "packages/another"
      preInclude:
        # Tip: Could then have a service-level `include` negate subfiles.
        - "packages/another/dist/**"
    include:
      - "packages/another/src/**"
```

**Layers**

```yml
# serverless.yml
plugins:
  - serverless-jetpack

layers:
  vendor:
    # A typical pattern is `NAME/nodejs/node_modules` that expands to
    # `/opt/nodejs/node_modules` which is included in `NODE_PATH` and available
    # to running lambdas. Here, we use `jetpack.roots` to properly exclude
    # `devDependencies` that built-in Serverless wouldn't.
    path: layers/vendor
    jetpack:
      roots:
        # Instruct Jetpack to review and exclude devDependencies originating
        # from this `package.json` directory.
        - "layers/vendor/nodejs"
```

## How Jetpack's faster dependency filtering works

Serverless built-in packaging slows to a crawl in applications that have lots of files from `devDependencies`. Although the `excludeDevDependencies` option will ultimately remove these from the target zip bundle, it does so only **after** the files are read from disk, wasting a lot of disk I/O and time.

The `serverless-jetpack` plugin removes this bottleneck by performing a fast production dependency on-disk discovery via the [inspectdep][] library before any globbing is done. The discovered production dependencies are then converted into patterns and injected into the otherwise normal Serverless framework packaging heuristics to efficiently avoid all unnecessary disk I/O due to `devDependencies` in `node_modules`.

Process-wise, the `serverless-jetpack` plugin detects when built-in packaging applies and then takes over the packaging process. The plugin then sets appropriate internal Serverless `artifact` fields to cause Serverless to skip the (slower) built-in packaging.

### The nitty gritty of why it's faster

Let's start by looking at how Serverless packages (more or less):

1. If the `excludeDevDependencies` option is set, use synchronous `globby()` for on disk I/O calls to find all the `package.json` files in `node_modules`, then infer which are `devDependencies`. Use this information to enhance the `include|exclude` configured options.
2. Glob files from disk using [globby][] with a root `**` (all files) and the `include` pattern, following symlinks, and create a list of files (no directories). This is again disk I/O.
3. Filter the in-memory list of files using [nanomatch][] via service + function `exclude`, then `include` patterns in order to decide what is included in the package zip file.

This is potentially slow if `node_modules` contains a lot of ultimately removed files, yielding a lot of completely wasted disk I/O time.

Jetpack, by contrast does the following:

1. Efficiently infer production dependencies from disk without globbing, and without reading any `devDependencies`.
2. Glob files from disk with a root `**` (all files), `!node_modules/**` (exclude all by default), `node_modules/PROD_DEP_01/**, node_modules/PROD_DEP_02/**, ...` (add in specific directories of production dependencies), and then the normal `include` patterns. This small nuance of limiting the `node_modules` globbing to **just** production dependencies gives us an impressive speedup.
3. Apply service + function `exclude`, then `include` patterns in order to decide what is included in the package zip file.

This ends up being way faster in most cases, and particularly when you have very large `devDependencies`. It is worth pointing out the minor implication that:

* If your `include|exclude` logic intends to glob in `devDependencies`, this won't work anymore. But, you're not really planning on deploying non-production dependencies are you? 😉

### Complexities

#### Other Serverless plugins that set `package.artifact`

The `serverless-jetpack` plugin hooks into the Serverless packaging lifecycle by being the [last](https://github.com/FormidableLabs/serverless-jetpack/pull/68#issuecomment-556987101) function run in the `before:package:createDeploymentArtifacts` lifecycle event. This means that if a user configures `package.artifact` directly in their Serverless configuration or another plugin sets `package.artifact` before Jetpack runs then Jetpack will skip the unit of packaging (service, function, layer, etc.).

Some notable plugins that **do** set `package.artifact` and thus don't need and won't use Jetpack (or vanilla Serverless packaging for that matter):

- [`serverless-plugin-typescript`](https://github.com/prisma-labs/serverless-plugin-typescript): See [#74](https://github.com/FormidableLabs/serverless-jetpack/issues/74)
- [`serverless-webpack`](https://github.com/serverless-heaven/serverless-webpack): See, e.g. [`packageModules.js`](https://github.com/serverless-heaven/serverless-webpack/blob/21393845fb173a6f806b0bc2bee0be7daf0adc86/lib/packageModules.js#L11-L24)

#### Minor differences vs. Serverless globbing

Our [benchmark correctness tests](./test/benchmark.js) highlight a number of various files not included by Jetpack that are included by `serverless` in packaging our benchmark scenarios. Some of these are things like `node_modules/.yarn-integrity` which Jetpack knowingly ignores because you shouldn't need it. All of the others we've discovered to date are instances in which `serverless` incorrectly includes `devDependencies`...

#### Layers

Jetpack supports `layer` packaging as close to `serverless` as it can. However, there are a couple of very wonky things with `serverless`' approach that you probably want to keep in mind:

* Service level `package.include|exclude` patterns are applied at the `layers.NAME.path` level for a given layer. So, e.g., if you have a service-level `include` pattern of `"!*"` to remove `ROOT/foo.txt`, this will apply at a **different** root path from `layers.NAME.path` of like `ROOT/layers/NAME/foo.txt`.
* As mentioned in our options configuration section above, Jetpack applies the `base` and `roots` options to the root project `servicePath` for dependency searching and not relatively to layer `path`s.

#### Be careful with `include` configurations and `node_modules`

Let's start with how `include|exclude` work for both Serverless built-in packaging and Jetpack:

1. **Disk read phase** with `globby()`. Assemble patterns in order from below and then return a list of files matching the total patterns.

    1. Start at `**` (everything).
    2. (_Jetpack only_) Add in service and function-level `jetpack.preInclude` patterns.
    3. (_Jetpack only_) Add in dynamic patterns to `include` production `node_modules`.
    4. Add in service and function-level `package.include` patterns.

2. **File filtering phase** with `nanomatch()`. Once we have a list of files read from disk, we apply patterns in order as follows to decide whether to include them (last positive match wins).

    1. (_Jetpack only_) Add in service and function-level `jetpack.preInclude` patterns.
    2. (_Jetpack only_) Add in dynamic patterns to `include` production `node_modules`.
    3. Add in service and function-level `package.exclude` patterns.
    4. (_Serverless only_) Add in dynamic patterns to `exclude` development `node_modules`
    5. Add in service and function-level `package.include` patterns.

The practical takeaway here is the it is typically faster to prefer `include` exclusions like `!foo/**` than to use `exclude` patterns like `foo/**` because the former avoids a lot of unneeded disk I/O.

Let's consider a pattern like this:

```yml
include:
  - "node_modules/**"
exclude:
  - # ... a whole bunch of stuff ...
```

This would likely be just as slow as built-in Serverless packaging because all of `node_modules` gets read from disk.

Thus, the **best practice** here when crafting service or function `include` configurations is: **don't `include` anything extra in `node_modules`**. It's fine to do extra exclusions like:

```yml
# Good. Remove dependency provided by lambda from zip
exclude:
  - "**/node_modules/aws-sdk/**"

# Better! Never even read the files from disk during globbing in the first place!
include:
  - "!**/node_modules/aws-sdk/**"
```

#### Packaging files Outside CWD

##### How files are zipped

A potentially serious situation that comes up with adding files to a Serverless package zip file is if any included files are outside of Serverless' `servicePath` / current working directory. For example, if you have files like:

```yml
- src/foo/bar.js
- ../node_modules/lodash/index.js
```

Any file below CWD is collapsed into starting at CWD and not outside. So, for the above example, we package / later expand:

```yml
- src/foo/bar.js                # The same.
- node_modules/lodash/index.js  # Removed `../`!!!
```

This most often happens with `node_modules` in monorepos where `node_modules` roots are scattered across different directories and nested. In particular, if you are using the `custom.jetpack.base` option this is likely going to come into play. Fortunately, in most cases, it's not that big of a deal. For example:

```yml
- node_modules/chalk/index.js
- ../node_modules/lodash/index.js
```

will collapse when zipped to:

```yml
- node_modules/chalk/index.js
- node_modules/lodash/index.js
```

... but Node.js [resolution rules](https://nodejs.org/api/modules.html#modules_all_together) should resolve and load the collapsed package the same as if it were in the original location.

##### Zipping problems

The real problems occur if there is a path conflict where files collapse to the **same location**. For example, if we have:

```yml
- node_modules/lodash/index.js
- ../node_modules/lodash/index.js
```

this will append files with the same path in the zip file:

```yml
- node_modules/lodash/index.js
- node_modules/lodash/index.js
```

that when expanded leave only **one** file actually on disk!

##### How to detect zipping problems

The first level is _detecting_ potentially collapsed files that conflict. Jetpack does this automatically with log warnings like:

```
Serverless: [serverless-jetpack] WARNING: Found 1 collapsed dependencies in .serverless/my-function.zip! Please fix, with hints at: https://npm.im/serverless-jetpack#packaging-files-outside-cwd
Serverless: [serverless-jetpack] .serverless/FN_NAME.zip collapsed dependencies:
- lodash (Packages: 2, Files: 108 unique, 216 total): [node_modules/lodash@4.17.11, ../node_modules/lodash@4.17.15]`
```

In the above example, `2` different versions of lodash were installed and their files were collapsed into the same path space. A total of `216` files will end up collapsed into `108` when expanded on disk in your cloud function. Yikes!

A good practice if you are using tracing mode is to set: `jetpack.collapsed.bail = true` so that Jetpack will throw an error and kill the `serverless` program if any collapsed conflicts are detected.

##### How to solve zipping problems

So how do we fix the problem?

A first starting point is to generate a full report of the packaging step. Instead of running `serverless deploy|package <OPTIONS>`, try out `serverless jetpack package --report <OPTIONS>`. This will produce a report at the end of packaging that gives a full list of files. You can then use the logged message above as a starting point to examine the actual files collapsed in the zip file. Then, spend a little time figuring out the dependencies of how things ended up where.

With a better understanding of what the files are and why we can turn to avoiding collapses. Some options:

* **Don't allow `node_modules` in intermediate directories**: Typically, a monorepo has `ROOT/package.json` and `packages/NAME/package.json` or something, which doesn't typically lead to collapsed files. A situation that runs into trouble is something like:

    ```
    ROOT/package.json
    ROOT/backend/package.json
    ROOT/backend/functions/NAME/package.json
    ```

    with `serverless` being run from `backend` as CWD then `ROOT/node_modules` and `ROOT/backend/node_modules` will present potential collapsing conflicts. So, if possible, just remove the `backend/package.json` dependencies and stick them all either in the root or further nested into the functions/packages of the monorepo.

* **Mirror exact same dependencies in `package.json`s**: In our above example, even if `lodash` isn't declared in either `../package.json` or `package.json` we can manually add it to both at the same pinned version (e.g., `"lodash": "4.17.15"`) to force it to be the same no matter where npm or Yarn place the dependency on disk.

* **Use Yarn Resolutions**: If you are using Yarn and [resolutions](https://classic.yarnpkg.com/en/docs/selective-version-resolutions/) are an option that works for your project, they are a straightforward way to ensure that only one of a dependency exists on disk, solving collapsing problems.

* **Use `package.include|exclude`**: You can manually adjust packaging by excluding files that would be collapsed and then allowing the other ones to come into play. In our example above, a negative `package.include` for `!node_modules/lodash/**` would solve our problem in a semver-acceptable way by leaving only root-level lodash.

## Tracing mode

> ℹ️ **Experimental**: Although we have a wide array of tests, tracing mode is still considered experimental as we roll out the feature. You should be sure to test all the execution code paths in your deployed serverless functions and verify your bundled package contents before using in production.

Jetpack speeds up the underlying dependencies filtering approach of `serverless` packaging while providing completely equivalent bundles. However, this approach has some fundamental limitations:

* **Over-inclusive**: All production dependencies include many individual files that are not needed at runtime.
* **Speed**: For large sets of dependencies, copying lots of files is slow at packaging time.

Thus, we pose the question: _What if we packaged **only** the files we needed at runtime?_

Welcome to **tracing mode**!

Tracing mode is an alternative way to include dependencies in a `serverless` application. It works by using [Acorn](https://github.com/browserify/acorn-node) to parse out all dependencies in entry point files (`require`, `require.resolve`, static `import`) and then resolves them with [resolve](https://github.com/browserify/resolve) according to the Node.js resolution algorithm. This produces a list of the files that will actually be used at runtime and Jetpack includes these instead of traversing production dependencies. The engine for all of this work is a small, dedicated library, [trace-deps][].

### Tracing configuration

The most basic configuration is just to enable `custom.jetpack.trace` (service-wide) or `functions.{FN_NAME}.jetpack.trace` (per-function) set to `true`. By default, tracing mode will trace _just_ the entry point file specified in `functions.{FN_NAME}.handler`.

```yml
plugins:
  - serverless-jetpack

custom:
  jetpack:
    trace: true
```

The `trace` field can be a Boolean or object containing further configuration information.

#### Tracing options

The basic `trace` Boolean field should hopefully work for most cases. Jetpack provides several additional options for more flexibility:

**Service**-level configurations available via `custom.jetpack.trace`:

* `trace` (`Boolean | Object`): If `trace: true` or `trace: { /* other options */ }` then tracing mode is activated at the service level.
* `trace.ignores` (`Array<string>`): A set of package path prefixes up to a directory level (e.g., `react` or `mod/lib`) to skip tracing on. This is particularly useful when you are excluding a package like `aws-sdk` that is already provided for your lambda.
* `trace.allowMissing` (`Object.<string, Array<string>>`): A way to allow certain packages to have potentially failing dependencies. Specify each object key as either (1) an source file path relative to `servicePath` / CWD that begins with a `./` or (2) a package name and provide a value as an array of dependencies that _might_ be missing on disk. If the sub-dependency is found, then it is included in the bundle (this part distinguishes this option from `ignores`). If not, it is skipped without error.
* `trace.include` (`Array<string>`): Additional file path globbing patterns (relative to `servicePath`) to be included in the package and be further traced for dependencies to include. Applies to functions that are part of a service or function (`individually`) packaging.
    * **Note**: These patterns are in _addition_ to the handler inferred file path. If you want to exclude the handler path you could technically do a `!file/path.js` exclusion, but that would be a strange case in that your handler files would no longer be present.
* `trace.dynamic.bail` (`Boolean`): Terminate `serverless` program with an error if dynamic import misses are detected. See [discussion below](#handling-dynamic-import-misses) regarding handling.
* `trace.dynamic.resolutions` (`Object.<string, Array<string>>`): Handle dynamic import misses by providing a key to match misses on and an array of additional glob patterns to trace and include in the application bundle.
    * _Application source files_: If a miss is an application source file (e.g., not within `node_modules`), specify the **relative path** (from `servicePath` / CWD) to it like `"./src/server/router.js": [/* array of patterns */]`.
        * **Note**: To be an application source path, it **must** be prefixed with a dot (e.g., `./src/server.js`, `../lower/src/server.js`). Basically, like the Node.js `require()` rules go for a local path file vs. a package dependency.
    * _Dependency packages_: If a miss is part of a dependency (e.g., an `npm` package placed within `node_modules`), specify the **package name** first (without including `node_modules`) and then trailing path to file at issue like `"bunyan/lib/bunyan.js": [/* array of patterns */]`.
    * _Ignoring dynamic import misses_: If you just want to ignore the missed dynamic imports for a given application source file or package, just specify and empty array `[]` or falsey value.

 A way to allow certain packages to have potentially failing dependencies. Specify each object key as a package name and value as an array of dependencies that _might_ be missing on disk. If the sub-dependency is found, then it is included in the bundle (this part distinguishes this option from `ignores`). If not, it is skipped without error.

The following **function**-level configurations available via `functions.{FN_NAME}.jetpack.trace` and  `layers.{LAYER_NAME}.jetpack.trace`:

* `trace` (`Boolean | Object`): If `trace: true` or `trace: { /* other options */ }` then tracing mode is activated at the function level **if** the function is being packaged `individually`.
* `trace.ignores` (`Array<string>`): A set of package path prefixes up to a directory level (e.g., `react` or `mod/lib`) to skip tracing **if** the function is being packaged `individually`. If there are service-level `trace.ignores` then the function-level ones will be **added** to the list.
* `trace.allowMissing` (`Object.<string, Array<string>>`): An object of package path prefixes mapping to lists of packages that are allowed to be missing **if** the function is being packaged `individually`. If there is a service-level `trace.allowMissing` object then the function-level ones will be smart **merged** into the list.
* `trace.include` (`Array<string>`): Additional file path globbing patterns (relative to `servicePath`) to be included in the package and be further traced for dependencies to include. Applies to functions that are part of a service or function (`individually`) packaging. If there are service-level `trace.include`s then the function-level ones will be **added** to the list.
* `trace.dynamic.bail` (`Boolean`): Terminate `serverless` program with an error if dynamic import misses are detected **if** the function is being packaged `individually`.
* `trace.dynamic.resolutions` (`Object.<string, Array<string>>`): An object of application source file or package name keys mapping to lists of pattern globs that are traced and included in the application bundle **if** the function is being packaged `individually`. If there is a service-level `trace.dynamic.resolutions` object then the function-level ones will be smart **merged** into the list.

Let's see the advanced options in action:

```yml
plugins:
  - serverless-jetpack

custom:
  jetpack:
    preInclude:
      - "!**"
    trace:
      ignores:
        # Unconditionally skip `aws-sdk` and all dependencies
        # (Because it already is installed in target Lambda)
        - "aws-sdk"
      allowMissing:
        # For just the `ws` package allow certain lazy dependencies to be
        # skipped without error if not found on disk.
        "ws":
          - "bufferutil"
          - "utf-8-validate"
      dynamic:
        # Force errors if have unresolved dynamic imports
        bail: true
        # Resolve encountered dynamic import misses, either by tracing
        # additional files, or ignoring after confirmation of safety.
        resolutions:
          # **Application Source**
          #
          # Specify keys as relative path to application source files starting
          # with a dot.
          "./src/server/config.js":
            # Manually trace all configuration files for bespoke configuration
            # application code. (Note these are relative to the file key!)
            - "../../config/default.js"
            - "../../config/production.js"

          # Ignore dynamic import misses with empty array.
          "./src/something-else.js": []

          # **Dependencies**
          #
          # Specify keys as `PKG_NAME/path/to/file.js`.
          "bunyan/lib/bunyan.js":
            # - node_modules/bunyan/lib/bunyan.js [79:17]: require('dtrace-provider' + '')
            # - node_modules/bunyan/lib/bunyan.js [100:13]: require('mv' + '')
            # - node_modules/bunyan/lib/bunyan.js [106:27]: require('source-map-support' + '')
            #
            # These are all just try/catch-ed permissive require's meant to be
            # excluded in browser. We manually add them in here.
            - "dtrace-provider"
            - "mv"
            - "source-map-support"

          # Ignore: we aren't using themes.
          # - node_modules/colors/lib/colors.js [127:29]: require(theme)
          "colors/lib/colors.js": []

package:
  include:
    - "a/manual/file-i-want.js"

functions:
  # Functions in service package.
  # - `jetpack.trace.ignores` does not apply.
  # - `jetpack.trace.include` **will** include and trace additional files.
  service-packaged-app-1:
    handler: app1.handler

  service-packaged-app-2:
    handler: app2.handler
    jetpack:
      # - `jetpack.trace.allowMissing` additions are merged into service level
      trace:
        # Trace and include: `app2.js` + `extra/**.js` patterns
        include:
          - "extra/**.js"

  # Individually with no trace configuration will be traced from service-level config
  individually-packaged-1:
    handler: ind1.handler
    package:
      individually: true
      # Normal package include|exclude work the same, but are not traced.
      include:
        - "some/stuff/**"
    jetpack:
      trace:
        # When individually, `ignores` from fn are added: `["aws-sdk", "react-ssr-prepass"]`
        ignores:
          - "react-ssr-prepass"
        # When individually, `allowMissing` smart merges like:
        # `{ "ws": ["bufferutil", "utf-8-validate", "another"] }`
        allowMissing:
          "ws":
            - "another"

  # Individually with explicit `false` will not be traced
  individually-packaged-1:
    handler: ind1.handler
    package:
      individually: true
    jetpack:
      trace: false
```

### Tracing caveats

* **Works best for large, unused production dependencies**: Tracing mode is best suited for an application wherein many / most of the files specified in `package.json:dependencies` are not actually used. When there is a large discrepancy between "specific dependencies" and "actually used files" you'll see the biggest speedups. Conversely, when production dependencies are very tight and almost every file is used you won't see a large speedup versus Jetpack's normal dependency mode.

* **Only works with JavaScript handlers + code**: Tracing mode only works with `functions.{FN_NAME}.handler` and `trace.include` files that are real JavaScript ending in the suffixes of `.js` or `.mjs`. If you have TypeScript, JSX, etc., please transpile it first and point your handler at that file. By default tracing mode will search on `PATH/TO/HANDLER_FILE.{js,mjs}` to then trace, and will throw an error if no matching files are found for a function that has `runtime: node*` when tracing mode is enabled.

* **Only works with imports/requires**: [trace-deps][] only works with a supported set of `require`, `require.resolve` and `import` dependency specifiers. That means if your application code or a dependency does something like: `const styles = fs.readFileSync(path.join(__dirname, "styles.css"))` then the dependency of `node_modules/<pkg>/<path>/styles.css` will not be included in your serverless bundle. To remedy this you presently must manually detect and find any such missing files and use a standard service or function level `package.include` as appropriate to explicitly include the specific files in your bundle.

* **Service/function-level Applications**: Tracing mode at the service level and `individually` configurations work as follows:
    * If service level `custom.jetpack.trace` is set (`true` or config object), then the service will be traced. All functions are packaged in tracing mode except for those with both `individually` enabled (service or function level) and `functions.{FN_NAME}.jetpack.trace=false` explicitly.
    * If service level `custom.jetpack.trace` is false or unset, then the service will not be traced. All functions are packaged in normal dependency-filtering mode except for those with both `individually` enabled (service or function level) and `functions.{FN_NAME}.jetpack.trace` is set which will be in tracing mode.

* **Replaces Package Introspection**: Enabling tracing mode will replace all `package.json` production dependency inspection and add a blanket exclusion pattern for `node_modules` meaning things that are traced are the **only** thing that will be included by your bundle.

* **Works with other `include|excludes`s**: The normal package `include|exclude`s work like normal and are a means of bring in other files as appropriate to your application. And for many cases, you **will** want to include other files via the normal `serverless` configurations, just without tracing and manually specified.

* **Layers are not traced**: Because Layers don't have a distinct entry point, they will not be traced. Instead Jetpack does normal pattern-based production dependency inference.

* **Static analysis by default**: Out of the box, tracing will only detect files included via `require("A_STRING")`, `require.resolve("A_STRING")`, `import "A_STRING"`, and `import NAME from "A_STRING"`. It will not work with dynamic `import()`s or `require`s that dynamically inject a variable etc. like `require(myVariable)`.
    * **Note**: Jetpack will log warnings for files found that have dynamic imports that tracing missed. See `WARNING` log output for the list of files and read our [section below](#handling-dynamic-import-misses) on handling dynamic imports.

### Handling dynamic import misses

Dynamic imports that use variables or runtime execution like `require(A_VARIABLE)` or ``import(`template_${VARIABLE}`)`` cannot be used by Jetpack to infer what the underlying dependency files are for inclusion in the bundle. That means some level of developer work to handle.

**Identify**

The first step is to be aware and watch for dynamic import misses. Conveniently, Jetpack logs warnings like the following:

```
Serverless: [serverless-jetpack] WARNING: Found 6 dependency packages with tracing misses in .serverless/FN_NAME.zip! Please see logs and read: https://npm.im/serverless-jetpack#handling-dynamic-import-misses
Serverless: [serverless-jetpack] .serverless/FN_NAME.zip dependency package tracing misses: [* ... */,"colors","bunyan",/* ... */]
```

and produces combined `--report` output like:

```md
### Tracing Dynamic Misses (`6` packages): Dependencies

...
- ../node_modules/aws-xray-sdk-core/node_modules/colors/lib/colors.js [127:29]: require(theme)
- ../node_modules/bunyan/lib/bunyan.js [79:17]: require('dtrace-provider' + '')
- ../node_modules/bunyan/lib/bunyan.js [100:13]: require('mv' + '')
- ../node_modules/bunyan/lib/bunyan.js [106:27]: require('source-map-support' + '')
...
```

which gives you the line + column number of the dynamic dependency in a given source file and snippet of the code in question.

In addition to just logging this information, you can ensure you have no unaccounted for dynamic import misses by setting `jetpack.trace.dynamic.bail = true` in your applicable service or function-level configuration.

**Diagnose**

With the `--report` output in hand, the recommended course is to identify what the impact is of these missed dynamic imports. For example, in `node_modules/bunyan/lib/bunyan.js` the interesting `require('mv' + '')` import is within a permissive try/catch block to allow conditional import of the library if found (and prevent `browserify` from bundling the library). For our Serverless application we could choose to ignore these dynamic imports or manually add in the imported libraries.

For other dependencies, there may well be "hidden" dependencies that you will need to add to your Serverless bundle for runtime correctness. Things like `node-config` which dynamically imports various configuration files from environment variable information, etc.

**Remedy**

Once we have logging information and the `--report` output, we can start remedying dynamic import misses via the Jetpack feature `jetpack.trace.dynamic.resolutions`. Resolutions are keys to files with dynamic import misses that allow a developer to specify what imports _should_ be included manually or to simply ignore the dynamic import misses.

**Keys**: Resolutions take a key value to match each file with missing dynamic imports. There are two types of keys that are used:

* **Application Source File**: Something that is within your application and **not** `node_modules`. Specify these files with a dot prefix as appropriate relative to the Serverless service path (usually CWD) like `./src/server.js` or `../outside/file.js`.
* **Package Dependencies**: A file from a dependency within `node_modules`. Specify these files without a dot and just `PKG_NAME/path/to/file.js` or `@SCOPE/PKG_NAME/path/to/file.js`.

**Values**: Values are an array of extra imports to add in from each file as if they were declared in that very file with `require("EXTRA_IMPORT")` or `import "EXTRA_IMPORT"`. This means the values should either be _relative paths within that package_ (`./lib/auth/noop.js`) or other package dependencies (`lodash` or `lodash/map.js`).
    * **Note**: We choose to support "additional imports" and not just file additions like `package.include` or `jetpack.trace.include`. The reason is that for package dependency import misses, the packages can be flattened to unpredictable locations in the `node_modules` trees and doubly so in monorepos. An import will always be resolved to the correct location, and that's why we choose it. At the same time, tools like `package.include` or `jetpack.trace.include`are still available to use!

Some examples:

[`bunyan`](https://github.com/trentm/node-bunyan): The popular logger library has some optional dependencies that are not meant only for Node.js. To prevent browser bundling tools from including, they use a curious `require` strategy of `require('PKG_NAME' + '')` to defeat parsing. For Jetpack, this means we get dynamic misses reports of:

```yml
- node_modules/bunyan/lib/bunyan.js [79:17]: require('dtrace-provider' + '')
- node_modules/bunyan/lib/bunyan.js [100:13]: require('mv' + '')
- node_modules/bunyan/lib/bunyan.js [106:27]: require('source-map-support' + '')
```

Using `resolutions` we can remedy these by simple adding imports for all three libraries like:

```yml
custom:
  jetpack:
    trace:
      dynamic:
        resolutions:
          "bunyan/lib/bunyan.js":
            - "dtrace-provider"
            - "mv"
            - "source-map-support"
```

[`express`](https://expressjs.com/): The popular server framework dynamically imports engines which produces a dynamic misses report of:

```yml
- node_modules/express/lib/view.js [81:13]: require(mod)
```

In a common case, this is a non-issue if you aren't using engines, so we can simply "ignore" the import miss by setting an empty array `resolutions` value:

```yml
custom:
  jetpack:
    trace:
      dynamic:
        resolutions:
          "express/lib/view.js": []
```

Once we have analyzed all of our misses and added `resolutions` to either ignore the miss or add other imports, we can then set `trace.dynamic.bail = true` to make sure that if future dependency upgrades adds new, unhandled dynamic misses we will get a failed build notification so we know that we're always deploying known, good code.

### Tracing results

The following is a table of generated packages using vanilla Serverless vs Jetpack with tracing (using `yarn benchmark:sizes`).

The relevant portions of our measurement chart.

- `Scenario`: Same benchmark scenarios
- `Type`: `jetpack` is this plugin in `trace` mode and `baseline` is Serverless built-in packaging.
- `Zips`: The number of zip files generated per scenario (e.g., service bundle + individually packaged function bundles).
- `Files`: The aggregated number of individual files in **all** zip files for a given scenario. This shows how Jetpack in tracing mode results in many less files.
- `Size`: The aggregated total byte size of **all** zip files for a given scenario. This shows how Jetpack in tracing mode results in smaller bundle packages.
- `vs Base`: Percentage difference of the aggregated zip bundle byte sizes for a given scenario of Jetpack vs. Serverless built-in packaging.

Results:

| Scenario | Type     | Zips | Files |    Size |      vs Base |
| :------- | :------- | ---: | ----: | ------: | -----------: |
| simple   | jetpack  |    1 |   200 |  529417 | **-42.78 %** |
| simple   | baseline |    1 |   433 |  925260 |              |
| complex  | jetpack  |    2 |  1588 | 3835544 | **-18.20 %** |
| complex  | baseline |    2 |  2120 | 4688648 |              |

## Command Line Interface

Jetpack also provides some CLI options.

**`serverless jetpack package`**

Package a function like `serverless package` does, just with better options.

```sh
$ serverless jetpack package -h
Plugin: Jetpack
jetpack package ............... Packages a Serverless service or function
    --function / -f .................... Function name. Packages a single function (see 'deploy function')
    --report / -r ...................... Generate full bundle report
```

So, to package all service / functions like `serverless package` does, use:

```sh
$ serverless jetpack package # OR
$ serverless package
```

... as this is basically the same built-in or custom.

The neat addition that Jetpack provides is:

```sh
$ serverless jetpack package -f|--function {NAME}
```

which allows you to package just one named function exactly the same as `serverless deploy -f {NAME}` does. (Curiously `serverless deploy` implements the `-f {NAME}` option but `serverless package` does not.)

## Benchmarks

The following is a simple, "on my machine" benchmark generated with `yarn benchmark`. It should not be taken to imply any real world timings, but more to express relative differences in speed using the `serverless-jetpack` versus the built-in baseline Serverless framework packaging logic.

As a quick guide to the results table:

- `Scenario`: Contrived scenarios for the purpose of generating results. E.g.,
    - `simple`: Very small production and development dependencies.
    - `complex`: Many different serverless configurations all in one.
- `Pkg`: Project installed via `yarn` or `npm`? This really only matters in that `npm` and `yarn` may flatten dependencies differently, so we want to make sure Jetpack is correct in both cases.
- `Type`: `jetpack` is this plugin and `baseline` is Serverless built-in packaging.
- `Mode`: For `jetpack` benchmarks, either:
    - `deps`: Dependency filtering with equivalent output to `serverless` (just faster).
    - `trace`: Tracing dependencies from specified source files. Not equivalent to `serverless` packaging, but functionally correct, way faster, and with smaller packages.
- `Time`: Elapsed build time in milliseconds.
- `vs Base`: Percentage difference of `serverless-jetpack` vs. Serverless built-in. Negative values are faster, positive values are slower.

Machine information:

* os:   `darwin 18.7.0 x64`
* node: `v12.14.1`

Results:

| Scenario | Pkg  | Type     | Mode  |  Time |      vs Base |
| :------- | :--- | :------- | :---- | ----: | -----------: |
| simple   | yarn | jetpack  | trace |  4878 | **-74.25 %** |
| simple   | yarn | jetpack  | deps  |  3861 | **-79.62 %** |
| simple   | yarn | baseline |       | 18941 |              |
| simple   | npm  | jetpack  | trace |  7290 | **-68.34 %** |
| simple   | npm  | jetpack  | deps  |  4017 | **-82.55 %** |
| simple   | npm  | baseline |       | 23023 |              |
| complex  | yarn | jetpack  | trace | 10475 | **-70.93 %** |
| complex  | yarn | jetpack  | deps  |  8821 | **-75.52 %** |
| complex  | yarn | baseline |       | 36032 |              |
| complex  | npm  | jetpack  | trace | 15644 | **-59.13 %** |
| complex  | npm  | jetpack  | deps  |  9896 | **-74.15 %** |
| complex  | npm  | baseline |       | 38282 |              |

## Maintenance status

**Active:** Formidable is actively working on this project, and we expect to continue for work for the foreseeable future. Bug reports, feature requests and pull requests are welcome.

[Serverless]: https://serverless.com/
[lerna]: https://lerna.js.org/
[yarn workspaces]: https://yarnpkg.com/lang/en/docs/workspaces/
[inspectdep]: https://github.com/FormidableLabs/inspectdep/
[trace-deps]: https://github.com/FormidableLabs/trace-deps/
[globby]: https://github.com/sindresorhus/globby
[nanomatch]: https://github.com/micromatch/nanomatch

[npm_img]: https://badge.fury.io/js/serverless-jetpack.svg
[npm_site]: http://badge.fury.io/js/serverless-jetpack
[actions_img]: https://github.com/FormidableLabs/serverless-jetpack/workflows/CI/badge.svg
[actions_site]: https://github.com/FormidableLabs/serverless-jetpack/actions
[lic_img]: https://img.shields.io/npm/l/serverless-jetpack.svg?color=brightgreen&style=flat
[lic_site]: https://github.com/FormidableLabs/serverless-jetpack/blob/master/LICENSE.txt
[maintenance-image]: https://img.shields.io/badge/maintenance-active-brightgreen.svg
