# Why the signed cookie disappears

No documentation file was attached to this question, so every claim below is [memory].

## Root cause

`setSignedCookie(c, name, value, secret, opts)` signs the value and attaches a
`Set-Cookie` header by calling `c.header('set-cookie', ..., { append: true })`
under the hood [memory]. That call mutates headers tracked against Hono's own
context response, `c.res` [memory].

Hono only ships those tracked headers to the client when the handler's return
value ends up being `c.res` itself (returning nothing and letting Hono finalize
it, mutating `c.res` directly, or explicitly returning `c.res`) [memory]. When
your handler instead does:

```js
app.get('/page', async (c) => {
  await setSignedCookie(c, 'session', value, secret)
  return c.env.ASSETS.fetch(c.req.raw)   // <-- a brand-new Response
})
```

`c.env.ASSETS.fetch()` returns a completely different `Response` object — the
one built by the static-assets binding, carrying its own `content-type`,
`etag`, `cache-control`, etc. [memory]. Hono never merges the headers it
accumulated on `c.res` into a Response you return yourself; it just sends the
returned object as-is [memory]. The `Set-Cookie` header lives only on the
now-discarded `c.res`, so it never reaches the browser [memory].

This isn't specific to `setSignedCookie` or to `ASSETS.fetch` — the same thing
happens with plain `setCookie`, `c.header('x-foo', ...)`, or any other
context-level header call, any time the handler's final return value is a
Response object Hono didn't build (e.g. the result of a `fetch()` call to an
origin, another binding, or a manually constructed `new Response(...)`)
[memory]. It's a common gotcha in proxy-style Hono handlers [memory].

## Fix: copy the cookie onto the returned response

Grab the header(s) Hono already computed before you discard `c.res`, and
reattach them to the response you actually return:

```js
app.get('/page', async (c) => {
  await setSignedCookie(c, 'session', value, secret, { httpOnly: true, secure: true })

  const assetRes = await c.env.ASSETS.fetch(c.req.raw)
  const res = new Response(assetRes.body, assetRes)

  for (const cookie of c.res.headers.getSetCookie()) {
    res.headers.append('set-cookie', cookie)
  }

  return res
})
```

Notes:

- Use `Headers.getSetCookie()`, not `Headers.get('set-cookie')`, if there's any
  chance of more than one cookie being set in the handler. `.get()` on a
  standard `Headers` object can fold multiple `Set-Cookie` values into one
  comma-joined string, which is invalid for that header (browsers won't parse
  it as two cookies); `getSetCookie()` exists specifically to return each
  value separately, and it's available in the Cloudflare Workers runtime
  [memory].
- `new Response(assetRes.body, assetRes)` copies status/statusText/headers
  from `assetRes` and reuses its body stream unread, so the static asset body
  still streams through untouched; you're only adding a header, not buffering
  the file [memory].
- The same pattern applies any time you proxy/forward another Response
  (upstream `fetch`, another Worker binding, a Pages redirect) from inside a
  Hono handler after having called `c.header()` / `setCookie()` /
  `setSignedCookie()`: always merge the tracked cookie/header values onto the
  Response you actually return, since Hono won't do it for you [memory].
