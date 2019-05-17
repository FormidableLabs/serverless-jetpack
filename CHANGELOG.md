Changes
=======

## UNRELEASED

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
