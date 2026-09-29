# Suppressing a GritQL plugin lint rule in Biome

No documentation file was attached to this question, so everything below is from memory [memory] and should be spot-checked against the exact string Biome prints in its diagnostic output before you rely on it.

## Baseline syntax

Biome's suppression comment for a built-in rule is: `// biome-ignore <group>/<ruleName>: <reason>`, placed on the line directly above the offending code [memory]. Example: `// biome-ignore lint/suspicious/noExplicitAny: legacy API, typed upstream`. The explanation after the colon is required; Biome flags a suppression comment that has no reason [memory]. You can also suppress every lint rule on a line with `// biome-ignore lint: <reason>`, and suppress for the rest of the file with `// biome-ignore-all <group>/<ruleName>: <reason>` at the top [memory].

## The plugin case

For a rule defined by a GritQL plugin (Biome's plugin system, GA since Biome 2.0), the diagnostic isn't filed under one of the built-in groups (`style`, `suspicious`, `correctness`, etc.) since it didn't come from Biome's own rule set. Instead it's filed under a `plugin` group, keyed by the rule name the plugin itself declares. So the ignore comment follows the same shape, just with `plugin` where a built-in group name would go [memory]:

```js
// biome-ignore lint/plugin/<ruleName>: <reason>
```

For example, if a GritQL file defines a rule named `noRawFetch`, suppressing one hit looks like:

```js
// biome-ignore lint/plugin/noRawFetch: intentional, wrapped below
fetch(url);
```

## The reliable way to get the exact string

Confidence on the exact `plugin/<ruleName>` segment is moderate, not certain, since plugin diagnostics are a newer and less-documented corner of Biome [memory]. The safe move: run the linter, and copy the rule code straight out of the diagnostic it prints (Biome always prints the same string you're meant to paste into the `biome-ignore` comment for both built-in and plugin rules) [memory]. That sidesteps guessing the exact category name entirely.
