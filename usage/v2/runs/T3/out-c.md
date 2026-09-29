# Changing Vite's dev server port

No documentation file was attached to this task, so the answer below is drawn from general
knowledge of Vite [memory].

## Option 1: config file (recommended for a permanent change)

Set `server.port` in `vite.config.js` (or `.ts`):

```js
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 3000
  }
})
```

This is the standard way to pin the dev server to a specific port every time you run
`vite` / `npm run dev` [memory].

## Option 2: CLI flag (one-off or scripted)

```bash
vite --port 3000
```

or via an npm script:

```json
{
  "scripts": {
    "dev": "vite --port 3000"
  }
}
```

A CLI flag passed at invocation time overrides whatever is set in `vite.config.js` [memory].

## Option 3: environment variable

Vite doesn't read a dedicated `PORT` env var out of the box the way some other tools do, but
since `vite.config.js` is just JS, you can wire one up yourself:

```js
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: Number(process.env.PORT) || 5173
  }
})
```

[memory]

## Related option: fail instead of auto-incrementing

By default, if the requested port is already in use, Vite will pick the next free port and
print a warning rather than fail. If you want it to error out instead (useful in CI or when
you need a guaranteed port), set `strictPort: true` alongside `port`:

```js
export default defineConfig({
  server: {
    port: 3000,
    strictPort: true
  }
})
```

[memory]

## Summary

- Quick/one-off: `vite --port <n>`
- Permanent/project default: `server.port` in `vite.config.js`
- CLI flag takes precedence over the config file value.
- Add `server.strictPort: true` if you don't want Vite silently falling back to another port.

All claims above are marked [memory] since no attached documentation file was available to
cite for this answer.
