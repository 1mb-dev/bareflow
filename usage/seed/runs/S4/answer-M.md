# Watching a file or directory from a Rolldown plugin

Call `this.addWatchFile(id)` on the plugin context. [doc]

```js
this.addWatchFile(id);
```

Signature: `(id: string) => void`. It is a method on `PluginContext`. [doc]

- `id` is the path to monitor. It can be an absolute path to a file or directory, or a path relative to the `cwd` option. [doc]
- It adds files to be monitored in watch mode, so changes to them trigger rebuilds. [doc]
- It returns `void`. [doc]

## Example

```js
import path from 'node:path';

export default function myPlugin() {
  return {
    name: 'my-plugin',
    transform(code, id) {
      // Watch a file this module depends on.
      this.addWatchFile(path.resolve('config/schema.json'));
      // A directory is also accepted.
      this.addWatchFile(path.resolve('content'));
      return null;
    },
  };
}
```

The `path.resolve` calls and the `transform` hook choice are my illustration; the doc only specifies the `this.addWatchFile(id)` call. [memory]

## Notes

- Call it from the hook that depends on the watched file. [doc]
- In watch mode, `transform` normally re-runs for a module only if that module's contents changed. Calling `this.addWatchFile` inside `transform` makes `transform` re-run for that module when the watched file changes. [doc]
- If you are emitting an asset that corresponds to an existing file, set `originalFileName` in the `this.emitFile` call instead. That watches the file and makes the connection visible to other plugins. [doc]
