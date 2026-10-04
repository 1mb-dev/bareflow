# Rendering an Astro component with inlined styles and scripts (container API)

Import the component with the `?container` query suffix. The container then renders the component's inlined styles and scripts. [doc]

```javascript
import { experimental_AstroContainer } from "astro/container";
import Card from "../src/components/Card.astro?container";

const container = await experimental_AstroContainer.create();
const result = await container.renderToString(Card);
```

The `?container` suffix on the component import is the key step. [doc] Without it you get the plain `renderToString()` output, with no inlined assets. [doc]

## Limits

- The container renders only scripts and styles that are inlined. Assets pulled in by any resolution, such as `@import` or `import ... from`, are not rendered. [doc]

## Discrepancies with the attached doc

- The doc shows `container.renderComponent(Card)`. I don't recognise that as a container method. The method I know is `container.renderToString(Component, options)`, so I used it in the snippet above. The doc's own last line also compares against `renderToString()`, which suggests that is the call. [memory]
- `renderToString` returns a string. `renderToResponse` returns a `Response`. [memory]
- In the Astro versions I know (4.9+ and 5.x), the export is `experimental_AstroContainer` from `astro/container`. [memory] I can't confirm whether 7.3.5 dropped the `experimental_` prefix, so check the exports of `astro/container` in your installed version. [memory]
- I can't verify that Astro 7.3.5 exists or that its container API matches the doc. Check the installed package's types. [memory]
