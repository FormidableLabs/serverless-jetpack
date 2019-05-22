Serverless Jetpack 🚀
====================
[![npm version][npm_img]][npm_site]
[![Travis Status][trav_img]][trav_site]
[![AppVeyor Status][appveyor_img]][appveyor_site]

A faster JavaScript packager for [Serverless][] applications.

## Overview

The Serverless framework is a **fantastic** one-stop-shop for taking your code and packing up all the infrastructure around it to deploy it to the cloud. Unfortunately, for many JavaScript applications, some aspects of packaging are slow, hindering deployment speed and developer happiness.

With the `serverless-jetpack` plugin, many common, slow Serverless packaging scenarios can be dramatically sped up. All with a very easy, seamless integration into your existing Serverless projects.

## Usage

### The short, short version

First, install the plugin:

```sh
$ yarn add --dev serverless-jetpack
$ npm add --save-dev serverless-jetpack
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
        - "!**/node_modules/aws-sdk" # Faster way to exclude
        - "package.json"
```

## How it works

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
2. Glob files from disk with a root `**` (all files), `!node_modules` (exclude all by default), `!node_modules/PROD_DEP_01, !node_modules/PROD_DEP_02, ...` (add in specific directories of production dependencies), and then the normal `include` patterns. This small nuance of limiting the `node_modules` globbing to **just** production dependencies gives us an impressive speedup.
3. Apply service + function `exclude`, then `include` patterns in order to decide what is included in the package zip file.

This ends up being way faster in most cases, and particularly when you have very large `devDependencies`. It is worth pointing out the minor implication that:

* If your `include|exclude` logic intends to glob in `devDependencies`, this won't work anymore. But, you're not really planning on deploying non-production dependencies are you? 😉

### Complexities

#### Minor differences vs. Serverless globbing

Our [benchmark correctness tests](./test/benchmark.js) highlight a number of various files not included by Jetpack that are included by `serverless` in packaging our benchmark scenarios. Some of these are things like `node_modules/.yarn-integrity` which Jetpack knowingly ignores because you shouldn't need it. All of the others we've discovered to date are instances in which `serverless` incorrectly includes `devDependencies`...

#### Be careful with `include` configurations and `node_modules`

Let's start with how `include|exclude` work for both Serverless built-in packaging and Jetpack:

- `include`: Used in `globby()` disk reads files into a list and `nanomatch()` pattern matching to decide what to keep.
    - `!**/node_modules/aws-sdk`: During `globby()` on-disk reading, the `node_modules/aws-sdk` directory will **never** even be read from disk. This is faster. During later `nanomatch()` this has no effect, because it won't match an actual file.
    - `!**/node_modules/aws-sdk/**`: During `globby()` on-disk reading, the `node_modules/aws-sdk` directory will read from disk, but then individual files excluded from the list. This is slower. During later `nanomatch()` this will potentially re-exclude.

- `exclude`: Only used in `nanomatch()` pattern matching to decide which files in a list to keep.
    - `**/node_modules/aws-sdk`: No effect, because directory-only application.
    - `**/node_modules/aws-sdk/**`: During `nanomatch()` this will exclude.

So, in either case if you were to add something like:

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
  - "**/node_modules/aws-sdk"

# Better! Never even read the files from disk during globbing in the first place!
include:
  - "!**/node_modules/aws-sdk"
```

## Benchmarks

The following is a simple, "on my machine" benchmark generated with `yarn benchmark`. It should not be taken to imply any real world timings, but more to express relative differences in speed using the `serverless-jetpack` versus the built-in baseline Serverless framework packaging logic.

As a quick guide to the results table:

- `Scenario`: Contrived scenarios for the purpose of generating results.
    - `simple`: Very small production and development dependencies.
    - `individually`: Same dependencies as `simple`, but with `individually` packaging.
    - `huge`: Lots and lots of development dependencies.
- `Mode`: Project installed via `yarn` or `npm`? This really only matters in that `npm` and `yarn` may flatten dependencies differently, so we want to make sure Jetpack is correct in both cases.
- `Type`: `jetpack` is this plugin and `baseline` is Serverless built-in packaging.
- `Time`: Elapsed build time in milliseconds.
- `vs Base`: Percentage difference of `serverless-jetpack` vs. Serverless built-in. Negative values are faster, positive values are slower.

Machine information:

* os:   `darwin 18.5.0 x64`
* node: `v8.16.0`

Results:

| Scenario     | Mode | Type     | Time  |      vs Base |
| :----------- | :--- | :------- | ----: | -----------: |
| simple       | yarn | jetpack  |  4338 | **-46.37 %** |
| simple       | yarn | baseline |  8089 |              |
| simple       | npm  | jetpack  |  4055 | **-53.78 %** |
| simple       | npm  | baseline |  8773 |              |
| individually | yarn | jetpack  |  2964 | **-76.77 %** |
| individually | yarn | baseline | 12760 |              |
| individually | npm  | jetpack  |  4183 | **-69.67 %** |
| individually | npm  | baseline | 13790 |              |
| huge         | yarn | jetpack  |  4524 | **-84.03 %** |
| huge         | yarn | baseline | 28321 |              |
| huge         | npm  | jetpack  |  5680 | **-83.07 %** |
| huge         | npm  | baseline | 33551 |              |

[Serverless]: https://serverless.com/
[lerna]: https://lerna.js.org/
[yarn workspaces]: https://yarnpkg.com/lang/en/docs/workspaces/
[inspectdep]: https://github.com/FormidableLabs/inspectdep/
[globby]: https://github.com/sindresorhus/globby
[nanomatch]: https://github.com/micromatch/nanomatch

[npm_img]: https://badge.fury.io/js/serverless-jetpack.svg
[npm_site]: http://badge.fury.io/js/serverless-jetpack
[trav_img]: https://api.travis-ci.com/FormidableLabs/serverless-jetpack.svg
[trav_site]: https://travis-ci.com/FormidableLabs/serverless-jetpack
[appveyor_img]: https://ci.appveyor.com/api/projects/status/github/formidablelabs/serverless-jetpack?branch=master&svg=true
[appveyor_site]: https://ci.appveyor.com/project/FormidableLabs/serverless-jetpack
