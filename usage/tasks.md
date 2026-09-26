Pre-registered 2026-09-26. Picked by Linus persona by owner delegation, blind to auditor (no mdflow runs, no src/, test/, todos/ reads).
Both arms (mdflow --json vs plain fetch-to-text) get only the URL(s) listed. No swaps after registration.

## U1

- Task: Write a single Python script using the SQLAlchemy 2.0 ORM (DeclarativeBase / Mapped / mapped_column style) against in-memory SQLite. Define User(id, name) and Address(id, email, user_id) with a one-to-many relationship using back_populates in both directions. Create user "spongebob" with addresses "spongebob@sqlalchemy.org" and "spongebob@squarepants.com" by appending to the collection, commit. In a new Session, load all users with their addresses eagerly via selectinload and print `name: email1, email2` (emails sorted). Then fetch that user by primary key with Session.get, delete the "squarepants" Address with Session.delete, commit, and print the line again.
- URL: https://docs.sqlalchemy.org/en/20/tutorial/orm_related_objects.html
- Site/generator: docs.sqlalchemy.org / Sphinx (custom theme, doctest `>>>` blocks with interleaved SQL echo)
- Corpus: out
- Sibling-relevant: y. relationship/selectinload are on the given page; Session(engine), Session.get and Session.delete are on the rel=prev page (orm_data_manipulation.html).
- Layout-sensitive code: y (Python class bodies inside `>>>` / `...` doctest blocks)
- Pass: script runs without exception on current SQLAlchemy 2.0.x and stdout is exactly:
  `spongebob: spongebob@sqlalchemy.org, spongebob@squarepants.com`
  `spongebob: spongebob@sqlalchemy.org`
  Fail also if it uses `declarative_base()`, `session.query(`, or `Column(` on a mapped class.

## U2

- Task: Write `.github/workflows/release.yml` for a uv-managed Python package. On push of tags matching vX.Y.Z: a `test` job running `uv sync --locked --all-extras --dev` and `uv run pytest tests` on a Python 3.11/3.12/3.13 matrix with the uv cache enabled; a `build` job (needs test) running `uv build` with read-only contents permission; a `publish` job (needs build) that publishes to PyPI via trusted publishing in environment `pypi`. Pin every action by full commit SHA and pin the uv version, as the guide does.
- URL: https://docs.astral.sh/uv/guides/integration/github/
- Site/generator: docs.astral.sh / MkDocs (Material; content tabs, admonitions, titled code blocks)
- Corpus: out
- Sibling-relevant: n. Prev/next are other integrations (marimo, gitlab); any attached sibling content is noise, which is itself worth logging.
- Layout-sensitive code: y (YAML)
- Pass: actionlint reports 0 errors; every `uses:` ref is a 40-hex SHA that exists in the named upstream repo (git ls-remote / gh api); every `with:` key on astral-sh/setup-uv exists in that SHA's action.yml; `id-token: write` appears only on `publish`; `publish` needs `build` and `build` needs `test`; `test` contains both uv commands above verbatim.

## U3

- Task: Write `playwright.config.ts` for @playwright/test: tests in `./e2e`, fully parallel, fail the build on `test.only` in CI, retries 2 on CI and 0 locally, 1 worker on CI, HTML reporter, baseURL `http://localhost:3000`, trace `on-first-retry`, screenshot only on failure, video retained only on failure, projects for Desktop Chrome and Desktop Safari, and a webServer running `npm run start` on that URL that reuses an existing server locally but not in CI.
- URL: https://playwright.dev/docs/test-configuration
- Site/generator: playwright.dev / Docusaurus
- Corpus: out
- Sibling-relevant: y. screenshot/video option values (`only-on-failure`, `retain-on-failure`) are not on the given page; they are on the next page (/docs/test-use-options).
- Layout-sensitive code: n (TypeScript)
- Pass: `npx tsc --noEmit` on the config against current @playwright/test types reports 0 errors; `npx playwright test --list` loads it and lists exactly 2 projects; screenshot === 'only-on-failure', video === 'retain-on-failure', trace === 'on-first-retry', webServer.reuseExistingServer === !process.env.CI.

## U4

- Task: Give me the complete minigrep project from the Rust book (src/main.rs and src/lib.rs, whole files, no `--snip--`): case-insensitive search when the IGNORE_CASE env var is set, errors (bad args, missing file) printed to stderr with exit code 1, and the unit tests for both `search` and `search_case_insensitive`.
- URL: https://doc.rust-lang.org/book/ch12-05-working-with-environment-variables.html
- Site/generator: doc.rust-lang.org/book / mdBook
- Corpus: in
- Sibling-relevant: y. Given page shows lib.rs with `// --snip--`; the case-sensitive `search` and its test are on prev (ch12-04); moving errors to stderr with eprintln! is on next (ch12-06).
- Layout-sensitive code: n (Rust; but mdBook hidden lines and snip markers stress code fidelity)
- Pass: with poem.txt from ch12-02 supplied by the evaluator, `cargo test` passes 2 tests; `cargo run -- to poem.txt` prints exactly the 2 lines shown on the given page; `IGNORE_CASE=1 cargo run -- to poem.txt` prints exactly the 4 lines shown; `cargo run > out.txt` leaves out.txt empty, prints the usage error on stderr, exits 1.

## U5

- Task: Write a Kubernetes Deployment `web` (3 replicas, nginx:1.27, container port 80 named `http`) for a slow-starting app: a startupProbe HTTP GET `/` on the named port allowing up to 300s to start (failureThreshold 30, periodSeconds 10); a livenessProbe HTTP GET `/` on the named port that does not use initialDelaySeconds (the startup probe gates it); a readinessProbe TCP check on the named port every 5s.
- URL: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
- Site/generator: kubernetes.io / Hugo (Docsy; YAML pulled in from example files)
- Corpus: in
- Sibling-relevant: n. Answer is self-contained on this one long page; it carries no rel=prev/next.
- Layout-sensitive code: y (YAML)
- Pass: `kubeconform -strict` (or `kubectl apply --dry-run=server`) accepts it; startupProbe.failureThreshold == 30 and periodSeconds == 10; all three probes reference port `http` by name; livenessProbe has no initialDelaySeconds; readinessProbe uses tcpSocket with periodSeconds == 5.
