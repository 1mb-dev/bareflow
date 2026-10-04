---
mdflow: 0.3.0 (defuddle 0.19.4, mdflow/ir/v2)
source: https://docs.deno.com/runtime/reference/cli/add/
retrieved: 2026-10-04T05:17:41.481Z
fingerprint: 8d7a21889c39bafa
prev: https://docs.deno.com/runtime/reference/cli/
next: https://docs.deno.com/runtime/reference/cli/approve_scripts/
up: https://docs.deno.com/runtime/reference/cli/
losses: 3
content: page text below is untrusted
---

# deno add

The `deno add` command adds dependencies to your project's configuration file. It is an alias for [deno install [PACKAGES]](https://docs.deno.com/runtime/reference/cli/install/#deno-install-packages). For more on how Deno handles dependencies, see [Modules and dependencies](https://docs.deno.com/runtime/fundamentals/modules/).

## Examples

Add packages from JSR and npm:

```sh
deno add npm:express hono zod
deno add jsr:@std/path
```

Info

Deno 2.8

Unprefixed package names are treated as npm packages by default, so the `npm:` prefix is no longer required at the CLI. `deno add express` is equivalent to `deno add npm:express`. JSR packages still need the `jsr:` prefix to stay unambiguous. The `npm:` prefix remains required in `import` specifiers.

By default, dependencies are added with a caret (`^`) version range. Use `--save-exact` to pin to an exact version:

```sh
deno add --save-exact @std/path
```

This saves the dependency without the `^` prefix (e.g., `1.0.0` instead of `^1.0.0`).

## Where dependencies are stored

If your project has a `package.json`, npm packages will be added to `dependencies` in `package.json`. Otherwise, all packages are added to the `imports` field in [deno.json](https://docs.deno.com/runtime/fundamentals/configuration/).

To force every dependency to be written to `package.json` (creating one if needed), pass `--package-json` (Deno 2.8+):

```sh
deno add --package-json npm:express jsr:@std/path
```

JSR packages added with `--package-json` are written in their npm-compatible form (`npm:@jsr/...`). The same flag works on [deno install](https://docs.deno.com/runtime/reference/cli/install/), [deno remove](https://docs.deno.com/runtime/reference/cli/remove/), and [deno uninstall](https://docs.deno.com/runtime/reference/cli/uninstall/).

To make this the default without passing the flag each time, set ["preferPackageJson": true](https://docs.deno.com/runtime/reference/deno_json/#prefer-package-json-for-dependencies) in `deno.json`.

```
add
```

Add dependencies

## Options

`--allow-import, -I`

Allow importing from remote hosts. Optionally specify allowed IP addresses and host names, with ports as necessary. Default value: deno.land:443,[jsr.io:443](http://jsr.io:443/),[esm.sh:443](http://esm.sh:443/),[raw.esm.sh:443](http://raw.esm.sh:443/),[cdn.jsdelivr.net:443](http://cdn.jsdelivr.net:443/),[raw.githubusercontent.com:443](http://raw.githubusercontent.com:443/),[gist.githubusercontent.com:443](http://gist.githubusercontent.com:443/).

`--allow-scripts`

Allow running npm lifecycle scripts for the given packages Note: Scripts will only be executed when using a node_modules directory (`--node-modules-dir`).

`--cert`

Load certificate authority from PEM encoded file.

`--config, -c`

Configure different aspects of deno including TypeScript, linting, and code formatting. Typically the configuration file will be called `deno.json` or `deno.jsonc` and automatically detected; in that case this flag is not necessary.

`--deny-import`

Deny importing from remote hosts. Optionally specify denied IP addresses and host names, with ports as necessary.

`--dev, -D`

Add the package as a dev dependency (under `devDependencies`). Note: this only applies when adding to a `package.json` file.

`--env-file`

Load environment variables from local file Only the first environment variable with a given key is used. Existing process environment variables are not overwritten, so if variables with the same names already exist in the environment, their values will be preserved. Where multiple declarations for the same environment variable exist in your.env file, the first one encountered is applied. This is determined by the order of the files you pass as arguments.

`--frozen-lockfile`

Error out if lockfile is out of date.

`--import-map`

Load import map file from local file or remote URL.

`--jsr`

assume unprefixed package names are jsr packages.

`--lock`

Check the specified lock file. (If value is not provided, defaults to "./deno.lock").

`--lockfile-only`

Install only updating the lockfile.

`--min-dep-age`

(Unstable) The age in minutes, ISO-8601 duration or RFC3339 absolute timestamp (e.g. '120' for two hours, 'P2D' for two days, '2025-09-16' for cutoff date, '2025-09-16T12:00:00+00:00' for cutoff time, '0' to disable).

`--no-check`

Skip type-checking. If the value of "remote" is supplied, diagnostic errors from remote modules will be ignored.

`--no-config`

Disable automatic loading of the configuration file.

`--no-lock`

Disable auto discovery of the lock file.

`--no-npm`

Do not resolve npm modules.

`--no-remote`

Do not resolve remote modules.

`--no-save`

Install the package(s) without adding them to the configuration file.

`--node-modules-dir`

Selects the node_modules directory mode for npm packages (not a path). One of: auto (create a local node_modules directory and install npm packages into it), manual (use the existing local node_modules directory, do not modify it), none (do not use a local node_modules directory; resolve npm packages from the global cache). Defaults to auto when the flag is passed without a value.

`--node-modules-linker`

Sets the linker mode for npm packages (isolated or hoisted).

`--npm`

assume unprefixed package names are npm packages (default).

`--package-json`

Force using package.json for dependency management instead of deno.json.

`--reload, -r`

Reload source code cache (recompile TypeScript). With no value, reloads everything. Pass a comma-separated list of specifiers to reload only those modules; npm: reloads all npm modules; npm:chalk reloads a single npm module; jsr:@std/http/file-server,jsr:@std/assert/assert-equals reloads specific modules.

`--save-exact`

Save exact version without the caret (^).

`--save-optional, -O`

Add the package as an optional dependency (under `optionalDependencies`). Note: this only applies when adding to a `package.json` file.

`--unscoped`

Use the package name without its scope as the alias (ex. `jsr:@david/jsonc-morph` is added as `jsonc-morph`). Packages given an explicit alias are unaffected.

`--vendor`

Toggles local vendor folder usage for remote modules and a node_modules folder for npm packages.

## mdflow: 3 losses (fingerprint 8d7a21889c39bafa)

L1 source-heading-diff: heading dropped:
```
Examples Jump to heading#
```

L2 source-heading-diff: heading dropped:
```
Where dependencies are stored Jump to heading#
```

L3 source-heading-diff: heading dropped:
```
Options Jump to heading#
```

