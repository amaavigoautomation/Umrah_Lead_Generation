# Firestore → MongoDB migration

Branch: `feature/mongodb-migration` (from `feature/unified-inbox-redesign`).

## What changed

| Area | Before | Now |
|---|---|---|
| Server data layer | Firebase Admin Firestore | MongoDB, behind the **same function names** (`src/server/adminFirestore.ts`) so no service code changed |
| Document model | Firestore paths (`tenants/{id}/leads/{id}`) | Same paths, stored in Mongo (see below) |
| Browser data access | Firestore JS SDK, live `onSnapshot`, protected by `firestore.rules` | `POST /api/db` + polling (`src/services/clientDb.ts`); the rules were ported to `src/server/clientDataApi.ts` |
| Sign-in / tokens / claims | Firebase Auth | **Unchanged** (Firebase Auth) |
| Indexes | `firestore.indexes.json` | `npm run mongo:indexes` builds Mongo indexes from the same file |

### Storage layout

Each Firestore collection is a Mongo collection named after its **last path segment** (`tenants/t1/leads` → `leads`).
A document is `{ _id: "tenants/t1/leads/L1", __p: "tenants/t1/leads", ...fields }`. `_id` is the full path and `__p`
is the parent collection path (indexed; every query filters on it, which is also what keeps tenants isolated).
Field names containing `.` or starting with `$` are escaped on write and restored on read.

### Behaviour that is reproduced on purpose

`orderBy` skips documents missing the field · `== null` matches explicit null only · `update()` on a missing doc fails
with code 5 · `create()` on an existing doc fails with code 6 · `set(..., {merge:true})` deep-merges · `increment()` is
atomic · transaction writes are buffered and applied together (inside a Mongo transaction on a replica set).

## Setup

1. Create a MongoDB Atlas cluster (replica set is automatic). Add your server's IP (or Vercel's) to the Atlas network access list.
2. Set `MONGODB_URI` and `MONGODB_DB_NAME` (see `.env.example`). Keep the Firebase vars: sign-in still uses them.
3. `npm run mongo:indexes`

## Cutover from Firestore (existing data)

```bash
# 1. Rehearse: counts only, writes nothing
npm run migrate:mongo -- --dry-run

# 2. Copy everything, verify per-collection counts, create indexes (idempotent: safe to re-run)
npm run migrate:mongo

# 3. At the real cutover: stop writes (maintenance window), run step 2 again to catch up, then deploy this branch.
```

Needs `FIREBASE_SERVICE_ACCOUNT_JSON` (and `FIRESTORE_DATABASE_ID` for a named database) plus the Mongo vars. Firestore is
never modified. Rollback = redeploy the previous branch; Firestore still has the old data (anything written to Mongo after
cutover would need copying back).

## Things to know

- **Live updates are polling** (every 5 s while the tab is visible, plus an immediate refresh after the user's own writes;
  the server answers "not modified" when nothing changed). Change with `VITE_DB_POLL_MS`. Another user's change appears
  within one poll interval instead of instantly.
- **Transactions need a replica set.** Atlas is one. On a standalone `mongod` the app logs a warning and runs transaction
  callbacks without isolation (fine for local dev, not for production).
- **Vercel:** keep `MONGODB_MAX_POOL` small (e.g. 5). `mongodb` is kept external in the server bundle (`npm run build`).
- `firestore.rules` is no longer used by the app (kept for rollback/reference).
- One-off legacy scripts under `scripts/` that call `getAdminFirestore()` now read and write MongoDB.
- Document size limit is 16 MB (Firestore's was 1 MiB), so nothing that fit before can fail on size.

## Checks

```bash
MONGODB_URI=mongodb://127.0.0.1:27017 MONGODB_DB_NAME=umrah_selftest npm run test:mongo       # data layer
MONGODB_URI=mongodb://127.0.0.1:27017 MONGODB_DB_NAME=umrah_selftest npm run test:client-db   # browser API + permissions
```

The database name must contain `test` (the scripts drop it when finished).
