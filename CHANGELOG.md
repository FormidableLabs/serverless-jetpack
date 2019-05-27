Changes
=======

## UNRELEASED

**API**

* Add custom options `base` and `roots` for better monorepo/workspaces support.
  [#26](https://github.com/FormidableLabs/serverless-jetpack/pull/26)

**Behavior**

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
