Serverless Jetpack 🚀
====================
[![npm version][npm_img]][npm_site]
[![CircleCI status][circle_img]][circle_site]
[![AppVeyor status][appveyor_img]][appveyor_site]
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
    * _WARNING_: If you don't **know** that you need this option, you probably don't want to set it. Setting the base dependency root outside of Serverless' `servicePath` / current working directory (e.g., `..`) may have some unintended side effects. Most notably, any discovered `node_modules` dependencies will be flattened into the zip at the same level as `servicePath` / CWD. E.g., if dependencies were included by Jetpack at `node_modules/foo` and then `../node_modules/foo` they would be collapsed in the resulting zip file package.
    * **Layers**: Layers are a bit of an odddity with built-in Serverless Framework packaging in that the current working directory is `layer.NAME.path` (and not `servicePath` like usual), yet things like `include|exclude` apply relatively to the layer `path`, not the `servicePath`. Jetpack has a similar choice and applies `base` applies to the root `servicePath` for everything (layers, functions, and service packaging), which seems to be the best approach given that monorepo consumers may well lay out projects like `functions/*` and `layers/*` and need dependency inference to get all the way to the root irrespective of a child layer `path`.
* `roots` (`Array<string>`): A list of paths (relative to `servicePath` / CWD) at which there may additionally declared and/or installed `node_modules`. (default: [Serverless' `servicePath` / CWD]).
    * Setting a value here replaces the default `[servicePath]` with the new array, so if you want to additionally keep the `servicePath` in the roots array, set as: `[".", ADDITION_01, ADDITION_02, ...]`.
    * This typically occurs in a monorepo project, wherein dependencies may be located in e.g. `packages/{NAME}/node_modules` and/or hoisted to the `node_modules` at the project base. It is important to specify these additional dependency roots so that Jetpack can (1) find and include the right dependencies and (2) hone down these directories to just production dependencies when packaging. Otherwise, you risk having a slow `serverless package` execution and/or end up with additional/missing dependencies in your final application zip bundle.
    * You only need to declare roots of things that _aren't_ naturally inferred in a dependency traversal. E.g., if starting at `packages/{NAME}/package.json` causes a traversal down to `node_modules/something` then symlinked up to `lib/something-else/node_modules/even-more` these additional paths don't need to be separately declared because they're just part of the dependency traversal.
    * **Layers**: Similar to `base`, both the project/service- and layer-level `roots` declarations will be relative to the project `servicePath` directory and _not_ the `layers.NAME.path` directory.
* `preInclude` (`Array<string>`): A list of glob patterns to be added _before_ Jetpack's dependency pattern inclusion and Serverless' built-in service-level and then function-level `package.include`s. This option most typically comes up in a monorepo scenario where you want a broad base exclusion like `!functions/**` or `!packages/**` at the service level and then inclusions in later functions.
* `concurrency` (`Number`): The number of independent package tasks (per function and service) to run off the main execution thread. If `1`, then run tasks serially in main thread. If `2+` run off main thread with `concurrency` number of workers. (default: `1`).
    * This option is most useful for Serverless projects that (1) have many individually packaged functions, and (2) large numbers of files and dependencies. E.g., start considering this option if your per-function packaging time takes more than 10 seconds and you have more than one service and/or function package.

The following **function** and **layer**-level configurations available via `functions.{FN_NAME}.jetpack` and  `layers.{LAYER_NAME}.jetpack`:

* `roots` (`Array<string>`): This option **adds** more dependency roots to the service-level `roots` option.
* `preInclude` (`Array<string>`): This option **adds** more glob patterns to the service-level `preInclude` option.

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

2. **File filtering phase** with `nanomatch()`. Once we have a list of files read from disk, we apply patterns in order as follows to decide whether to include them (last postitive match wins).

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

## Tracing Mode

Jetpack speeds up the underlying dependencies filtering approach of `serverless` packaging while providing completely equivalent bundles. However, this approach has some fundamental limitations:

* **Over-inclusive**: All production dependencies include many individual files that are not needed at runtime.
* **Speed**: For large sets of dependencies, copying lots of files is slow at packaging time.

Thus, we pose the question: _What if we packaged **only** the files we needed at runtime?_

Welcome to **tracing mode**!

Tracing mode is an alternative way to include dependencies in a `serverless` application. It works by using [Acorn](https://github.com/browserify/acorn-node) to parse out all dependencies in entry point files (`require`, `require.resolve`, static `import`) and then resolves them with [resolve](https://github.com/browserify/resolve) according to the Node.js resolution algorithm. This produces a list of the files that will actually be used at runtime and Jetpack includes these instead of traversing production dependencies. The engine for all of this work is a small, dedicated library, [trace-deps][].

### Tracing Configuration

The most basic configuration is just to enable `custom.jetpack.trace` (service-wide) or `functions.{FN_NAME}.jetpack.trace` (per-function) set to `true`. By default, tracing mode will trace _just_ the entry point file specified in `functions.{FN_NAME}.handler`.

```yml
plugins:
  - serverless-jetpack

custom:
  jetpack:
    trace: true
```

The `trace` field can be a Boolean or object containing further configuration information.

#### \[EXPERIMENTAL\] Tracing Options

> ℹ️ **Experimental**: Although we have a wide array of tests, tracing mode is still considered experimental as we roll out the feature. You should be sure to test all the execution code paths in your deployed serverless functions and verify your bundled package contents before using in production.

The basic `trace` Boolean field should hopefully work for most cases. Jetpack provides several additional options for more flexibility:

**Service**-level configurations available via `custom.jetpack.trace`:

* `trace` (`Boolean | Object`): If `trace: true` or `trace: { /* other options */ }` then tracing mode is activated at the service level.
* `trace.ignores` (`Array<string>`): A set of package path prefixes up to a directory level (e.g., `react` or `mod/lib`) to skip tracing on. This is particularly useful when you are excluding a package like `aws-sdk` that is already provided for your lambda.
* `trace.include` (`Array<string>`): Additional file path globbing patterns (relative to `servicePath`) to be included in the package and be further traced for dependencies to include. Applies to functions that are part of a service or function (`individually`) packaging.
    * **Note**: These patterns are in _addition_ to the handler inferred file path. If you want to exclude the handler path you could technically do a `!file/path.js` exclusion, but that would be a strange case in that your handler files would no longer be present.

The following **function**-level configurations available via `functions.{FN_NAME}.jetpack.trace` and  `layers.{LAYER_NAME}.jetpack.trace`:

* `trace` (`Boolean | Object`): If `trace: true` or `trace: { /* other options */ }` then tracing mode is activated at the function level **if** the function is being packaged `individually`.
* `trace.ignores` (`Array<string>`): A set of package path prefixes up to a directory level (e.g., `react` or `mod/lib`) to skip tracing **if** the function is being packaged `individually`. If there are service-level `trace.ignores` then the function-level ones will be **added** to the list.
* `trace.include` (`Array<string>`): Additional file path globbing patterns (relative to `servicePath`) to be included in the package and be further traced for dependencies to include. Applies to functions that are part of a service or function (`individually`) packaging. If there are service-level `trace.include`s then the function-level ones will be **added** to the list.

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
        - "aws-sdk" # Ignore for all service + function tracing

package:
  include:
    - "a/manual/file_i_want.js"

functions:
  # Functions in service package.
  # - `jetpack.trace` option `ignores` does not apply.
  # - `jetpack.include` **will** include and trace additional files.
  service-packaged-app-1:
    handler: app1.handler

  service-packaged-app-2:
    handler: app2.handler
    jetpack:
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

  # Individually with explicit `false` will not be traced
  individually-packaged-1:
    handler: ind1.handler
    package:
      individually: true
    jetpack:
      trace: false
```

### Tracing Caveats

* **Works best for large, unused production dependencies**: Tracing mode is best suited for an application wherein many / most of the files specified in `package.json:dependencies` are not actually used. When there is a large descrepancy between "specific dependencies" and "actually used files" you'll see the biggest speedups. Conversely, when production dependencies are very tight and almost every file is used you won't see a large speedup versus Jetpack's normal dependency mode.

* **Only works with JavaScript handlers + code**: Tracing mode only works with `functions.{FN_NAME}.handler` and `trace.include` files that are real JavaScript ending in the suffixes of `.js` or `.mjs`. If you have TypeScript, JSX, etc., please transpile it first and point your handler at that file. By default tracing mode will search on `PATH/TO/HANDLER_FILE.{js,mjs}` to then trace, and will throw an error if no matching files are found for a function that has `runtime: node*` when tracing mode is enabled.

* **Only works with imports/requires**: [trace-deps][] only works with a supported set of `require`, `require.resolve` and `import` dependency specifiers. That means if your application code or a dependency does something like: `const styles = fs.readFileSync(path.join(__dirname, "styles.css"))` then the dependency of `node_modules/<pkg>/<path>/styles.css` will not be included in your serverless bundle. To remedy this you presently must manually detect and find any such missing files and use a standard service or function level `package.include` as appropriate to explicitly include the specific files in your bundle.

* **Service/function-level Applications**: Tracing mode at the service level and `individually` configurations work as follows:
  * If service level `custom.jetpack.trace` is set (`true` or config object), then the service will be traced. All functions are packaged in tracing mode except for those with both `individually` enabled (service or function level) and `functions.{FN_NAME}.jetpack.trace=false` explicitly.
  * If service level `custom.jetpack.trace` is false or unset, then the service will not be traced. All functions are packaged in normal dependency-filtering mode except for those with both `individually` enabled (service or function level) and `functions.{FN_NAME}.jetpack.trace` is set which will be in tracing mode.

* **Replaces Package Introspection**: Enabling tracing mode will replace all `package.json` production dependency inspection and add a blanket exclusion pattern for `node_modules` meaning things that are traced are the **only** thing that will be included by your bundle.

* **Works with other `include|excludes`s**: The normal package `include|exclude`s work like normal and are a means of bring in other files as appropriate to your application. And for many cases, you **will** want to include other files via the normal `serverless` configurations, just without tracing and manually specified.

* **Layers are not traced**: Because Layers don't have a distinct entry point, they will not be traced. Instead Jetpack does normal pattern-based production dependency inference.

* **Static analysis only**: Tracing will only detect files included via `require("A_STRING")`, `require.resolve("A_STRING")`, `import "A_STRING"`, and `import NAME from "A_STRING"`. It will not work with dynamic `import()`s or `require`s that dynamically inject a variable etc. like `require(myVariable)`.

## Command Line Interface

Jetpack also provides some CLI options.

### `serverless jetpack package`

Package a function like `serverless package` does, just with better options.

```sh
$ serverless jetpack package -h
Plugin: Jetpack
jetpack package ............... Packages a Serverless service or function
    --function / -f .................... Function name. Packages a single function (see 'deploy function')
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

- `Scenario`: Contrived scenarios for the purpose of generating results.
    - `simple`: Very small production and development dependencies.
    - `individually`: Same dependencies as `simple`, but with `individually` packaging.
    - `huge`: Lots and lots of development dependencies.
- `Pkg`: Project installed via `yarn` or `npm`? This really only matters in that `npm` and `yarn` may flatten dependencies differently, so we want to make sure Jetpack is correct in both cases.
- `Type`: `jetpack` is this plugin and `baseline` is Serverless built-in packaging.
- `Mode`: For `jetpack` benchmarks, either:
    - `deps`: Dependency filtering with equivalent output to `serverless` (just faster).
    - `trace`: Tracing dependencies from specified source files. Not equivalent to `serevrless` packaging, but functionally correct, way faster, and with smaller packages.
- `Time`: Elapsed build time in milliseconds.
- `vs Base`: Percentage difference of `serverless-jetpack` vs. Serverless built-in. Negative values are faster, positive values are slower.

Machine information:

* os:   `darwin 18.7.0 x64`
* node: `v12.14.1`

Results:

| Scenario     | Pkg  | Type     | Mode  |  Time |      vs Base |
| :----------- | :--- | :------- | :---- | ----: | -----------: |
| simple       | yarn | jetpack  | trace |  7630 | **-60.06 %** |
| simple       | yarn | jetpack  | deps  |  2880 | **-84.92 %** |
| simple       | yarn | baseline |       | 19102 |              |
| simple       | npm  | jetpack  | trace |  7143 | **-62.61 %** |
| simple       | npm  | jetpack  | deps  |  3465 | **-81.86 %** |
| simple       | npm  | baseline |       | 19106 |              |
| complex      | yarn | jetpack  | trace | 12988 | **-48.67 %** |
| complex      | yarn | jetpack  | deps  | 10269 | **-59.41 %** |
| complex      | yarn | baseline |       | 25302 |              |
| complex      | npm  | jetpack  | trace | 10684 | **-59.44 %** |
| complex      | npm  | jetpack  | deps  | 10496 | **-60.15 %** |
| complex      | npm  | baseline |       | 26339 |              |
| individually | yarn | jetpack  | trace | 16857 |  **-7.38 %** |
| individually | yarn | jetpack  | deps  | 12759 | **-29.90 %** |
| individually | yarn | baseline |       | 18201 |              |
| individually | npm  | jetpack  | trace | 16024 | **-15.10 %** |
| individually | npm  | jetpack  | deps  | 13067 | **-30.76 %** |
| individually | npm  | baseline |       | 18873 |              |
| huge         | yarn | jetpack  | trace |  5562 | **-86.02 %** |
| huge         | yarn | jetpack  | deps  |  5079 | **-87.24 %** |
| huge         | yarn | baseline |       | 39793 |              |
| huge         | npm  | jetpack  | trace |  6790 | **-87.48 %** |
| huge         | npm  | jetpack  | deps  |  4105 | **-92.43 %** |
| huge         | npm  | baseline |       | 54254 |              |
| huge-prod    | yarn | jetpack  | trace |  8987 | **-70.00 %** |
| huge-prod    | yarn | jetpack  | deps  | 25348 | **-15.38 %** |
| huge-prod    | yarn | baseline |       | 29954 |              |
| huge-prod    | npm  | jetpack  | trace |  9766 | **-67.39 %** |
| huge-prod    | npm  | jetpack  | deps  | 23121 | **-22.79 %** |
| huge-prod    | npm  | baseline |       | 29947 |              |
## Maintenance Status

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
[circle_img]: https://circleci.com/gh/FormidableLabs/serverless-jetpack.svg?style=shield
[circle_site]: https://circleci.com/gh/FormidableLabs/serverless-jetpack
[appveyor_img]: https://ci.appveyor.com/api/projects/status/github/formidablelabs/serverless-jetpack?branch=master&svg=true
[appveyor_site]: https://ci.appveyor.com/project/FormidableLabs/serverless-jetpack
[lic_img]: https://img.shields.io/npm/l/serverless-jetpack.svg?color=brightgreen&style=flat
[lic_site]: https://github.com/FormidableLabs/serverless-jetpack/blob/master/LICENSE.txt
[maintenance-image]: https://img.shields.io/badge/maintenance-active-brightgreen.svg
