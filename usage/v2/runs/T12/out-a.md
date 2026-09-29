# Suppressing a GritQL plugin lint rule in Biome

For a built-in rule you address it by group/name, e.g. `lint/suspicious/noDebugger` [doc]. Plugin
diagnostics don't use a group name at all — they use the fixed segment `plugin` instead, so the
syntax is:

```js
// biome-ignore lint/plugin/<plugin-name>: <explanation>
```

targeting one plugin, or, to suppress diagnostics from every plugin:

```js
// biome-ignore lint/plugin: <explanation>
```

`<plugin-name>` is the plugin's file name with the `.grit` extension stripped [doc]. So a plugin
defined in `preferObjectSpread.grit` is referenced as `lint/plugin/preferObjectSpread`:

```js
// biome-ignore lint/plugin/preferObjectSpread: reason
Object.assign({}, foo);
```

This suppresses the diagnostic emitted by `preferObjectSpread.grit` for the next line only [doc].
GritQL plugin files use the `.grit` extension [doc]; GritQL itself is the pattern-matching query
language Biome's plugin system is built on [memory].

Like built-in suppressions, this is an inline (next-line) suppression by default. The same
`lint/plugin` / `lint/plugin/<plugin-name>` target also works with the other suppression forms:

```js
// biome-ignore-all lint/plugin/preferObjectSpread: reason   // whole file, must be at top
// biome-ignore-start lint/plugin/preferObjectSpread: reason // range start
// biome-ignore-end lint/plugin/preferObjectSpread: reason   // range end
```

[doc] — "Plugin suppressions can also be authored as top-level and range suppressions."

## Why this differs from the normal path

For built-in rules/actions the comment shape is `category[/group[/name]]`, e.g. `lint`,
`lint/suspicious`, or `lint/suspicious/noDebugger` — each added segment narrows the suppression
[doc]. Plugins don't have Biome-assigned groups, so `plugin` stands in as that middle segment, and
the plugin's own file-derived name takes the place of the rule name [doc]. If you're unsure of a
rule's exact category (built-in or plugin), Biome's own docs suggest checking the rule/plugin's
diagnostic category on its documentation page [doc].
