Set the `ignoreConstructors` option to `true` on `object-shorthand`. [doc]

```json
{
    "object-shorthand": ["error", "always", { "ignoreConstructors": true }]
}
```
[doc]

`"ignoreConstructors": true` prevents the rule from reporting errors for constructor functions. [doc] The option works with the `"always"` or `"methods"` settings. [doc]

In ESLint 10 flat config (`eslint.config.js`), the same thing looks like this: [memory]

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

A "constructor function" here means a function whose name starts with a capital letter, such as `Foo: function() {}`. With the option on, the rule won't ask you to rewrite it as `Foo() {}`. [memory]
