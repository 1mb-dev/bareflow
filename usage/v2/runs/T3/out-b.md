# Changing Vite's dev server port

## Option 1: Config file (recommended for a persistent setting)

Set `server.port` in `vite.config.js`:

```js
export default defineConfig({
  server: {
    port: 3000,
  },
})
```

`server.port` is a `number`, defaulting to `5173` [doc]. Note the caveat: if the port you specify is already in use, Vite will automatically try the next available port, so the port you set may not be the one it actually ends up listening on [doc].

If you want Vite to fail instead of silently picking a different port, pair it with `server.strictPort: true`, which exits the process if the requested port is already taken rather than falling back to the next free one [doc]:

```js
export default defineConfig({
  server: {
    port: 3000,
    strictPort: true,
  },
})
```

## Option 2: CLI flag (one-off, no config change)

```bash
vite --port 3000
```

This isn't in the attached doc (which only documents a `--host` CLI flag explicitly [doc]), but Vite's CLI accepts a `--port <number>` flag that overrides `server.port` for that run [memory].

## Notes

- These `server.*` options apply only to the dev server, not to `vite preview` or `vite build`, unless a section says otherwise; the attached doc states server options apply only to dev unless noted [doc]. `preview.port` is the separate option for `vite preview`'s port [memory].
- If you need the server reachable from other devices on your network (not just localhost), that's the separate `server.host` option, not `server.port` [doc].
