# Why `cargo +nightly -Zscript file.rs` doesn't work

No documentation file was attached to this task (checked the scratchpad — it's empty), so
everything below is from general knowledge [memory], not a source document. If you have the
actual `unstable.html` page or the exact error text, share it and this can be checked precisely.

The command as written is exactly what the cargo unstable book shows for the `script` feature
[memory], so when it fails it's almost always environment/context, not a typo in the command.
Check these in order:

## 1. Most likely: `cargo` isn't the rustup proxy, or nightly isn't actually selected

`+toolchain` is a convention implemented by **rustup's `cargo` shim**, not by Cargo itself [memory].
If the `cargo` on your `PATH` is a distro package, a Homebrew formula, a Nix store path, or
anything else not going through `~/.cargo/bin/cargo` (rustup's proxy), then:

- `+nightly` gets passed straight through as an unrecognized positional argument, and Cargo
  errors instead of switching toolchains [memory].
- Symptom to look for: `error: no such command: '+nightly'` or similar "unexpected argument"
  errors [memory].

Check with:

```bash
which cargo          # should resolve to ~/.cargo/bin/cargo (or a rustup shim)
rustup show           # confirms nightly is installed and which toolchain 'nightly' resolves to
```

- If nightly isn't installed, `rustup toolchain install nightly` before anything else.
- If `+nightly` resolves but you're actually still landing on stable (e.g., a shell alias or a
  second cargo earlier in `PATH` intercepts the call), Cargo prints the very common
  `error: the -Z flag is only accepted on the nightly channel of Cargo, but this is the
  'stable' channel` [memory, fairly confident this is the exact wording] — that message means the
  `+nightly` never took effect, not that `-Zscript` itself is broken.

## 2. `+nightly` must be the very first argument

Rustup's proxy only recognizes `+toolchain` when it's literally argv[1]. If you (or a wrapper
script/alias) reordered it — e.g. `cargo -Zscript +nightly file.rs` — it fails, because at that
point `+nightly` is just an ordinary argument to Cargo, which doesn't understand it [memory].
Your posted command has the order right, so double-check whatever you're *actually* running
(shell history, alias, Makefile target) matches it exactly.

## 3. Running inside (or under) an existing Cargo package/workspace

The script feature only engages cleanly when there's no ambient `Cargo.toml` cargo can find by
walking up from the current directory. If `file.rs` sits inside a normal crate or workspace,
Cargo can pick up that ambient manifest instead of treating the `.rs` file as a self-contained
script, and the invocation does something other than what you expect (or errors trying to
reconcile the two) [memory, moderate confidence — this is a known rough edge of an unstable
feature, but I don't have the exact current error text]. Try it from a scratch directory with no
`Cargo.toml` anywhere above it, isolated from any workspace, and see if that changes the result.

## 4. Embedded-manifest syntax drift (only matters once the file actually parses as a script)

The `-Zscript` feature has been unstable and its embedded-manifest syntax has changed at least
once while it iterated — earlier revisions embedded the manifest inside a `//! ```cargo ... ```` `
rustdoc block; later revisions use a bare `---`-delimited frontmatter fence at the top of the
file [memory, moderate-low confidence on exact version boundaries]. If your `file.rs` uses one
syntax and your installed nightly's Cargo expects the other, you'll get a manifest-not-found or
parse error that looks like the feature "isn't working," when really the file and the toolchain
disagree on format. Match the frontmatter syntax to whatever your *currently installed* nightly's
copy of the unstable docs shows (`rustup doc --unstable-book` or the nightly build's own
`unstable.html`), not to a blog post or an older cached copy of the page — this feature has moved
under you release to release.

## Practical next step

Run this and read the actual error, since that will point at which of the above applies:

```bash
rustup show
rustup run nightly cargo -Zscript --version
cd /tmp && printf '#!/usr/bin/env -S cargo -Zscript\n---\n---\nfn main(){ println!("hi"); }\n' > t.rs
cargo +nightly -Zscript t.rs
```

Running it against a trivial file in `/tmp` (no ambient `Cargo.toml`, no workspace) isolates
causes 3 and 4 from causes 1 and 2. If that trivial case works but your real file doesn't, the
problem is your file's location or its embedded-manifest syntax, not your toolchain setup.
