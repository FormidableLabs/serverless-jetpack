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

It is a best practice to use lockfiles (`yarn.lock` or `package-lock.json`) generally, and specifically important for the approach this plugin takes because it does **new** `yarn|npm` installs into a temporary directory. Without lockfiles you may be packaging/deploying something _different_ from what is in the root project.

To this end, the plugin assumes that a lockfile is provided by default and you must explicitly set the option to `lockfile: null` to avoid having a lockfile copied over. When a lockfile is present then the strict (and fast!) `yarn install --frozen-lockfile  --production` and `npm ci --production` commands are used to guarantee the packaged `node_modules` matches the relevant project modules. And, the installs will **fail** (by design) if the lockfile is out of date.

**Monorepos and lockfiles**

Many projects use features like [yarn workspaces][] and/or [lerna][] to have a large root project that then has many separate serverless functions/packages in separate directories. In cases like these, the relevant lock file may not be in something like `packages/NAME/yarn.lock`, but instead at the project root like `yarn.lock`.

In cases like these, simply set the `lockfile` option to relatively point to the appropriate lockfile (e.g., `lockfile: ../../yarn.lock`).

**`npm install` vs `npm ci`**

`npm ci` was introduced in version [`5.7.0`](https://blog.npmjs.org/post/171139955345/v570). Notwithstanding the general lockfile logic discussed above, if the plugin detects an `npm` version prior to `5.7.0`, the non-locking, slower `npm install --production` command will be used instead.

## Benchmarks

The following is a simple, "on my machine" benchmark generated with `yarn test:benchmark`. It should not be taken to imply any real world timings, but more to express relative differences in speed using the `serverless-jetpack` versus the built-in baseline Serverless framework packaging logic.

When run with a lockfile (producing the fastest `yarn|npm` install) our scenarios produce over a 4x speedup for `serverless-jetpack` over built-in packaging.

| Scenario     | Mode | Lockfile | Type     |  Time |
| :----------- | :--- | :------- | :------- | ----: |
| simple       | yarn | true     | jetpack  |  5726 |
| simple       | yarn | true     | baseline |  6510 |
| simple       | yarn | false    | jetpack  |  6203 |
| simple       | yarn | false    | baseline |  6081 |
| simple       | npm  | true     | jetpack  |  5407 |
| simple       | npm  | true     | baseline |  6742 |
| simple       | npm  | false    | jetpack  |  8597 |
| simple       | npm  | false    | baseline |  7438 |
| individually | yarn | true     | jetpack  |  5856 |
| individually | yarn | true     | baseline | 11325 |
| individually | yarn | false    | jetpack  |  6974 |
| individually | yarn | false    | baseline | 10414 |
| individually | npm  | true     | jetpack  |  6430 |
| individually | npm  | true     | baseline | 11778 |
| individually | npm  | false    | jetpack  |  9536 |
| individually | npm  | false    | baseline | 12550 |
| huge         | yarn | true     | jetpack  |  6304 |
| huge         | yarn | true     | baseline | 25895 |
| huge         | yarn | false    | jetpack  | 13842 |
| huge         | yarn | false    | baseline | 94972 |
| huge         | npm  | true     | jetpack  |  6803 |
| huge         | npm  | true     | baseline | 28672 |
| huge         | npm  | false    | jetpack  | 24700 |
| huge         | npm  | false    | baseline | 29956 |

[Serverless]: https://serverless.com/
[lerna]: https://lerna.js.org/
[yarn workspaces]: https://yarnpkg.com/lang/en/docs/workspaces/