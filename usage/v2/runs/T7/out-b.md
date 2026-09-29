# Adopting Prisma Migrate against an existing tenant database with legacy tables

## Short answer

Use Prisma's **baselining** workflow [doc]. Baselining tells Prisma Migrate that a
migration representing the current database state has "already been applied," so
`migrate deploy` skips it instead of trying to (re-)create tables/columns that already
exist [doc]. The reason legacy tables never get touched is a side effect of how the
baseline migration is generated: it is produced from your `schema.prisma` file, not
from the live database, so anything you haven't modeled as a Prisma model simply never
appears in the SQL Prisma manages [memory, direct consequence of the documented
`migrate diff --to-schema` mechanism]. Keep those legacy tables out of `schema.prisma`
and Prisma Migrate stays structurally blind to them, forever, not just at adoption
time.

## Step by step

1. **Model only what you want Prisma to own.** Write (or introspect and then trim)
   `schema.prisma` so it contains models for the tables you want Prisma Migrate to
   manage going forward, and *omit* the legacy tables entirely [memory - the attached
   guide starts from an assumed `schema.prisma`; curating its contents is what
   determines which tables Migrate will ever act on]. If you introspect with
   `prisma db pull` against the tenant database, expect it to pull in the legacy
   tables too — delete those models before continuing.

2. **Clear out any existing migration history** (if one exists) and start fresh:
   delete/move/rename/archive the current `prisma/migrations` folder, then create a
   new `prisma/migrations` directory [doc].

3. **Create the baseline migration folder**, prefixed `0_` (or a timestamp) so it
   sorts first lexicographically, e.g. `prisma/migrations/0_init/` [doc].

4. **Generate the baseline SQL from the schema, not from the database**, using
   `migrate diff --from-empty`:

   ```bash
   npx prisma migrate diff \
     --from-empty \
     --to-schema prisma/schema.prisma \
     --script > prisma/migrations/0_init/migration.sql
   ```
   [doc, command shown for npm; bun/pnpm/yarn equivalents also given in the source]

   Because `--to-schema` points at your trimmed `schema.prisma`, the emitted SQL only
   contains `CREATE TABLE`/etc. statements for the models you kept — the legacy tables
   you left out generate no SQL at all [memory, inferred from the diff command's
   schema-to-schema semantics].

5. **Mark that migration as already applied**, instead of running it:

   ```bash
   npx prisma migrate resolve --applied 0_init
   ```
   [doc]

   This writes a row into the `_prisma_migrations` table marking `0_init` as applied,
   without executing its SQL against the tenant database (which already has that
   state) [doc].

6. **From here on, `prisma migrate deploy` only applies migrations that come after the
   baseline** — it skips everything marked applied, including the baseline itself
   [doc].

## Why this keeps legacy tables safe long-term, not just at adoption

- `migrate dev` and `migrate deploy` apply pre-generated `migration.sql` files (a
  history), they do not compute a fresh diff against the live tenant database at
  deploy time. Only `prisma migrate dev` (in development, against a disposable shadow
  database) and `prisma db push` compute diffs, and both diff against your schema's
  own migration history/shadow state, never against the production/tenant database's
  actual contents [memory, general Prisma Migrate architecture — not covered in the
  attached page]. So a legacy table that was never modeled cannot show up in a
  generated `DROP TABLE` or `ALTER TABLE` statement, because it never appears on
  either side of any diff.
- The corollary: if someone later adds a model for one of those legacy tables to
  `schema.prisma`, the next generated migration would then try to reconcile it (and
  likely fail or conflict, since the table already exists in a shape Prisma doesn't
  expect). Adoption discipline is "don't model it," and that has to be maintained
  going forward, not just during the baseline step [memory].

## Caveats specific to a multi-tenant setup

- Baselining is per-database: `_prisma_migrations` lives inside each database, so if
  "tenant database" means one physical database per tenant, you must run steps 3-5
  (or a scripted equivalent) against every existing tenant database individually
  before that tenant can receive `migrate deploy` [memory, inference from
  `_prisma_migrations` being a table inside the target database, not shared state].
- If any tenant's legacy schema differs from another's (e.g., extra legacy tables
  present in only some tenants), that's fine under this approach — the baseline SQL is
  driven by your shared `schema.prisma`, and per-tenant legacy tables outside it are
  ignored the same way regardless of which extra tables a given tenant happens to
  have [memory].
- This workflow is for SQL databases. It does **not** apply to MongoDB — Mongo uses
  `db push` instead of `migrate deploy`/baselining [doc].
- If you need to keep a legacy table visible to Prisma Client (for querying) but never
  want Migrate to manage its DDL, that's a separate mechanism (`@@ignore` on a model
  introspected from it) and isn't covered by the attached baselining page [memory,
  flagged as a possible follow-up, not verified against current docs].

## Source

Content and commands above are drawn from the attached Prisma ORM v7 "Baselining a
database" doc page (Workflows section) [doc]; the deploy-time diff/shadow-database
architecture explanation is general Prisma Migrate knowledge not present in the
attached excerpt [memory].
