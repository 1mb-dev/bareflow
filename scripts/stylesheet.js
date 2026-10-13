// _app/style.css: the tokens first (verify's design check reads them there), then the rules. A leaf
// module: the site build and the card renderer both import it.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const stylesheet = async () => (await Promise.all(["site/tokens.css", "site/style.css"].map((f) => readFile(join(ROOT, f), "utf8")))).join("\n");
