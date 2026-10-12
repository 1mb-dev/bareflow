// The browser bundle: convert() and its imports as one minified IIFE exposing `bareflow.convert`.
// verify builds it with these same options and diffs it with the CLI, so what ships is what is
// checked. `npm run bundle` writes dist/bareflow.js.
import { build } from "esbuild";
import { writeFile, mkdir } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function bundle() {
  const out = await build({
    entryPoints: [join(ROOT, "src/convert.js")],
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
