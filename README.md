Serverless Jetpack 🚀
====================
[![npm version][npm_img]][npm_site]
[![Travis Status][trav_img]][trav_site]

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

The plugin supports all normal built-in Serverless framework packaging configurations. E.g., more complex `serverless.yml` configurations like:

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
      exclude:
        - "**"
      include:
        - "src/**"
        - "node_modules/**"
        - "package.json"
```

## How it works

The Serverless framework can sometimes massively slow down when packaging applications with large amounts / disk ussage for `devDependencies`. Although the framework enables `excludeDevDependencies` during packaging by default, just ingesting all the files that are later excluded (via that setting and normal `include|exclude` globs) causes apparently enough disk I/O to make things potentially slow.

Observing that a very common use case for a Serverless framework is:

- A `package.json` file defining production and development dependencies.
- A `yarn.lock` file if using `yarn` or a `package-lock.json` file if using `npm` to lock down and speed up installations.
- One or more JavaScript source file directories, typically something like `src`.

The `serverless-jetpack` plugin leverages this use case and gains a potentially significant speedup performing a fast production dependency on-disk discovery via the [inspectdep][] library that is turned into an efficient up-front globbing limitation to scan way, way less files in `node_modules` during packaging.

Process-wise, the `serverless-jetpack` plugin uses the internal logic from Serverless packaging to detect when Serverless would actually do it's own packaging. Then, it inserts its different packaging steps and copies over the analogous zip file to where Serverless would have put it, and sets internal Serverless `artifact` field that then causes Serverless to skip all its normal packaging steps.

### The nitty gritty of why it's faster

Jetpack does _most_ of what Serverless does globbing-wise with `include|exclude` at the service or function level. Serverless does the following (more or less):

1. Glob files from disk with a root `**` (all files) and the `include` pattern, following symlinks, and create a list of files.
2. Apply service + function `exclude`, then `include` patterns in order to decide what is included in the package zip file.

This is potentially slow if `node_modules` contains a lot of ultimately removed files, yielding a lot of completely wasted disk I/O time.

Jetpack, by contrast does the following:

1. Efficiently infer production dependencies from disk.
2. Glob files from disk with a root `**` (all files) that excludes `node_modules` generally from being read except for production dependencies. This small nuance of limiting the `node_modules` globbing to **just** production dependencies gives us an impressive speedup.
3. Apply service + function `exclude`, then `include` patterns in order to decide what is included in the package zip file.

This _does_ have some other implications like:

* If your `include|exclude` logic intends to glob in `devDependencies`, this won't work anymore. But, you're not really planning on deploying non-production dependencies are you? 😉

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
| :----------- | :--- | :------- | :---- | -----------: |
| simple       | yarn | jetpack  | 4338  | **-46.37 %** |
| simple       | yarn | baseline | 8089  |              |
| simple       | npm  | jetpack  | 4055  | **-53.78 %** |
| simple       | npm  | baseline | 8773  |              |
| individually | yarn | jetpack  | 2964  | **-76.77 %** |
| individually | yarn | baseline | 12760 |              |
| individually | npm  | jetpack  | 4183  | **-69.67 %** |
| individually | npm  | baseline | 13790 |              |
| huge         | yarn | jetpack  | 4524  | **-84.03 %** |
| huge         | yarn | baseline | 28321 |              |
| huge         | npm  | jetpack  | 5680  | **-83.07 %** |
| huge         | npm  | baseline | 33551 |              |

[Serverless]: https://serverless.com/
[lerna]: https://lerna.js.org/
[yarn workspaces]: https://yarnpkg.com/lang/en/docs/workspaces/
[inspectdep]: https://github.com/FormidableLabs/inspectdep/

[npm_img]: https://badge.fury.io/js/serverless-jetpack.svg
[npm_site]: http://badge.fury.io/js/serverless-jetpack
[trav_img]: https://api.travis-ci.com/FormidableLabs/serverless-jetpack.svg
[trav_site]: https://travis-ci.com/FormidableLabs/serverless-jetpack
