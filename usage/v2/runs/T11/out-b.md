# Why the signed cookie never reaches the browser

## Root cause

`setSignedCookie(c, ...)` doesn't hand you a header value to send — it writes a
`Set-Cookie` header directly onto Hono's own response object, `c.res` [memory]. That
works fine as long as the handler finishes by building on top of `c.res` (e.g.
`c.text()`, `c.json()`, `c.body()`, or simply falling through).

The moment your handler does `return c.env.ASSETS.fetch(request)`, you're
returning an entirely different `Response` object — one that came from the
`ASSETS` binding, not from Hono's context. Hono just forwards whatever
`Response` the handler returns as the final response; it does not go merge the
headers you accumulated on `c.res` into a response object your handler
returns separately [memory]. The `Set-Cookie` header that `setSignedCookie`
wrote lives on a response nobody ever sends — it's discarded along with the
rest of `c.res`.

## A second trap if you try to patch it manually

If you try to fix this by grabbing the asset response and setting the header
on it directly:

```js
const assetResponse = await c.env.ASSETS.fetch(c.req.raw)
assetResponse.headers.set('set-cookie', cookieValue) // throws
```

this throws, because a `Response` obtained directly from a `fetch()` call
(including a `Fetcher`/service-binding fetch like `ASSETS.fetch()`) has an
**immutable** `Headers` guard in the Workers runtime — you can't mutate it in
place [memory]. You have to construct a *new* `Response` wrapping the same
body/status to get a mutable `Headers` object.

## Fix

The doc's `generateSignedCookie` is built for exactly this situation: unlike
`setSignedCookie`, it only returns the cookie string and never touches any
response object [doc], so it doesn't matter that you're returning a response
Hono never saw:

```js
import { generateSignedCookie } from 'hono/cookie'

app.get('*', async (c) => {
  const secret = c.env.COOKIE_SECRET

  const signedCookie = await generateSignedCookie(
    'session',
    'user-id-123',
    secret,
    { path: '/', httpOnly: true, secure: true, sameSite: 'Strict' } // [doc] option names
  )

  const assetResponse = await c.env.ASSETS.fetch(c.req.raw)

  // Wrap the immutable fetch() Response so we get a mutable Headers object.
  const response = new Response(assetResponse.body, assetResponse)
  response.headers.append('set-cookie', signedCookie)
  return response
})
```

If you'd rather keep using `setSignedCookie(c, ...)` for the convenience, pull
the header it wrote off `c.res` and re-apply it to the response you actually
return:

```js
app.get('*', async (c) => {
  await setSignedCookie(c, 'session', 'user-id-123', secret, {
    path: '/',
    httpOnly: true,
  })

  const assetResponse = await c.env.ASSETS.fetch(c.req.raw)
  const response = new Response(assetResponse.body, assetResponse)

  const cookieHeader = c.res.headers.get('set-cookie')
  if (cookieHeader) response.headers.append('set-cookie', cookieHeader)

  return response
})
```

Use `.append()`, not `.set()` — `Headers.set` would overwrite/collapse the
header instead of adding a distinct `Set-Cookie` entry, which matters as soon
as you set more than one cookie [memory].

## Note

`getSignedCookie` treats a cookie with no valid signature format as absent
(`undefined`) and a cookie with a signature that fails verification as
`false` — both falsy, so `if (!value)` covers both cases [doc]. Not the cause
of this bug, but worth knowing if you're also reading the cookie back on a
later request to gate access to `ASSETS.fetch()`.
