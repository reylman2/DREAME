const fs = require("fs/promises");
const { Pool } = require("pg");

const COLLECTIONS = [
  "users",
  "sessions",
  "verificationRequests",
  "workspaces",
  "wallets",
  "apiKeys",
  "orders",
  "generations",
  "models",
  "workflows",
  "communityWorks",
  "plans",
  "userWorkflows",
];

let pool;
const WRITE_LOCK_ID = 638475201;

function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

async function migratePostgres() {
  const db = getPool();
  if (!db) return;

  await db.query(`
    create table if not exists app_kv (
      key text primary key,
      value jsonb not null,
      updated_at timestamptz not null default now()
    );

    create table if not exists collection_items (
      collection text not null,
      id text not null,
      user_id text,
      workspace_id text,
      doc jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (collection, id)
    );

    create index if not exists collection_items_user_idx on collection_items (collection, user_id);
    create index if not exists collection_items_workspace_idx on collection_items (collection, workspace_id);
    create index if not exists collection_items_doc_gin_idx on collection_items using gin (doc);
  `);
}

function itemId(collection, item) {
  if (collection === "userWorkflows" && item.userId && item.id)
    return `${item.userId}:${item.id}`;
  if (item.id) return String(item.id);
  if (collection === "stats") return "stats";
  return `${collection}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function userIdFor(collection, item) {
  if (item.userId) return item.userId;
  if (collection === "users") return item.id;
  if (collection === "workspaces") return item.ownerId;
  return null;
}

function workspaceIdFor(item) {
  if (item.workspaceId) return item.workspaceId;
  if (item.id && item.ownerId) return item.id;
  return null;
}

async function readPostgresDb(seedFile) {
  const db = getPool();
  if (!db) return null;
  await migratePostgres();

  const count = await db.query("select count(*)::int as count from collection_items");
  if (seedFile && count.rows[0].count === 0) {
    const seed = JSON.parse(await fs.readFile(seedFile, "utf8"));
    await writePostgresDb(seed);
  }

  const stateRows = await db.query("select key, value from app_kv");
  const itemRows = await db.query("select collection, doc from collection_items order by created_at asc");
  const result = {};

  for (const row of stateRows.rows) {
    result[row.key] = row.value;
  }

  for (const collection of COLLECTIONS) {
    result[collection] = [];
  }

  for (const row of itemRows.rows) {
    result[row.collection] ||= [];
    result[row.collection].push(row.doc);
  }

  return result;
}

async function writePostgresDb(data) {
  const db = getPool();
  if (!db) return false;
  await migratePostgres();

  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock($1)", [WRITE_LOCK_ID]);
    await client.query("delete from app_kv");
    await client.query("delete from collection_items");

    for (const [key, value] of Object.entries(data)) {
      if (COLLECTIONS.includes(key)) continue;
      await client.query(
        "insert into app_kv (key, value, updated_at) values ($1, $2, now())",
        [key, JSON.stringify(value)],
      );
    }

    for (const collection of COLLECTIONS) {
      for (const item of data[collection] || []) {
        await client.query(
          `insert into collection_items (collection, id, user_id, workspace_id, doc, updated_at)
           values ($1, $2, $3, $4, $5, now())`,
          [
            collection,
            itemId(collection, item),
            userIdFor(collection, item),
            workspaceIdFor(item),
            JSON.stringify(item),
          ],
        );
      }
    }

    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function upsertPostgresItems(collection, items) {
  const db = getPool();
  if (!db) return false;
  await migratePostgres();
  const list = Array.isArray(items) ? items : [items].filter(Boolean);
  if (!COLLECTIONS.includes(collection) || !list.length) return false;

  const client = await db.connect();
  try {
    await client.query("begin");
    for (const item of list) {
      await client.query(
        `insert into collection_items (collection, id, user_id, workspace_id, doc, updated_at)
         values ($1, $2, $3, $4, $5, now())
         on conflict (collection, id) do update
         set user_id = excluded.user_id,
             workspace_id = excluded.workspace_id,
             doc = excluded.doc,
             updated_at = now()`,
        [
          collection,
          itemId(collection, item),
          userIdFor(collection, item),
          workspaceIdFor(item),
          JSON.stringify(item),
        ],
      );
    }
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function mergeMissingPostgresDb(data) {
  const db = getPool();
  if (!db) return false;
  await migratePostgres();

  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock($1)", [WRITE_LOCK_ID]);

    for (const [key, value] of Object.entries(data)) {
      if (COLLECTIONS.includes(key)) continue;
      await client.query(
        `insert into app_kv (key, value, updated_at)
         values ($1, $2, now())
         on conflict (key) do nothing`,
        [key, JSON.stringify(value)],
      );
    }

    for (const collection of COLLECTIONS) {
      for (const item of data[collection] || []) {
        await client.query(
          `insert into collection_items (collection, id, user_id, workspace_id, doc, updated_at)
           values ($1, $2, $3, $4, $5, now())
           on conflict (collection, id) do nothing`,
          [
            collection,
            itemId(collection, item),
            userIdFor(collection, item),
            workspaceIdFor(item),
            JSON.stringify(item),
          ],
        );
      }
    }

    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function closePostgres() {
  if (pool) await pool.end();
}

module.exports = {
  closePostgres,
  getPool,
  mergeMissingPostgresDb,
  migratePostgres,
  readPostgresDb,
  upsertPostgresItems,
  writePostgresDb,
};
