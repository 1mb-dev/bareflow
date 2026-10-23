// GET /_fetch: the Pages Function. Everything but the platform's fetch, byte limiter, and Analytics
// Engine binding is in src/edge.js. FixedLengthStream is a Workers API: it errors past (or short of) n
// bytes, natively. OUTCOMES is wrangler.toml's Analytics Engine dataset; a write that fails is dropped.
import { counted, handler } from "../src/edge.js";

export const onRequestGet = counted(handler((url, init) => fetch(url, init), { limit: (n) => new FixedLengthStream(n) }), (env, blobs) => env.OUTCOMES.writeDataPoint({ blobs }));
