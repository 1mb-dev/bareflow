# Why a wrapper around `@docusaurus/plugin-content-docs` throws "missing/undefined option defaults"

## Root cause

A Docusaurus plugin module has two separate things living on it, not one:

1. A **default export function** `(context, opts) => pluginInstance` that returns the object
   holding the lifecycle methods (`loadContent`, `contentLoaded`, `configureWebpack`,
   `configurePostCss`, `postBuild`, `injectHtmlTags`, `getClientModules`, etc.) [doc].
2. Separate **named exports** `validateOptions({options, validate})` and
   `validateThemeConfig({themeConfig, validate})`, declared as siblings of the default
   function at the top level of the module, e.g.:

   ```js
   export function validateOptions({options, validate}) {
     const validatedOptions = validate(myValidationSchema, options);
     return validatedOptions;
   }

   export function validateThemeConfig({themeConfig, validate}) {
     const validatedThemeConfig = validate(myValidationSchema, options);
     return validatedThemeConfig;
   }
   ```
   [doc]

`validateOptions` is where the plugin's Joi schema (or equivalent) fills in default values
for any option the caller didn't supply. Docusaurus's plugin loader calls this function
**before** it calls the default factory function, so by the time your plugin body runs,
`opts` (`"opts" is the user-defined options"` per the reference example [doc]) is already
the *normalized, defaulted* object -- every internal lifecycle method (`configureWebpack`
included) is written assuming that has already happened.

`configureWebpack(config, isServer, utils, content)` itself doesn't touch option
validation directly -- it just reads whatever fields the plugin's closure captured from
`opts` when the factory ran [doc: signature and "modifies the internal webpack config...
merged using webpack-merge" description]. If those fields never got their defaults filled
in, `configureWebpack` (or `loadContent`, `getClientModules`, etc., which use the same
`opts` closure) dereferences `undefined` and throws.

**Where wrappers go wrong:** when you write

```js
import docsPlugin from '@docusaurus/plugin-content-docs';

export default function myWrapper(context, options) {
  const instance = docsPlugin.default(context, options);
  return {
    ...instance,
    name: 'my-docs-wrapper',
    configureWebpack: instance.configureWebpack,
  };
}
```

you are copying properties off the **returned instance object** -- that's the natural
mental model, since that's where `configureWebpack` and friends visibly live [doc, the
returned-object example]. But `validateOptions`/`validateThemeConfig` are not on that
instance object at all; they are separate named exports of the *module*, sitting next to
the default function, not inside what it returns [doc, structure of the reference
example]. A wrapper that only re-exports the default function (and maybe hand-picks some
lifecycle methods off its return value) silently drops `validateOptions`/
`validateThemeConfig`.

When Docusaurus loads your wrapper module and finds no `validateOptions` export, it
doesn't run `@docusaurus/plugin-content-docs`'s Joi schema at all -- it just passes your
raw, unvalidated config straight through, with no defaults applied [memory: this
pass-through-when-absent behavior is Docusaurus core plugin-loading behavior, not
described in the attached page]. Your wrapper then calls `docsPlugin.default(context,
options)` with that un-defaulted `options`, so the inner plugin builds its lifecycle
closures over an object missing fields like `path`, `routeBasePath`, `sidebarPath`,
`include`/`exclude`, etc. -- and later, when `configureWebpack` (or another lifecycle
method) reads one of those, it's `undefined`.

## The fix

Forward the validation statics unchanged, alongside your default export:

```js
import docsPlugin from '@docusaurus/plugin-content-docs';

export default function myWrapper(context, options) {
  // `options` here has ALREADY been through docsPlugin's validateOptions
  // (Docusaurus calls the module's exported validateOptions before this factory runs),
  // so it is safe to hand straight to the wrapped plugin.
  const instance = docsPlugin.default(context, options);

  return {
    ...instance,
    name: 'my-docs-wrapper',
    configureWebpack(config, isServer, utils, content) {
      // delegate to the wrapped implementation; content is what
      // the wrapped plugin's loadContent() returned [doc]
      return instance.configureWebpack?.(config, isServer, utils, content);
    },
  };
}

// Required: re-export these so Docusaurus applies plugin-content-docs's own
// defaults before your default() factory (and the wrapped plugin) ever see `options`.
export const validateOptions = docsPlugin.validateOptions;
export const validateThemeConfig = docsPlugin.validateThemeConfig;
```

If your wrapper adds its own option fields on top of the docs plugin's schema, don't
replace `validateOptions` with your own from scratch -- compose it, so both sets of
defaults get applied:

```js
export function validateOptions({options, validate}) {
  const docsValidated = docsPlugin.validateOptions({options, validate});
  return validate(myExtraOptionsSchema, docsValidated);
}
```

The key fix in both cases is the same: **don't let the wrapper module omit
`validateOptions`/`validateThemeConfig`** -- they are what fills in the defaults that
every lifecycle method downstream (including `configureWebpack`) assumes are already
present [doc for the mechanism's shape; memory for Docusaurus's silent-passthrough
behavior when the export is missing, and for the wrapper-composition fix pattern].

## Sources

- [doc] = `doc.json`, Docusaurus "Plugin Method References" / "Lifecycle APIs" /
  "Extending infrastructure" (docusaurus.io/docs/api/plugin-methods, v3.10.2).
- [memory] = general knowledge of Docusaurus's plugin-loading internals, not present in
  the attached page.
