Serverless Jetpack 🚀
====================

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

The plugin has the following options:

- `mode`: Either `yarn` (default) or `npm`. The installation tool to use which must be already installed on your system. _Note_: If you are using `npm`, `npm@5.7.0+` is **strongly** recommended so that the plugin can use `npm ci` for much faster installations.
- `lockfile`: Defaults to `yarn.lock` for `mode: yarn` and `package-lock.json` for `mode: npm`.
    - You can set it to a different relative location like: `lockfile: ../../yarn.lock` for monorepo projects wherein the lockfile exists outside of the package directory.
    - Setting `lockfile: null` will skip using lockfiles entirely. This will be slower and more dangerous (since you can wind up with different dependencies than your root project). But it is available if your project does not use lockfiles.
- `stdio`: Enable/disable shell output for `yarn|npm install` commands. Defaults to `false`.

Which can be integrated into a more complex `serverless.yml` configuration like:

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

custom:
  # Optional configuration options go here:
  serverless-jetpack:
    mode: npm                           # Default `yarn`
    lockfile: ../../package-lock.json   # Different location
    stdio: true                         # Default `false`

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

The `serverless-jetpack` plugin leverages this use case and gains a potentially significant speedup by observing that manually pruning development dependencies (as Serverless does) can be much, much slower in practice than using honed, battle-tested tools like `yarn` and `npm` to install just the production dependencies from scratch -- by doing a fresh `yarn|npm install` in a temporary directory, copying over source files and zipping that all up!

Process-wise, the `serverless-jetpack` plugin uses the internal logic from Serverless packaging to detect when Serverless would actually do it's own packaging. Then, it inserts its different packaging steps and copies over the analogous zip file to where Serverless would have put it, and sets internal Serverless `artifact` field that then causes Serverless to skip all its normal packaging steps.

### The nitty gritty of why it's faster

Jetpack does _most_ of what Serverless does globbing-wise with `include|exclude` at the service or function level. Serverless does the following (more or less):

1. Glob files from disk with a root `**` (all files) and the `include` pattern, following symlinks, and create a list of files.
2. Apply service + function `exclude`, then `include` patterns in order to move files into the build directory to be zipped.

This is potentially slow if `node_modules` contains a lot of ultimately removed files, yielding a lot of completely wasted disk I/O time. Also, following symlinks is expensive, and for `node_modules` almost never useful.

Jetpack, by contrast does the following:

1. Glob files from disk with a root `**` (all files) and the `include` pattern, **except** for `node_modules` (never read) and without following symlinks to create a list of files.
2. Apply service + function `exclude`, then `include` patterns in order.
3. Separately `npm|yarn install` production `node_modules` into a dedicated dependencies build directory. Run the same glob logic and `exclude` + `include` matching over just the new `node_modules`.
4. Then zip the files from the two separate matching operations.

This _does_ have some other implications like:

* If your `include|exclude` logic intends to glob in `devDependencies`, this won't work anymore. But, you're not really planning on deploying non-production dependencies are you? 😉

### Complexities

#### Root `node_modules` directory

This plugin assumes that the directory from which you run `serverless` commands is where `node_modules` is installed and the only one in play. It's fine if you have things like a monorepo with nested packages that each have a `serverless.yml` and `package.json` as long as each one is an independent "root" of `serverless` commands.

Having additional `node_modules` installs in nested directory from a root is unlikely to work properly with this plugin.

#### Lockfiles

It is a best practice to use lockfiles (`yarn.lock` or `package-lock.json`) generally, and specifically important for the approach this plugin takes because it does **new** `yarn|npm` installs into a temporary directory. Without lockfiles you may be packaging/deploying something _different_ from what is in the root project. And, production installs with this plugin are much, much _faster_ with a lockfile than without.

To this end, the plugin assumes that a lockfile is provided by default and you must explicitly set the option to `lockfile: null` to avoid having a lockfile copied over. When a lockfile is present then the strict (and fast!) `yarn install --frozen-lockfile  --production` and `npm ci --production` commands are used to guarantee the packaged `node_modules` matches the relevant project modules. And, the installs will **fail** (by design) if the lockfile is out of date.

#### Monorepos and lockfiles

Many projects use features like [yarn workspaces][] and/or [lerna][] to have a large root project that then has many separate serverless functions/packages in separate directories. In cases like these, the relevant lock file may not be in something like `packages/NAME/yarn.lock`, but instead at the project root like `yarn.lock`.

