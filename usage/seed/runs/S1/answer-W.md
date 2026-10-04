Use the `--unscoped` flag with `deno add`. [doc]

```
deno add --unscoped jsr:@scope/package-name
```
[doc]

The flag uses the package name without its scope as the alias. For example, `jsr:@david/jsonc-morph` is added as `jsonc-morph`. [doc]

You can then import it by the base name instead of the scoped identifier. [doc]

```ts
import { something } from "package-name";
```
[memory] (illustrative; the import specifier is the alias that `deno add` writes into the import map in `deno.json`.)

Note: I could not verify against Deno 2.9.5 itself. The flag comes from the attached doc only.
