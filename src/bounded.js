// convert() in a worker thread, stopped at CONVERT_TIMEOUT. A conversion is synchronous work no
// timer on this thread can interrupt; terminating the thread can. Node only: the web runs the same
// convert() in a Web Worker with the same deadline (site/app.js).
import { Worker } from "node:worker_threads";
import { CONVERT_TIMEOUT } from "./fetch-policy.js";

export function convertBounded(args, timeout = CONVERT_TIMEOUT) {
  const host = URL.canParse(args.finalUrl ?? args.url) ? new URL(args.finalUrl ?? args.url).hostname : undefined;
  return new Promise((resolve, reject) => {
    const thread = new Worker(new URL("./convert-thread.js", import.meta.url), { workerData: args });
    const done = (settle, value) => { clearTimeout(timer); thread.terminate(); settle(value); };
    const timer = setTimeout(() => done(reject, Object.assign(new Error(`the conversion took over ${timeout} ms`), { code: "slow", host })), timeout);
    thread.once("message", (m) => (m.error ? done(reject, Object.assign(new Error(m.error.message), m.error)) : done(resolve, m.result)));
    thread.once("error", (e) => done(reject, e));
  });
}
