// The workflows' trust rules, read by verify. readYaml is a subset of YAML, fail-closed: block
// mappings and sequences, plain and quoted scalars, `|` blocks, and a flow sequence of plain words.
// Anything else (a flow map, an anchor or alias, a merge key, a tab, a document marker, a tag, a
// folded block, a __proto__ key) throws: a construct the reader does not know is never read as
// something it does.
// Scalars stay strings: `false` is "false".

const WORD = /^[\w.-]+$/;

export function readYaml(text) {
  if (text.includes("\t")) throw new Error("a tab");
  const lines = text.split("\n").map((raw, n) => ({ raw, n: n + 1 }));
  for (const { raw, n } of lines) if (/^(---|\.\.\.)(\s|$)/.test(raw)) throw new Error(`line ${n}: a document marker`);
  // Comments and blank lines go, except inside a block scalar, which takes its lines raw.
  const live = (l) => l.raw.trim() !== "" && !/^\s*#/.test(l.raw);
  const indent = (l) => l.raw.length - l.raw.trimStart().length;
  let i = 0;
  const skip = () => { while (i < lines.length && !live(lines[i])) i++; };
  const fail = (l, why) => { throw new Error(`line ${l.n}: ${why}`); };

  function scalar(s, l) {
    s = s.trim();
    if (s.startsWith("'")) { if (!/^'(?:[^']|'')*'$/.test(s)) fail(l, "an unclosed or trailing single quote"); return s.slice(1, -1).replaceAll("''", "'"); }
    if (s.startsWith('"')) { const m = s.match(/^"([^"\\]*)"$/); if (!m) fail(l, "a double-quoted scalar with an escape or trailing text"); return m[1]; }
    if (s.startsWith("[")) {
      const m = s.match(/^\[\s*(.*?)\s*\]$/);
      const items = m && m[1] !== "" ? m[1].split(/\s*,\s*/) : m ? [] : null;
      if (!items || !items.every((w) => WORD.test(w))) fail(l, "a flow sequence other than plain words");
      return items;
    }
    const plain = s.replace(/\s+#.*$/, "");
    if (/^[{&*!%@`>|?,\]}]/.test(plain) || /^-(\s|$)/.test(plain)) fail(l, `a construct outside the subset: ${plain.slice(0, 20)}`);
    if (/:(\s|$)/.test(plain)) fail(l, "a mapping inside a plain scalar");
    return plain;
  }

  // A `|` or `|-` block: the lines indented past the key, dedented by the first one.
  function block(l, at, keep) {
    const out = [];
    let by = -1;
    i++;
    while (i < lines.length) {
      const b = lines[i];
      if (b.raw.trim() === "") { out.push(""); i++; continue; }
      if (indent(b) <= at) break;
      if (by < 0) by = indent(b);
      if (indent(b) < by) fail(b, "a block line indented less than the first");
      out.push(b.raw.slice(by));
      i++;
    }
    while (out.length && out.at(-1) === "") out.pop();
    if (!out.length) fail(l, "an empty block scalar");
    return out.join("\n") + (keep ? "\n" : "");
  }

  // The value after `key:` or `- `: a block scalar, a nested block, nothing, or a scalar.
  function value(rest, l, at) {
    if (rest === "|" || rest === "|-") return block(l, at, rest === "|");
    i++;
    if (rest !== "" && !/^#/.test(rest)) return scalar(rest, l);
    skip();
    if (i < lines.length && indent(lines[i]) > at) return node(indent(lines[i]));
    return null;
  }

  function mapping(at) {
    const out = {};
    for (skip(); i < lines.length && indent(lines[i]) === at && !/^-(\s|$)/.test(lines[i].raw.trim()); skip()) {
      const l = lines[i], m = l.raw.slice(at).match(/^([A-Za-z_][\w-]*):(?:\s+(.*))?$/);
      if (!m) fail(l, `not a plain key: ${l.raw.trim().slice(0, 30)}`);
      if (Object.hasOwn(out, m[1])) fail(l, `a duplicate key ${m[1]}`);
      // An object would drop it: a key the comparisons never see.
      if (m[1] === "__proto__") fail(l, "a __proto__ key");
      out[m[1]] = value((m[2] ?? "").trim(), l, at);
    }
    return out;
  }

  function sequence(at) {
    const out = [];
    for (skip(); i < lines.length && indent(lines[i]) === at && /^-(\s|$)/.test(lines[i].raw.trim()); skip()) {
      const l = lines[i], rest = l.raw.slice(at + 1).trim();
      if (/^[A-Za-z_][\w-]*:(\s|$)/.test(rest)) {
        // `- key: value` opens a mapping whose keys sit two columns in.
        l.raw = " ".repeat(at + 2) + l.raw.slice(at + 2);
        if (indent(l) !== at + 2) fail(l, "a sequence item not followed by one space");
        out.push(mapping(at + 2));
      } else out.push(value(rest, l, at));
    }
    return out;
  }

  function node(at) {
    skip();
    return /^-(\s|$)/.test(lines[i].raw.trim()) ? sequence(at) : mapping(at);
  }

  skip();
  if (i >= lines.length || indent(lines[i]) !== 0) throw new Error("no top-level mapping");
  const doc = mapping(0);
  skip();
  if (i < lines.length) fail(lines[i], "a line outside the structure");
  return doc;
}

// Each workflow as it must be, by file: every key and value but an action's commit (checked below and
// recorded in test/golden/workflows.json) and a step's name. A changed run line, env pair, grant,
// trigger, or new step is an edit here as well as in the workflow; a bless never turns one green.
const ORG_CI = "1mb-dev/.github/.github/workflows/ci-node.yml@main";
const CHECKOUT = { uses: "actions/checkout", with: { "persist-credentials": "false" } };
const NODE = { uses: "actions/setup-node", with: { "node-version": "24", "package-manager-cache": "false" } };
const WRANGLER = "node_modules/.bin/wrangler pages deploy dist/site --branch main";
// A full-history checkout and the line that refuses a commit off main: publish and deploy share both.
const HISTORY = { uses: CHECKOUT.uses, with: { "fetch-depth": "0", "persist-credentials": "false" } };
const ON_MAIN = 'git merge-base --is-ancestor "$GITHUB_SHA" origin/main';
export const TABLE = {
  "ci.yml": {
    on: { push: { branches: ["main"] }, pull_request: { branches: ["main"] } },
    permissions: { contents: "read" },
    jobs: { check: { uses: ORG_CI, with: { "node-versions": '["22", "24", "26"]', "run-build": "false", "run-audit": "false" } } },
  },
  "deploy.yml": {
    on: { push: { tags: ["v*"] }, workflow_dispatch: null },
    permissions: { contents: "read" },
    concurrency: { group: "deploy", "cancel-in-progress": "false" },
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        steps: [CHECKOUT, NODE, { run: "npm ci --ignore-scripts" }, { run: "npm test" }, { run: "npm run audit" },
          { run: "npm run site -- --deploy", env: { TURNSTILE_SITEKEY: "${{ vars.TURNSTILE_SITEKEY }}" } },
          { uses: "actions/upload-artifact", with: { name: "site", path: "dist/site", "if-no-files-found": "error", "retention-days": "1" } }],
      },
      deploy: {
        needs: "build", "runs-on": "ubuntu-latest", environment: "production",
        steps: [HISTORY, { run: ON_MAIN }, NODE, { run: "npm ci --ignore-scripts" },
          { uses: "actions/download-artifact", with: { name: "site", path: "dist/site" } },
          { run: "node scripts/artifact.js dist/site" },
          { run: WRANGLER, env: { CLOUDFLARE_API_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN }}", CLOUDFLARE_ACCOUNT_ID: "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}" } },
          { id: "smoke", run: "node scripts/smoke.js" },
          { if: "failure() && steps.smoke.outcome == 'failure'", run: "echo \"::error::smoke failed after the deploy, so this build is live in production. Roll back in the dashboard (Workers & Pages > bareflow > Deployments) to the last green deployment.\"" }],
      },
    },
  },
  "publish.yml": {
    on: { push: { tags: ["v*"] } },
    permissions: { contents: "read" },
    jobs: {
      check: { "runs-on": "ubuntu-latest", steps: [CHECKOUT, NODE, { run: "npm ci --ignore-scripts" }, { run: "npm test" }, { run: "npm run audit" }] },
      publish: {
        needs: "check", "runs-on": "ubuntu-latest", environment: "npm", permissions: { contents: "read", "id-token": "write" },
        steps: [HISTORY, NODE,
          { run: `grep -Eq '^v[0-9]+\\.[0-9]+\\.[0-9]+$' <<< "$GITHUB_REF_NAME" && test "$GITHUB_REF_NAME" = "v$(node -p 'require("./package.json").version')"` },
          { run: ON_MAIN },
          { run: "npm stage publish --ignore-scripts --provenance" }],
      },
    },
  },
  "probe.yml": {
    on: { schedule: [{ cron: "17 * * * *" }], workflow_dispatch: null },
    permissions: { contents: "read" },
    jobs: { probe: { "runs-on": "ubuntu-latest", steps: [CHECKOUT, NODE, { run: "node scripts/smoke.js --probe" }] } },
  },
};
// The only actions a step may use, each pinned to a commit (exact case: a lookalike is refused).
const ACTION = /^(actions\/(?:checkout|setup-node|upload-artifact|download-artifact))@([0-9a-f]{40})$/;
const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v);
// Equal as YAML reads them: key order does not count, array order does.
const canon = (v) => (Array.isArray(v) ? v.map(canon) : isMap(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

// A parsed workflow in the table's form: no top-level name, no step names, actions without their
// commit; every other key kept, so an unknown key is a difference.
function tableForm(doc) {
  const { name, ...rest } = doc;
  const jobs = isMap(rest.jobs) ? Object.fromEntries(Object.entries(rest.jobs).map(([j, job]) => {
    if (!isMap(job)) return [j, job];
    const steps = Array.isArray(job.steps) ? job.steps.map((st) => {
      if (!isMap(st)) return st;
      const { name: _, ...k } = st;
      if (typeof k.uses === "string") k.uses = k.uses.replace(ACTION, "$1");
      return k;
    }) : job.steps;
    return [j, steps === undefined ? job : { ...job, steps }];
  })) : rest.jobs;
  return { ...rest, jobs };
}

// faults({ "ci.yml": text, ... }) -> ["rule file: detail"]: each workflow equals its table entry (in
// table form), every step's action is an allowed one at a commit, names carry no expression, and no
// workflow is missing or new.
export function faults(files, table = TABLE) {
  const out = [];
  const bad = (rule, file, detail) => out.push(`${rule} ${file}: ${detail}`);
  for (const [file, text] of Object.entries(files)) {
    if (!Object.hasOwn(table, file)) { bad("unknown", file, "a workflow the table does not state"); continue; }
    let doc;
    try { doc = readYaml(text); } catch (e) { bad("unreadable", file, e.message); continue; }
    const got = tableForm(doc), want = table[file];
    for (const k of new Set([...Object.keys(got), ...Object.keys(want)])) {
      if (k === "jobs") continue;
      if (!same(got[k], want[k])) bad("table", file, `${k}: ${JSON.stringify(got[k]) ?? "absent"}, want ${JSON.stringify(want[k]) ?? "absent"}`);
    }
    const jobs = isMap(got.jobs) ? got.jobs : {};
    for (const j of new Set([...Object.keys(jobs), ...Object.keys(want.jobs)])) if (!same(jobs[j], want.jobs[j])) bad("table", file, `jobs.${j} differs from the table`);
    // Names are the golden's alone, so they stay plain text: an expression in one would be bless-only.
    if (typeof doc.name === "string" && doc.name.includes("${{")) bad("name", file, "an expression in the workflow's name");
    for (const [j, job] of Object.entries(isMap(doc.jobs) ? doc.jobs : {})) {
      for (const st of Array.isArray(job?.steps) ? job.steps : []) {
        if (st?.uses !== undefined && !ACTION.test(st.uses)) bad("uses", file, `${j}: ${st.uses}`);
        if (typeof st?.name === "string" && st.name.includes("${{")) bad("name", file, `${j}: an expression in a step's name`);
      }
    }
  }
  for (const file of Object.keys(table)) if (!Object.hasOwn(files, file)) bad("missing", file, "a workflow the table states is absent");
  return out;
}

// The parsed workflows, as the golden (test/golden/workflows.json) holds them: commits and names
// included, so an action bump is a recorded change.
export function parsed(files) {
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([f, t]) => { try { return [f, readYaml(t)]; } catch { return [f, null]; } }));
}

// Where the workflows differ from the golden, by path: "golden file: path: old -> new". A change is
// red until `node src/verify.js --bless-workflows` records it; for an action bump, first check the new
// commit is the tag's (gh api repos/<owner>/<action>/git/ref/tags/<tag>).
export function drift(files, golden) {
  const out = [];
  const walk = (a, b, path) => {
    if ((isMap(a) && isMap(b)) || (Array.isArray(a) && Array.isArray(b))) {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], [...path, k]);
      return;
    }
    if (a === b || same(a, b)) return;
    out.push(`golden ${path[0]}: ${path.slice(1).join(".") || "the file"}: ${JSON.stringify(b) ?? "absent"} -> ${JSON.stringify(a) ?? "absent"}`);
  };
  const now = parsed(files);
  for (const f of new Set([...Object.keys(now), ...Object.keys(golden)])) walk(now[f], golden[f], [f]);
  return out;
}
