Changes
=======

## 0.11.1

* Chore: Add plugin options types for serverless v3.
  [#206](https://github.com/FormidableLabs/trace-pkg/issues/206)
  (*[XuluWarrior][]*)

## 0.11.0

* Feature: Add full support for modern Node.js ESM and `exports`.
* Deps: Upgrade more various dependencies.
* Deps: Update various production and development dependencies.
  [#254](https://github.com/FormidableLabs/serverless-jetpack/pull/254)

## 0.10.9

* Bug: Handle special characters in filenames like `[...id].js` during tracing.
* Deps: Upgrade `globby` to `v11`.

## 0.10.8

* Feature: Support application source paths as keys in `jetpack.trace.allowMissing`.

## 0.10.7

* Internal: Refactor inefficient JavaScript object usage in `reduce()`.
  [#121](https://github.com/FormidableLabs/serverless-jetpack/pull/121)
  [#123](https://github.com/FormidableLabs/serverless-jetpack/pull/123)
  (*[@gabmontes][]*)

## 0.10.6

* Bug: Fix process hang on errors when using `concurrency: 2+` by properly ending worker.

## 0.10.5

* Feature: Add `jetpack.trace.dynamic.bail` option.
* Feature: Add `jetpack.trace.dynamic.resolutions` option.
* Internal: Minor refactor of patterns passed for trace includes to globbing handlers. Also standardize options passed to `globby()` across different functions.
* Internal: Enhance and refactor trace miss logging as well as the `--report` format for trace misses to collapse packages.

## 0.10.4

* Misc: Add better collapsed packages log information.

## 0.10.3

* Feature: Add log warnings and `--report` information for missed dynamic imports in tracing mode.
* Bug: Fix `--report` on collapsed sources and dependencies.

## 0.10.2

* Feature: Detect and issue warnings for collapsed files in package. Add `jetpack.collapsed.bail` option to kill serverless on detected conflicts.
  [#109](https://github.com/FormidableLabs/serverless-jetpack/pull/109)

## 0.10.1

* Add `jetpack.trace.allowMissing` configuration option.

## 0.10.0

* Add dependency tracing feature and `jetpack.trace` configuration options.
* Test: Change `test/packages/webpack` into a comparison scenario for trace mode rather than testing that it doesn't conflict with Jetpack.

## 0.9.0

* Bug: Only package Node.js `runtime` service + functions.
  [#89](https://github.com/FormidableLabs/serverless-jetpack/pull/89)
* Infra: Add CircleCI.

## 0.8.1

* Upgrade production dependencies (`jest-worker`, and other minor/patches).
  [#80](https://github.com/FormidableLabs/serverless-jetpack/pull/80)

## 0.8.0

* Feature: Make builds deterministic like `serverless` to avoid unneeded re-deploys.
  [#7](https://github.com/FormidableLabs/serverless-jetpack/pull/7)

## 0.7.0

* BUG: Hack a fix to generate wrapper files like `ServerlessEnterprisePlugin` does.
  [#67](https://github.com/FormidableLabs/serverless-jetpack/pull/67)
* Infra: Add node13 to Travis CI matrix. Bump Appveyor to node10.
* Deps: Update to `serverless@^1.57.0` in all scenarios. Refactor local path plugins to use new syntax.

## 0.6.0

* README: Fix incorrect language about `foo` vs `foo/**`. See [`fast-glob` notes](https://github.com/mrmlnc/fast-glob#how-to-exclude-directory-from-reading).
* Add custom option `preInclude` for better monorepo/workspaces support.
* Add `jetpack package --report` option for patterns and files report.
* Refactor internal pattern matching in `nanomatch()` phase.

## 0.5.0

* Add support for Lambda Layers packaging in Jetpack.
  [#42](https://github.com/FormidableLabs/serverless-jetpack/pull/42)
* BUG: Properly exclude layers sources from normal function packages.

## 0.4.1

* BUG: Publish missing `util` directory.

## 0.4.0

* Add `concurrency` configuration option to run packaging off main thread and in parallel.
  [#33](https://github.com/FormidableLabs/serverless-jetpack/pull/33)
  [#34](https://github.com/FormidableLabs/serverless-jetpack/pull/34)

## 0.3.3

* Add CLI options for `serverless jetpack package`.
  [#35](https://github.com/FormidableLabs/serverless-jetpack/pull/35)
* BUG: Don't package service if `serverless deploy -f {NAME}` is specified.

## 0.3.2

* Add support for `deploy -f {NAME}` to (1) hook in `jetpack` to overtake built-in packaging and (2) limit builds to just the function if `individually` or just the service if not.

## 0.3.1

* Remove unnecessary `commands` in constructor as we have no actual CLI yet.

## 0.3.0

**API**

* Add custom options `base` and `roots` for better monorepo/workspaces support.
  [#26](https://github.com/FormidableLabs/serverless-jetpack/pull/26)

**Behavior**

* Process functions in serial to reduce system resource contention and typically make overall process faster.
* Add automatic exclusion of `devDependencies` in traversed directories outside of the root.

**Test**

* Add `monorepo` test scenario.

## 0.2.1

* Add a `mkdir -p` equivalent of the directory containing the output bundle same as `serverless` built-in packaging behavior.
  [#30](https://github.com/FormidableLabs/serverless-jetpack/pull/30)
  [#31](https://github.com/FormidableLabs/serverless-jetpack/pull/31)

## 0.2.0

**BREAKING**

* Replace strategy of `yarn|npm install --production` in a temporary directory with better, faster production dependency inference via `inspectdep`.
* Change the API to take no `custom` options.

## 0.1.2

* Add better exec support for yarn|npm on windows.
  [#27](https://github.com/FormidableLabs/serverless-jetpack/pull/27)
* Add `--no-progress` flag to `npm|yarn` installs.
  [#25](https://github.com/FormidableLabs/serverless-jetpack/issues/25)

## 0.1.1

* Add debug log message if no service or function `package` configurations apply.

## 0.1.0

* Initial release.

[@gabmontes]: https://github.com/gabmontes
[@XuluWarrior]: https://github.com/XuluWarrior
