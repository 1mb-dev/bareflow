# Why the wrapper throws on missing/undefined option defaults

## Root cause

Docusaurus plugin option defaults are not applied by the plugin factory function itself.
They are applied by a separate `validateOptions` function that the Docusaurus core calls
*before* it invokes the plugin factory, using the plugin module's own Joi option schema. [memory]

`validateOptions` is exported as a sibling named export alongside the plugin's `default`
export from the plugin's module (e.g. `@docusaurus/plugin-content-docs` exports both
`export default function pluginContentDocs(context, options) {...}` and
`export function validateOptions(...)`). [memory] The attached lifecycle-APIs reference
documents the factory's returned lifecycle object (`loadContent`, `contentLoaded`,
`configureWebpack`, `configurePostCss`, `postBuild`, `injectHtmlTags`,
`getClientModules`) but says nothing about `validateOptions` at all [doc] — it is a
separate, undocumented-on-that-page contract that the core loader relies on. [memory]

When you write a wrapper like this:

```js
// my-plugin/index.js
import contentDocsPlugin from '@docusaurus/plugin-content-docs';

export default function myWrapperPlugin(context, options) {
  const instance = contentDocsPlugin(context, options);
  return {
    ...instance,
    name: 'my-wrapper-plugin',
  };
}
```

your module's `default` export is the only thing Docusaurus sees; there is no
`validateOptions` export on *your* module. [memory] The core plugin loader looks for
`validateOptions` on the plugin module you registered in `docusaurus.config.js` (your
wrapper), not on the inner plugin you happen to call inside it. [memory] Finding none, it
either uses a permissive fallback (any unknown keys pass through unchanged) or fails
validation outright, but either way it never runs `@docusaurus/plugin-content-docs`'s
own Joi schema, so none of that schema's `.default(...)` values (e.g. `path: 'docs'`,
`routeBasePath: 'docs'`, `include`, `sidebarPath`, `remarkPlugins: []`,
`rehypePlugins: []`, `breadcrumbs: true`, etc.) get filled in. [memory]

The raw, un-defaulted `options` object is then what you pass into
`contentDocsPlugin(context, options)` inside your wrapper. [memory] The real
content-docs implementation assumes those fields are already present, because
normally the core guarantees that by the time any plugin factory runs. [memory] Its
internal lifecycle code, including the closures returned as `configureWebpack`, then
reads `undefined` where it expects an array, string, or function, and throws — which
surfaces as errors about missing/undefined option defaults. [memory] The lifecycle
reference confirms `configureWebpack(config, isServer, utils, content)` is called with
the content the plugin loaded [doc], so the same closure-over-`options` mechanism applies
to every hook the wrapper re-exports, not just `configureWebpack`. [memory]

## The fix

Forward the inner plugin's `validateOptions` as a named export from your wrapper module,
so the core runs the *same* schema (and therefore the same defaults) against your raw
config before calling your factory: [memory]

```js
// my-plugin/index.js
import contentDocsPlugin, {validateOptions} from '@docusaurus/plugin-content-docs';

export default function myWrapperPlugin(context, options) {
  const instance = contentDocsPlugin(context, options);
  return {
    ...instance,
    name: 'my-wrapper-plugin',
  };
}

// Re-export so Docusaurus's core loader can defaults-fill your raw config
// the same way it would for the un-wrapped plugin.
export {validateOptions};
```

CJS equivalent:

```js
const contentDocsPluginModule = require('@docusaurus/plugin-content-docs');

function myWrapperPlugin(context, options) {
  const instance = contentDocsPluginModule.default(context, options);
  return {...instance, name: 'my-wrapper-plugin'};
}

module.exports = myWrapperPlugin;
module.exports.default = myWrapperPlugin;
module.exports.validateOptions = contentDocsPluginModule.validateOptions;
```

With this in place, the options object your wrapper receives (and forwards into
`contentDocsPlugin(context, options)`) is already fully defaulted, so every
re-exported lifecycle method, `configureWebpack` included, closes over a complete
options object instead of the raw one. [memory]

A few related things worth checking:

- If the wrapper is meant to *override* a hook rather than just pass it through
  (e.g. add a webpack rule on top of the docs plugin's own), call through to the
  inner instance's method explicitly and merge, rather than only spreading
  `...instance`, since `configureWebpack` return values are merged via
  `webpack-merge` and returning your object instead of the inner one drops the
  content-docs plugin's own webpack config. [doc for the merge behavior, memory for
  applying it to a wrapper]
- If you are instead wrapping a *theme* (not a content plugin), the equivalent
  export to forward is `validateThemeConfig`, not `validateOptions`. [memory]
- Confirm you are calling the inner factory via its `default` export
  (`contentDocsPlugin.default(...)` under `require`, or the default import under
  `import`) — mixing this up throws a distinct "not a function" error, not an
  options-default error, so it is a separate failure mode from the one above. [memory]
