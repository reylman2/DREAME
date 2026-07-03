const { S3Client, PutBucketCorsCommand } = require("@aws-sdk/client-s3");
const { NodeHttpHandler } = require("@smithy/node-http-handler");
const { HttpsProxyAgent } = require("https-proxy-agent");
const path = require("path");
const { loadEnvFile } = require("../lib/env");

loadEnvFile(path.join(__dirname, "..", ".env"));

const accountId = String(process.env.R2_ACCOUNT_ID || "").trim();
const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || "").trim();
const secretAccessKey = String(
  process.env.R2_SECRET_ACCESS_KEY || "",
).trim();
const bucket = String(process.env.R2_BUCKET || "").trim();
const proxy = String(
  process.env.R2_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    "",
).trim();
const origins = String(
  process.env.R2_ALLOWED_ORIGINS ||
    process.env.PUBLIC_BASE_URL ||
    "http://localhost:3000",
)
  .split(",")
  .map((value) => value.trim().replace(/\/+$/, ""))
  .filter(Boolean);

if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
  throw new Error(
    "R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET are required",
  );
}

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

async function main() {
  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: origins,
            AllowedMethods: ["PUT", "GET", "HEAD"],
            AllowedHeaders: ["*"],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );
  console.log(`R2 CORS configured for ${bucket}: ${origins.join(", ")}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
