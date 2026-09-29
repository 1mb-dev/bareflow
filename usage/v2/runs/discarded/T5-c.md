# Why the wrapper plugin throws on missing/undefined option defaults

## Root cause

Docusaurus does not apply option defaults inside a plugin's factory function. Defaults
come from a separate `validateOptions({validate, options})` export on the plugin
*module*, which Docusaurus core calls once, before invoking the plugin factory, to run
the plugin's Joi schema over the raw options from `docusaurus.config.js` and fill in
`.default(...)` values (`routeBasePath`, `path`, `sidebarPath`, `docItemComponent`,
`docLayoutComponent`, `breadcrumbs`, `include`, etc. for `@docusaurus/plugin-content-docs`
specifically). [memory]

A "wrapper" plugin typically looks like this:

```js
// broken
const docsPlugin = require('@docusaurus/plugin-content-docs').default;

module.exports = function myWrapperPlugin(context, options) {
  const docsInstance = docsPlugin(context, options); // options is whatever Docusaurus
                                                       // core handed *this* module
  return {
    ...docsInstance,
    name: 'my-wrapper-plugin',
    configureWebpack: docsInstance.configureWebpack,
  };
};
```

The wrapper module itself exports no `validateOptions`, so Docusaurus core has nothing
to run the schema against and passes the wrapper's factory the raw, unvalidated options
object exactly as written in the config (or `{}` if none given). That raw object is then
forwarded straight into the real `@docusaurus/plugin-content-docs` factory call. Inside
the docs plugin, `loadContent`, `contentLoaded`, and `configureWebpack` all assume the
Joi defaults already ran, so they dereference fields like `options.docItemComponent` or
iterate `options.include` without a defined fallback. When those fields are `undefined`,
you get a `TypeError` (path resolution on `undefined`, `.filter`/`.map` on `undefined`,
etc.) coming from inside the docs plugin's own lifecycle code, surfaced through the
wrapper. [memory]

This is specifically an options-defaulting bug, not a lifecycle re-export bug per se:
re-exporting `configureWebpack` by reference works fine as a function; the problem is
what `options` it closed over when the docs plugin instance was constructed. [memory]

## Fix

Re-export (or delegate to) the wrapped plugin's `validateOptions` (and
`validateThemeConfig`, if you touch theme config) as a **named export on your wrapper
module itself**, not on the object your factory returns. That is the hook Docusaurus
core actually calls to compute defaults before your factory runs. [memory]

```js
// fixed
const docsPluginModule = require('@docusaurus/plugin-content-docs');
const docsPlugin = docsPluginModule.default;

module.exports = function myWrapperPlugin(context, options) {
  // `options` here has already been through validateOptions below, so it carries
  // every Joi default the docs plugin expects.
  const docsInstance = docsPlugin(context, options);

  return {
    ...docsInstance,
    name: 'my-wrapper-plugin',
    configureWebpack: docsInstance.configureWebpack,
  };
};

// Delegate straight through if you add no options of your own:
module.exports.validateOptions = docsPluginModule.validateOptions;
module.exports.validateThemeConfig = docsPluginModule.validateThemeConfig;
```

If your wrapper adds its own options on top of the docs plugin's, validate both and
merge, rather than only delegating:

```js
const {PluginOptionSchema} = require('@docusaurus/plugin-content-docs/lib/options');
const {default: myExtraSchema} = require('./options');

module.exports.validateOptions = ({validate, options}) => {
  const docsOptions = validate(PluginOptionSchema, options);
  return validate(myExtraSchema, docsOptions);
};
```

Two things to keep straight:

- `validateOptions` must live on the module Docusaurus loads from `docusaurus.config.js`
  (the wrapper), not on the plugin instance object the factory returns. Docusaurus never
  looks for it there. [memory]
- The options object flowing into your factory, and the one you forward into the inner
  `docsPlugin(context, options)` call, must be the *validated* object, not whatever the
  user typed in `docusaurus.config.js`. If your wrapper does any option massaging of its
  own, do it after `validateOptions` has run (i.e. inside the factory, on the already-
  defaulted `options`), not before. [memory]

With `validateOptions` correctly re-exported, `options` reaching both your wrapper and
the inner docs-plugin factory call carries all its defaults, and the re-exported
lifecycle methods (`configureWebpack` included) stop throwing. [memory]
