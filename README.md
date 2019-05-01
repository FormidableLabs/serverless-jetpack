TODO_INSERT_NAME
================

A faster JavaScript packager for [Serverless][] applications.

## Overview

TODO_INSERT_OVERVIEW

## Usage

TODO_INSERT_USAGE

## How it works

TODO_INSERT

## Benchmarks

TODO_INSERT

## Development

Our development revolves around various fixture packages we have in `test`. First, get setup with:

```sh
$ yarn
$ yarn install:test
```

to install the root and a lot of fixture packages. (This is **meant** to take a while as we install a lot of dependencies to give us sizable app simulations to work with...) You will need to re-run `install:test` whenever you update dependencies inside `test/` packages.

From there you can run various packaging configurations and perform benchmarks.

```sh
# Show all computed scenario sls configurations
$ yarn sls:config

# Package everything with timings.
$ yarn sls:package
```

- [ ] Note how to generate a benchmark.
- [ ] Note examples of all permutations for the fixtures.

[Serverless]: https://serverless.com/
