# PostgreSQL Migration Runbook

## Overview

GroundworX ships SQLite locally. Production target (neuroglitch.ai / DigitalOcean) requires
PostgreSQL. This document is the step-by-step migration protocol.

**RULE: Never run `prisma migrate dev` or `migrate deploy` without explicit founder approval.**

---

## Current state (April 2026)

Prisma 7 — URL lives in `prisma.config.ts`, NOT in `schema.prisma`.

**`prisma.config.ts` (current)**
```typescript
import { defineConfig } from "prisma/config";
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", ... },
  datasource: { url: "file:./dev.db" },  // ← change this
});
```

**`prisma/schema.prisma` (current)**
```prisma
datasource db {
  provider = "sqlite"
  // URL configured in prisma.config.ts — NOT here (Prisma 7 breaking change)
}
```

53 models. All JSON stored as `String` fields (SQLite-compatible). No native enums.

---

## Phase 1 — Local PostgreSQL dev environment

### 1a. Install PostgreSQL locally (or use Docker)

```bash
# Docker (recommended — no install needed)
docker run -d --name gwx-pg \
  -e POSTGRES_PASSWORD=gwxlocal \
  -e POSTGRES_DB=groundworx \
  -p 5432:5432 \
  postgres:16

# Connection string for .env.local:
DATABASE_URL="postgresql://postgres:gwxlocal@localhost:5432/groundworx?schema=public"
```

### 1b. Switch provider and URL

**Step 1 — `prisma/schema.prisma`** — change provider only:
```prisma
datasource db {
  provider = "postgresql"
  // URL configured in prisma.config.ts
}
```

**Step 2 — `prisma.config.ts`** — change the URL:
```typescript
datasource: {
  url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/groundworx",
},
```

**Step 3 — `.env.local`** — set the PG connection string:
```
DATABASE_URL="postgresql://postgres:gwxlocal@localhost:5432/groundworx?schema=public"
```

### 1c. JSON field migration (optional but recommended)

SQLite stores JSON as `String`. PostgreSQL supports native `Json` / `JsonB` for indexed queries.
Candidates to upgrade (search `// JSON` in schema.prisma):

| Field | Model | Current | Recommended |
|-------|-------|---------|-------------|
| `budgetGcLines` | Bid | String? | Json? |
| `analysisJson` | SpecSection, DrawingUpload | String? | Json? |
| `reviewers` | SubmittalItem | String | Json |
| `distribution` | SubmittalItem | String | Json |
| `snapshot` | AiUsageLog | String | Json |
| `openIssues`, `redFlags`, `keyDecisions` | Meeting | String | Json |

Changing these to `Json` type is a migration — do it in the same `migrate dev` run as the
provider switch to avoid a second migration. Prisma `Json` maps to `jsonb` in PostgreSQL.

### 1d. Generate and migrate

```bash
# ← STOP: confirm with founder before running
npx prisma migrate dev --name switch-to-postgresql
npx prisma generate
```

### 1e. Verify

```bash
npx tsc --noEmit
npm run dev
```

Open the app and exercise: bids list, leveling tab, AI usage card, submittals.

---

## Phase 2 — Data migration (SQLite → PostgreSQL)

Run this once to move existing dev data. Skip in production if starting fresh.

```bash
# Export SQLite data
npx tsx scripts/export-sqlite.ts > data-export.json

# Import to PostgreSQL (after provider switch)
npx tsx scripts/import-pg.ts < data-export.json
```

**Note:** The export/import scripts don't exist yet — create them only when needed.
Alternatively, start with a clean PostgreSQL database in production (all bid data is in SQLite
on your local machine for demo purposes; production starts fresh).

---

## Phase 3 — DigitalOcean production setup

### Infrastructure

```
Droplet:     ubuntu-22.04, 2 vCPU / 4GB RAM ($24/mo)
Database:    DigitalOcean Managed PostgreSQL ($15/mo starter) — OR — pg on same droplet
Storage:     Spaces (S3-compatible) for document uploads when implemented
```

### Managed PostgreSQL (recommended)

1. Create a Managed PostgreSQL cluster in DigitalOcean (same datacenter as droplet)
2. Copy the connection string from the DO dashboard
3. Set `DATABASE_URL` in production `.env`:
   ```
   DATABASE_URL="postgresql://doadmin:<password>@<host>:25060/groundworx?sslmode=require"
   ```

### Self-hosted PostgreSQL on droplet (budget option)

```bash
sudo apt install postgresql postgresql-contrib
sudo -u postgres psql -c "CREATE DATABASE groundworx;"
sudo -u postgres psql -c "CREATE USER gwxuser WITH PASSWORD 'strong-password';"
sudo -u postgres psql -c "GRANT ALL ON DATABASE groundworx TO gwxuser;"
# DATABASE_URL="postgresql://gwxuser:strong-password@localhost:5432/groundworx"
```

---

## Phase 4 — Deploy

See `docs/architecture/DEPLOY_RUNBOOK.md` for the full deployment sequence (PM2, Nginx,
Certbot, GitHub Actions). PostgreSQL migration is step 3 of that runbook.

---

## Schema fields to watch

### `Bid.createdById` — nullable today

Currently `String?` with comment "nullable, backfill to user 1 when multi-tenant."
When Auth B goes live, run a one-time migration:

```sql
UPDATE "Bid" SET "createdById" = '<admin-user-id>' WHERE "createdById" IS NULL;
```

Then change schema to `createdById String` (non-nullable) and migrate.

### String enums → actual enums

These fields are validated in the API layer, not the schema. Leaving them as `String` is fine.
Changing to Prisma enums would require a migration and enum backfill — defer.

---

## Checklist — day of switch

- [ ] Docker PG container running locally
- [ ] `.env.local` updated to PG connection string
- [ ] `schema.prisma` provider changed to `"postgresql"`
- [ ] `npx prisma migrate dev` — confirm output, approve migration file
- [ ] `npx tsc --noEmit` — clean
- [ ] Manual smoke test: create bid, invite subs, run leveling, generate brief
- [ ] Commit migration file to git
- [ ] Push to GitHub
- [ ] Deploy to DigitalOcean
- [ ] `npx prisma migrate deploy` on production server
- [ ] Smoke test production

---

*NeuroGlitch · GroundworX · April 2026*
