To alias a package by its unscoped name in Deno, use the `--unscoped` flag with the `deno add` command.

According to the documentation: "Use the package name without its scope as the alias (ex. `jsr:@david/jsonc-morph` is added as `jsonc-morph`)."

**Exact command:**
```
deno add --unscoped jsr:@scope/package-name
```

This flag strips the scope prefix, allowing you to import the package using only its base name rather than the full scoped identifier.
