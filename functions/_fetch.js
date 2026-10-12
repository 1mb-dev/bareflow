// GET /_fetch: the Pages Function. Everything but the platform's fetch is in src/edge.js.
import { handler } from "../src/edge.js";

export const onRequestGet = handler((url, init) => fetch(url, init));
