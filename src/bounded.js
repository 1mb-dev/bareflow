// convert() in a worker thread, stopped at CONVERT_TIMEOUT. A conversion is synchronous work no
// timer on this thread can interrupt; terminating the thread can. Node only: the web runs the same
// convert() in a Web Worker with the same deadline (site/app.js). The deadline counts from thread
// start, loading included; `started` on a slow error says the conversion itself had begun. The
// thread's old space is capped at heapMb and at this process's whole heap limit (the thread's young
// generation comes on top): past it Node ends the thread (the process lives), refused as "memory"
// once the conversion has started. `heapMb` on a slow or memory error is the cap the thread was
// given. A V8 heap flag on the process (NODE_OPTIONS) replaces every thread's cap; README says so.
// A Worker's stdout reaches this process's stdout by default, where the page goes: to stderr instead.
import { getHeapStatistics } from "node:v8";
import { Worker } from "node:worker_threads";
import { CONVERT_TIMEOUT, HEAP_MB } from "./fetch-policy.js";

export const heapCap = (heapMb = HEAP_MB) => Math.min(heapMb, Math.floor(getHeapStatistics().heap_size_limit / 1048576));

export function convertBounded(args, timeout = CONVERT_TIMEOUT, heapMb = HEAP_MB) {
  const host = URL.canParse(args.finalUrl ?? args.url) ? new URL(args.finalUrl ?? args.url).hostname : undefined;
  return new Promise((resolve, reject) => {
    const thread = new Worker(new URL("./convert-thread.js", import.meta.url), { workerData: args, stdout: true, resourceLimits: { maxOldGenerationSizeMb: heapCap(heapMb) } });
    thread.stdout.pipe(process.stderr);
    let started = false, settled = false, readBack;
    const done = (settle, value) => { if (settled) return; settled = true; clearTimeout(timer); thread.terminate(); settle(value); };
    const timer = setTimeout(() => done(reject, Object.assign(new Error(`the conversion took over ${timeout} ms`), { code: "slow", host, started, heapMb: readBack })), timeout);
    thread.on("message", (m) => {
      if (m.started) { started = true; readBack = m.heapMb; }
      else if (m.error) done(reject, Object.assign(new Error(m.error.message), m.error));
      else done(resolve, m.result);
    });
    // Matched by code: the message is Node's and changes between versions. Before {started} the
    // converter itself did not load, which says nothing about the page: Node's error goes through.
    thread.once("error", (e) => done(reject, e?.code === "ERR_WORKER_OUT_OF_MEMORY" && started
      ? Object.assign(new Error(`the conversion needed over ${readBack} MB of heap`), { code: "memory", host, started, heapMb: readBack })
      : e));
    thread.once("exit", (code) => done(reject, new Error(`the conversion thread exited (code ${code}) without a result`)));
  });
}
