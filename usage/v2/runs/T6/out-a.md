# Why the Ruff VS Code extension formats differently from the `ruff` CLI (brace/bracket "hugging"), and how to align them

## Root cause

1. **Two independent `ruff` binaries.** The Ruff VS Code extension (`charliermarsh.ruff`) bundles and runs its own native `ruff` binary by default -- separate from whatever `ruff` your terminal resolves (installed via pip/uv/pipx/homebrew into a project or venv). Nothing forces these two to be the same version unless you configure it. [memory]

2. **Formatting style is versioned, not only config-driven.** Ruff's formatter deliberately evolves: new style changes land behind a `preview` flag and get "promoted to stable through minor releases" [doc]. So the *same* `ruff.toml`, run through two different `ruff` versions, can legitimately produce different stable output, because what counts as "stable style" changed between those releases [doc]. Brace/bracket "hugging" around a sole function argument (e.g. `foo(**{\n    ...\n})` instead of wrapping the dict on its own indented line) is exactly this kind of preview-gated style change, mirroring Black's own `hug_parens_with_braces_and_square_brackets` preview feature -- it has moved between preview and stable across Ruff releases. [memory] If the CLI binary and the extension's bundled binary sit on different minor versions, one can have that behavior stabilized while the other still has it in preview (or lacks it), producing visibly different output from the same `ruff.toml`. [memory]

3. **Preview mode can diverge between the two invocations even with "the same" config file.** The toggle lives under `[tool.ruff.format]` / `[format]` as the `preview` key (`format.preview` setting) [doc], but the VS Code extension layers its own settings on top (`ruff.format.args`, `ruff.configuration`, per-workspace `settings.json`) and can resolve a different config file or workspace root than the CLI does from your shell's cwd. [memory] "Same `ruff.toml`" on disk doesn't guarantee both tools are actually reading that file with the same `preview` value in effect.

4. **The attached docs page doesn't cover the extension itself.** The Formatter reference documents CLI behavior, configuration keys, and the Black-compatibility/preview-style model [doc], but the Editor Integration page in this snapshot only extracted its headings ("Editor Integrations", "Language Server Protocol") with no body content [doc] -- so the extension-specific settings below are not sourced from the attached file; they reflect general Ruff/VS Code knowledge. [memory]

## How to make them match

1. **Compare versions.**
   - CLI: `ruff --version`
   - Extension: Command Palette -> "Ruff: Show logs" (or "Ruff: Show Client Logs") prints the running server/binary version. [memory]

2. **Point the extension at your project's `ruff` instead of its bundled copy.** In `.vscode/settings.json`:
   ```json
   {
     "ruff.importStrategy": "fromEnvironment",
     "ruff.interpreter": ["${workspaceFolder}/.venv/bin/python"]
   }
   ```
   `importStrategy: "fromEnvironment"` makes the extension resolve `ruff` from the active Python environment -- the same install your terminal uses -- instead of its bundled version. [memory] Alternatively pin an exact binary directly: `"ruff.path": ["/absolute/path/to/ruff"]`. [memory]

3. **Pin the ruff version in the project** so both paths land on the same build regardless of install timing, e.g. in `pyproject.toml`:
   ```toml
   [dependency-groups]
   dev = ["ruff==0.16.9"]
   ```
   and install with the same tool the CLI uses (`uv sync`, `pip install -e '.[dev]'`, etc.). [memory]

4. **Make `preview` explicit and confirm it's the same file on both sides.** In `ruff.toml`:
   ```toml
   [format]
   preview = false   # or true -- be explicit rather than relying on version defaults
   ```
   `preview` is a real, documented formatter setting (`format.preview`) [doc]; setting it explicitly removes ambiguity from version-dependent defaults. Also check `ruff.configuration` in VS Code settings isn't pointing at a different config file than the one the CLI picks up from your shell's working directory. [memory]

5. **Reload after changing settings.** VS Code caches the resolved interpreter/binary per window; run "Developer: Reload Window" after changing `ruff.importStrategy`/`ruff.path`/`ruff.interpreter` so the extension re-resolves the binary. [memory]

Once the extension and the CLI run the identical `ruff` build against the identical config file with the identical `preview` value, output -- including brace/bracket hugging -- will match, since Ruff's formatter is deterministic for a given version + config. [memory]
