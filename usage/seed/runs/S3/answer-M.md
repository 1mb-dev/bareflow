# object-shorthand: ignore constructor functions

Set the `ignoreConstructors` option to `true`. [doc]

```json
{
    "object-shorthand": ["error", "always", { "ignoreConstructors": true }]
}
```
[doc]

- `ignoreConstructors: true` stops the rule from reporting constructor functions. By default the rule treats constructors like any other function. [doc]
- The option only works when the first (string) option is `"always"` or `"methods"`. [doc]
- With it enabled, `const foo = { ConstructorFunction: function() {} };` is accepted. [doc]
- Setting it to `false` with `"methods"` makes `"ConstructorFunction": function() {}` an error. The accepted form is `"ConstructorFunction"() {}`. [doc]

`"methods"` variant:

```json
{
    "object-shorthand": ["error", "methods", { "ignoreConstructors": true }]
}
```
[doc, inferred from the "always or methods" restriction]

In a flat config file (`eslint.config.js`, the format ESLint 10 uses), the same rule entry goes under `rules`: [memory]

```js
export default [
  {
    rules: {
      "object-shorthand": ["error", "always", { ignoreConstructors: true }],
    },
  },
];
```
[memory]

The doc does not say what counts as a "constructor function". From memory, the rule treats a function as a constructor when the property name starts with an uppercase letter. [memory]
