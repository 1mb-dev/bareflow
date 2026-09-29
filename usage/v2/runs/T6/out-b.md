# Why the VS Code Ruff extension and the ruff CLI disagree with the same ruff.toml

## Root cause: it's almost never the config file, it's what's reading it

Three independent things can differ between "VS Code extension" and "CLI binary" even though both claim to load the same `ruff.toml`:

### 1. Different Ruff versions
The Ruff formatter is not style-frozen release to release: Ruff explicitly ships formatting changes behind a `preview` flag and later promotes them to the stable style in a minor release [doc] (e.g. f-string expression formatting was preview-only, then "Stabilized in Ruff 0.9.0" [doc]). If the extension and the CLI are running different Ruff versions, one may have already promoted a bracket/brace-placement change to stable while the other still treats it as preview-only (or doesn't have it at all). Same `ruff.toml`, different formatter binary, different output.

The VS Code extension does not automatically use whatever `ruff` is on your PATH or in your project's venv - by default it runs a copy of Ruff bundled inside the extension itself, controlled by the `ruff.importStrategy` setting (`"useBundled"` vs `"fromEnvironment"`) [memory]. That bundled copy is pinned to whatever version shipped with the extension release you have installed, which is very often not the same patch (or even minor) version as the `ruff` binary you get from `pip`/`uv`/`cargo`/homebrew on the CLI [memory].

### 2. Preview mode enabled on only one side
"Hugging braces" - collapsing a call's opening bracket against a single collection-literal argument instead of putting it on its own indented line - is the kind of change Ruff ships under preview mode before it's stable [memory]. The doc's own example of a preview-only layout change is the "Fluent layout for method chains" feature, which is explicitly a preview-mode diff from the stable style: preview breaks *before* the leading attribute, stable breaks *after* the call/subscript [doc]. Bracket-hugging behavior falls in the same bucket - a preview-mode formatting decision, not part of the stable style shown in the doc's baseline example [doc].

So if:
- your `ruff.toml` doesn't set `preview = true` (the doc's own config example has no `preview` key at all [doc]), but
- the extension's bundled Ruff version has already promoted the hugging behavior to stable, or the extension is invoking Ruff with an implicit/leftover `--preview`-equivalent setting,

...the two outputs diverge even though the config text is identical.

### 3. Extension isn't reading the same config file at all
The extension has its own `ruff.configuration` setting that can pin an explicit config path. If that's set (or stale), or the extension's working directory/workspace root doesn't match where you run `ruff format` from, it may resolve a *different* `ruff.toml`/`pyproject.toml`, or fall back to Ruff's built-in defaults, none of the settings in your file (quote style, line width, `[format]` block, etc. [doc]) apply on that side [memory].

## How to make them match

1. **Pin both sides to the identical Ruff binary/version.**
   In `.vscode/settings.json`:
   ```json
   {
     "ruff.importStrategy": "fromEnvironment"
   }
   ```
   This tells the extension to use the `ruff` installed in your active Python environment (the same one the CLI resolves) instead of its bundled copy [memory]. If you don't use a venv-managed install, set `ruff.path` to point at the exact CLI binary:
   ```json
   {
     "ruff.path": ["/absolute/path/to/ruff"]
   }
   ```
   Verify: run `ruff --version` in your terminal, then open the "Ruff" output channel in VS Code (Output panel dropdown) - it logs the executable path and version it loaded at startup. They must match exactly, including patch version [memory].

2. **Make the preview flag explicit and identical, don't rely on defaults.**
   In your `ruff.toml`:
   ```toml
   [format]
   preview = false   # or true, but pick one, deliberately
   ```
   (or `[tool.ruff] preview = true/false` if you use `pyproject.toml` - Ruff's config layout mirrors the `[tool.ruff]` / `[tool.ruff.format]` split shown in the doc [doc]). Confirm no stray CLI flag (`ruff format --preview`) or extension setting (`ruff.format.args`) is forcing preview on one side only [memory].

3. **Make sure both sides discover the same config file.**
   Don't set `ruff.configuration` in VS Code settings unless it points at the exact same `ruff.toml` the CLI uses. Otherwise let both discover config the normal way (walking up from the file being formatted), and run the CLI from the same directory VS Code has open as the workspace root [memory].

4. **Reload after changing settings.**
   Reload the VS Code window (or restart the Ruff language server via the command palette) so it re-reads `ruff.importStrategy`/`ruff.path` and re-resolves the config file instead of running against a cached session [memory].

Once the extension is running the *same Ruff binary* against the *same config file* with the *same preview flag* as your terminal's `ruff format`, output will match, since both are just invocations of the same formatter logic [doc: "ruff format is the primary entrypoint to the formatter" - the extension's format-on-save is documented to shell out to the same formatting engine, not a separate implementation].

## Marking key

- [doc]: from the attached Ruff Formatter documentation page.
- [memory]: from general knowledge of the Ruff VS Code extension (`charliermarsh.ruff`) and Ruff's preview-mode mechanics; the attached doc does not cover the VS Code extension, its settings, or the specific "hug brackets" feature name.
