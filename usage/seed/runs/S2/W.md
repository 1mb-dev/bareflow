# Rendering Astro Components with Inlined Styles and Scripts

To render an Astro component with its inlined styles and scripts using Astro 7.3.5+, use the `renderComponent()` method with the `?container` query string:

**Import:**
```javascript
import { experimental_AstroContainer } from "astro/container";
import Card from "../src/components/Card.astro?container";
```

**Call:**
```javascript
const container = await experimental_AstroContainer.create();
const result = await container.renderComponent(Card);
```

**Key point:** As the documentation states, "The container renders only scripts and styles that are inlined. Assets imported by any resolution (e.g. `@import`, `import ... from`) aren't rendered."

The `?container` query string is essential—omitting it produces the same output as `renderToString()`, without the inlined assets.
