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
  if (!response.ok) throw new Error(`${response.status} ${payload.error || JSON.stringify(payload)}`);
  return payload;
}

async function main() {
  const suffix = Date.now();
  const email = `image-model-${suffix}@example.com`;
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
      name: `Image Model ${suffix}`,
      email,
      password: "123456",
      verificationToken: confirmed.verificationToken,
    }),
  });
  const apiKey = await request("/api/api-keys", {
    method: "POST",
    headers: { Authorization: `Bearer ${registered.token}` },
    body: JSON.stringify({
      name: "Image Model Test",
      permissions: ["images:create", "models:read", "billing:read"],
      freeQuota: {
        "models:list": 5,
        "images:generations": 2,
        "chat:completions": 0,
        "workflows:run": 0,
      },
      ipWhitelist: "",
    }),
  });
  const auth = { Authorization: `Bearer ${apiKey.secret}` };
  const generated = await request("/v1/images/generations", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      model: "pollinations:flux",
      prompt: "minimal product photo of a glass perfume bottle",
      size: "1024x1024",
      quality: "auto",
    }),
  });
  if (generated.model !== "pollinations:flux") throw new Error("generation did not use pollinations:flux");
  if (!generated.data?.[0]?.url?.includes("/generated/")) throw new Error("generation did not return local generated image url");
  if (generated.quota.remaining !== 1) throw new Error("image quota did not decrement");
  console.log("PASS");
  console.log(`   model: ${generated.model}`);
  console.log(`   image: ${generated.data[0].url}`);
  console.log(`   remaining: ${generated.quota.remaining}`);
}

main().catch((error) => {
  console.error("FAIL");
  console.error(error.message);
  process.exit(1);
});
