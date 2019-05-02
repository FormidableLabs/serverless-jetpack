Serverless Jetpack
==================

A faster JavaScript packager for [Serverless][] applications.

## Overview

The Serverless framework is a **fantastic** one-stop-shop for taking your code and packing up all the infrastructure around it to deploy it to the cloud. Unfortunately, for many JavaScript applications, some aspects of packaging are slow, hindering development speed and happiness.

With the `serverless-jetpack` plugin, many common, slow Serverless packaging scenarios can be dramatically sped up.

## Usage

TODO_INSERT_USAGE

## How it works

The Serverless framework can sometimes massively slow down when packaging applications with large amounts / disk ussage for `devDependencies`. Although the framework enables `excludeDevDependencies` during packaging by default, just ingesting all the files that are later excluded (via that setting and normal `include|exclude` globs) causes apparently enough disk I/O to make things potentially slow.

Observing that a very common use case for a Serverless framework is:

- A `package.json` file defining production and development dependencies.
- A `yarn.lock` file if using `yarn` or a `package-lock.json` file if using `npm` to lock down and speed up installations.
- One or more JavaScript source file directories, typically something like `src`.

The `serverless-jetpack` plugin leverages this use case and gains a potentially significant speedup by observing that manually pruning development dependencies (as Serverless does) can be much, much slower in practice than using honed, battle-tested tools like `yarn` and `npm` to install just the production dependencies from scratch -- by doing a fresh `yarn|npm install` in a temporary directory, copying over source files and zipping that all up!

Process-wise, the `serverless-jetpack` plugin uses the internal logic from Serverless packaging to detect when Serverless would actually do it's own packaging. Then, it inserts its different packaging steps and copies over the analogous zip file to where Serverless would have put it, and sets internal Serverless state to point to that artifact and skip the built-in Serverless packaging.

## Benchmarks

TODO_INSERT

## Development

Our development revolves around various fixture packages we have in `test`. First, get setup with:

```sh
$ yarn
$ yarn test:install
```

to install the root project and a lot of fixture packages. (This is **meant** to take a while as we install a lot of dependencies to give us sizable app simulations to work with...) You will need to re-run `test:install` whenever you update dependencies inside `test/` packages.

Our present fixture setup is:

```
$ tree test/packages/ -L 2
test/packages/
├── huge
│   ├── npm
│   └── yarn
├── individually
│   ├── npm
│   └── yarn
└── simple
    ├── npm
    └── yarn
```

For ease of development, we want to do `yarn test:install` and install the respective yarn/npm packages **once**. However, this means we keep duplicates of source code / package.json files across the `npm`/`yarn` variant directories. To keep things in sync, we designate the `yarn` directory as "the source of truth" for everything except for `SCENARIO/npm/package-lock.json` and copy files across scenarios with:

```sh
$ yarn test:build
```

From there you can run various packaging configurations and perform benchmarks.

```sh
$ TEST_MODE=yarn TEST_SCENARIO=simple yarn test:benchmark
$ TEST_MODE=yarn TEST_SCENARIO=simple,huge yarn test:benchmark
$ TEST_MODE=yarn,npm TEST_SCENARIO=simple yarn test:benchmark
```

[Serverless]: https://serverless.com/
