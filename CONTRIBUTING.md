Contributing
============

Thanks for contributing!

## Development

We manage dependencies using `npm`. Note that for the time being, our development tools assume a Unix-like environment, which means Mac, Linux, or something like the Windows Subsystem for Linux.

Our development revolves around various fixture packages we have in `test`. Get set up with:

```sh
$ npm install

# If not changing deps
$ npm run benchmark:ci
# If changing deps
$ npm run benchmark:install
```

to install the root project and a lot of fixture packages. (This is **meant** to take a while as we install a lot of dependencies to give us sizable app simulations to work with...) You will need to re-run `benchmark:install` whenever you update dependencies inside `test/` packages.

Our present fixture setup is:

```
$ tree test/packages/ -L 2
test/packages/
├── complex
│   ├── npm
│   └── yarn
└── simple
    ├── npm
    └── yarn
```

**Note**: Only **some** of the scenarios contribute to the timed benchmark results as some scenarios don't actually use either built-in Serverless or Jetpack packaging.

For ease of development, we want to do `npm run benchmark:ci`/`npm run benchmark:install` and install the respective yarn/npm packages **once**. However, this means we keep duplicates of source code / package.json files across the `npm`/`yarn` variant directories. To keep things in sync, we designate the `yarn` directory as "the source of truth" for everything except for `SCENARIO/npm/package-lock.json` and copy files across scenarios with:

```sh
$ npm run benchmark:build
```

From there you can run various packaging configurations and perform benchmarks.

```sh
$ TEST_SCENARIO=simple npm run benchmark
$ TEST_SCENARIO=simple,complex npm run benchmark

# Faster, because scenarios run in parallel, but less reliable results because
# of impact on your machine. Use this for faster development, but do a normal
# serial benchmark for pasting results.
# ... using all CPU cores
$ npm run benchmark --parallel
# ... or set the level of concurrency manually
$ npm run benchmark --concurrency=2
```

After this, we can run benchmark specific QA stuff:

```sh
$ npm run benchmark:test
```

(The `lint` needs the individual installs and `test` needs file list output from a full benchmark).

## Checks

### Fast stuff

Run these often -- unit tests and lint:

```sh
$ npm run lint
$ npm run test

# ... or all together ...
$ npm run run check
```

### Slow stuff

Run these before a PR and when changing things / kicking tires...

*Requirements*: For CLI and benchmark tests...

```sh
# Install once (or on changes to dependencies or fixtures)
$ npm run benchmark:ci # or npm run benchmark:install if changing deps
$ npm run benchmark:build
```

*CLI tests*: Use the fixtures

```sh
$ npm run test:cli
```

*Benchmark tests*: Run the benchmark to gather data and assess correctness of packages vs. real Serverless.

```sh
$ npm run benchmark
$ npm run benchmark:test
```

*Serverless Enterprise*: Unfortunately, these tests require a login account and special `SERVERLESS_ACCESS_KEY` environment variable. The Jetpack project has two active tokens for `localdev` and `ci`. You can enable these and our `dashboard` tests with something like:

```sh
$ SERVERLESS_ACCESS_KEY="<INSERT_HERE>" npm run benchmark
$ SERVERLESS_ACCESS_KEY="<INSERT_HERE>" npm run benchmark:test
```

## Before submitting a PR...

Before you go ahead and submit a PR, make sure that you have done the following:

```sh
# Update the documentation TOCs (and commit changes).
$ npm run run build

# Run lint and unit tests
$ npm run run check

# Make sure all fixtures are updated and valid
$ npm run benchmark:install
$ npm run benchmark:ci
$ npm run benchmark:build

# After this, you can run the CLI tests which use real fixtures in E2E scenarios
# They're relatively slow (several seconds a test), but nowhere near as slow
# as the benchmark.
$ npm run test:cli

# Run a benchmark.
# Then, actually generate the benchmark.
# _Note_: Unfortunately, this takes some **time**. Grab a ☕
$ npm run benchmark
# Now, test the benchmark for correctness.
$ npm run benchmark:test

# If the timed benchmark stats and/or usage is notably different
# than what's in README.md, update relevant sections and commit your changes.
$ vim README.md

# Run all final checks.
$ npm run run check
```

### Using changesets

Our official release path is to use automation to perform the actual publishing of our packages. The steps are to:

1. A human developer adds a changeset. Ideally this is as a part of a PR that will have a version impact on a package.
2. On merge of a PR our automation system opens a "Version Packages" PR.
3. On merging the "Version Packages" PR, the automation system publishes the packages.

Here are more details:

### Add a changeset

When you would like to add a changeset (which creates a file indicating the type of change), in your branch/PR issue this command:

```sh
$ npm run changeset
```

to produce an interactive menu. Navigate the packages with arrow keys and hit `<space>` to select 1+ packages. Hit `<return>` when done. Select semver versions for packages and add appropriate messages. From there, you'll be prompted to enter a summary of the change. Some tips for this summary:

1. Aim for a single line, 1+ sentences as appropriate.
2. Include issue links in GH format (e.g. `#123`).
3. You don't need to reference the current pull request or whatnot, as that will be added later automatically.

After this, you'll see a new uncommitted file in `.changesets` like:

```sh
$ git status
# ....
Untracked files:
  (use "git add <file>..." to include in what will be committed)
	.changeset/flimsy-pandas-marry.md
```

Review the file, make any necessary adjustments, and commit it to source. When we eventually do a package release, the changeset notes and version will be incorporated!

### Creating versions

On a merge of a feature PR, the changesets GitHub action will open a new PR titled `"Version Packages"`. This PR is automatically kept up to date with additional PRs with changesets. So, if you're not ready to publish yet, just keep merging feature PRs and then merge the version packages PR later.

### Publishing packages

On the merge of a version packages PR, the changesets GitHub action will publish the packages to npm.

### Manually Releasing a new version to NPM

<details>
<summary>
<i>Only for project administrators</i>
</summary>

1. Update `CHANGELOG.md`, following format for previous versions
2. Commit as "Changes for version VERSION"
3. Run `npm version patch` (or `minor|major|VERSION`) to run tests and lint,
   build published directories, then update `package.json` + add a git tag.
4. Run `npm publish` and publish to NPM if all is well.
5. Run `git push && git push --tags`

</details>