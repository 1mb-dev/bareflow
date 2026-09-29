# Why `cargo +nightly -Zscript file.rs` may not work

The attached `cargo(1)` man page documents the two mechanisms this command depends on
(`+toolchain` and `-Z`), but it does not document the `script` feature itself, so the
exact failure mode isn't fully covered by the attached file. Combining what the page
does confirm with what's generally known about the feature:

**1. `+toolchain` only works if cargo was installed via rustup.**
The doc says: "If Cargo has been installed with rustup, and the first argument to cargo
begins with +, it will be interpreted as a rustup toolchain name (such as +stable or
+nightly)." [doc] If your `cargo` binary came from a system package manager (apt, dnf,
a distro's `cargo` package, etc.) instead of rustup, this `+` handling never triggers --
cargo just sees an unrecognized leading argument and errors (something like "no such
subcommand" or "unexpected argument `+nightly`"). Check with `rustup which cargo`; if
rustup isn't managing your toolchain, no amount of syntax fixing helps. [memory]

**2. `+nightly` selects a toolchain, it does not install one.**
Under rustup, if nightly was never installed you get "toolchain 'nightly' is not
installed." Fix with `rustup toolchain install nightly`. [memory]

**3. `-Z` flags are nightly-only, unstable, and their set changes across nightly builds.**
The doc: "-Z flag: Unstable (nightly-only) flags to Cargo. Run cargo -Z help for
details." [doc] `script` gates a feature that has been under active development, so
whether that exact flag exists depends on the date of your nightly. Run:

```
cargo +nightly -Z help
```

and check whether `script` is listed [doc, this is the documented way to enumerate
valid flags]. Two failure modes follow:
- Your nightly predates the flag being added, so it's unknown to that build --
  `rustup update nightly` and retry.
- The feature has since stabilized (single-file/"cargo script" support moving into
  normal edition-gated cargo behavior) and the `-Z` flag was retired once it became
  default behavior, so cargo no longer accepts it as an unstable flag. If that's the
  case, drop `+nightly -Zscript` entirely and just run `cargo file.rs` on a current
  toolchain. [memory, moderate confidence -- verify against your `cargo --version` and
  the `-Z help` output rather than trusting an older tutorial's exact invocation]

**4. Argument order and positioning.**
Per the SYNOPSIS, `cargo [options] command [args]` [doc] -- `+nightly` and `-Zscript`
are options and must precede the file argument, with nothing else (no subcommand such
as `run`) in between. `cargo +nightly -Zscript file.rs` matches that shape; inserting
any other token before `file.rs` (e.g. a shell alias that prepends a subcommand) makes
cargo try to resolve `file.rs` as an argument to that subcommand instead of as the
script path, and it fails.

**Diagnostic order:**
1. `rustup which cargo` -- confirm cargo is rustup-managed.
2. `rustup toolchain list` -- confirm nightly is installed; if not, install it.
3. `cargo +nightly -Z help` -- confirm `script` is a flag this nightly actually
   recognizes.
4. If it's missing: either update nightly, or check whether the feature has since
   stabilized and drop the `-Z` flag/toolchain override altogether.

The specific error text (toolchain-not-installed vs. unknown-flag vs.
no-such-subcommand) tells you which of these four it is -- they look different and
point to different fixes.
