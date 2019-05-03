Serverless Jetpack
==================

A faster JavaScript packager for [Serverless][] applications.

## Overview

The Serverless framework is a **fantastic** one-stop-shop for taking your code and packing up all the infrastructure around it to deploy it to the cloud. Unfortunately, for many JavaScript applications, some aspects of packaging are slow, hindering development speed and happiness.

With the `serverless-jetpack` plugin, many common, slow Serverless packaging scenarios can be dramatically sped up. All with a very easy, seamless integration into your existing Serverless projects.

## Usage

First, install the plugin:

```sh
$ yarn add --dev serverless-jetpack
$ npm add --save-dev serverless-jetpack
```

Then, take a tour of all the options:

```sh
$ serverless jetpack --help
Plugin: Jetpack
jetpack ....................... A faster JavaScript packager for Serverless applications.
    --mode / -m ........................ Installation mode (default: `yarn`)
    --lockfile / -l .................... Path to lockfile (default: `yarn.lock` for `mode: yarn`, `package-lock.json` for `mode: npm`)
    --stdio / -s ....................... `child_process` stdio mode for our shell commands like yarn|npm installs (default: `null`)
```

And, integrate into your `serverless.yml` configuration file:

TODO_INSERT_SLS_CONFIG

## How it works

The Serverless framework can sometimes massively slow down when packaging applications with large amounts / disk ussage for `devDependencies`. Although the framework enables `excludeDevDependencies` during packaging by default, just ingesting all the files that are later excluded (via that setting and normal `include|exclude` globs) causes apparently enough disk I/O to make things potentially slow.

Observing that a very common use case for a Serverless framework is:

- A `package.json` file defining production and development dependencies.
- A `yarn.lock` file if using `yarn` or a `package-lock.json` file if using `npm` to lock down and speed up installations.
- One or more JavaScript source file directories, typically something like `src`.

The `serverless-jetpack` plugin leverages this use case and gains a potentially significant speedup by observing that manually pruning development dependencies (as Serverless does) can be much, much slower in practice than using honed, battle-tested tools like `yarn` and `npm` to install just the production dependencies from scratch -- by doing a fresh `yarn|npm install` in a temporary directory, copying over source files and zipping that all up!

Process-wise, the `serverless-jetpack` plugin uses the internal logic from Serverless packaging to detect when Serverless would actually do it's own packaging. Then, it inserts its different packaging steps and copies over the analogous zip file to where Serverless would have put it, and sets internal Serverless `artifact` field that then causes Serverless to skip all its normal packaging steps.

### Complexities

**Lockfiles**

It is a best practice to use lockfiles (`yarn.lock` or `package-lock.json`) generally, and specifically important for the approach this plugin takes because it does **new** `yarn|npm` installs into a temporary directory. Without lockfiles you may be packaging/deploying something _different_ from what is in the root project. And, production installs with this plugin are much, much _faster_ with a lockfile than without.

To this end, the plugin assumes that a lockfile is provided by default and you must explicitly set the option to `lockfile: null` to avoid having a lockfile copied over. When a lockfile is present then the strict (and fast!) `yarn install --frozen-lockfile  --production` and `npm ci --production` commands are used to guarantee the packaged `node_modules` matches the relevant project modules. And, the installs will **fail** (by design) if the lockfile is out of date.

**Monorepos and lockfiles**

Many projects use features like [yarn workspaces][] and/or [lerna][] to have a large root project that then has many separate serverless functions/packages in separate directories. In cases like these, the relevant lock file may not be in something like `packages/NAME/yarn.lock`, but instead at the project root like `yarn.lock`.

In cases like these, simply set the `lockfile` option to relatively point to the appropriate lockfile (e.g., `lockfile: ../../yarn.lock`).

**`npm install` vs `npm ci`**

`npm ci` was introduced in version [`5.7.0`](https://blog.npmjs.org/post/171139955345/v570). Notwithstanding the general lockfile logic discussed above, if the plugin detects an `npm` version prior to `5.7.0`, the non-locking, slower `npm install --production` command will be used instead.

## Benchmarks

The following is a simple, "on my machine" benchmark generated with `yarn test:benchmark`. It should not be taken to imply any real world timings, but more to express relative differences in speed using the `serverless-jetpack` versus the built-in baseline Serverless framework packaging logic.

When run with a lockfile (producing the fastest `yarn|npm` install), **all** of our scenarios have faster packaging with `serverless-jetpack`. In some cases, this means over a **4x** speedup. The results also indicate that if your project is **not** using a lockfile, then built-in Serverless packaging may be faster.

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

| Scenario     | Mode | Lockfile | Type     |  Time |  vs Base |
| :----------- | :--- | :------- | :------- | ----: | -------: |
| simple       | yarn | true     | plugin   |  4880 | -25.15 % |
| simple       | yarn | true     | baseline |  6520 |          |
| simple       | npm  | true     | plugin   |  5700 | -16.00 % |
| simple       | npm  | true     | baseline |  6786 |          |
| simple       | yarn | false    | plugin   |  7121 |   7.81 % |
| simple       | yarn | false    | baseline |  6605 |          |
| simple       | npm  | false    | plugin   |  7942 | -12.74 % |
| simple       | npm  | false    | baseline |  9102 |          |
| individually | yarn | true     | plugin   |  6209 | -56.67 % |
| individually | yarn | true     | baseline | 14329 |          |
| individually | npm  | true     | plugin   |  7367 | -51.62 % |
| individually | npm  | true     | baseline | 15228 |          |
| individually | yarn | false    | plugin   |  8850 | -37.34 % |
| individually | yarn | false    | baseline | 14124 |          |
| individually | npm  | false    | plugin   | 15115 | -22.39 % |
| individually | npm  | false    | baseline | 19475 |          |
| huge         | yarn | true     | plugin   |  6331 | -83.39 % |
| huge         | yarn | true     | baseline | 38109 |          |
| huge         | npm  | true     | plugin   |  5289 | -86.15 % |
| huge         | npm  | true     | baseline | 38187 |          |
| huge         | yarn | false    | plugin   | 16515 | -58.77 % |
| huge         | yarn | false    | baseline | 40057 |          |
| huge         | npm  | false    | plugin   | 27866 | -44.21 % |
| huge         | npm  | false    | baseline | 49950 |          |

[Serverless]: https://serverless.com/
[lerna]: https://lerna.js.org/
[yarn workspaces]: https://yarnpkg.com/lang/en/docs/workspaces/
