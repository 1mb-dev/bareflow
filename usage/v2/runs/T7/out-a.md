# Adopting Prisma Migrate on an existing, non-empty tenant database

There are two separate problems bundled in this question, and they need two separate mechanisms:

1. Telling Prisma Migrate "the tables you *do* model already exist, don't try to create them again" -- this is baselining. [doc]
2. Keeping Prisma from ever touching tables it *doesn't* model at all (the legacy ones) -- this is a schema-authoring discipline, not a Migrate command. [memory]

## 1. Baseline the tables Prisma owns

Baselining initializes a migration history for a database that already existed before Prisma Migrate and contains data you cannot reset. [doc] It works by telling Prisma Migrate to assume one or more migrations have already been applied, so generated migrations don't try to recreate tables/columns that are already there. [doc]

Steps, against your tenant database:

```bash
# 1. If prisma/migrations already exists, archive/move it out of the way.
# 2. Create a fresh migrations directory, and a subfolder with a 0_ prefix
#    (lexicographic ordering matters -- this must sort first).
mkdir -p prisma/migrations/0_init

# 3. Generate the migration SQL from your Prisma schema (not from the live DB),
#    diffed against an empty database, and save it to a file:
bunx prisma migrate diff \
  --from-empty \
  --to-schema prisma/schema.prisma \
  --script > prisma/migrations/0_init/migration.sql

# 4. Mark it as applied against the target (tenant) database, without running its SQL:
bunx prisma migrate resolve --applied 0_init
```
[doc]

`migrate resolve --applied` inserts a row into `_prisma_migrations` marking that migration as applied -- it does not execute the migration's SQL. [doc] From then on, `prisma migrate deploy` skips every migration marked applied (including the baseline) and only runs migrations that come after it. [doc]

This is per-database bookkeeping: `_prisma_migrations` lives inside each database, so for a multi-tenant setup you repeat step 4 (`migrate resolve --applied 0_init`) once per tenant connection string. The migration folder itself is shared/committed once. [memory]

Note: this whole workflow does not apply to MongoDB -- use `db push` there instead. [doc] Irrelevant if your tenant DBs are relational, worth knowing if any tenant is on Mongo.

## 2. Keep legacy tables invisible to Prisma entirely

Baselining only solves "don't re-create what's already there for tables I modeled." It says nothing about tables that aren't in `schema.prisma` at all -- and that's the actual mechanism that protects legacy tables: **if a table has no model in `schema.prisma`, Prisma Migrate never generates DDL for it.** [memory] `migrate diff --to-schema prisma/schema.prisma` in step 3 above only emits `CREATE TABLE` statements for the models you've defined -- not a dump of everything present in the live tenant database. [memory, inferred from the `--to-schema` flag's semantics in the doc's own command] So the practical rule is: only put the tables you intend to own in the Prisma schema, and the legacy tables are structurally excluded from every subsequent `migrate dev` / `migrate deploy` diff, because Migrate's source of truth for "current state" is the migration history, and its target is `schema.prisma` -- neither one ever enumerates the live database's full object list for tables outside that loop. [memory]

Practical pitfalls to watch for:

- **Don't run a full `prisma db pull` against the tenant database and commit the result as-is.** Introspection will happily add every table it finds, including legacy ones, back into `schema.prisma` -- at which point they *are* modeled, and Migrate will start diffing and managing them on the next migration. [memory] If you introspect to bootstrap the schema, prune the unwanted model blocks before generating the baseline diff in step 3.
- **`@@ignore` does not exempt a table from Migrate.** It only suppresses the generated Client's CRUD methods for that model; the model is still part of the schema Migrate diffs against, so its table is still created/altered by migrations. [memory] Use `@@ignore` for "Prisma Client shouldn't expose this," not for "Prisma Migrate shouldn't manage this." For a table you want fully hands-off, leave it out of `schema.prisma` completely (only reference it via a raw FK column/`Int`/`String` field on an owned model if you need the relation, not via a modeled counterpart).
- **If legacy and owned tables share a Postgres schema/namespace,** consider Prisma's multi-schema support (`schemas = [...]` on the datasource plus `@@schema("...")` per model) to scope introspection and keep the ownership boundary explicit, rather than relying purely on "just don't add a model for it." Check the exact preview-feature flag name against your Prisma ORM v7 docs, since preview feature naming has shifted across versions. [memory, low confidence on exact v7 flag name]
- **Verify after baselining** with `prisma migrate status` against each tenant DB -- it should report the baseline as applied and no pending drift for owned tables. [memory]

## Summary

- Generate the baseline migration from `schema.prisma` (not from the live DB), then `migrate resolve --applied` it per tenant database, so Prisma treats existing owned tables as already-created. [doc]
- Never let a legacy table enter `schema.prisma` (directly or via unpruned `db pull`) if you want Prisma to leave it alone -- absence from the schema, not `@@ignore`, is what keeps Migrate from managing it. [memory]
