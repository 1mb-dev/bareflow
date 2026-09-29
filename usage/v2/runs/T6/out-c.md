# Ruff VS Code extension vs CLI: different formatting (hugging braces) from the same ruff.toml

## Why it happens

The VS Code extension does not run your project's `ruff` binary by default; it bundles its own vendored Ruff build and uses that unless you tell it otherwise [memory]. Ruff has stated its formatter is not guaranteed stable across versions until 1.0, so two different Ruff versions can produce different output from the identical `ruff.toml` [memory]. "Hugging braces" (a single list/dict/set argument formatted tight against the call's parens instead of exploded onto its own indented line) is exactly this kind of feature: it's the `hug_parens_with_braces_and_square_brackets` preview-style behavior, the same name and idea as Black's preview feature of the same purpose [memory]. Because it lives behind Ruff's `preview` flag, whether you see it depends on (a) which Ruff version is actually running, since preview features move to stable at different times across releases, and (b) whether `preview` is turned on for that specific invocation [memory].

Concretely, four things can cause "same toml, different output":

1. **Version skew.** The extension's bundled Ruff is not the `ruff` your CLI resolves to (PATH, venv, pinned dependency). Different version, different formatter behavior, identical config file [memory].
2. **Preview mismatch.** `ruff.toml` sets `preview = true`, or the extension injects `--preview`/`--no-preview` via a `ruff.format.args` setting, for one path but not the other [memory].
3. **Config discovery mismatch.** Ruff walks up from the file being formatted and uses the single nearest config file; it does not merge configs found at multiple levels. If the CLI runs from a different working directory than the file VS Code is editing, or another `ruff.toml`/`pyproject.toml` up or down the tree wins, the two tools can be reading different config even though you believe it's "the same file" [memory].
4. **Editor-setting override.** The extension's `ruff.configurationPreference` setting controls whether VS Code's own `ruff.*` settings take precedence over the on-disk `ruff.toml`/`pyproject.toml`. If it isn't set to prefer the filesystem config, values in `.vscode/settings.json` can silently override the toml [memory].

## How to make them match

**1. Pin one Ruff version and point both tools at it.**

Pin `ruff` as an exact-version dev dependency so `ruff --version` on the CLI is deterministic. Then stop the extension from using its bundled copy, in `.vscode/settings.json`:

```json
{
  "ruff.importStrategy": "fromEnvironment",
  "ruff.interpreter": ["${workspaceFolder}/.venv/bin/python"]
}
```

or pin the binary directly:

```json
{ "ruff.path": ["${workspaceFolder}/.venv/bin/ruff"] }
```

Confirm by checking the version the extension actually launched (VS Code Output panel -> "Ruff" channel logs it on startup) against `ruff --version` [memory].

**2. Make `preview` explicit in the config, not implicit via flags.**

If you want hugging braces, put it in the toml so both tools see identical behavior:

```toml
[format]
preview = true
```

Then check both workspace and user `.vscode/settings.json` for `ruff.format.args` / `ruff.lint.args` injecting `--preview` or `--no-preview`, and remove them so the config file is the single source of truth [memory].

**3. Force the filesystem config to win over editor settings.**

```json
{ "ruff.configurationPreference": "filesystemFirst" }
```

This makes the extension defer to `ruff.toml`/`pyproject.toml` instead of any conflicting `ruff.*` values set in VS Code [memory].

**4. Rule out multiple config files.**

Run `ruff format --diff <path-to-file>` from the same directory VS Code treats as the workspace root, on the exact file that looks wrong. Check for a second `ruff.toml`, or a `pyproject.toml` with a `[tool.ruff]` section, closer to that file, since Ruff uses only the nearest one rather than merging [memory].

**5. Re-verify.**

With matched version, matched preview setting, and confirmed single config file, re-run `ruff format --diff` and reload the file in the editor; the diff between the two paths should be empty.

If it still isn't, that's informative on its own: it means the divergence isn't config or version, but a genuine behavior difference between the language-server formatting path and the CLI's `ruff format`, worth filing upstream with `ruff --version`, the `ruff.toml`, and a minimal repro [memory].
