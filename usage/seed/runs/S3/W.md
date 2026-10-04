To configure the `object-shorthand` rule to not report constructor functions, use this exact configuration:

```json
{
    "object-shorthand": ["error", "always", { "ignoreConstructors": true }]
}
```

According to the documentation, `"ignoreConstructors": true` "can be used to prevent the rule from reporting errors for constructor functions." This option works with the `"always"` or `"methods"` settings.
