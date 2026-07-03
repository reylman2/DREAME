const http = require("http");
const https = require("https");

const baseUrl = (process.env.TEST_BASE_URL || "http://127.0.0.1:3001").replace(
  /\/$/,
  "",
);

function getJson(path) {
  return new Promise((resolve, reject) => {
    const target = new URL(`${baseUrl}${path}`);
    const client = target.protocol === "http:" ? http : https;
    const req = client.request(
      {
        method: "GET",
        hostname: target.hostname,
        port: target.port || (target.protocol === "http:" ? 80 : 443),
        path: `${target.pathname}${target.search}`,
        timeout: 10000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            reject(new Error(`Expected JSON from ${path}, got: ${text.slice(0, 80)}`));
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(json.error || `HTTP ${res.statusCode}`));
            return;
          }
          resolve(json);
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("PAYMENT_AMOUNT_TIMEOUT")));
    req.on("error", reject);
    req.end();
  });
}

(async () => {
  const payload = await getJson("/api/plans");
  const plans = Array.isArray(payload.plans) ? payload.plans : [];
  if (!plans.length) throw new Error("/api/plans did not return plans");

  const minCreditPrice = Number(payload.minCreditPrice || 0);
  if (!Number.isFinite(minCreditPrice) || minCreditPrice <= 0) {
    throw new Error("minCreditPrice must be a positive number");
  }

  for (const plan of plans) {
    const price = Number(plan.price);
    const credits = Number(plan.credits);
    if (!Number.isFinite(price) || price <= 0)
      throw new Error(`${plan.id} price must be positive`);
    if (!Number.isFinite(credits) || credits <= 0)
      throw new Error(`${plan.id} credits must be positive`);
    const minimum = Number((credits * minCreditPrice).toFixed(2));
    if (price + 0.0001 < minimum) {
      throw new Error(
        `${plan.id} price ${price} is below minimum profitable amount ${minimum}`,
      );
    }
  }

  console.log(`Payment amount API ok: ${plans.length} plans checked`);
})().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
