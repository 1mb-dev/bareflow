// convert() in a worker thread, stopped at CONVERT_TIMEOUT. A conversion is synchronous work no
// timer on this thread can interrupt; terminating the thread can. Node only: the web runs the same
// convert() in a Web Worker with the same deadline (site/app.js). The deadline counts from thread
// start, loading included; `started` on a slow error says the conversion itself had begun.
import { Worker } from "node:worker_threads";
import { CONVERT_TIMEOUT } from "./fetch-policy.js";

export function convertBounded(args, timeout = CONVERT_TIMEOUT) {
  const host = URL.canParse(args.finalUrl ?? args.url) ? new URL(args.finalUrl ?? args.url).hostname : undefined;
  return new Promise((resolve, reject) => {
    const thread = new Worker(new URL("./convert-thread.js", import.meta.url), { workerData: args });
    let started = false, settled = false;
    const done = (settle, value) => { if (settled) return; settled = true; clearTimeout(timer); thread.terminate(); settle(value); };
    const timer = setTimeout(() => done(reject, Object.assign(new Error(`the conversion took over ${timeout} ms`), { code: "slow", host, started })), timeout);
    thread.on("message", (m) => {
      if (m.started) started = true;
      else if (m.error) done(reject, Object.assign(new Error(m.error.message), m.error));
      else done(resolve, m.result);
    });
    thread.once("error", (e) => done(reject, e));
    thread.once("exit", (code) => done(reject, new Error(`the conversion thread exited (code ${code}) without a result`)));
  });
}
