# Sharing a login session across Vitest browser mode test files

No attached doc for this question; everything below is [memory].

## Why there's no direct equivalent

Playwright's `storageState` + `auth.setup.ts` + project `dependencies` are features of the
`@playwright/test` runner. [memory] Vitest browser mode uses Playwright (or WebdriverIO,
or `preview`) only as a browser driver underneath its own runner, so none of `@playwright/test`'s
runner-level features (fixtures, projects, dependency graph, storageState) apply. [memory]
You rebuild the equivalent from three Vitest primitives: `globalSetup` (Node-side, once
per run), a custom browser `command` (Node-side, has access to the real Playwright
`context`), and `setupFiles` (browser-side, runs per test file). [memory]

Also relevant: browser mode isolates each test file into a fresh browser context by
default for test isolation. [memory] That means "share the session" in practice means
"replay a cheap, already-obtained auth state into every file's fresh context," not
"reuse one literal browser tab." This is the same shape Playwright itself uses when a
project sets `storageState` -- it also re-hydrates a saved state into a new context per
test file. [memory]

## Pattern: log in once via API, replay via a custom command

**1. Real login happens once, in Node, outside the browser** (`globalSetup`):

```ts
// test/global-setup.ts
import { mkdir, writeFile } from 'node:fs/promises'

export default async function setup() {
  const res = await fetch('http://localhost:3000/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'test@example.com', password: 'secret' }),
  })
  const { token } = await res.json()
  const setCookie = res.headers.get('set-cookie') // parse into {name, value, domain, path...} as needed

  await mkdir('.auth', { recursive: true })
  await writeFile(
    '.auth/user.json',
    JSON.stringify({
      cookies: setCookie ? [parseCookie(setCookie)] : [],
      origins: [
        { origin: 'http://localhost:3000', localStorage: [{ name: 'token', value: token }] },
      ],
    }),
  )
}
```

This is a plain HTTP call, no browser involved, so it runs once for the whole run --
the direct analog of Playwright's single `auth.setup.ts` project. [memory]

**2. A custom command hydrates that saved state into whatever context the test is about
to run in** (`vitest.config.ts`):

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: './test/global-setup.ts',
    setupFiles: ['./test/auth-setup.ts'],
    browser: {
      enabled: true,
      provider: 'playwright',
      instances: [{ browser: 'chromium' }],
      commands: {
        async applyAuthState({ context }) {
          const { readFile } = await import('node:fs/promises')
          const state = JSON.parse(await readFile('.auth/user.json', 'utf-8'))

          if (state.cookies?.length) await context.addCookies(state.cookies)

          for (const origin of state.origins ?? []) {
            await context.addInitScript({
              content: `(() => {
                const data = ${JSON.stringify(origin.localStorage)};
                for (const { name, value } of data) localStorage.setItem(name, value);
              })()`,
            })
          }
        },
      },
    },
  },
})
```

`commands` are Vitest's supported way to run privileged, Node-side code (with access to
the real Playwright `page`/`context`) from a test file. [memory] `context.addCookies` and
`context.addInitScript` are Playwright APIs; `addInitScript` is what lets you seed
`localStorage`/`sessionStorage` before any app script runs, since cookies alone don't
cover token-in-localStorage auth. [memory]

**3. Every test file calls it once, before its own tests, via `setupFiles`:**

```ts
// test/auth-setup.ts
import { beforeAll } from 'vitest'
import { commands } from '@vitest/browser/context'

beforeAll(async () => {
  await commands.applyAuthState()
})
```

`setupFiles` entries run in the browser context, per test file, before that file's
tests. [memory] Because the real login already happened once in `globalSetup`, each
file's `beforeAll` is just a cheap cookie/localStorage replay, not a UI login -- so you
get "log in once, share across files" without ever driving the login form more than
once. [memory]

## If you don't need per-file isolation

Setting `test.isolate: false` (and running with a single browser instance / no file
parallelism) keeps files from getting a fresh context each time, so a real UI-driven
login in the first file's `beforeAll`, guarded by a flag, persists for subsequent files
in the same run. [memory] This is simpler but trades away Playwright-style per-file
isolation, and is generally the worse default -- prefer the `globalSetup` + command
pattern above unless you have a specific reason to serialize. [memory]

## Token-in-header auth (no cookie/localStorage)

If your app sends the token as an `Authorization` header rather than reading it from
storage, hydrate it via request interception instead of `addInitScript`, e.g. a command
that calls `context.route('**/*', route => route.continue({ headers: { ...route.request().headers(), authorization: \`Bearer ${token}\` } }))`. [memory]
Same `globalSetup` (obtain token once) + `commands` (Node-side Playwright access) +
`setupFiles` (call it per file) shape applies.
