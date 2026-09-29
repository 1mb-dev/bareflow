# Why setSignedCookie()'s cookie never reaches the browser

Two things compound:

1. **`setSignedCookie` doesn't return a Response — it mutates the Context's header state.** It calls `c.header('Set-Cookie', <signed-value>, { append: true })` internally, which stages the header on the Hono `Context` object (`c`), not on any particular Response instance [memory]. That staged header only ends up on the final Response when Hono builds the response itself — e.g. via `c.text()`, `c.json()`, `c.body()`, or by using `c.res` as the return value [memory]. The attached docs confirm the call shape (`await setSignedCookie(c, name, value, secret, options)`, called on `c`, returns a Promise) [doc] but say nothing about what happens if the handler's return value is a Response Hono didn't build [memory].

2. **`c.env.ASSETS.fetch()` returns a completely separate, already-built Response.** When the handler does `return c.env.ASSETS.fetch(c.req.raw)`, that Response comes from the Workers static-assets binding with its own headers (content-type, etag, cache-control, etc.). Hono passes it through essentially as-is — it does not retroactively merge in headers you staged on `c` earlier in the handler [memory]. So the `Set-Cookie` header from `setSignedCookie` was written to the wrong object and is silently dropped.

A third wrinkle if you try to patch this by hand: Response objects returned by any `fetch()` call in the Workers runtime — including `ASSETS.fetch()` — have **immutable** `Headers`. Calling `.append()`/`.set()` directly on `assetRes.headers` throws `TypeError: immutable headers` [memory]. You have to reconstruct the Response before you can add a header to it.

## Fix

The doc itself documents the escape hatch for exactly this situation: `generateSignedCookie` (unlike `setSignedCookie`) only builds the cookie string — "these functions only generate the cookie strings. You need to manually set them in headers if needed" [doc]. Use it to get the `Set-Cookie` value, then attach it yourself to a mutable clone of the assets Response:

```ts
import { generateSignedCookie } from 'hono/cookie'

app.get('*', async (c) => {
  const assetRes = await c.env.ASSETS.fetch(c.req.raw)

  // fetch() responses (including ASSETS.fetch()) have immutable headers,
  // so clone into a new Response before mutating it.
  const res = new Response(assetRes.body, assetRes)

  const cookie = await generateSignedCookie(
    'session',
    'value',
    secret,
    { path: '/', httpOnly: true, secure: true, sameSite: 'Strict' }
  )
  res.headers.append('Set-Cookie', cookie)

  return res
})
```
[doc] for `generateSignedCookie`'s existence/purpose and its options object (same fields as `setCookie`/`setSignedCookie`: path, secure, httpOnly, sameSite, etc.) [doc]; the immutable-headers workaround and overall pattern are [memory].

### Alternative: keep using `setSignedCookie`

If you'd rather keep the convenience function, the ordering trick is to make the assets Response the Context's *own* response before calling it, so Hono's header buffering targets that Response instead of a throwaway internal buffer:

```ts
app.get('*', async (c) => {
  const assetRes = await c.env.ASSETS.fetch(c.req.raw)
  c.res = new Response(assetRes.body, assetRes) // mutable clone; marks context "finalized"

  await setSignedCookie(c, 'session', 'value', secret, {
    path: '/', httpOnly: true, secure: true, sameSite: 'Strict',
  })

  return c.res
})
```
Once `c.res` has been assigned, Hono's context is "finalized" and `c.header()`/`setSignedCookie` write straight onto that Response's headers instead of a buffer nothing reads [memory]. Either approach works; `generateSignedCookie` + manual append is more explicit about what's happening and is the pattern the docs point at directly [doc].
