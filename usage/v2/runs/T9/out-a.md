# Why `cargo +nightly -Zscript file.rs` fails

## What the attached doc actually covers

The attached page is the general `cargo(1)` reference ("Common Options" section of the Cargo Book), not the dedicated unstable-features page for the `script` feature itself. It never mentions "script" at all [doc]. So it can confirm the two building blocks the command depends on, but it can't confirm anything `-Zscript`-specific.

What it does say, and how that bears on your command:

- `+toolchain` (e.g. `+nightly`) is only recognized "if Cargo has been installed with rustup, and the first argument to cargo begins with +" [doc]. The interception happens in the rustup shim, not in cargo itself.
- `-Z flag` is described as "Unstable (nightly-only) flags to Cargo. Run `cargo -Z help` for details." [doc]
- A related nightly-only flag, `-C`, is documented as requiring the nightly channel *and* also needing `-Z unstable-options` to enable [doc] -- i.e. some nightly features need more than just their own `-Z` name to turn on. That pattern (flag exists, but is gated behind an additional unstable switch or a fresh-enough nightly) is worth keeping in mind for `script` too, even though this page doesn't spell it out.

## Most likely reasons it doesn't work

1. **Cargo isn't a rustup install.** If your `cargo` came from a distro package, Homebrew's plain `rust` formula, conda, or a from-source build, there's no rustup proxy to catch the leading `+nightly` argument, so per the doc's own conditional it is never interpreted as a toolchain override [doc] -- it gets passed straight into cargo as a literal, unrecognized argument, and the command fails before `-Zscript` is even reached [memory]. Fix: install/use rustup, or point directly at a nightly cargo binary instead of using `+nightly`.

2. **`nightly` toolchain isn't installed under rustup.** Even with rustup, `+nightly` requires `rustup toolchain install nightly` to have been run; otherwise rustup reports the toolchain isn't installed [memory]. Check with `rustup toolchain list`.

3. **You're actually still on the stable/beta cargo binary.** Any `-Z` flag is rejected outright on non-nightly channels with an explicit "only accepted on the nightly channel" error [memory]. If `+nightly` silently didn't take effect (case 1 or 2), this is the symptom you'd see.

4. **Your nightly is older than the feature.** `script` is an actively-evolving unstable feature; the flag name, required syntax, and whether it exists at all can change between nightly builds [memory]. Run `rustup update nightly` and then `cargo +nightly -Z help` [doc: this is the documented way to list available unstable flags] -- if `script` isn't in that list, your nightly predates it.

5. **Fused vs. spaced flag form.** Cargo's own docs generally show unstable flags as `-Z script` (with a value, not a boolean) [doc pattern from `-Z flag ... Run cargo -Z help`]. If the exact nightly you're on parses `-Zscript` differently than `-Z script`, try the spaced form as a first sanity check [memory, low confidence -- easy to rule out].

## How to isolate it

```
rustup show                 # confirms nightly is installed and which one
cargo +nightly --version    # confirms +nightly actually switches the binary
cargo +nightly -Z help      # lists this nightly's supported unstable flags
cargo +nightly -Z script ./file.rs   # spaced form, explicit relative path
```

If `cargo +nightly --version` doesn't print a `nightly` version string, the problem is (1) or (2), not `-Zscript` at all. If it does, and `script` is missing from `cargo -Z help`, the problem is (4).
