Contributing
============

Thanks for contributing!

## Development

Our development revolves around various fixture packages we have in `test`. First, get set up with:

```sh
$ yarn
$ yarn benchmark:install
```

to install the root project and a lot of fixture packages. (This is **meant** to take a while as we install a lot of dependencies to give us sizable app simulations to work with...) You will need to re-run `benchmark:install` whenever you update dependencies inside `test/` packages.

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

For ease of development, we want to do `yarn benchmark:install` and install the respective yarn/npm packages **once**. However, this means we keep duplicates of source code / package.json files across the `npm`/`yarn` variant directories. To keep things in sync, we designate the `yarn` directory as "the source of truth" for everything except for `SCENARIO/npm/package-lock.json` and copy files across scenarios with:

```sh
$ yarn benchmark:build
```

From there you can run various packaging configurations and perform benchmarks.

```sh
$ TEST_MODE=yarn TEST_SCENARIO=simple yarn benchmark
$ TEST_MODE=yarn TEST_SCENARIO=simple,huge yarn benchmark
$ TEST_MODE=yarn,npm TEST_SCENARIO=simple yarn benchmark
```

### QA

```sh
$ yarn run lint
$ yarn run test

# ... or all together ...
$ yarn run check
```

## Before submitting a PR...

Before you go ahead and submit a PR, make sure that you have done the following:

```sh
# Run lint and unit tests
$ yarn run check

# Make sure all fixtures are updated and valid
$ yarn run benchmark:install
$ yarn run benchmark:build

# Run a benchmark.
# First, check that `npm` versions is 5.7.0+ (which has `npm ci`).
$ npm --version
# Then, actually generate the benchmark.
# _Note_: Unfortunately, this takes some **time**. Grab a ☕
$ yarn run benchmark
# Now, test the benchmark for correctness.
$ yarn run test:benchmark

# Generate the usage message.
$ yarn run usage

# If the benchmark stats and/or the usage message are notably different than
# what's in README.md, update relevant sections and commit your changes.
$ vim README.md

# Run all final checks.
$ yarn run check
```

## Releasing a new version to NPM

_Only for project administrators_.

1. Update `HISTORY.md`, following format for previous versions
2. Commit as "History for version NUMBER"
3. Run `npm version patch` (or `minor|major|VERSION`) to run tests and lint,
   build published directories, then update `package.json` + add a git tag.
4. Run `npm publish` and publish to NPM if all is well.
5. Run `git push && git push --tags`
