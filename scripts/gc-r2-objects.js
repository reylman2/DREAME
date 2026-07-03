const path = require("path");
const {
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} = require("@aws-sdk/client-s3");
const { NodeHttpHandler } = require("@smithy/node-http-handler");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { loadEnvFile } = require("../lib/env");
const { closePostgres, readPostgresDb } = require("../lib/postgres-store");

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
      : ""),
).replace(/\/+$/, "");
const proxy = String(
  process.env.R2_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    "",
).trim();
const apply = process.argv.includes("--apply");
const ageArg = process.argv.find((arg) => arg.startsWith("--min-age-hours="));
const minAgeHours = Math.max(
  0,
  Number(ageArg?.split("=")[1] || process.env.R2_GC_MIN_AGE_HOURS || 24),
);

if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
  throw new Error(
    "R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET are required",
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

function keyFromUrl(value) {
  const source = String(value || "");
  if (source.startsWith("/r2/")) {
    return decodeURIComponent(source.slice("/r2/".length));
  }
  try {
    const target = new URL(source);
    for (const configuredBase of [deliveryBaseUrl, publicBaseUrl].filter(
      (item) => /^https?:\/\//i.test(item),
    )) {
      const base = new URL(configuredBase);
      if (target.origin !== base.origin) continue;
      const basePath = base.pathname.replace(/\/+$/, "");
      if (basePath && !target.pathname.startsWith(`${basePath}/`)) continue;
      return target.pathname
        .slice(basePath.length)
        .replace(/^\/+/, "")
        .split("/")
        .map((part) => decodeURIComponent(part))
        .join("/");
    }
  } catch {}
  return "";
}

function collectReferences(value, counts = new Map()) {
  if (typeof value === "string") {
    const candidates = new Set([value]);
    for (const match of value.matchAll(
      /https?:\/\/[^\s"'<>\\]+|\/r2\/[^\s"'<>\\]+/g,
    )) {
      candidates.add(match[0]);
    }
    for (const candidate of candidates) {
      const key = keyFromUrl(candidate);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectReferences(item, counts);
    return counts;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectReferences(item, counts);
  }
  return counts;
}

async function listObjects(prefix) {
  const objects = [];
  let continuationToken;
  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    objects.push(...(response.Contents || []));
    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return objects;
}

async function main() {
  const db = await readPostgresDb();
  const references = collectReferences(db);
  const objects = (
    await Promise.all(
      ["users/", "generated/", "migrated/data/"].map(listObjects),
    )
  ).flat();
  const cutoff = Date.now() - minAgeHours * 60 * 60 * 1000;
  const orphaned = objects.filter(
    (object) =>
      object.Key &&
      !references.get(object.Key) &&
      new Date(object.LastModified || 0).getTime() <= cutoff,
  );

  for (const object of orphaned) {
    console.log(
      `${apply ? "deleting" : "[dry-run] orphan"} ${object.Key} (${object.Size || 0} bytes)`,
    );
    if (apply) {
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }),
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        apply,
        minAgeHours,
        scannedObjects: objects.length,
        referencedObjects: references.size,
        orphanedObjects: orphaned.length,
        orphanedBytes: orphaned.reduce(
          (total, object) => total + Number(object.Size || 0),
          0,
        ),
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
