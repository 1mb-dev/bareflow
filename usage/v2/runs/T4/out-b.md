# Sharing a logged-in session across Vitest Browser Mode test files

## Why there's no direct equivalent

The attached page is Vitest's Browser Mode overview (install, config, running tests, examples,
limitations) [doc]. It documents providers (`preview`, `playwright`, `webdriverio`) and shows
`browser.instances` config with a provider like `playwright()` [doc], but it does not cover
authentication, session sharing, or storage state anywhere in this page [doc].

Playwright Test's `storageState` / `auth.setup.ts` pattern relies on its own runner's project
dependency graph (`projects: [{name:'setup'}, {name:'chromium', dependencies:['setup']}]`).
Vitest doesn't have that concept — it has `globalSetup` (runs once per whole run, in Node) and
`setupFiles` (runs per test file, in whichever environment that file uses, including the browser
iframe) [memory]. Since `@vitest/browser-playwright` drives the browser via Playwright underneath
[doc: "playwright supports these browsers"], you can still get the storageState pattern back —
you just wire it up yourself instead of getting it for free from the test runner.

## Pattern: log in once, replay state into every file

**1. Do the real login exactly once, outside the per-file browser session.**

Use Vitest's `globalSetup` (plain Node, runs once before any test file starts) to either drive a
throwaway Playwright browser through the login UI, or just hit your auth API directly if you have
one — the latter is faster and doesn't need a browser at all [memory].

```ts
// scripts/auth-setup.ts
import { chromium } from 'playwright'

export default async function globalSetup() {
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${process.env.APP_URL}/login`)
  await page.getByLabel('Email').fill(process.env.TEST_USER!)
  await page.getByLabel('Password').fill(process.env.TEST_PASS!)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard')
  await context.storageState({ path: '.auth/state.json' })
  await browser.close()
}
```

**2. Feed that captured state into the browser instance's context, so every test file's page
starts already authenticated.**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  test: {
    globalSetup: './scripts/auth-setup.ts',
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [
        {
          browser: 'chromium',
          // passed through to Playwright's browser.newContext()
          context: { storageState: '.auth/state.json' },
        },
      ],
    },
  },
})
```

This is the load-bearing trick: the instance-level context options are forwarded to Playwright's
own `newContext()`, so `storageState` (cookies + localStorage, including httpOnly cookies) is
seeded before any page in any test file loads [memory]. I'm not fully certain of the exact option
key (`context` vs `contextOptions`) for your installed `@vitest/browser-playwright` version —
check that package's config reference, since this shape has moved between Vitest major versions
[memory].

Cookies must go in through this context-level option, not through `document.cookie` in a
`setupFiles` script — by the time `setupFiles` runs, the page/context already exists, and
`document.cookie` can't set httpOnly cookies anyway [memory].

## Alternative: token-only auth, no browser needed for login

If your app uses a bearer token rather than session cookies, skip the UI login and pass the token
through Vitest's `provide`/`inject` bridge, which exists precisely to move data from `globalSetup`
(Node) into test files (any environment, including the browser) [memory]:

```ts
// scripts/auth-setup.ts
export default async function setup({ provide }) {
  const res = await fetch(`${process.env.APP_URL}/api/login`, {
    method: 'POST',
    body: JSON.stringify({ user: process.env.TEST_USER, pass: process.env.TEST_PASS }),
  })
  const { token } = await res.json()
  provide('authToken', token)
}
```

```ts
// vitest.setup.ts -- registered as `browser.instances[].setupFiles` or top-level `setupFiles`
import { beforeAll, inject } from 'vitest'

beforeAll(() => {
  localStorage.setItem('auth_token', inject('authToken'))
})
```

`setupFiles` re-runs per test file, but that's cheap here — it's just a `localStorage.setItem`
using the value already fetched once in `globalSetup`, not a repeated login [memory].

## Notes

- The expensive step (real login) happens once per run in `globalSetup`; every test file only
  replays cheap state (context storageState or a `localStorage.setItem`) [memory].
- The Browser Mode sidebar lists a "Multiple Setups" page right after "Getting Started" [doc],
  which is aimed at exactly this kind of per-instance setup variation (e.g. one instance/project
  pre-authenticated, another anonymous). Its body wasn't part of the attached excerpt, so I can't
  quote it — worth reading directly before finalizing your config [memory].
- If different test files need different identities (not just one shared session), give each its
  own `storageState` file and put them on separate `browser.instances` (or `projects`) entries
  rather than trying to swap state mid-run on a shared instance [memory].
