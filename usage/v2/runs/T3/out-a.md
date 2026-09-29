# Changing Vite's dev server port

## Config file (recommended)

Set `server.port` in `vite.config.js`:

```js
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 3000,
  },
})
```

- `server.port` — type `number`, default `5173`. [doc]
- If the port you set is already in use, Vite automatically tries the next available port, so the port you configured may not be the one it actually ends up listening on. [doc]
- If you want it to fail instead of silently picking a different port, set `server.strictPort: true` alongside it: [doc]

```js
export default defineConfig({
  server: {
    port: 3000,
    strictPort: true,
  },
})
```

## CLI flag

You can also override the port from the command line without touching the config file, e.g. `vite --port 3000`. [memory] The attached doc explicitly documents a CLI equivalent for `server.host` (`--host 0.0.0.0` / `--host`), but its `server.port` entry does not call out a CLI flag directly — the `--port` flag above is from general Vite CLI knowledge, not stated on this page. [doc] (for the host CLI note) / [memory] (for `--port` existing).

## Summary

- Quickest one-off change: `vite --port 3000` [memory]
- Persistent project setting: `server.port` in `vite.config.js`, default `5173` [doc]
- Add `server.strictPort: true` if you need a hard failure instead of Vite auto-selecting the next free port [doc]
