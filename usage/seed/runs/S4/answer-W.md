# Watching a file or directory from a Rolldown plugin

Call `addWatchFile()` on the plugin context (`this`) [doc]:

```javascript
this.addWatchFile(id)
```

`id` is an absolute path to a file or directory, or a path relative to the `cwd` option [doc].

Example [doc]:

```javascript
export default function myPlugin() {
  return {
    name: 'my-plugin',
    transform(code, id) {
      // Watch a specific file for changes
      this.addWatchFile('/path/to/config.json');
      // ... transform logic
    }
  };
}
```

Notes:
- Rebuilds trigger when the watched file changes [doc].
- Called in a `transform` hook in watch mode, the transform re-evaluates when the watched file changes [doc].
- If you are emitting an asset that corresponds to an existing file, the doc recommends `originalFileName` in `emitFile()` instead, for better plugin transparency [doc].
- `this` must be a regular function context. Define hooks as methods or `function`, not arrow functions, so `this` is the plugin context [memory].
- `addWatchFile` is available in build hooks such as `buildStart`, `resolveId`, `load` and `transform` [memory].
