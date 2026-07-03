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
  const email = `openai-proxy-${suffix}@example.com`;

  console.log("1. start email verification");
  const verification = await request("/api/auth/verification/start", {
    method: "POST",
    body: JSON.stringify({ channel: "email", email }),
  });

  console.log("2. confirm verification");
  const confirmed = await request("/api/auth/verification/confirm", {
    method: "POST",
    body: JSON.stringify({
      verificationId: verification.verificationId,
      code: verification.devCode,
    }),
  });

  console.log("3. register user and create default workspace/wallet");
  const registered = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name: `Proxy Tester ${suffix}`,
      email,
      password: "123456",
      verificationToken: confirmed.verificationToken,
    }),
  });

  if (registered.wallet.balance !== 0) {
    throw new Error("wallet balance should be 0 after registration");
  }

  console.log("4. create platform API key");
  const apiKey = await request("/api/api-keys", {
    method: "POST",
    headers: { Authorization: `Bearer ${registered.token}` },
    body: JSON.stringify({
      name: "OpenAI Proxy E2E",
      permissions: ["images:create", "models:read"],
      quota: 5,
      ipWhitelist: "",
    }),
  });

  console.log(`   created ${apiKey.apiKey.maskedKey}`);

  console.log("5. call real OpenAI through platform API");
  const generation = await request("/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey.secret}` },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
      prompt: "A minimal commercial photo of a glass perfume bottle on a silver surface, soft studio lighting",
      size: "1024x1024",
      quality: "medium",
    }),
  });

  if (!generation.data?.[0]?.url) {
    throw new Error("image generation response missing data[0].url");
  }

  console.log("PASS");
  console.log(`   model: ${generation.model}`);
  console.log(`   image: ${generation.data[0].url}`);
  console.log(`   quota remaining: ${generation.quota.remaining}`);
}

main().catch((error) => {
  console.error("FAIL");
  console.error(error.message);
  process.exit(1);
});
