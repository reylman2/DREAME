const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${response.status} ${payload.error || JSON.stringify(payload)}`);
  }
  return payload;
}

async function main() {
  const suffix = Date.now();
  const email = `free-api-${suffix}@example.com`;

  console.log("1. register user");
  const verification = await request("/api/auth/verification/start", {
    method: "POST",
    body: JSON.stringify({ channel: "email", email }),
  });
  const confirmed = await request("/api/auth/verification/confirm", {
    method: "POST",
    body: JSON.stringify({ verificationId: verification.verificationId, code: verification.devCode }),
  });
  const registered = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name: `Free API ${suffix}`,
      email,
      password: "123456",
      verificationToken: confirmed.verificationToken,
    }),
  });

  console.log("2. create API key with free quotas");
  const apiKey = await request("/api/api-keys", {
    method: "POST",
    headers: { Authorization: `Bearer ${registered.token}` },
    body: JSON.stringify({
      name: "Free API Test",
      permissions: ["models:read", "chat:create", "workflows:run", "billing:read"],
      freeQuota: {
        "models:list": 3,
        "chat:completions": 2,
        "workflows:run": 2,
        "images:generations": 0,
      },
      ipWhitelist: "",
    }),
  });

  const auth = { Authorization: `Bearer ${apiKey.secret}` };

  console.log("3. call /v1/models");
  const models = await request("/v1/models", { headers: auth });
  if (!models.data?.length) throw new Error("/v1/models returned empty data");

  console.log("3b. call /v1/image-models");
  const imageModels = await request("/v1/image-models", { headers: auth });
  if (!imageModels.data?.some((model) => model.id === "pollinations:flux")) {
    throw new Error("/v1/image-models missing pollinations:flux");
  }

  console.log("4. call /v1/chat/completions");
  const chat = await request("/v1/chat/completions", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      messages: [{ role: "user", content: "hello" }],
    }),
  });
  if (!chat.choices?.[0]?.message?.content) throw new Error("/v1/chat/completions missing content");

  console.log("5. call /v1/workflows/run");
  const workflow = await request("/v1/workflows/run", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ workflowId: "brand-visual", input: { topic: "launch" } }),
  });
  if (workflow.status !== "completed") throw new Error("/v1/workflows/run did not complete");

  console.log("6. call /v1/quota");
  const quota = await request("/v1/quota", { headers: auth });
  if (quota.quota.endpoints["models:list"].remaining !== 1) {
    throw new Error("models:list quota did not decrement as expected");
  }

  console.log("PASS");
  console.log(`   key: ${apiKey.apiKey.maskedKey}`);
  console.log(`   models remaining: ${quota.quota.endpoints["models:list"].remaining}`);
  console.log(`   chat remaining: ${quota.quota.endpoints["chat:completions"].remaining}`);
  console.log(`   workflows remaining: ${quota.quota.endpoints["workflows:run"].remaining}`);
}

main().catch((error) => {
  console.error("FAIL");
  console.error(error.message);
  process.exit(1);
});
