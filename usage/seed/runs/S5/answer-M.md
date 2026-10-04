# Allowing compound component exports in `react/only-export-components` (Oxlint)

The option is `allowCompoundComponents`. It is a boolean and defaults to `false`. [doc]

It allows an exported object when every property is a React component. This matches Vite's compound component support. [doc]

## Rule config

In `.oxlintrc.json`, pass the option as the second element of the rule array:

```json
{
  "plugins": ["react"],
  "rules": {
    "react/only-export-components": ["error", { "allowCompoundComponents": true }]
  }
}
```

The array form `[severity, options]` is the standard Oxlint way to pass rule options. [memory] The doc itself only shows the bare `"error"` form and says the rule "accepts a configuration object" with these properties. [doc]

In `oxlint.config.ts`:

```ts
import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["react"],
  rules: {
    "react/only-export-components": ["error", { "allowCompoundComponents": true }],
  },
});
```

The `defineConfig` and `plugins: ["react"]` shape comes from the doc. [doc] The options tuple in the TS config is the same convention as the JSON one. [memory]

## What it permits

```jsx
// Allowed when allowCompoundComponents: true
const Root = () => <div />;
const Label = () => <span />;
export const Tag = { Root, Label };
```
[doc]

## Constraints on the exported object

- The object must be non-empty. [doc]
- It must contain no nested objects, spreads, or accessors. [doc]
- Anonymous functions must use a component name as a static property key. [doc]

## Notes

- The rule was added in v1.23.0, so it is available in 1.86.0. [doc]
- With the default (`false`), exporting an object like `Tag` above is reported. [memory]
- Related options, all defaulting to off or empty: `allowConstantExport`, `allowExportNames` (string[]), `checkJS`, `customHOCs` (string[]). [doc]
- Combine them in the same object, for example `{ "allowCompoundComponents": true, "allowConstantExport": true }`. [memory]
