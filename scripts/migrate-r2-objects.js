const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { NodeHttpHandler } = require("@smithy/node-http-handler");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { loadEnvFile } = require("../lib/env");
const {
  closePostgres,
  readPostgresDb,
  writePostgresDb,
} = require("../lib/postgres-store");

const ROOT = path.join(__dirname, "..");
loadEnvFile(path.join(ROOT, ".env"));

const accountId = String(process.env.R2_ACCOUNT_ID || "").trim();
const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || "").trim();
const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || "").trim();
const bucket = String(process.env.R2_BUCKET || "").trim();
const publicBaseUrl = String(process.env.R2_PUBLIC_BASE_URL || "").replace(
  /\/+$/,
  "",
);
const deliveryBaseUrl = String(
  process.env.R2_DELIVERY_BASE_URL ||
    (process.env.PUBLIC_BASE_URL
      ? `${String(process.env.PUBLIC_BASE_URL).replace(/\/+$/, "")}/r2`
      : publicBaseUrl),
).replace(/\/+$/, "");
const proxy = String(
  process.env.R2_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    "",
).trim();
const dryRun = process.argv.includes("--dry-run");

if (
  !accountId ||
  !accessKeyId ||
  !secretAccessKey ||
  !bucket ||
  !publicBaseUrl
) {
  throw new Error(
    "R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET and R2_PUBLIC_BASE_URL are required",
  );
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
  ...(proxy
    ? {
        requestHandler: new NodeHttpHandler({
          httpsAgent: new HttpsProxyAgent(proxy),
        }),
      }
    : {}),
});

const mimeTypes = {
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".md": "text/markdown",
  ".txt": "text/plain",
};

function publicUrl(key) {
  return `${deliveryBaseUrl}/${key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

async function putObject(key, body, contentType, metadata = {}) {
  if (!dryRun) {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType || "application/octet-stream",
        CacheControl: "public, max-age=31536000, immutable",
        Metadata: metadata,
      }),
    );
  }
  return publicUrl(key);
}

async function walkFiles(directory, prefix, relativePrefix = "") {
  const uploaded = new Map();
  let entries = [];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return uploaded;
    throw error;
  }
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    const relative = [relativePrefix, entry.name].filter(Boolean).join("/");
    if (entry.isDirectory()) {
      const nested = await walkFiles(fullPath, prefix, relative);
      for (const [name, url] of nested) uploaded.set(name, url);
      continue;
    }
    if (!entry.isFile()) continue;
    const body = await fs.readFile(fullPath);
    const key = `${prefix}/${relative}`;
    uploaded.set(
      relative,
      await putObject(
        key,
        body,
        mimeTypes[path.extname(entry.name).toLowerCase()] ||
          "application/octet-stream",
        { migrated: "true" },
      ),
    );
    console.log(`${dryRun ? "[dry-run] " : ""}uploaded ${key}`);
  }
  return uploaded;
}

const dataUrlCache = new Map();

async function migrateString(value, generatedFiles) {
  const dataMatch = value.match(/^data:([^;,]+)?;base64,([\s\S]+)$/);
  if (dataMatch) {
    const contentType = dataMatch[1] || "application/octet-stream";
    const body = Buffer.from(dataMatch[2].replace(/\s/g, ""), "base64");
    const hash = crypto.createHash("sha256").update(body).digest("hex");
    if (!dataUrlCache.has(hash)) {
      const extension =
        Object.entries(mimeTypes).find(([, mime]) => mime === contentType)?.[0] ||
        ".bin";
      const key = `migrated/data/${hash}${extension}`;
      dataUrlCache.set(
        hash,
        await putObject(key, body, contentType, {
          migrated: "true",
          source: "postgres-data-url",
        }),
      );
      console.log(`${dryRun ? "[dry-run] " : ""}uploaded ${key}`);
    }
    return dataUrlCache.get(hash);
  }

  let output = value;
  if (
    publicBaseUrl &&
    deliveryBaseUrl &&
    output.startsWith(`${publicBaseUrl}/`)
  ) {
    output = `${deliveryBaseUrl}/${output.slice(publicBaseUrl.length + 1)}`;
  }
  for (const [fileName, url] of generatedFiles) {
    const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    output = output.replace(
      new RegExp(
        `(?:https?:\\/\\/[^\\s"'<>]+)?\\/generated\\/${escaped}`,
        "g",
      ),
      url,
    );
  }
  return output;
}

async function migrateValue(value, generatedFiles, stats) {
  if (typeof value === "string") {
    const migrated = await migrateString(value, generatedFiles);
    if (migrated !== value) stats.rewritten += 1;
    return migrated;
  }
  if (Array.isArray(value)) {
    const output = [];
    for (const item of value) {
      output.push(await migrateValue(item, generatedFiles, stats));
    }
    return output;
  }
  if (value && typeof value === "object") {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = await migrateValue(item, generatedFiles, stats);
    }
    return output;
  }
  return value;
}

async function main() {
  const generatedFiles = await walkFiles(
    path.join(ROOT, "public", "generated"),
    "generated",
  );
  const assetFiles = await walkFiles(
    path.join(ROOT, "public", "assets"),
    "assets",
  );
  const db = await readPostgresDb();
  const stats = { rewritten: 0 };
  const migratedDb = await migrateValue(db, generatedFiles, stats);
  if (!dryRun && stats.rewritten) {
    const backupDirectory = path.join(ROOT, "backups", "r2-object-migration");
    await fs.mkdir(backupDirectory, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.writeFile(
      path.join(backupDirectory, `postgres-before-${timestamp}.json`),
      JSON.stringify(db, null, 2),
    );
    await writePostgresDb(migratedDb);
  }
  console.log(
    JSON.stringify(
      {
        dryRun,
        generatedObjects: generatedFiles.size,
        staticAssets: assetFiles.size,
        databaseStringsRewritten: stats.rewritten,
        embeddedDataObjects: dataUrlCache.size,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closePostgres);
