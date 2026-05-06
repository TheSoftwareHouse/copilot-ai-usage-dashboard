---
name: 'Migration Conventions'
description: 'TypeORM migration format, raw SQL patterns, naming conventions, and reversibility requirements. Applied when working on migration files.'
applyTo: 'migrations/**/*.ts'
---

# Migration File Structure

Migrations use raw SQL via `queryRunner.query()` — never TypeORM schema builder methods.

## File Naming

Format: `{timestamp}-{PascalCaseDescription}.ts`

```
1772400000000-CreateTeamTables.ts
1772600000000-AddTeamSoftDelete.ts
1772800000000-AddPremiumRequestsPerSeat.ts
```

## Migration Template

```ts
import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateTeamTables1772400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "team" (
        "id" SERIAL PRIMARY KEY,
        "name" VARCHAR(255) NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_team_name_active" ON "team" ("name") WHERE "deletedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_team_name_active"`);
    await queryRunner.query(`DROP TABLE "team"`);
  }
}
```

## Rules

- Class name format: `{PascalCaseDescription}{Timestamp}` (description + timestamp)
- Always implement both `up()` and `down()` — migrations must be reversible
- Use raw SQL only — no `queryRunner.createTable()` or schema builder
- Quote column names with double quotes to preserve camelCase in PostgreSQL
- Drop in reverse order in `down()` (indices before tables, dependent tables before parent)
- `synchronize: false` in all environments — schema changes only via migrations

## Registration (CRITICAL)

Every migration MUST be registered in `scripts/run-migrations.ts`:

1. Import the migration class at the top of the file
2. Add the class to the `migrations` array inside the `DataSource` configuration

A migration file that exists in `migrations/` but is not registered in `run-migrations.ts` will **never execute**. Always verify registration after creating a migration.
