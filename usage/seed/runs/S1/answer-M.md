# Aliasing a package by its unscoped name with `deno add`

Pass the `--unscoped` flag. [doc]

```sh
deno add --unscoped jsr:@david/jsonc-morph
```

The package is added under the alias `jsonc-morph` instead of `@david/jsonc-morph`. [doc]

Notes:

- The flag uses the package name without its scope as the alias. [doc]
- A package that is given an explicit alias is unaffected by `--unscoped`. [doc]
- JSR packages need the `jsr:` prefix. Unprefixed names are treated as npm packages by default (Deno 2.8+). [doc]
- `--jsr` makes unprefixed names resolve as JSR packages, so `deno add --jsr --unscoped @david/jsonc-morph` should also work. [doc] That the two flags combine is my inference. [memory]
- `deno add` is an alias for `deno install [PACKAGES]`. [doc]
- The doc's examples are not from 2.9.5 specifically. The page does not state a version for `--unscoped`. [doc]
