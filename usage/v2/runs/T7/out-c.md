# Adopting Prisma Migrate on a non-empty tenant database

No documentation file was attached to this task, so every claim below is marked [memory].

## Core principle

Prisma Migrate is driven by `schema.prisma`, not by the database. It only ever generates
DDL for models declared in the schema file [memory]. A table you never model simply does not
exist as far as Migrate is concerned: it will not appear in generated migration SQL, and
Migrate will not attempt to create, alter, or drop it [memory]. So the first and most
important step is: do not add Prisma models for the legacy tables you don't want managed
[memory].

The one piece of state Prisma adds to the database is the `_prisma_migrations` bookkeeping
table it uses to track which migrations have been applied [memory]. It does not scan the
database for "unknown" objects during normal migration generation or deploy [memory].

## Step 1: baseline the database

Baselining tells Prisma "the tables I do want to manage already exist in the shape this
migration would produce, so mark it applied without running it" [memory]. Official flow:

```bash
# Model only the tables Prisma should own, then generate a migration
# that represents that current state.
mkdir -p prisma/migrations/0_init

npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/0_init/migration.sql

# Record it as already applied, without executing the SQL.
npx prisma migrate resolve --applied 0_init
```

`migrate resolve --applied` writes a row into `_prisma_migrations` marking that migration as
done; it does not touch table data or structure [memory]. From this point on, Migrate's
history starts at "0_init" and only tracks the tables that were in `schema.prisma` when you
generated it [memory]. `migrate resolve --rolled-back <name>` is the counterpart used to
un-stick a migration that failed partway, so it can be reapplied [memory].

## Step 2: keep legacy tables out of the schema (or out of Migrate's write path)

Two situations, two answers:

- **You never need to query the legacy tables from Prisma Client.** Leave them out of
  `schema.prisma` entirely. `prisma db pull` will re-add them if you re-introspect the whole
  database, so keep introspection scoped (see multi-schema below) or manually prune the
  pulled file and keep that pruning as a standing discipline [memory].

- **You need to query them, but never want Migrate generating DDL for them.** Introspect
  just those tables in, and keep the resulting models in the schema, but never edit their
  fields. Migrate only emits ALTER/CREATE/DROP when the model definition changes relative to
  migration history, so an untouched model produces no migration diffs [memory]. This is
  "passive" management: Prisma Client can read/write rows, but nothing in the DDL lifecycle
  touches the table unless you deliberately change its model [memory]. Note that `@@ignore`
  does not achieve table-level migration exclusion: it only excludes a model from the
  generated Client API surface, and Prisma still applies to it when computing schema diffs
  [memory].

- **If the legacy tables live in a separate Postgres/CockroachDB schema (namespace),** use
  the multi-schema feature to scope Prisma cleanly:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  schemas  = ["public", "legacy"]
}

generator client {
  provider = "prisma-client-js"
}

model Tenant {
  id   String @id @default(cuid())
  name String
  @@schema("public")
}
```

  Only DB schemas you list, and models mapped to them via `@@schema(...)`, are ever
  introspected or migrated; a `legacy` schema you never reference in `schema.prisma` is
  invisible to Prisma [memory]. This feature was preview-gated for a while and stabilized in
  a recent Prisma 5.x release; check the version you're pinned to before relying on it
  without the `previewFeatures` flag [memory].

## Step 3: never run `migrate dev` against this database

This is the part that actually endangers legacy tables. `migrate dev` builds a shadow
database, replays your full migration history into it, and diffs that result against the
real target database to detect "drift" [memory]. If it finds a mismatch, it prompts
(interactively) to reset the target database, i.e., drop everything and reapply migrations
from scratch [memory]. On a tenant database that still carries legacy tables and real data,
a confirmed reset is a full data-loss event, not just a Prisma-managed-tables problem
[memory].

`migrate dev` is meant for local/dev databases you fully own and can safely wipe [memory].
For the shared tenant database, use:

```bash
npx prisma migrate deploy
```

`migrate deploy` has no drift detection and no shadow database. It simply applies any
migration files not yet recorded in `_prisma_migrations`, in order, and exits [memory]. This
is the documented flow for CI/CD and production/shared environments precisely because it
won't try to reconcile the live database against an expected full-state snapshot [memory].

## Summary checklist

1. Write `schema.prisma` with only the models you want Prisma to own (or scope by DB schema
   with `multiSchema` if legacy tables sit in their own namespace) [memory].
2. Baseline: `prisma migrate diff --from-empty ... --script`, then
   `prisma migrate resolve --applied <name>` to seed migration history without running SQL
   [memory].
3. For any legacy table you must query but not migrate, introspect it once, keep the model,
   and never edit it -- unchanged models generate no DDL [memory].
4. Use `migrate deploy` (never `migrate dev`) against the real tenant database, in CI/CD or
   by hand, so there is no drift-triggered reset path anywhere near production data
   [memory].
