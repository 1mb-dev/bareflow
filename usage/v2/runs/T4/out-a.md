# Sharing a logged-in session across Vitest browser mode test files

You're right that there's no `storageState` option and no `auth.setup.ts` /
project-dependency mechanism in Vitest browser mode [doc: the attached Browser
Mode guide has no mention of `storageState`, `auth.setup`, login, session, or
token anywhere in Installation, Configuration, Browser Option Types, Running
Tests, Headless, Examples, or Limitations]. The fix is to rebuild the same
three pieces Playwright Test gives you for free: acquire the session once,
persist it, and cheaply re-apply it before each file's tests run.

One correction to the premise first: Vitest browser mode instances can isolate
each test file into its own browser context/page rather than reusing one
context across files [memory]. So the real pattern isn't "one shared live
session object" -- it's "log in once, save the result, replay it per file,"
which is fast (no network round-trip) even though it repeats.

## 1. Acquire and persist once, in `globalSetup` (Node-side, runs before any
browser instance starts)

```ts
// vitest.global-setup.ts
import { chromium } from 'playwright' // real playwright, driven from Node directly

export default async function setup() {
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto(`${process.env.APP_URL}/login`)
  await page.getByLabel('Email').fill(process.env.TEST_USER!)
  await page.getByLabel('Password').fill(process.env.TEST_PASS!)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard')

  // same shape Playwright Test's storageState uses: cookies + localStorage
  await context.storageState({ path: '.auth/state.json' })
  await browser.close()
}
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  test: {
    globalSetup: './vitest.global-setup.ts',
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
})
```

[doc: `browser.enabled`, `browser.provider`, `browser.instances` are exactly
the config fields shown in the attached guide's Configuration section]
`globalSetup` itself is a plain Vitest option, unrelated to browser mode --
prefer hitting a login/token API directly here over driving a UI login if the
app has one; it's faster and less flaky [memory].

## 2. Re-apply the saved state before each test file runs

This is the part Vitest doesn't do for you automatically. Two options,
depending on what you're actually testing:

**(a) Custom browser command** -- a Node-side function that gets the real
Playwright `context` and can call `context.addCookies()` / inject localStorage
via `addInitScript`, invoked from a `setupFiles` entry [memory: `browser.commands`
is a real Vitest browser mode feature but does not appear in the attached
doc, which only goes as far as Installation/Configuration/Running
Tests/Headless/Examples/Limitations]:

```ts
// vitest.config.ts (add to the browser block)
browser: {
  commands: {
    async loadAuthState({ context }) {
      const state = JSON.parse(await readFile('.auth/state.json', 'utf-8'))
      await context.addCookies(state.cookies)
      await context.addInitScript((entries) => {
        for (const [k, v] of entries) localStorage.setItem(k, v)
      }, Object.entries(state.origins[0]?.localStorage ?? {}))
    },
  },
}
```

```ts
// browser-auth-setup.ts, referenced from instances[].setupFiles
import { commands } from '@vitest/browser/context'
await commands.loadAuthState()
```

**(b) Simpler, and usually sufficient if you're testing components rather than
a full running app**: skip cookies/UI login entirely and just seed a token
directly in `setupFiles`:

```ts
// browser-auth-setup.ts
localStorage.setItem('authToken', import.meta.env.VITE_TEST_TOKEN)
```

`setupFiles` as a per-instance array is a documented, real field -- it's used
exactly this way in the attached guide's sibling "Multiple Setups" page:
`instances: [{ browser: 'chromium', name: 'chromium-1', setupFiles:
['./ratio-setup.ts'], provide: { ratio: 1 } }]` [doc]. It runs before each
test file in that instance, which is what gives you the "log in once, applied
everywhere" effect in practice, even though it's technically replaying saved
state per file rather than sharing one session handle [memory].

## Which one to use

If you're doing real end-to-end tests against a running app, use (a):
`context.addCookies` matches what the app's server actually expects (real
cookie-based session). If you're doing component-level tests where the app
code just reads a token out of storage, (b) is less machinery for the same
result.

If the goal is genuinely full E2E with a shared authenticated session across
many spec files, it's worth checking whether Playwright Test itself (not
Vitest browser mode) is the better tool for that slice of the suite --
`storageState` + project dependencies is exactly what it's built for. The
attached guide's sibling "Why Browser Mode" page has a heading titled "Not a
Drop-In Replacement" [doc: heading text only -- its body paragraph was not
included in what I was given], which is consistent with that boundary, though
I can't quote its reasoning since the paragraph wasn't in the projection I have.
