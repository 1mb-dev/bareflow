# Suppressing a GritQL plugin rule in Biome

Built-in lint rules use the `lint/<group>/<ruleName>` category (e.g. `lint/suspicious/noDebugger`) [doc]. Plugin-sourced diagnostics use a different category, `lint/plugin`, instead of a rule group [doc].

## Syntax

Suppress diagnostics from **one specific plugin**, for the next line:

```js
// biome-ignore lint/plugin/<plugin-name>: <explanation>
```

For example, if the plugin file is `preferObjectSpread.grit`:

```js
// biome-ignore lint/plugin/preferObjectSpread: reason
Object.assign({}, foo);
```

This disables diagnostics emitted by `preferObjectSpread.grit` for the following line only [doc].

`<plugin-name>` is the plugin's file name with the `.grit` extension stripped [doc].

Suppress diagnostics from **all plugins** at once, by omitting the plugin name:

```js
// biome-ignore lint/plugin: reason
Object.assign({}, foo);
```

[doc]

## Other forms

The same `lint/plugin` / `lint/plugin/<plugin-name>` category works with every suppression-comment variant Biome supports, not just the inline one [doc]:

- `// biome-ignore lint/plugin/<plugin-name>: <explanation>` — suppress for the next line only [doc]
- `// biome-ignore-all lint/plugin/<plugin-name>: <explanation>` — top-level suppression; must be placed at the top of the file, suppresses for the whole file [doc]
- `// biome-ignore-start lint/plugin/<plugin-name>: <explanation>` ... `// biome-ignore-end lint/plugin/<plugin-name>: <explanation>` — range suppression between the two comments [doc]

The doc states explicitly: "Plugin suppressions can also be authored as top-level and range suppressions." [doc]

## Why this differs from a built-in rule

For a built-in rule you'd write `// biome-ignore lint/<group>/<ruleName>: <explanation>` (e.g. `lint/suspicious/noDebugger`) — the segments after `lint/` are the rule's group and name [doc]. A plugin isn't part of Biome's built-in rule groups, so it gets its own fixed category, `plugin`, with the plugin's filename (minus `.grit`) taking the place a rule name would normally occupy [doc]. GritQL is Biome's query language for authoring custom lint rules as `.grit` plugin files, which is why the plugin identity is tied to that file [memory].

If you're unsure of a rule or plugin's exact category string, the doc recommends checking its documentation page for the diagnostic category [doc].
