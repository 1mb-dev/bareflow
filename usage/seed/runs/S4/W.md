# Adding Files to Watch in Rolldown Plugins

To add a file or directory to be watched in a Rolldown plugin, use the `addWatchFile()` method from the plugin context:

```javascript
this.addWatchFile(id)
```

**Example usage:**

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

**Key details:**
- The `id` parameter accepts an absolute path to a file or directory, or a path relative to the `cwd` option
- This ensures rebuilds trigger when the watched file changes
- It's recommended to use `originalFileName` in `emitFile()` instead when emitting assets corresponding to existing files, as that provides better plugin transparency
- In watch mode, using this in a transform hook ensures the transform re-evaluates if the watched file changes
