// The states sheet's stand-ins (scripts/contact.js): a classic script that runs before the real
// app.js and answers /_fetch, Turnstile, and the worker as each failure would, so a person sees
// every state the shell can show. ?bf-state=<id> picks the state; "interactive" loads Cloudflare's
// real script with the dummy sitekey that forces a challenge (the server puts it on the body).
{
  const state = new URLSearchParams(location.search).get("bf-state");
  const octet = { "content-type": "application/octet-stream" };
  const bytes = (s) => () => new Response(new TextEncoder().encode(s), { headers: octet });
  const edge = (status, code, body, upstream, final) => () => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "x-bareflow-error": code, ...(upstream ? { "x-bareflow-status": String(upstream), "x-final-url": final } : {}) } });
  const http = (n, final = "https://docs.example.com/guide/") => edge(502, "upstream", `HTTP ${n} from ${final}; check the URL (bareflow does not retry)`, n, final);
  const FETCH = {
    "url-edge": edge(400, "url", "port 8080 in https://docs.example.com:8080/guide/: this site fetches ports 80 and 443 only"),
    "url-edge-long": edge(400, "url", "port 8443 in https://docs.example.com:8443/guide/a/long/path/that/shows/how/the/detail/line/wraps/and/where/it/is/cut: this site fetches ports 80 and 443 only"),
    redirect: edge(502, "redirect", "port 8443 in https://docs.example.com:8443/guide/: this site fetches ports 80 and 443 only"),
    blocked: edge(403, "blocked", "blocked address for 10.0.0.1: bareflow fetches public addresses only"),
    timeout: edge(504, "timeout", "no answer from https://docs.example.com/guide/ within 30000 ms (redirects included); retry, or open it in a browser"),
    "upstream-403": http(403), "long-host": http(403, "https://a-subdomain-label-that-runs-on-without-any-break-at-all.docs.example.com/guide/"), "upstream-403-redirect": http(403, "https://sso.vendor.example/login"), "upstream-404": http(404), "upstream-429": http(429), "upstream-503": http(503), "upstream-418": http(418),
    "upstream-none": edge(502, "upstream", "more than 5 redirects from https://docs.example.com/guide/"),
    "over-cap": edge(502, "over-cap", "the page is over 1 MB, this site's limit"),
    token: edge(403, "token", "the Turnstile check failed or expired; reload the page"),
    limited: () => new Response("", { status: 429 }),
    unavailable: edge(503, "unavailable", "the bot check service did not answer"),
    cut: () => new Response(new ReadableStream({ start(c) { c.error(new TypeError("network error")); } }), { headers: octet }),
    "not-html": bytes("\0binary"),
    blank: bytes(" "),
    "too-deep": bytes("<div>".repeat(300)), "too-big": bytes("<p></p>".repeat(50001)), slow: bytes("<p>a</p>"),
    empty: bytes("<html><body></body></html>"),
    convert: bytes("<p>a</p>"), converter: bytes("<p>a</p>"),
    interactive: bytes("<html><head><title>Install</title></head><body><main><h1>Install</h1><p>Run the installer, then open a new terminal.</p></main></body></html>"),
  };
  const real = window.fetch.bind(window);
  window.fetch = async (u, init) => (String(u).startsWith("/_fetch") && FETCH[state] ? FETCH[state]() : real(u, init));

  // The worker answers for itself, except a conversion that throws, a script that fails to load,
  // and one that never answers (slow: the app's deadline ends it).
  if (state === "slow") window.Worker = class { postMessage() { setTimeout(() => this.onmessage?.({ data: { started: true } })); } terminate() {} };
  if (state === "convert" || state === "converter") {
    window.Worker = class {
      postMessage() { setTimeout(() => (state === "converter" ? this.onerror?.({}) : this.onmessage?.({ data: { error: "convert", message: "Cannot read properties of undefined (reading 'blocks')" } })), 200); }
      terminate() {}
    };
  }

  // Turnstile: answered here unless the state is the real widget; a blocked script fails its load.
  if (state !== "interactive") {
    const append = document.head.append.bind(document.head);
    document.head.append = (...nodes) => {
      for (const n of nodes) {
        if (!String(n.src || "").startsWith("https://challenges.cloudflare.com/")) append(n);
        else if (state === "challenge") setTimeout(() => n.onerror?.(), 300); // else dropped unanswered: check-slow waits out the 10 s
      }
    };
    if (state !== "challenge" && state !== "check-slow") {
      window.turnstile = { render: (_, o) => setTimeout(() => (state === "check-timeout" ? o["timeout-callback"]?.() : o.callback("stub")), 300) };
    }
  }

  // A paste goes through the home's form, as a person's would; the real worker answers.
  const PASTE = { "paste-over-cap": `<p>${"a".repeat(5 * 1024 * 1024)}</p>`, "paste-empty": '<html><body><div id="app"></div></body></html>' };
  if (PASTE[state]) {
    document.addEventListener("DOMContentLoaded", () => setTimeout(() => {
      document.getElementById("paste-url").value = "https://docs.example.com/guide/";
      document.getElementById("paste-html").value = PASTE[state];
      document.getElementById("paste-form").requestSubmit();
    }, 100));
  }
}