In cases like these, simply set the `lockfile` option to relatively point to the appropriate lockfile (e.g., `lockfile: ../../yarn.lock`).

#### `npm install` vs `npm ci`

`npm ci` was introduced in version [`5.7.0`](https://blog.npmjs.org/post/171139955345/v570). Notwithstanding the general lockfile logic discussed above, if the plugin detects an `npm` version prior to `5.7.0`, the non-locking, slower `npm install --production` command will be used instead.

#### Excluding `serverless.*` files

The serverless framework only excludes the _first_ match of `serverless.{yml,yaml,json,js}` in order. By contrast, Jetpack just glob excludes them all. We recommend using a glob `include` if your deploy logic depends on having something like `serverless.js` around.

## Benchmarks

The following is a simple, "on my machine" benchmark generated with `yarn benchmark`. It should not be taken to imply any real world timings, but more to express relative differences in speed using the `serverless-jetpack` versus the built-in baseline Serverless framework packaging logic.

When run with a lockfile (producing the fastest `yarn|npm` install), **all** of our scenarios have faster packaging with `serverless-jetpack`. In some cases, this means over a **6x** speedup. The results also indicate that if your project is **not** using a lockfile, then built-in Serverless packaging may be faster.

As a quick guide to the results table:

- `Scenario`: Contrived scenarios for the purpose of generating results.
    - `simple`: Very small production and development dependencies.
    - `individually`: Same dependencies as `simple`, but with `individually` packaging.
    - `huge`: Lots and lots of development dependencies.
- `Mode`: Use `yarn` or `npm`?
- `Lockfile`: Use a lockfile (fastest) or omit?
- `Type`: `jetpack` is this plugin and `baseline` is Serverless built-in packaging.
- `Time`: Elapsed build time in milliseconds.
- `vs Base`: Percentage difference of `serverless-jetpack` vs. Serverless built-in. Negative values are faster, positive values are slower.

The rows that are **bolded** are the preferred configurations for `serverless-jetpack`, which is to say, configured with a lockfile and `npm@5.7.0+` if using `npm`.

| Scenario         | Mode     | Lockfile | Type        |     Time |      vs Base |
| :--------------- | :------- | :------- | :---------- | -------: | -----------: |
| **simple**       | **yarn** | **true** | **jetpack** | **4811** | **-41.33 %** |
| simple           | yarn     | true     | baseline    |     8200 |              |
| **simple**       | **npm**  | **true** | **jetpack** | **8944** | **-49.97 %** |
| simple           | npm      | true     | baseline    |    17878 |              |
| simple           | yarn     | false    | jetpack     |     7190 |     -17.72 % |
| simple           | yarn     | false    | baseline    |     8738 |              |
| simple           | npm      | false    | jetpack     |    12552 |      14.37 % |
| simple           | npm      | false    | baseline    |    10975 |              |
| **individually** | **yarn** | **true** | **jetpack** | **5061** | **-56.12 %** |
| individually     | yarn     | true     | baseline    |    11534 |              |
| **individually** | **npm**  | **true** | **jetpack** | **6864** | **-43.79 %** |
| individually     | npm      | true     | baseline    |    12212 |              |
| individually     | yarn     | false    | jetpack     |     7661 |     -32.25 % |
| individually     | yarn     | false    | baseline    |    11307 |              |
| individually     | npm      | false    | jetpack     |    10986 |     -14.10 % |
| individually     | npm      | false    | baseline    |    12789 |              |
| **huge**         | **yarn** | **true** | **jetpack** | **6144** | **-74.87 %** |
| huge             | yarn     | true     | baseline    |    24445 |              |
| **huge**         | **npm**  | **true** | **jetpack** | **5892** | **-78.70 %** |
| huge             | npm      | true     | baseline    |    27668 |              |
| huge             | yarn     | false    | jetpack     |    12660 |     -49.27 % |
| huge             | yarn     | false    | baseline    |    24954 |              |
| huge             | npm      | false    | jetpack     |    18511 |     -35.03 % |
| huge             | npm      | false    | baseline    |    28490 |              |

[Serverless]: https://serverless.com/
[lerna]: https://lerna.js.org/
[yarn workspaces]: https://yarnpkg.com/lang/en/docs/workspaces/
