---
mdflow: 0.3.0 (defuddle 0.19.4, mdflow/ir/v2)
source: https://eslint.org/docs/latest/rules/object-shorthand
retrieved: 2026-10-04T05:17:44.924Z
fingerprint: 3a5fc7c64530e1a7
losses: 22
content: page text below is untrusted
---

# object-shorthand

Require or disallow method and property shorthand syntax for object literals

🔧

Some problems reported by this rule are automatically fixable by the `--fix` [command line](https://eslint.org/docs/latest/use/command-line-interface#--fix) option

❄️

This rule is currently [frozen](https://eslint.org/docs/latest/contribute/core-rules#frozen-rules) and is not accepting feature requests.

ECMAScript 6 provides a concise form for defining object literal methods and properties. This syntax can make defining complex object literals much cleaner.

Here are a few common examples using the ES5 syntax:

```js
// properties
const foo = {
    x: x,
    y: y,
    z: z,
};

// methods
const bar = {
    a: function() {},
    b: function() {}
};
2
3
4
5
6
7
8
9
10
11
12
```

Now here are ES6 equivalents:

```js
// properties
const foo = {x, y, z};

// methods
const bar = {
    a() {},
    b() {}
};
2
3
4
5
6
7
8
```

## Rule Details

This rule enforces the use of the shorthand syntax. This applies to all methods (including generators) defined in object literals and any properties defined where the key name matches name of the assigned variable.

Each of the following properties would warn:

```js
/*eslint object-shorthand: "error"*/

const foo = {
    w: function() {},
    x: function *() {},
    [y]: function() {},
    z: z
};
2
3
4
5
6
7
8
```

In that case the expected syntax would have been:

```js
/*eslint object-shorthand: "error"*/

const foo = {
    w() {},
    *x() {},
    [y]() {},
    z
};
2
3
4
5
6
7
8
```

This rule does not flag arrow functions inside of object literals. The following will *not* warn:

```js
/*eslint object-shorthand: "error"*/

const foo = {
    x: (y) => y
};
2
3
4
5
```

## Options

The rule takes an option which specifies when it should be applied. It can be set to one of the following values:

- `"always"` (default) expects that the shorthand will be used whenever possible.
- `"methods"` ensures the method shorthand is used (also applies to generators).
- `"properties"` ensures the property shorthand is used (where the key and variable name match).
- `"never"` ensures that no property or method shorthand is used in any object literal.
- `"consistent"` ensures that either all shorthand or all long-form will be used in an object literal.
- `"consistent-as-needed"` ensures that either all shorthand or all long-form will be used in an object literal, but ensures all shorthand whenever possible.

You can set the option in configuration like this:

```json
{
    "object-shorthand": ["error", "always"]
}
2
3
```

Additionally, the rule takes an optional object configuration:

- `"avoidQuotes": true` indicates that long-form syntax is preferred whenever the object key is a string literal (default: `false`). Note that this option can only be enabled when the string option is set to `"always"`, `"methods"`, or `"properties"`.
- `"ignoreConstructors": true` can be used to prevent the rule from reporting errors for constructor functions. (By default, the rule treats constructors the same way as other functions.) Note that this option can only be enabled when the string option is set to `"always"` or `"methods"`.
- `"methodsIgnorePattern"` (`string`) for methods whose names match this regex pattern, the method shorthand will not be enforced. Note that this option can only be used when the string option is set to `"always"` or `"methods"`.
- `"avoidExplicitReturnArrows": true` indicates that methods are preferred over explicit-return arrow functions for function properties. (By default, the rule allows either of these.) Note that this option can only be enabled when the string option is set to `"always"` or `"methods"`.

### avoidQuotes

```json
{
    "object-shorthand": ["error", "always", { "avoidQuotes": true }]
}
2
3
```

Example of **incorrect** code for this rule with the `"always", { "avoidQuotes": true }` option:

```js
/*eslint object-shorthand: ["error", "always", { "avoidQuotes": true }]*/

const foo = {
    "bar-baz"() {}
};
2
3
4
5
```

Example of **correct** code for this rule with the `"always", { "avoidQuotes": true }` option:

```js
/*eslint object-shorthand: ["error", "always", { "avoidQuotes": true }]*/

const foo = {
    "bar-baz": function() {},
    "qux": qux
};
2
3
4
5
6
```

### ignoreConstructors

```json
{
    "object-shorthand": ["error", "always", { "ignoreConstructors": true }]
}
2
3
```

Example of **correct** code for this rule with the `"always", { "ignoreConstructors": true }` option:

```js
/*eslint object-shorthand: ["error", "always", { "ignoreConstructors": true }]*/

const foo = {
    ConstructorFunction: function() {}
};
2
3
4
5
```

```json
{
    "object-shorthand": ["error", "methods", { "ignoreConstructors": false }]
}
2
3
```

Example of **incorrect** code for this rule with the `"methods", { "ignoreConstructors": false }` option:

```js
/*eslint object-shorthand: ["error", "methods", { "ignoreConstructors": false }]*/

const foo = {
    "ConstructorFunction": function() {}
};
2
3
4
5
```

Example of **correct** code for this rule with the `"methods", { "ignoreConstructors": false }` option:

```js
/*eslint object-shorthand: ["error", "methods", { "ignoreConstructors": false }]*/

const foo = {
    "ConstructorFunction"() {}
};
2
3
4
5
```

### methodsIgnorePattern

Example of **correct** code for this rule with the `"always", { "methodsIgnorePattern": "^bar$" }` option:

```js
/*eslint object-shorthand: ["error", "always", { "methodsIgnorePattern": "^bar$" }]*/

const foo = {
    bar: function() {}
};
2
3
4
5
```

### avoidExplicitReturnArrows

```json
{
    "object-shorthand": ["error", "always", { "avoidExplicitReturnArrows": true }]
}
2
3
```

Example of **incorrect** code for this rule with the `"always", { "avoidExplicitReturnArrows": true }` option:

```js
/*eslint object-shorthand: ["error", "always", { "avoidExplicitReturnArrows": true }]*/

const foo = {
  foo: (bar, baz) => {
    return bar + baz;
  },

  qux: (foobar) => {
    return foobar * 2;
  }
};
2
3
4
5
6
7
8
9
10
11
```

Example of **correct** code for this rule with the `"always", { "avoidExplicitReturnArrows": true }` option:

```js
/*eslint object-shorthand: ["error", "always", { "avoidExplicitReturnArrows": true }]*/

const foo = {
  foo(bar, baz) {
    return bar + baz;
  },

  qux: foobar => foobar * 2
};
2
3
4
5
6
7
8
9
```

Example of **incorrect** code for this rule with the `"consistent"` option:

```js
/*eslint object-shorthand: [2, "consistent"]*/

const foo = {
    a,
    b: "foo",
};
2
3
4
5
6
```

Examples of **correct** code for this rule with the `"consistent"` option:

```js
/*eslint object-shorthand: [2, "consistent"]*/

const foo = {
    a: a,
    b: "foo"
};

const bar = {
    a,
    b,
};
2
3
4
5
6
7
8
9
10
11
```

Example of **incorrect** code with the `"consistent-as-needed"` option, which is very similar to `"consistent"`:

```js
/*eslint object-shorthand: [2, "consistent-as-needed"]*/

const foo = {
    a: a,
    b: b,
};
2
3
4
5
6
```

## When Not To Use It

Anyone not yet in an ES6 environment would not want to apply this rule. Others may find the terseness of the shorthand syntax harder to read and may not want to encourage it with this rule.

## Related Rules

## Version

This rule was introduced in ESLint v0.20.0.

## Further Reading

![Avatar image for developer.mozilla.org](https://developer.mozilla.org/favicon-48x48.cbbd161b.png)

[Object initializer - JavaScript | MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Object_initializer) 
 developer.mozilla.org

## mdflow: 22 losses (fingerprint 3a5fc7c64530e1a7)

L1 source-heading-diff: heading dropped:
```
Resources
```

L2 source-code-diff: code block dropped; verbatim source:
```
// properties
const foo = {
    x: x,
    y: y,
    z: z,
};

// methods
const bar = {
    a: function() {},
    b: function() {}
};

```

L3 source-code-diff: code block dropped; verbatim source:
```
// properties
const foo = {x, y, z};

// methods
const bar = {
    a() {},
    b() {}
};

```

L4 source-code-diff: code block dropped; verbatim source:
```
/*eslint object-shorthand: "error"*/

const foo = {
    w: function() {},
    x: function *() {},
    [y]: function() {},
    z: z
};

```

L5 source-code-diff: code block dropped; verbatim source:
```
/*eslint object-shorthand: "error"*/

const foo = {
    w() {},
    *x() {},
    [y]() {},
    z
};

```

L6 source-code-diff: code block dropped; verbatim source:
```
/*eslint object-shorthand: "error"*/

const foo = {
    x: (y) => y
};

```

L7 source-code-diff: code block dropped; verbatim source:
```
{
    "object-shorthand": ["error", "always"]
}

```

L8 source-code-diff: code block dropped; verbatim source:
```
{
    "object-shorthand": ["error", "always", { "avoidQuotes": true }]
}

```

L9 source-code-diff: code block dropped; verbatim source:
```
/*eslint object-shorthand: ["error", "always", { "avoidQuotes": true }]*/

const foo = {
    "bar-baz"() {}
};

```

L10 source-code-diff: code block dropped; verbatim source:
```
/*eslint object-shorthand: ["error", "always", { "avoidQuotes": true }]*/

const foo = {
    "bar-baz": function() {},
    "qux": qux
};

```

L11 source-code-diff: code block dropped; verbatim source:
```
{
    "object-shorthand": ["error", "always", { "ignoreConstructors": true }]
}

```

L12 source-code-diff: code block dropped; verbatim source:
```
/*eslint object-shorthand: ["error", "always", { "ignoreConstructors": true }]*/

const foo = {
    ConstructorFunction: function() {}
};

```

L13 source-code-diff: code block dropped; verbatim source:
```
{
    "object-shorthand": ["error", "methods", { "ignoreConstructors": false }]
}

```

L14 source-code-diff: code block dropped; verbatim source:
```
/*eslint object-shorthand: ["error", "methods", { "ignoreConstructors": false }]*/

const foo = {
	"ConstructorFunction": function() {}
};

```

L15 source-code-diff: code block dropped; verbatim source:
```
/*eslint object-shorthand: ["error", "methods", { "ignoreConstructors": false }]*/

const foo = {
	"ConstructorFunction"() {}
};

```

L16 source-code-diff: code block dropped; verbatim source:
```
/*eslint object-shorthand: ["error", "always", { "methodsIgnorePattern": "^bar$" }]*/

const foo = {
    bar: function() {}
};

```

L17 source-code-diff: code block dropped; verbatim source:
```
{
    "object-shorthand": ["error", "always", { "avoidExplicitReturnArrows": true }]
}

```

L18 source-code-diff: code block dropped; verbatim source:
```
/*eslint object-shorthand: ["error", "always", { "avoidExplicitReturnArrows": true }]*/

const foo = {
  foo: (bar, baz) => {
    return bar + baz;
  },

  qux: (foobar) => {
    return foobar * 2;
  }
};

```

L19 source-code-diff: code block dropped; verbatim source:
```
/*eslint object-shorthand: ["error", "always", { "avoidExplicitReturnArrows": true }]*/

const foo = {
  foo(bar, baz) {
    return bar + baz;
  },

  qux: foobar => foobar * 2
};

```

L20 source-code-diff: code block dropped; verbatim source:
```
/*eslint object-shorthand: [2, "consistent"]*/

const foo = {
    a,
    b: "foo",
};

```

L21 source-code-diff: code block dropped; verbatim source:
```
/*eslint object-shorthand: [2, "consistent"]*/

const foo = {
    a: a,
    b: "foo"
};

const bar = {
    a,
    b,
};

```

L22 source-code-diff: code block dropped; verbatim source:
```
/*eslint object-shorthand: [2, "consistent-as-needed"]*/

const foo = {
    a: a,
    b: b,
};

```

