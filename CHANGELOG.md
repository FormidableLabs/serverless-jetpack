Changes
=======

## UNRELEASED

* Add `jetpack package --report` option for patterns and files report.

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
