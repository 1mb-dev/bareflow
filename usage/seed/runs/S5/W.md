# Allowing Compound Component Exports in Oxlint

To allow compound component exports in the `react/only-export-components` rule, use the **`allowCompoundComponents`** option set to `true`.

## Configuration Example

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

## What This Enables

When enabled, this option permits exporting an object where "every property is a React component." The documentation notes that "the object must be non-empty, contain no nested objects, spreads, or accessors, and anonymous functions must use a component name as a static property key."

## Valid Pattern

```jsx
const Root = () => <div />;
const Label = () => <span />;
export const Tag = { Root, Label };
```

This configuration aligns with Vite's compound component support model.
