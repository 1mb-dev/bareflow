// The browser bundle: convert(), the fetch policy's snapshot() and MAX_BYTES, as one minified IIFE
// exposing `bareflow`. verify builds it with these same options and diffs it with the CLI, and the
// web app's worker is this bundle plus site/worker.js, so what ships is what is checked.
// `npm run bundle` writes dist/bareflow.js.
import { build } from "esbuild";
import { writeFile, mkdir } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function bundle() {
  const out = await build({
    stdin: { contents: 'export { convert } from "./src/convert.js"; export { snapshot, MAX_BYTES } from "./src/fetch-policy.js";', resolveDir: ROOT },
    bundle: true, format: "iife", globalName: "bareflow", platform: "browser", minify: true,
    write: false, logLevel: "silent",
  });
  return out.outputFiles[0].text;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const code = await bundle();
  await mkdir(join(ROOT, "dist"), { recursive: true });
  await writeFile(join(ROOT, "dist/bareflow.js"), code);
  console.log(`dist/bareflow.js ${code.length} bytes`);
}
