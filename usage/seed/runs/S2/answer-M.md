# Rendering an Astro component with inlined styles and scripts (Container API)

Use `renderComponent()` (added in `astro@7.3.5`) [doc]. It returns the component's HTML including its scripts and styles [doc]. Import the component with the `?container` query string [doc].

```js
import { experimental_AstroContainer } from "astro/container";
import Card from "../src/components/Card.astro?container";

const container = await experimental_AstroContainer.create();
const result = await container.renderComponent(Card);
```

(Exact import and call as given in the docs [doc].)

## Details

- `experimental_AstroContainer` is imported from `astro/container`, and `create()` returns a Promise, so `await` it [doc].
- `renderComponent()` has type `(component: AstroComponentFactory; options?: Omit<ContainerRenderOptions, 'routeType'>) => Promise<string>` [doc]. It resolves to a string of HTML [doc].
- Only scripts and styles that are inlined are rendered. Assets imported through any resolution (e.g. `@import`, `import ... from`) are not rendered [doc].
- If you leave off `?container`, the output is the same as `renderToString()`, so you get no scripts or styles [doc].
- The `routeType` option is not accepted by `renderComponent()`. The other options are: `slots`, `props`, `request`, `params`, `locals`, `partial` [doc].

Example with options:

```js
const result = await container.renderComponent(Card, {
  props: { name: "Hello, world!" },
  slots: { default: "Some value" },
});
```

(The `props` and `slots` options are documented for the render functions generally [doc]. Passing them to `renderComponent()` follows from its options type [doc].)

## Caveats

- The Container API is experimental and may break in minor or patch releases [doc]. This is why the export is prefixed `experimental_` [doc].
- The `?container` import suffix is resolved by Vite. I assume it needs a Vite-based environment such as Astro itself or `vitest` [memory]. The docs do not state this for `renderComponent()`.
