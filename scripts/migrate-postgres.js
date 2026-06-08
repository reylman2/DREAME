const path = require("path");
const fs = require("fs/promises");
const { loadEnvFile } = require("../lib/env");
const {
  closePostgres,
  mergeMissingPostgresDb,
  migratePostgres,
  readPostgresDb,
  writePostgresDb,
} = require("../lib/postgres-store");

loadEnvFile(path.join(__dirname, "..", ".env"));

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const replace = process.argv.includes("--replace");
  const merge = process.argv.includes("--merge");
  const explicitSeedFile = process.argv.find((item) => !item.startsWith("--") && item !== process.argv[0] && item !== process.argv[1]);
  const seedFile = explicitSeedFile || path.join(__dirname, "..", "data", "db.json");

  await migratePostgres();
  if (merge) {
    if (!(await fileExists(seedFile))) throw new Error(`Seed file not found: ${seedFile}`);
    const seed = JSON.parse(await fs.readFile(seedFile, "utf8"));
    await mergeMissingPostgresDb(seed);
    console.log("PostgreSQL migration completed with missing JSON records merged");
    return;
  }

  if (replace) {
    if (!(await fileExists(seedFile))) throw new Error(`Seed file not found: ${seedFile}`);
    const seed = JSON.parse(await fs.readFile(seedFile, "utf8"));
    await writePostgresDb(seed);
    console.log("PostgreSQL migration completed with JSON seed replacement");
    return;
  }

  await readPostgresDb((await fileExists(seedFile)) ? seedFile : undefined);
  console.log("PostgreSQL migration completed");
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(closePostgres);
