// GET /_fetch: the Pages Function. Everything but the platform's fetch and byte limiter is in
// src/edge.js. FixedLengthStream is a Workers API: it errors past (or short of) n bytes, natively.
import { handler } from "../src/edge.js";

export const onRequestGet = handler((url, init) => fetch(url, init), { limit: (n) => new FixedLengthStream(n) });
