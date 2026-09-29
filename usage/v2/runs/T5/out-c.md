No documentation file was attached to this task, so every claim below is [memory] (no [doc] source was available to check against).

## Root cause

Every Docusaurus plugin module exports two things: a default factory `(context, options) => PluginInstance` that returns the lifecycle object (`loadContent`, `contentLoaded`, `configureWebpack`, `postBuild`, etc.), and a separate named export `validateOptions({validate, options})` built on a Joi schema with `.default(...)` values baked in. [memory]

Docusaurus core only calls `validateOptions` for plugins that are *registered directly* in `docusaurus.config.js` (in the `plugins`/`presets` array). That call is what fills in every default: `path`, `routeBasePath`, `include`/`exclude` globs, sidebar settings, remark/rehype plugin lists, etc. Only after that merge does core call the plugin's default factory with the fully-defaulted options object. [memory]

A wrapper plugin that does something like:

```js
import docsPlugin from '@docusaurus/plugin-content-docs';

export default function myWrapperPlugin(context, options) {
  const inner = docsPlugin(context, options); // <-- raw options, no defaulting
  return {
    ...inner,
    name: 'my-wrapper-plugin',
  };
}
```

calls `plugin-content-docs`'s factory function *manually*, passing it whatever raw options your wrapper received from config. Those options never pass through `plugin-content-docs`'s own `validateOptions`/Joi schema, so every field that plugin normally assumes is defaulted (e.g. `include`, `exclude`, `routeBasePath`, `sidebarPath`) is `undefined` instead. The inner plugin's lifecycle closures (`loadContent`, `contentLoaded`, `configureWebpack`, ...) read those fields directly and throw or misbehave on `undefined`. Because your wrapper is what gets `validateOptions` treatment from core (using your own schema, if you even defined one), that top-level validation never reaches the inner `plugin-content-docs` call. [memory]

`configureWebpack` is frequently where this surfaces because it runs after `loadContent`/`contentLoaded` in the plugin lifecycle, so by the time it fires, accumulated state built from undefined option fields (sidebar data, alias paths, doc route base, etc.) finally gets dereferenced in a way that throws. The proximate error message points at `configureWebpack`, but the actual defect is upstream: the options were never validated/defaulted before being handed to the wrapped plugin's factory. [memory]

## Fix

Explicitly run the wrapped plugin's own `validateOptions` on your options before invoking its factory, and forward that same `validateOptions` as your wrapper's export so Docusaurus core applies the correct schema/defaults when it processes your plugin's config entry:

```js
import contentDocsModule from '@docusaurus/plugin-content-docs';
import { normalizePluginOptions } from '@docusaurus/utils-validation';

const docsPlugin = contentDocsModule.default ?? contentDocsModule;
const validateDocsOptions = contentDocsModule.validateOptions;

export default function myWrapperPlugin(context, rawOptions) {
  // Re-run the wrapped plugin's own schema so defaults are applied,
  // exactly as core would have done for a directly-registered plugin.
  const options = validateDocsOptions({
    validate: normalizePluginOptions,
    options: rawOptions,
  });

  const inner = docsPlugin(context, options);

  return {
    ...inner,
    name: 'my-wrapper-plugin',
    // override/augment specific lifecycle methods here if needed;
    // anything left spread from `inner` now closes over fully-defaulted options
  };
}

// Forward the schema so core defaults your OWN config entry the same way
// (keeps behavior consistent if core ever calls validateOptions directly on you too).
export const validateOptions = validateDocsOptions;
```

Notes on this fix: [memory]
- The exact import surface (`normalizePluginOptions` from `@docusaurus/utils-validation`, and whether `validateOptions` is a named export vs. a property on the default export) has shifted slightly across Docusaurus v2/v3 releases, so check the installed `@docusaurus/plugin-content-docs` version's source/types if the shape doesn't match.
- If you only need to *augment* one or two lifecycle methods (e.g. wrap `configureWebpack` to merge extra webpack config), you don't need to touch the others: spread `inner` first, then override just the methods you're changing, calling `inner.methodName(...)` inside your override if you still need the original behavior.

## Better long-term pattern

Rather than instantiating one plugin's factory function inside another's, compose at the **config/preset level**: register `@docusaurus/plugin-content-docs` normally in the `plugins`/`presets` array (so core validates and defaults it the standard way), and write your customization as an independent plugin that reads the docs plugin's *output* (via its own `loadContent`/`contentLoaded`, or via `context`/global data) instead of calling into the docs plugin's factory directly. This is the pattern Docusaurus's own presets (e.g. `@docusaurus/preset-classic`) use to bundle multiple plugins without any one plugin manually invoking another's factory function, and it avoids re-deriving option defaults yourself entirely. [memory]
