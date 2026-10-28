// The worker thread src/bounded.js starts: one conversion, its result or its error's fields back.
import { parentPort, resourceLimits, workerData } from "node:worker_threads";
import { convert } from "./convert.js";

// The cap as this thread was given it, so a refusal names it.
parentPort.postMessage({ started: true, heapMb: resourceLimits.maxOldGenerationSizeMb });
try {
  parentPort.postMessage({ result: await convert(workerData) });
} catch (e) {
  parentPort.postMessage({ error: { message: String(e?.message || e), code: e?.code, shape: e?.shape, host: e?.host } });
}
