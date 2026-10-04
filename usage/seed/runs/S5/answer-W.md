# Allowing compound component exports in `react/only-export-components` (Oxlint 1.86.0)

Set the option **`allowCompoundComponents`** to `true`. [doc]

## Rule config

```json
{
  "plugins": ["react"],
  "rules": {
    "react/only-export-components": ["error", {
      "allowCompoundComponents": true
    }]
  }
}
```
[doc]

## What it does

With the option on, you can export an object where every property is a React component. [doc] The object must be non-empty, contain no nested objects, spreads, or accessors, and anonymous functions must use a component name as a static property key. [doc]

Valid with the option enabled:

```jsx
const Root = () => <div />;
const Label = () => <span />;
export const Tag = { Root, Label };
```
[doc]

This matches Vite's compound component support model. [doc]

Caveat: the attached doc does not state which Oxlint version added this option. I have not verified it against 1.86.0 specifically. If the config is rejected, check the rule's docs for your installed version. [memory]
