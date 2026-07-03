const http = require("http");
const https = require("https");
const net = require("net");
const tls = require("tls");
const fs = require("fs/promises");
const fsNative = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const QRCode = require("qrcode");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { NodeHttpHandler } = require("@smithy/node-http-handler");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { loadEnvFile } = require("./lib/env");
const {
  closePostgres,
  getPool,
  readPostgresDb,
  upsertPostgresItems,
  writePostgresDb,
} = require("./lib/postgres-store");
const { sendVerificationCode } = require("./lib/notifier");

const ROOT = __dirname;
loadEnvFile(path.join(ROOT, ".env"));

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(ROOT, "public");
const GENERATED_DIR = path.join(PUBLIC_DIR, "generated");
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SESSION_TTL_MS = Math.max(
  60 * 60 * 1000,
  Number(process.env.SESSION_TTL_HOURS || 24 * 30) * 60 * 60 * 1000,
);
const MAX_UPLOAD_BYTES = Math.max(
  1024 * 1024,
  Number(process.env.MAX_UPLOAD_MB || 50) * 1024 * 1024,
);
const MAX_REQUEST_BODY_BYTES = Math.max(
  1024 * 1024,
  Number(process.env.MAX_REQUEST_BODY_MB || 10) * 1024 * 1024,
);
const ENABLE_TEST_PAYMENT = process.env.ENABLE_TEST_PAYMENT === "true";
const ACCESS_LOG_ENABLED = process.env.ACCESS_LOG_ENABLED !== "false";
const R2_ACCOUNT_ID = String(process.env.R2_ACCOUNT_ID || "").trim();
const R2_ACCESS_KEY_ID = String(process.env.R2_ACCESS_KEY_ID || "").trim();
const R2_SECRET_ACCESS_KEY = String(
  process.env.R2_SECRET_ACCESS_KEY || "",
).trim();
const R2_BUCKET = String(process.env.R2_BUCKET || "").trim();
const R2_PUBLIC_BASE_URL = String(
  process.env.R2_PUBLIC_BASE_URL || "",
).replace(/\/+$/, "");
const R2_DELIVERY_BASE_URL = String(
  process.env.R2_DELIVERY_BASE_URL ||
    (process.env.PUBLIC_BASE_URL
      ? `${String(process.env.PUBLIC_BASE_URL).replace(/\/+$/, "")}/r2`
      : "/r2"),
).replace(/\/+$/, "");
const R2_PRESIGN_TTL_SECONDS = Math.min(
  3600,
  Math.max(60, Number(process.env.R2_PRESIGN_TTL_SECONDS || 900)),
);
const R2_PROXY = String(
  process.env.R2_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    "",
).trim();
let r2Client = null;
const ALLOWED_CANVAS_MEDIA_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/ogg",
  "audio/mp4",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "application/octet-stream",
  "text/plain",
  "text/markdown",
]);
const rateLimitBuckets = new Map();
const RATE_LIMIT_RULES = [
  {
    name: "auth-login",
    method: "POST",
    path: "/api/auth/login",
    limit: 10,
    windowMs: 15 * 60 * 1000,
  },
  {
    name: "auth-register",
    method: "POST",
    path: "/api/auth/register",
    limit: 5,
    windowMs: 60 * 60 * 1000,
  },
  {
    name: "verification-start",
    method: "POST",
    path: "/api/auth/verification/start",
    limit: 5,
    windowMs: 15 * 60 * 1000,
  },
  {
    name: "verification-confirm",
    method: "POST",
    path: "/api/auth/verification/confirm",
    limit: 12,
    windowMs: 15 * 60 * 1000,
  },
  {
    name: "media-upload",
    method: "POST",
    path: "/api/canvas-media",
    limit: 60,
    windowMs: 10 * 60 * 1000,
  },
  {
    name: "media-direct-upload",
    method: "POST",
    pathPrefix: "/api/canvas-media/",
    limit: 120,
    windowMs: 10 * 60 * 1000,
  },
  {
    name: "generation",
    method: "POST",
    path: "/api/generations",
    limit: 30,
    windowMs: 10 * 60 * 1000,
  },
  {
    name: "commercial-agent",
    method: "POST",
    path: "/api/commercial-video-agent",
    limit: 60,
    windowMs: 10 * 60 * 1000,
  },
  {
    name: "commercial-chat",
    method: "POST",
    path: "/api/commercial-video-chat",
    limit: 60,
    windowMs: 10 * 60 * 1000,
  },
  {
    name: "orders",
    method: "POST",
    path: "/api/orders",
    limit: 10,
    windowMs: 10 * 60 * 1000,
  },
  {
    name: "external-api",
    method: "POST",
    pathPrefix: "/v1/",
    limit: 120,
    windowMs: 60 * 1000,
  },
];
const COMMERCIAL_VIDEO_SKILL_FILE = path.join(
  ROOT,
  "..",
  "SKILL_CommercialProductVideoWorkflow.md",
);
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
const OPENAI_BASE_URL = (
  process.env.OPENAI_BASE_URL || "https://api.openai.com"
).replace(/\/$/, "");
const OPENAI_PROXY =
  process.env.OPENAI_PROXY ||
  process.env.HTTPS_PROXY ||
  process.env.HTTP_PROXY ||
  "";
const OPENAI_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini";
const API_RELAY_TIMEOUT_MS = Math.min(
  10 * 60 * 1000,
  Math.max(5000, Number(process.env.API_RELAY_TIMEOUT_MS || 120000)),
);
const API_RELAY_MAX_RETRIES = Math.min(
  5,
  Math.max(0, Number(process.env.API_RELAY_MAX_RETRIES || 2)),
);
const API_RELAY_CHANNELS = [
  ...builtinApiRelayChannels(),
  ...parseApiRelayChannels(process.env.API_RELAY_CHANNELS_JSON),
].sort((left, right) => left.priority - right.priority);
const API_KEY_ENCRYPTION_SECRET = String(
  process.env.API_KEY_ENCRYPTION_SECRET ||
    process.env.DATABASE_URL ||
    "dreamehub-local-api-key-encryption",
);
const POLLINATIONS_TEXT_MODEL = process.env.POLLINATIONS_TEXT_MODEL || "openai";
const COMMERCIAL_AGENT_PROVIDER = (
  process.env.COMMERCIAL_AGENT_PROVIDER || "auto"
)
  .trim()
  .toLowerCase();
const LOCAL_LLM_BASE_URL = (
  process.env.LOCAL_LLM_BASE_URL ||
  process.env.COMMERCIAL_AGENT_LOCAL_BASE_URL ||
  ""
).replace(/\/$/, "");
const LOCAL_LLM_MODEL =
  process.env.LOCAL_LLM_MODEL ||
  process.env.COMMERCIAL_AGENT_LOCAL_MODEL ||
  "qwen2.5:14b-instruct";
const LOCAL_LLM_API_KEY =
  process.env.LOCAL_LLM_API_KEY ||
  process.env.OPENROUTER_API_KEY ||
  process.env.COMMERCIAL_AGENT_LOCAL_API_KEY ||
  "";
const LOCAL_LLM_TIMEOUT_MS = Math.min(
  10 * 60 * 1000,
  Math.max(
    30000,
    Number(
      process.env.LOCAL_LLM_TIMEOUT_MS ||
        process.env.COMMERCIAL_AGENT_LOCAL_TIMEOUT_MS ||
        600000,
    ),
  ),
);
const LOCAL_LLM_MAX_TOKENS = Math.min(
  4096,
  Math.max(
    64,
    Number(
      process.env.LOCAL_LLM_MAX_TOKENS ||
        process.env.COMMERCIAL_AGENT_LOCAL_MAX_TOKENS ||
        900,
    ),
  ),
);

function localLlmUsesOpenRouter() {
  try {
    return /(^|\.)openrouter\.ai$/i.test(
      new URL(LOCAL_LLM_BASE_URL || "http://localhost").hostname,
    );
  } catch {
    return false;
  }
}

function localLlmConfigured() {
  if (!LOCAL_LLM_BASE_URL) return false;
  if (localLlmUsesOpenRouter()) return Boolean(LOCAL_LLM_API_KEY);
  return true;
}

function localLlmModelName(model) {
  const value = String(model || "").trim();
  if (localLlmUsesOpenRouter() && isLocalTextModel(value)) return LOCAL_LLM_MODEL;
  if (value.startsWith("local:")) return value.slice("local:".length) || LOCAL_LLM_MODEL;
  if (value.startsWith("ollama:")) return value.slice("ollama:".length) || LOCAL_LLM_MODEL;
  return value || LOCAL_LLM_MODEL;
}

const SEEDANCE_API_KEY = (
  process.env.SEEDANCE_API_KEY ||
  process.env.ARK_API_KEY ||
  ""
).trim();
const SEEDANCE_PROVIDER = (
  process.env.SEEDANCE_PROVIDER ||
  (SEEDANCE_API_KEY.startsWith("ark-") ? "ark" : "seedance2")
)
  .trim()
  .toLowerCase();
const SEEDANCE_DEFAULT_ARK_MODEL = "doubao-seedance-2-0-260128";
const SEEDANCE_DEFAULT_THIRD_PARTY_MODEL = "seedance-2.0";
const SEEDANCE_MODEL_ENV =
  process.env.SEEDANCE_MODEL ||
  process.env.SEEDANCE_VIDEO_MODEL ||
  process.env.SEEDANCE_VEDIO_MODEL ||
  "";
const SEEDANCE_MODEL =
  SEEDANCE_PROVIDER === "ark" &&
  (!SEEDANCE_MODEL_ENV ||
    SEEDANCE_MODEL_ENV === SEEDANCE_DEFAULT_THIRD_PARTY_MODEL)
    ? SEEDANCE_DEFAULT_ARK_MODEL
    : SEEDANCE_MODEL_ENV || SEEDANCE_DEFAULT_THIRD_PARTY_MODEL;
const SEEDANCE_BASE_URL = (
  process.env.SEEDANCE_BASE_URL ||
  (SEEDANCE_PROVIDER === "ark"
    ? "https://ark.cn-beijing.volces.com/api/v3"
    : "https://seedance2.app/api/v1")
).replace(/\/$/, "");
const FACE_RESTORE_PROVIDER = (process.env.FACE_RESTORE_PROVIDER || "")
  .trim()
  .toLowerCase();
const FACE_RESTORE_API_URL = (process.env.FACE_RESTORE_API_URL || "").trim();
const FACE_RESTORE_API_KEY = (process.env.FACE_RESTORE_API_KEY || "").trim();
const COMFYUI_BASE_URL = (
  process.env.COMFYUI_BASE_URL || "http://127.0.0.1:8188"
).replace(/\/$/, "");
const COMFYUI_FACE_RESTORE_WORKFLOW = (
  process.env.COMFYUI_FACE_RESTORE_WORKFLOW ||
  "workflows/comfyui-face-restore-light.json"
).trim();
const COMFYUI_FACE_RESTORE_OUTPUT_NODE = (
  process.env.COMFYUI_FACE_RESTORE_OUTPUT_NODE || ""
).trim();
const COMFYUI_FACE_SWAP_WORKFLOW = (
  process.env.COMFYUI_FACE_SWAP_WORKFLOW ||
  "workflows/comfyui-face-swap-light.json"
).trim();
const COMFYUI_FACE_SWAP_OUTPUT_NODE = (
  process.env.COMFYUI_FACE_SWAP_OUTPUT_NODE || ""
).trim();
const COMFYUI_TIMEOUT_MS = Number(process.env.COMFYUI_TIMEOUT_MS || 600000);
const COMFYUI_LOG_FILE =
  process.env.COMFYUI_LOG_FILE || "/tmp/dreamehub-comfyui.log";
const ASYNC_GENERATION_MODES = new Set([
  "video",
  "video-face-restore",
  "video-face-swap",
]);
const PAYMENT_PROVIDER = (process.env.PAYMENT_PROVIDER || "alipay,wechat")
  .trim()
  .toLowerCase();
const PAYMENT_CURRENCY = (process.env.PAYMENT_CURRENCY || "cny")
  .trim()
  .toLowerCase();
const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || "").trim();
const STRIPE_WEBHOOK_SECRET = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();

function normalizePaymentPem(value, label) {
  const raw = String(value || "")
    .replace(/\\n/g, "\n")
    .trim();
  if (!raw) return "";
  if (/-----BEGIN [^-]+-----/.test(raw)) return raw;
  const compact = raw.replace(/\s+/g, "");
  if (/^[A-Za-z0-9+/=]+$/.test(compact) && compact.length > 128) {
    const lines = compact.match(/.{1,64}/g)?.join("\n") || compact;
    return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
  }
  return raw;
}

const ALIPAY_APP_ID = (process.env.ALIPAY_APP_ID || "").trim();
const ALIPAY_PRIVATE_KEY = normalizePaymentPem(
  process.env.ALIPAY_PRIVATE_KEY,
  "PRIVATE KEY",
);
const ALIPAY_PUBLIC_KEY = normalizePaymentPem(
  process.env.ALIPAY_PUBLIC_KEY,
  "PUBLIC KEY",
);
const ALIPAY_GATEWAY = (
  process.env.ALIPAY_GATEWAY || "https://openapi.alipay.com/gateway.do"
).trim();
const WECHAT_PAY_APP_ID = (process.env.WECHAT_PAY_APP_ID || "").trim();
const WECHAT_PAY_MCH_ID = (process.env.WECHAT_PAY_MCH_ID || "").trim();
const WECHAT_PAY_MCH_SERIAL_NO = (
  process.env.WECHAT_PAY_MCH_SERIAL_NO || ""
).trim();
const WECHAT_PAY_PRIVATE_KEY = (process.env.WECHAT_PAY_PRIVATE_KEY || "")
  .replace(/\\n/g, "\n")
  .trim();
const WECHAT_PAY_API_V3_KEY = (process.env.WECHAT_PAY_API_V3_KEY || "").trim();
const WECHAT_PAY_PLATFORM_CERT_PEM = (
  process.env.WECHAT_PAY_PLATFORM_CERT_PEM || ""
)
  .replace(/\\n/g, "\n")
  .trim();
const CREDIT_MIN_CNY = Number(process.env.CREDIT_MIN_CNY || 0.12);
const CREDIT_MARGIN_RATE = Number(process.env.CREDIT_MARGIN_RATE || 0.35);
const SEEDANCE_SUPPORTED_RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
const SEEDANCE_SUPPORTED_RESOLUTIONS = ["480p", "720p", "1080p"];
const SEEDANCE_DURATION_MIN = 4;
const SEEDANCE_DURATION_MAX = 15;
const SEEDANCE_REFERENCE_IMAGE_LIMIT = 9;
const SEEDANCE_REFERENCE_VIDEO_LIMIT = 3;
const SEEDANCE_REFERENCE_AUDIO_LIMIT = 3;
let dbCache = null;
let dbRuntimeMigrationsDone = false;
let generationJobsHydrated = false;
const generationJobs = new Map();

const DEFAULT_FREE_QUOTAS = {
  "models:list": 1000,
  "images:generations": 5,
  "chat:completions": 50,
  "responses:create": 50,
  "embeddings:create": 100,
  "workflows:run": 30,
};

function parseApiRelayChannels(rawValue) {
  if (!String(rawValue || "").trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(rawValue);
  } catch (error) {
    console.warn(
      `API_RELAY_CHANNELS_JSON 解析失败，已忽略中转渠道：${error.message}`,
    );
    return [];
  }
  if (!Array.isArray(parsed)) {
    console.warn("API_RELAY_CHANNELS_JSON 必须是 JSON 数组，已忽略中转渠道");
    return [];
  }

  return parsed
    .map((channel, index) => {
      const baseUrl = String(channel?.baseUrl || "")
        .trim()
        .replace(/\/+$/, "");
      if (!baseUrl || channel?.enabled === false) return null;
      let parsedUrl;
      try {
        parsedUrl = new URL(baseUrl);
      } catch {
        console.warn(`API 中转渠道 ${index + 1} 的 baseUrl 无效，已忽略`);
        return null;
      }
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        console.warn(`API 中转渠道 ${index + 1} 仅支持 HTTP/HTTPS，已忽略`);
        return null;
      }

      const id = String(channel.id || `relay-${index + 1}`)
        .trim()
        .replace(/[^\w.-]/g, "-")
        .slice(0, 64);
      const modelMap = {};
      for (const model of Array.isArray(channel.models) ? channel.models : []) {
        const name = String(model || "").trim();
        if (name) modelMap[name] = name;
      }
      if (channel.modelMap && typeof channel.modelMap === "object") {
        for (const [alias, upstreamModel] of Object.entries(channel.modelMap)) {
          const publicName = String(alias || "").trim();
          const upstreamName = String(upstreamModel || "").trim();
          if (publicName && upstreamName) modelMap[publicName] = upstreamName;
        }
      }

      const capabilities = (
        Array.isArray(channel.capabilities)
          ? channel.capabilities
          : ["chat"]
      )
        .map((item) => String(item || "").trim().toLowerCase())
        .filter((item) =>
          ["chat", "responses", "embeddings"].includes(item),
        );
      const apiKeyEnv = String(channel.apiKeyEnv || "").trim();
      const apiKey = String(
        (apiKeyEnv && process.env[apiKeyEnv]) || channel.apiKey || "",
      ).trim();
      const headers =
        channel.headers && typeof channel.headers === "object"
          ? Object.fromEntries(
              Object.entries(channel.headers)
                .map(([name, value]) => [
                  String(name || "").trim(),
                  String(value || "").trim(),
                ])
                .filter(([name, value]) => name && value),
            )
          : {};

      return {
        id,
        name: String(channel.name || id).trim().slice(0, 80),
        baseUrl,
        apiKey,
        headers,
        modelMap,
        capabilities: capabilities.length ? capabilities : ["chat"],
        priority: Number.isFinite(Number(channel.priority))
          ? Number(channel.priority)
          : 100,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.priority - right.priority);
}

function builtinApiRelayChannels() {
  const definitions = [
    {
      id: "openrouter",
      name: "OpenRouter",
      baseUrl: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
      priority: 15,
      capabilities: ["chat"],
      headers: {
        ...(process.env.PUBLIC_BASE_URL
          ? { "HTTP-Referer": process.env.PUBLIC_BASE_URL }
          : {}),
        "X-Title": "DreameHub",
      },
      modelMap: {
        "openrouter-qwen36-free":
          process.env.OPENROUTER_MODEL ||
          "google/gemma-4-31b-it:free",
        "openrouter-glm-free": "z-ai/glm-4.5-air:free",
      },
    },
    {
      id: "deepseek",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: process.env.DEEPSEEK_API_KEY,
      priority: 20,
      capabilities: ["chat"],
      modelMap: {
        "deepseek-chat": "deepseek-chat",
        "deepseek-reasoner": "deepseek-reasoner",
      },
    },
    {
      id: "dashscope",
      name: "阿里云百炼",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey: process.env.DASHSCOPE_API_KEY,
      priority: 30,
      capabilities: ["chat", "embeddings"],
      modelMap: {
        "qwen-plus": "qwen-plus",
        "qwen-max": "qwen-max",
        "qwen-coder-plus": "qwen-coder-plus",
        "text-embedding-v3": "text-embedding-v3",
      },
    },
    {
      id: "volcengine",
      name: "字节火山方舟",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      apiKey: process.env.ARK_API_KEY,
      priority: 40,
      capabilities: ["chat"],
      modelMap: process.env.ARK_TEXT_MODEL
        ? {
            "doubao-seed": process.env.ARK_TEXT_MODEL,
          }
        : {},
    },
    {
      id: "moonshot",
      name: "月之暗面 Kimi",
      baseUrl: "https://api.moonshot.cn/v1",
      apiKey: process.env.MOONSHOT_API_KEY,
      priority: 50,
      capabilities: ["chat"],
      modelMap: {
        "moonshot-v1-8k": "moonshot-v1-8k",
        "moonshot-v1-32k": "moonshot-v1-32k",
      },
    },
    {
      id: "zhipu",
      name: "智谱 AI",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      apiKey: process.env.ZHIPU_API_KEY,
      priority: 60,
      capabilities: ["chat"],
      modelMap: {
        "glm-4-plus": "glm-4-plus",
        "glm-4-flash": "glm-4-flash",
      },
    },
  ];
  return definitions
    .filter((channel) => String(channel.apiKey || "").trim())
    .map((channel) => ({
      ...channel,
      apiKey: String(channel.apiKey).trim(),
      headers: channel.headers || {},
    }));
}

function configuredFaceRestoreProvider() {
  if (FACE_RESTORE_PROVIDER) return FACE_RESTORE_PROVIDER;
  if (FACE_RESTORE_API_URL) return "custom";
  if (process.env.COMFYUI_BASE_URL || process.env.COMFYUI_FACE_RESTORE_WORKFLOW)
    return "comfyui";
  return "custom";
}

function faceRestoreConfigured() {
  const provider = configuredFaceRestoreProvider();
  if (provider === "custom") return Boolean(FACE_RESTORE_API_URL);
  if (provider === "comfyui")
    return Boolean(COMFYUI_BASE_URL && COMFYUI_FACE_RESTORE_WORKFLOW);
  return false;
}

function faceSwapConfigured() {
  return Boolean(COMFYUI_BASE_URL && COMFYUI_FACE_SWAP_WORKFLOW);
}

const IMAGE_MODEL_REGISTRY = [
  {
    id: "openai:gpt-image-2",
    provider: "openai",
    upstreamModel: "gpt-image-2",
    label: "GPT Images 2.0",
    description:
      "OpenAI 最新图片模型，支持文生图、图生图和图片编辑，需要 OPENAI_API_KEY。",
    requiresKey: true,
    sizes: ["1024x1024", "1024x1536", "1536x1024", "auto"],
    qualities: ["low", "medium", "high", "auto"],
    capabilities: {
      output: "image",
      modes: [
        "text-to-image",
        "image-to-image",
        "image-reference",
        "image-edit",
      ],
      inputTypes: ["text", "image"],
      supportsReferenceImage: true,
      supportsReferenceVideo: false,
      supportsReferenceAudio: false,
      supportsRegionMask: false,
      supportsFirstLastFrame: false,
      supportsBatch: false,
      realApi: Boolean(process.env.OPENAI_API_KEY),
    },
  },
  {
    id: "openai:gpt-image-1",
    provider: "openai",
    upstreamModel: "gpt-image-1",
    label: "GPT Image 1",
    description:
      "OpenAI 高质量图片模型，支持文生图和图片参考编辑，需要 OPENAI_API_KEY。",
    requiresKey: true,
    sizes: ["1024x1024", "1024x1536", "1536x1024", "auto"],
    qualities: ["low", "medium", "high", "auto"],
    capabilities: {
      output: "image",
      modes: [
        "text-to-image",
        "image-to-image",
        "image-reference",
        "image-edit",
      ],
      inputTypes: ["text", "image"],
      supportsReferenceImage: true,
      supportsReferenceVideo: false,
      supportsReferenceAudio: false,
      supportsRegionMask: false,
      supportsFirstLastFrame: false,
      supportsBatch: false,
      realApi: Boolean(process.env.OPENAI_API_KEY),
    },
  },
  {
    id: "pollinations:flux",
    provider: "pollinations",
    upstreamModel: "flux",
    label: "Flux",
    description: "Pollinations 免费公开文生图模型",
    requiresKey: false,
    sizes: ["1024x1024", "1024x1536", "1536x1024"],
    qualities: ["auto"],
    capabilities: {
      output: "image",
      modes: ["text-to-image"],
      inputTypes: ["text"],
      supportsReferenceImage: false,
      supportsReferenceVideo: false,
      supportsReferenceAudio: false,
      supportsRegionMask: false,
      supportsFirstLastFrame: false,
      supportsBatch: false,
      realApi: true,
    },
  },
  {
    id: "pollinations:turbo",
    provider: "pollinations",
    upstreamModel: "turbo",
    label: "Turbo",
    description: "Pollinations 快速免费文生图模型，适合预览和低成本试用。",
    requiresKey: false,
    sizes: ["1024x1024", "1024x1536", "1536x1024"],
    qualities: ["auto"],
    capabilities: {
      output: "image",
      modes: ["text-to-image"],
      inputTypes: ["text"],
      supportsReferenceImage: false,
      supportsReferenceVideo: false,
      supportsReferenceAudio: false,
      supportsRegionMask: false,
      supportsFirstLastFrame: false,
      supportsBatch: false,
      realApi: true,
    },
  },
];

const API_CAPABILITIES = {
  text: {
    realApi: true,
    models: [
      {
        id: LOCAL_LLM_MODEL,
        provider: localLlmUsesOpenRouter() ? "openrouter" : "local",
        label: localLlmUsesOpenRouter()
          ? `OpenRouter 免费文本 (${LOCAL_LLM_MODEL})`
          : `本地文本模型 (${LOCAL_LLM_MODEL})`,
        engine: LOCAL_LLM_MODEL,
        capabilities: {
          output: "text",
          modes: ["text-to-text"],
          inputTypes: ["text"],
          realApi: localLlmConfigured(),
        },
      },
      {
        id: "dreamehub-free-chat",
        provider: "pollinations",
        label: "免费真实对话",
        engine: POLLINATIONS_TEXT_MODEL,
        capabilities: {
          output: "text",
          modes: ["text-to-text"],
          inputTypes: ["text"],
          realApi: true,
        },
      },
      {
        id: "pollinations:openai",
        provider: "pollinations",
        label: "Pollinations OpenAI",
        engine: "openai",
        capabilities: {
          output: "text",
          modes: ["text-to-text"],
          inputTypes: ["text"],
          realApi: true,
        },
      },
      {
        id: "openai-chat",
        provider: "openai",
        label: "OpenAI 文本",
        engine: OPENAI_TEXT_MODEL,
        capabilities: {
          output: "text",
          modes: ["text-to-text"],
          inputTypes: ["text"],
          realApi: Boolean(process.env.OPENAI_API_KEY),
        },
      },
    ],
    reason: "",
  },
  image: {
    realApi: true,
    models: IMAGE_MODEL_REGISTRY.map((model) => ({
      id: model.id,
      provider: model.provider,
      label: model.label,
      capabilities: model.capabilities,
    })),
  },
  video: {
    realApi: Boolean(
      SEEDANCE_API_KEY || faceRestoreConfigured() || faceSwapConfigured(),
    ),
    models: [
      ...(SEEDANCE_API_KEY
        ? [
            {
              id: "seedance:2.0",
              provider: SEEDANCE_PROVIDER === "ark" ? "ark" : "seedance",
              label:
                SEEDANCE_PROVIDER === "ark"
                  ? "Doubao Seedance 2.0 (Ark)"
                  : "Seedance 2.0",
              capabilities: {
                output: "video",
                modes: [
                  "text-to-video",
                  "image-to-video",
                  "first-last-frame",
                  "reference-to-video",
                ],
                inputTypes: ["text", "image", "video", "audio"],
                supportsReferenceImage: true,
                supportsReferenceVideo: true,
                supportsReferenceAudio: true,
                supportsRegionMask: false,
                supportsFirstLastFrame: true,
                ratios: ["auto", ...SEEDANCE_SUPPORTED_RATIOS],
                resolutions: SEEDANCE_SUPPORTED_RESOLUTIONS,
                durationSeconds: {
                  min: SEEDANCE_DURATION_MIN,
                  max: SEEDANCE_DURATION_MAX,
                },
                referenceLimits: {
                  image: SEEDANCE_REFERENCE_IMAGE_LIMIT,
                  video: SEEDANCE_REFERENCE_VIDEO_LIMIT,
                  audio: SEEDANCE_REFERENCE_AUDIO_LIMIT,
                },
                controls: [
                  "generate_audio",
                  "watermark",
                  "return_last_frame",
                  "camera_fixed",
                  "seed",
                  "service_tier",
                  "draft",
                  "draft_task",
                  "callback_url",
                  "execution_expires_after",
                  "safety_identifier",
                  "web_search",
                ],
                realApi: true,
              },
            },
          ]
        : []),
      {
        id: "face-restore:hd",
        provider: "custom",
        label: "视频面部高清修复",
        capabilities: {
          output: "video",
          modes: ["face-restoration"],
          inputTypes: ["video"],
          supportsReferenceImage: false,
          supportsReferenceVideo: true,
          supportsReferenceAudio: false,
          supportsRegionMask: false,
          supportsFirstLastFrame: false,
          realApi: faceRestoreConfigured(),
        },
      },
      {
        id: "face-swap:light",
        provider: "comfyui",
        label: "视频换脸（InsightFace）",
        capabilities: {
          output: "video",
          modes: ["face-swap"],
          inputTypes: ["video", "image"],
          supportsReferenceImage: true,
          supportsReferenceVideo: true,
          supportsReferenceAudio: false,
          supportsRegionMask: false,
          supportsFirstLastFrame: false,
          realApi: faceSwapConfigured(),
        },
      },
    ],
    reason:
      SEEDANCE_API_KEY || faceRestoreConfigured() || faceSwapConfigured()
        ? ""
        : "缺少 SEEDANCE_API_KEY、FACE_RESTORE_API_URL 或 ComfyUI 工作流配置，无法启用真实视频 API。",
  },
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
};

function requireDatabaseUrl() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required. PostgreSQL is the only supported runtime database.",
    );
  }
}

async function readDb() {
  requireDatabaseUrl();
  if (dbCache) return dbCache;
  dbCache = await readPostgresDb();
  if (!dbRuntimeMigrationsDone) {
    dbRuntimeMigrationsDone = true;
    await applyRuntimeMigrations(dbCache);
  }
  dbCache.generationJobs ||= [];
  if (!generationJobsHydrated) {
    generationJobsHydrated = true;
    for (const job of dbCache.generationJobs) {
      if (job?.id) generationJobs.set(job.id, job);
    }
  }
  return dbCache;
}

async function writeDb(db) {
  requireDatabaseUrl();
  await writePostgresDb(db);
  dbCache = db;
}

async function applyRuntimeMigrations(db) {
  if (!db) return;
  db.users ||= [];
  db.sessions ||= [];
  let changed = false;
  for (const user of db.users) {
    if (needsPasswordUpgrade(user)) {
      upgradeUserPassword(user, user.password);
      changed = true;
    }
  }
  for (const session of db.sessions) {
    if (!session.expiresAt) {
      const baseTime = Number.isFinite(new Date(session.createdAt).getTime())
        ? new Date(session.createdAt).getTime()
        : Date.now();
      session.expiresAt = new Date(baseTime + SESSION_TTL_MS).toISOString();
      changed = true;
    }
  }
  const activeSessions = db.sessions.filter((session) => !isSessionExpired(session));
  if (activeSessions.length !== db.sessions.length) {
    db.sessions = activeSessions;
    changed = true;
  }
  if (changed) await writeDb(db);
}

async function upsertDbItems(collection, items) {
  requireDatabaseUrl();
  await upsertPostgresItems(collection, items);
}

async function checkPostgresHealth() {
  requireDatabaseUrl();
  const db = getPool();
  await db.query("select 1");
}

function acceptsGzip(req) {
  return /\bgzip\b/i.test(String(req?.headers?.["accept-encoding"] || ""));
}

function gzipResponse(req, res, status, headers, body) {
  const raw = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  if (raw.length > 1024 && acceptsGzip(req)) {
    const gzipped = zlib.gzipSync(raw);
    res.writeHead(status, {
      ...headers,
      "Content-Encoding": "gzip",
      "Content-Length": gzipped.length,
      Vary: "Accept-Encoding",
    });
    res.end(gzipped);
    return;
  }
  res.writeHead(status, {
    ...headers,
    "Content-Length": raw.length,
    Vary: "Accept-Encoding",
  });
  res.end(raw);
}

function sendJson(res, status, payload, req = null) {
  gzipResponse(req, res, status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  }, JSON.stringify(payload));
}

function sendError(res, status, message, req = null) {
  sendJson(res, status, { error: message }, req);
}

function requestClientIp(req) {
  const cloudflareIp = String(req.headers["cf-connecting-ip"] || "").trim();
  if (cloudflareIp) return cloudflareIp;
  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return forwarded || req.socket?.remoteAddress || "unknown";
}

function applySecurityHeaders(req, res, requestId) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(self)",
  );
  res.setHeader("X-Request-ID", requestId);
  if (String(req.headers["x-forwarded-proto"] || "").includes("https")) {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }
}

function matchingRateLimitRule(req, url) {
  return RATE_LIMIT_RULES.find(
    (rule) =>
      rule.method === req.method &&
      (rule.path === url.pathname ||
        (rule.pathPrefix && url.pathname.startsWith(rule.pathPrefix))),
  );
}

function enforceRateLimit(req, res, url) {
  const rule = matchingRateLimitRule(req, url);
  if (!rule) return true;
  const now = Date.now();
  const ip = requestClientIp(req);
  const key = `${rule.name}:${ip}`;
  let bucket = rateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + rule.windowMs };
    rateLimitBuckets.set(key, bucket);
  }
  bucket.count += 1;
  const remaining = Math.max(0, rule.limit - bucket.count);
  res.setHeader("X-RateLimit-Limit", String(rule.limit));
  res.setHeader("X-RateLimit-Remaining", String(remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
  if (bucket.count <= rule.limit) return true;
  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  res.setHeader("Retry-After", String(retryAfter));
  sendError(res, 429, "Too many requests. Please try again later.", req);
  return false;
}

function logHttpRequest(req, res, url, requestId, startedAt) {
  if (!ACCESS_LOG_ENABLED) return;
  if (
    res.statusCode < 400 &&
    !url.pathname.startsWith("/api/") &&
    !url.pathname.startsWith("/v1/")
  ) {
    return;
  }
  console.log(
    JSON.stringify({
      type: "http_request",
      requestId,
      method: req.method,
      path: url.pathname,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
      ip: requestClientIp(req),
    }),
  );
}

const rateLimitCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) rateLimitBuckets.delete(key);
  }
}, 5 * 60 * 1000);
rateLimitCleanupTimer.unref();

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_REQUEST_BODY_BYTES) {
      const error = new Error("Request body is too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

async function readRawBody(req, maxBytes = MAX_REQUEST_BODY_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error("Request body is too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readFormBody(req) {
  const rawBody = await readRawBody(req);
  return Object.fromEntries(new URLSearchParams(rawBody.toString("utf8")));
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    plan: user.plan,
    credits: user.credits,
    role: user.role,
  };
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function emailOwnedByAnotherUser(db, email, userId = "") {
  const normalized = normalizeEmail(email);
  return db.users.some(
    (item) =>
      item.id !== userId && normalizeEmail(item.email) === normalized,
  );
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto.scryptSync(String(password || ""), salt, 64).toString("base64url");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(user, password) {
  const storedHash = String(user?.passwordHash || "");
  if (storedHash.startsWith("scrypt$")) {
    const [, salt, expectedHash] = storedHash.split("$");
    if (!salt || !expectedHash) return false;
    const actualHash = crypto
      .scryptSync(String(password || ""), salt, 64)
      .toString("base64url");
    if (actualHash.length !== expectedHash.length) return false;
    return crypto.timingSafeEqual(
      Buffer.from(actualHash),
      Buffer.from(expectedHash),
    );
  }
  return Boolean(user?.password && user.password === password);
}

function needsPasswordUpgrade(user) {
  return Boolean(user?.password && !String(user?.passwordHash || "").startsWith("scrypt$"));
}

function upgradeUserPassword(user, password) {
  user.passwordHash = hashPassword(password);
  delete user.password;
  user.passwordUpdatedAt = new Date().toISOString();
}

function createSession(user) {
  const now = Date.now();
  return {
    token: crypto.randomUUID(),
    userId: user.id,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
  };
}

function isSessionExpired(session) {
  if (!session?.expiresAt) return false;
  return new Date(session.expiresAt).getTime() <= Date.now();
}

function ensureCollections(db) {
  db.users ||= [];
  db.sessions ||= [];
  db.verificationRequests ||= [];
  db.workspaces ||= [];
  db.wallets ||= [];
  db.apiKeys ||= [];
  db.orders ||= [];
  db.generations ||= [];
  db.generationJobs ||= [];
  db.userWorkflows ||= [];
  db.commercialVideoChats ||= [];
  db.models ||= [];
  db.workflows ||= [];
  db.communityWorks ||= [];
  db.previewImages ||= [
    "/assets/gpt-image-2-promo.png",
    "/assets/dreame-logo.png",
  ];
  db.sessions = db.sessions.filter((session) => !isSessionExpired(session));

  for (const user of db.users) {
    ensureUserInfrastructure(db, user);
  }
}

function ensureUserInfrastructure(db, user) {
  let created = false;
  let workspace = db.workspaces.find((item) => item.ownerId === user.id);
  if (!workspace) {
    workspace = createDefaultWorkspace(user);
    db.workspaces.push(workspace);
    created = true;
  }

  let wallet = db.wallets.find((item) => item.userId === user.id);
  if (!wallet) {
    wallet = createWallet(user, workspace);
    db.wallets.push(wallet);
    created = true;
  }

  return { workspace, wallet, created };
}

function createDefaultWorkspace(user) {
  const projectId = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    ownerId: user.id,
    name: `${user.name} 的工作区`,
    slug: `${user.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "workspace"}-${Date.now()}`,
    defaultProjectId: projectId,
    projects: [
      {
        id: projectId,
        name: "Default Project",
        environment: "production",
        createdAt: new Date().toISOString(),
      },
    ],
    createdAt: new Date().toISOString(),
  };
}

function createWallet(user, workspace) {
  return {
    id: crypto.randomUUID(),
    userId: user.id,
    workspaceId: workspace.id,
    currency: "CNY",
    balance: 0,
    frozenBalance: 0,
    createdAt: new Date().toISOString(),
  };
}

function fallbackGenerationModel(mode = "image") {
  if (mode === "video") {
    return {
      id: "seedance-video",
      title: SEEDANCE_PROVIDER === "ark" ? "Doubao Seedance 2.0" : "Seedance 2.0",
      category: "video",
    };
  }
  if (mode === "text") {
    return {
      id: "dreamehub-free-chat",
      title: "DreameHub Text",
      category: "text",
    };
  }
  return {
    id: "default-image",
    title: "Default Image",
    category: "image",
  };
}

function safeJsonClone(value, fallback) {
  try {
    const cloned = JSON.parse(JSON.stringify(value ?? fallback));
    return cloned ?? fallback;
  } catch {
    return fallback;
  }
}

function createDefaultUserCanvasWorkflow(user) {
  const now = new Date().toISOString();
  return {
    id: "free-canvas",
    userId: user.id,
    title: "自由画布",
    subtitle: "自由添加文本、图片、视频与音频节点，通过连线决定生成上下文。",
    icon: "＋",
    accent: "cyan",
    mode: "free",
    composerKind: "free",
    modelLabel: "自由节点",
    cost: 0,
    prompt: "",
    nodes: [],
    links: [],
    batchOutputs: [],
    createdAt: now,
    updatedAt: now,
  };
}

function userCanvasWorkflows(db, user) {
  db.userWorkflows ||= [];
  return db.userWorkflows.filter((item) => item.userId === user.id);
}

function ensureUserCanvasWorkflows(db, user) {
  const workflows = userCanvasWorkflows(db, user);
  if (workflows.length) return { workflows, created: false };
  const workflow = createDefaultUserCanvasWorkflow(user);
  db.userWorkflows.push(workflow);
  return { workflows: [workflow], created: true };
}

function extensionForMimeType(mimeType = "") {
  const mime = String(mimeType).toLowerCase();
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("quicktime") || mime.includes("mov")) return "mov";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("wav")) return "wav";
  return mime.startsWith("video/") ? "mp4" : mime.startsWith("audio/") ? "mp3" : "jpg";
}

function materializeCanvasDataUrl(value, fallbackMimeType = "", salt = "") {
  const source = String(value || "");
  if (!source.startsWith("data:") || source.length < 4096) return "";
  const match = source.match(/^data:([^;,]+)?;base64,([\s\S]+)$/);
  if (!match) return "";
  const mimeType = match[1] || fallbackMimeType || "application/octet-stream";
  const base64 = match[2].replace(/\s/g, "");
  const hash = crypto
    .createHash("sha1")
    .update(salt)
    .update(base64.slice(0, 4096))
    .update(String(base64.length))
    .digest("hex")
    .slice(0, 20);
  const ext = extensionForMimeType(mimeType);
  const filename = `canvas-media-${hash}.${ext}`;
  const filePath = path.join(GENERATED_DIR, filename);
  try {
    fsNative.mkdirSync(GENERATED_DIR, { recursive: true });
    if (!fsNative.existsSync(filePath)) {
      fsNative.writeFileSync(filePath, Buffer.from(base64, "base64"));
    }
    return `/generated/${filename}`;
  } catch {
    return "";
  }
}

function compactCanvasReferenceInputs(referenceInputs, nodeId = "") {
  return (Array.isArray(referenceInputs) ? referenceInputs : []).map((input, index) => {
    if (typeof input === "string") {
      const url = materializeCanvasDataUrl(input, "", `${nodeId}-ref-${index}`);
      return url || input;
    }
    const compact = safeJsonClone(input, {});
    for (const key of ["source", "image", "videoUrl"]) {
      const url = materializeCanvasDataUrl(
        compact[key],
        compact.mimeType || "",
        `${nodeId}-ref-${index}-${key}`,
      );
      if (url) compact[key] = url;
    }
    return compact;
  });
}

function compactCanvasNodeMedia(node) {
  const compact = safeJsonClone(node, {});
  let deferred = false;
  for (const key of ["image", "source"]) {
    if (typeof compact[key] === "string" && compact[key].length > 4096) {
      const url = materializeCanvasDataUrl(
        compact[key],
        compact.mimeType || "",
        `${compact.id || ""}-${key}`,
      );
      if (url) {
        compact[key] = url;
        if (key === "source" && compact.type === "video" && !compact.videoUrl) {
          compact.videoUrl = url;
        }
        if (key === "source" && compact.type === "image" && !compact.image) {
          compact.image = url;
        }
      } else {
        delete compact[key];
        deferred = true;
      }
    }
  }
  if (Array.isArray(compact.referenceInputs) && JSON.stringify(compact.referenceInputs).length > 4096) {
    compact.referenceInputs = compactCanvasReferenceInputs(
      compact.referenceInputs,
      compact.id || "",
    );
  }
  if (deferred) compact.mediaDeferred = true;
  return compact;
}

function restoreExistingCanvasNodeMedia(nodes, existingNodes = []) {
  const existingById = new Map(
    (Array.isArray(existingNodes) ? existingNodes : []).map((node) => [node?.id, node]),
  );
  return (Array.isArray(nodes) ? nodes : []).map((node) => {
    const restored = safeJsonClone(node, {});
    const oldNode = existingById.get(restored.id);
    if (!oldNode) return restored;
    for (const key of ["image", "source", "referenceInputs"]) {
      if (restored[key] === undefined && oldNode[key] !== undefined) {
        restored[key] = oldNode[key];
      }
    }
    return restored;
  });
}

function publicCanvasWorkflow(workflow, { compactMedia = false } = {}) {
  const payload = safeJsonClone(workflow, {});
  delete payload.userId;
  if (compactMedia && Array.isArray(payload.nodes)) {
    payload.nodes = payload.nodes.map(compactCanvasNodeMedia);
  }
  return payload;
}

function publicCanvasWorkflowSummary(workflow) {
  return {
    id: workflow.id,
    summaryOnly: true,
    title: workflow.title,
    subtitle: workflow.subtitle,
    icon: workflow.icon,
    accent: workflow.accent,
    mode: workflow.mode,
    composerKind: workflow.composerKind,
    modelLabel: workflow.modelLabel,
    cost: workflow.cost,
    nodeCount: Array.isArray(workflow.nodes) ? workflow.nodes.length : 0,
    linkCount: Array.isArray(workflow.links) ? workflow.links.length : 0,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  };
}

function sanitizeCanvasWorkflowPayload(payload, user, existing = {}) {
  const source =
    payload?.workflow && typeof payload.workflow === "object"
      ? payload.workflow
      : payload || {};
  const now = new Date().toISOString();
  const title =
    String(source.title || existing.title || "未命名工作流")
      .trim()
      .slice(0, 80) || "未命名工作流";
  const existingNodes = safeJsonClone(existing.nodes, []);
  const existingLinks = safeJsonClone(existing.links, []);
  const summaryOverwrite =
    source.summaryOnly ||
    (Number(source.nodeCount) > 0 &&
      Array.isArray(source.nodes) &&
      source.nodes.length === 0 &&
      existingNodes.length > 0);
  return {
    ...existing,
    id: String(existing.id || source.id || crypto.randomUUID()).slice(0, 80),
    userId: user.id,
    title,
    subtitle: String(source.subtitle || existing.subtitle || "").slice(0, 240),
    icon: String(source.icon || existing.icon || "＋").slice(0, 8),
    accent: String(source.accent || existing.accent || "cyan").slice(0, 24),
    mode: String(source.mode || existing.mode || "free").slice(0, 48),
    composerKind: String(
      source.composerKind || existing.composerKind || "free",
    ).slice(0, 48),
    modelLabel: String(
      source.modelLabel || existing.modelLabel || "自由节点",
    ).slice(0, 80),
    cost: Number.isFinite(Number(source.cost ?? existing.cost))
      ? Number(source.cost ?? existing.cost)
      : 0,
    prompt: String(source.prompt || "").slice(0, 50000),
    nodes: !summaryOverwrite && Array.isArray(source.nodes)
      ? restoreExistingCanvasNodeMedia(
          safeJsonClone(source.nodes, []),
          existingNodes,
        )
      : existingNodes,
    links: !summaryOverwrite && Array.isArray(source.links)
      ? safeJsonClone(source.links, [])
      : existingLinks,
    batchOutputs: Array.isArray(source.batchOutputs)
      ? safeJsonClone(source.batchOutputs, [])
      : safeJsonClone(existing.batchOutputs, []),
    createdAt: existing.createdAt || source.createdAt || now,
    updatedAt: now,
  };
}

function publicWorkspace(workspace) {
  if (!workspace) return null;
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    projects: workspace.projects,
    createdAt: workspace.createdAt,
  };
}

function publicWallet(wallet) {
  if (!wallet) return null;
  return {
    id: wallet.id,
    currency: wallet.currency,
    balance: wallet.balance,
    frozenBalance: wallet.frozenBalance,
    createdAt: wallet.createdAt,
  };
}

function publicOrder(order) {
  if (!order) return null;
  return {
    id: order.id,
    orderNo: order.orderNo,
    planId: order.planId,
    planName: order.planName,
    amount: order.amount,
    currency: order.currency || "CNY",
    credits: order.credits,
    method: order.method,
    provider: order.provider,
    status: order.status,
    checkoutUrl: order.checkoutUrl || "",
    qrText: order.qrText || "",
    qrImage: order.qrImage || "",
    paidAt: order.paidAt || "",
    createdAt: order.createdAt,
  };
}

function planUnitPrice(plan) {
  const price = Number(plan?.price || 0);
  const credits = Number(plan?.credits || 0);
  if (!Number.isFinite(price) || !Number.isFinite(credits) || credits <= 0)
    return Infinity;
  return price / credits;
}

function isPlanProfitable(plan) {
  const minUnitPrice = Number.isFinite(CREDIT_MIN_CNY) ? CREDIT_MIN_CNY : 0.12;
  return planUnitPrice(plan) >= minUnitPrice;
}

function profitProtectedPlan(plan) {
  const minUnitPrice = Number.isFinite(CREDIT_MIN_CNY) ? CREDIT_MIN_CNY : 0.12;
  const credits = Number(plan?.credits || 0);
  if (!Number.isFinite(credits) || credits <= 0) return plan;
  const minimumPrice = Math.ceil(credits * minUnitPrice);
  if (Number(plan.price || 0) >= minimumPrice) return plan;
  return {
    ...plan,
    originalPrice: plan.price,
    price: minimumPrice,
    profitProtected: true,
  };
}

function publicPlan(plan) {
  const protectedPlan = profitProtectedPlan(plan);
  return {
    ...protectedPlan,
    unitPrice: Number(planUnitPrice(protectedPlan).toFixed(4)),
  };
}

function billablePlans(db) {
  return (db.plans || []).map(profitProtectedPlan).filter(isPlanProfitable);
}

function maskApiKey(secret) {
  return `${secret.slice(0, 10)}...${secret.slice(-4)}`;
}

function hashSecret(secret) {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

function apiKeyEncryptionKey() {
  return crypto
    .createHash("sha256")
    .update(API_KEY_ENCRYPTION_SECRET)
    .digest();
}

function encryptApiKeySecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", apiKeyEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(String(secret), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

function decryptApiKeySecret(value) {
  if (!value) return "";
  try {
    const [version, ivRaw, tagRaw, encryptedRaw] = String(value).split(".");
    if (version !== "v1" || !ivRaw || !tagRaw || !encryptedRaw) return "";
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      apiKeyEncryptionKey(),
      Buffer.from(ivRaw, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "";
  }
}

function publicApiKey(apiKey, { includeSecret = false } = {}) {
  ensureApiKeyQuotaShape(apiKey);
  const secret = includeSecret ? decryptApiKeySecret(apiKey.encryptedKey) : "";
  return {
    id: apiKey.id,
    workspaceId: apiKey.workspaceId,
    name: apiKey.name,
    maskedKey: apiKey.maskedKey,
    permissions: apiKey.permissions,
    quota: apiKey.quota,
    used: apiKey.used,
    freeQuota: apiKey.freeQuota,
    usage: apiKey.usage,
    ipWhitelist: apiKey.ipWhitelist,
    status: apiKey.status,
    createdAt: apiKey.createdAt,
    lastUsedAt: apiKey.lastUsedAt,
    canReveal: Boolean(secret),
    ...(secret ? { secret } : {}),
  };
}

function parseIpWhitelist(value) {
  if (Array.isArray(value))
    return value
      .map(String)
      .map((item) => item.trim())
      .filter(Boolean);
  return String(value || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePermissions(value) {
  const allowed = new Set([
    "images:create",
    "chat:create",
    "videos:create",
    "models:read",
    "workflows:run",
    "billing:read",
  ]);
  const permissions = Array.isArray(value) ? value : [value].filter(Boolean);
  const clean = permissions.filter((item) => allowed.has(item));
  return clean.length ? clean : ["images:create", "models:read"];
}

function ensureApiKeyQuotaShape(apiKey) {
  apiKey.freeQuota ||= {};
  apiKey.usage ||= {};
  for (const [endpoint, quota] of Object.entries(DEFAULT_FREE_QUOTAS)) {
    if (!Number.isFinite(Number(apiKey.freeQuota[endpoint])))
      apiKey.freeQuota[endpoint] = quota;
    if (!Number.isFinite(Number(apiKey.usage[endpoint])))
      apiKey.usage[endpoint] = 0;
  }
  apiKey.quota ||= Object.values(apiKey.freeQuota).reduce(
    (sum, item) => sum + Number(item || 0),
    0,
  );
  apiKey.used ||= Object.values(apiKey.usage).reduce(
    (sum, item) => sum + Number(item || 0),
    0,
  );
}

function parseFreeQuotas(value) {
  const quotas = { ...DEFAULT_FREE_QUOTAS };
  const incoming = value && typeof value === "object" ? value : {};
  for (const endpoint of Object.keys(quotas)) {
    if (incoming[endpoint] !== undefined) {
      quotas[endpoint] = Math.max(0, Number(incoming[endpoint] || 0));
    }
  }
  return quotas;
}

function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  const raw = forwarded || req.socket.remoteAddress || "";
  return raw.replace(/^::ffff:/, "");
}

function ipv4ToInt(ip) {
  const parts = ip.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  return parts.reduce((acc, part) => (acc << 8) + part, 0) >>> 0;
}

function ipMatchesRule(ip, rule) {
  if (!rule) return false;
  if (rule === ip) return true;
  if (
    (ip === "::1" || ip === "127.0.0.1") &&
    (rule === "localhost" || rule === "127.0.0.1" || rule === "::1")
  ) {
    return true;
  }
  if (!rule.includes("/")) return false;

  const [rangeIp, bitsRaw] = rule.split("/");
  const bits = Number(bitsRaw);
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(rangeIp);
  if (
    ipInt === null ||
    rangeInt === null ||
    !Number.isInteger(bits) ||
    bits < 0 ||
    bits > 32
  ) {
    return false;
  }

  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

function isIpAllowed(ip, whitelist) {
  if (!whitelist?.length) return true;
  return whitelist.some((rule) => ipMatchesRule(ip, rule));
}

function requirePlatformApiKey(req, res, db, permission, endpoint) {
  const token = getToken(req);
  if (!token) {
    sendError(res, 401, "缺少平台 API Key");
    return null;
  }

  const keyHash = hashSecret(token);
  const apiKey = db.apiKeys.find((item) => item.keyHash === keyHash);
  if (!apiKey || apiKey.status !== "active") {
    sendError(res, 401, "API Key 无效或已禁用");
    return null;
  }
  ensureApiKeyQuotaShape(apiKey);

  if (!apiKey.permissions.includes(permission)) {
    sendError(res, 403, "API Key 权限不足");
    return null;
  }

  if (endpoint && apiKey.usage[endpoint] >= apiKey.freeQuota[endpoint]) {
    sendError(res, 429, `${endpoint} 免费额度已用尽`);
    return null;
  }

  const clientIp = getClientIp(req);
  if (!isIpAllowed(clientIp, apiKey.ipWhitelist)) {
    sendError(res, 403, `当前 IP 不在白名单内：${clientIp}`);
    return null;
  }

  return apiKey;
}

function consumeApiQuota(apiKey, endpoint, amount = 1) {
  ensureApiKeyQuotaShape(apiKey);
  apiKey.usage[endpoint] += amount;
  apiKey.used = Object.values(apiKey.usage).reduce(
    (sum, item) => sum + Number(item || 0),
    0,
  );
  apiKey.lastUsedAt = new Date().toISOString();
}

function quotaSummary(apiKey) {
  ensureApiKeyQuotaShape(apiKey);
  const endpoints = {};
  for (const endpoint of Object.keys(apiKey.freeQuota)) {
    endpoints[endpoint] = {
      limit: apiKey.freeQuota[endpoint],
      used: apiKey.usage[endpoint] || 0,
      remaining: Math.max(
        0,
        apiKey.freeQuota[endpoint] - (apiKey.usage[endpoint] || 0),
      ),
    };
  }
  return {
    limit: apiKey.quota,
    used: apiKey.used,
    remaining: Math.max(0, apiKey.quota - apiKey.used),
    endpoints,
  };
}

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function profitableCreditsFromCost(upstreamCostCny, minimumCredits = 1) {
  const unitPrice = Number.isFinite(CREDIT_MIN_CNY) ? CREDIT_MIN_CNY : 0.12;
  const margin = Number.isFinite(CREDIT_MARGIN_RATE) ? CREDIT_MARGIN_RATE : 0.35;
  const protectedMargin = Math.min(0.85, Math.max(0, margin));
  const cost = Math.max(0, Number(upstreamCostCny || 0));
  const credits = Math.ceil(cost / Math.max(0.01, unitPrice * (1 - protectedMargin)));
  return Math.max(minimumCredits, credits);
}

function generationBillingQuote(body, imageModel = null) {
  const mode = String(body?.mode || "image");
  const count = Math.max(1, Math.min(4, Number(body?.count || 1)));
  if (mode === "video") {
    const duration = normalizeSeedanceDuration(body?.duration);
    const resolution = normalizeSeedanceResolution(body?.resolution);
    const resolutionMultiplier =
      resolution === "1080p" ? 2 : resolution === "480p" ? 0.7 : 1;
    const audioMultiplier = body?.generateAudio ? 1.15 : 1;
    const baseCost = envNumber("UPSTREAM_COST_SEEDANCE_720P_5S_CNY", 5.6);
    const upstreamCost =
      baseCost * (duration / 5) * resolutionMultiplier * audioMultiplier * count;
    return {
      credits: profitableCreditsFromCost(upstreamCost, 85),
      upstreamCostCny: Number(upstreamCost.toFixed(2)),
      basis: {
        mode,
        count,
        duration,
        resolution,
        generateAudio: Boolean(body?.generateAudio),
      },
    };
  }
  if (mode === "video-face-restore") {
    const upstreamCost = envNumber("UPSTREAM_COST_FACE_RESTORE_CNY", 0.6);
    return {
      credits: profitableCreditsFromCost(upstreamCost, 8),
      upstreamCostCny: upstreamCost,
      basis: { mode },
    };
  }
  if (mode === "video-face-swap") {
    const upstreamCost = envNumber("UPSTREAM_COST_FACE_SWAP_CNY", 0.8);
    return {
      credits: profitableCreditsFromCost(upstreamCost, 10),
      upstreamCostCny: upstreamCost,
      basis: { mode },
    };
  }
  if (mode === "train") {
    const upstreamCost = envNumber("UPSTREAM_COST_TRAIN_CNY", 3);
    return {
      credits: profitableCreditsFromCost(upstreamCost, 30),
      upstreamCostCny: upstreamCost,
      basis: { mode },
    };
  }
  if (mode === "text") {
    const upstreamCost = 0;
    return {
      credits: profitableCreditsFromCost(upstreamCost, upstreamCost > 0 ? 6 : 1),
      upstreamCostCny: upstreamCost,
      basis: { mode, model: body?.model || "" },
    };
  }

  const provider = imageModel?.provider || "image";
  const quality = String(body?.quality || "medium");
  const upstreamCost =
    provider === "openai"
      ? quality === "high"
        ? envNumber("UPSTREAM_COST_OPENAI_IMAGE_HIGH_CNY", 0.9)
        : quality === "low"
          ? envNumber("UPSTREAM_COST_OPENAI_IMAGE_LOW_CNY", 0.25)
          : envNumber("UPSTREAM_COST_OPENAI_IMAGE_MEDIUM_CNY", 0.45)
      : envNumber("UPSTREAM_COST_FREE_IMAGE_CNY", 0.08);
  return {
    credits: profitableCreditsFromCost(upstreamCost, provider === "openai" ? 14 : 4),
    upstreamCostCny: upstreamCost,
    basis: {
      mode,
      provider,
      model: imageModel?.id || body?.imageModel || "",
      quality,
      size: body?.size || "auto",
    },
  };
}

function getToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function currentUser(req, db) {
  const token = getToken(req);
  const session = db.sessions.find((item) => item.token === token);
  if (!session) return null;
  if (isSessionExpired(session)) return null;
  return db.users.find((user) => user.id === session.userId) || null;
}

function requireUser(req, res, db) {
  const user = currentUser(req, db);
  if (!user) {
    sendError(res, 401, "请先登录");
    return null;
  }
  return user;
}

const COMMERCIAL_VIDEO_MODES = [
  "quick_prompt",
  "single_shot",
  "product_demo",
  "commercial_campaign",
  "multi_platform_campaign",
];

const COMMERCIAL_VIDEO_STAGES = [
  "scope_mode",
  "brand_guidelines",
  "marketing_brief",
  "script",
  "shot_list",
  "storyboard",
  "generation_mode",
  "review",
  "export",
];

let cachedCommercialSkillSpec = null;

async function commercialSkillSpec() {
  if (cachedCommercialSkillSpec) return cachedCommercialSkillSpec;
  try {
    const content = await fs.readFile(COMMERCIAL_VIDEO_SKILL_FILE, "utf8");
    cachedCommercialSkillSpec = {
      available: true,
      path: COMMERCIAL_VIDEO_SKILL_FILE,
      title: "商业产品视频工作流",
      modes: COMMERCIAL_VIDEO_MODES,
      stages: COMMERCIAL_VIDEO_STAGES,
      excerpt: content.slice(0, 1800),
    };
  } catch (error) {
    cachedCommercialSkillSpec = {
      available: false,
      path: COMMERCIAL_VIDEO_SKILL_FILE,
      title: "商业产品视频工作流",
      modes: COMMERCIAL_VIDEO_MODES,
      stages: COMMERCIAL_VIDEO_STAGES,
      error: error.message,
    };
  }
  return cachedCommercialSkillSpec;
}

function emptyCommercialArtifacts() {
  return {
    brandGuidelines: {
      brandName: "",
      tone: "",
      colors: { primary: [] },
      mustKeep: [],
    },
    marketingBrief: {
      productName: "",
      productCategory: "",
      targetAudience: "",
      coreBenefit: "",
      ctaCopy: "",
    },
    script: [],
    shotList: [],
    storyboardPrompts: [],
    generationModes: [],
    reviewChecklist: [],
    referenceRoles: [],
    qualityGate: {
      status: "pending",
      issues: [],
    },
    modelOutputs: [],
  };
}

function createCommercialVideoChat(user) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    userId: user.id,
    mode: "",
    stage: "scope_mode",
    messages: [
      {
        role: "assistant",
        content:
          "请告诉我工作流模式、品牌、产品、目标受众、核心卖点和行动号召。可以自然描述，也可以使用标签：品牌：、产品：、受众：、卖点：、CTA：。",
        createdAt: now,
      },
    ],
    artifacts: emptyCommercialArtifacts(),
    createdAt: now,
    updatedAt: now,
  };
}

function latestCommercialVideoChat(db, user) {
  return db.commercialVideoChats
    .filter((item) => item.userId === user.id)
    .sort(
      (a, b) =>
        new Date(b.updatedAt || b.createdAt || 0).getTime() -
        new Date(a.updatedAt || a.createdAt || 0).getTime(),
    )[0];
}

function commercialVideoChatsForUser(db, user) {
  return db.commercialVideoChats
    .filter((item) => item.userId === user.id)
    .sort(
      (a, b) =>
        new Date(b.updatedAt || b.createdAt || 0).getTime() -
        new Date(a.updatedAt || a.createdAt || 0).getTime(),
    );
}

function findCommercialVideoChat(db, user, chatId) {
  if (!chatId) return null;
  return db.commercialVideoChats.find(
    (item) => item.userId === user.id && item.id === chatId,
  );
}

function commercialChatTitle(chat) {
  const artifacts = chat.artifacts || emptyCommercialArtifacts();
  const brief = artifacts.marketingBrief || {};
  const brand = artifacts.brandGuidelines || {};
  const product = brief.productName || "";
  const brandName = brand.brandName || "";
  if (brandName && product) return `${brandName} · ${product}`;
  if (product) return product;
  const userMessage = (chat.messages || []).find((item) => item.role === "user");
  if (userMessage?.content) return String(userMessage.content).slice(0, 28);
  return "新的商业视频工作流";
}

function publicCommercialVideoChatSummary(chat) {
  const artifacts = chat.artifacts || emptyCommercialArtifacts();
  const issueCount = Array.isArray(artifacts.qualityGate?.issues)
    ? artifacts.qualityGate.issues.length
    : 0;
  return {
    id: chat.id,
    title: commercialChatTitle(chat),
    mode: chat.mode || "",
    stage: chat.stage || "",
    qualityStatus: artifacts.qualityGate?.status || "pending",
    issueCount,
    messageCount: Array.isArray(chat.messages) ? chat.messages.length : 0,
    updatedAt: chat.updatedAt || chat.createdAt,
    createdAt: chat.createdAt,
  };
}

function inferCommercialMode(text) {
  const lower = String(text || "").toLowerCase();
  if (/prompt|negative prompt|提示词|负面提示词/.test(lower)) return "quick_prompt";
  if (/one shot|single shot|单镜头|一镜到底/.test(lower)) return "single_shot";
  if (/platform|tiktok|youtube|instagram|reels|locali[sz]e|多平台|小红书|抖音|视频号/.test(lower))
    return "multi_platform_campaign";
  if (/campaign|commercial|brand launch|paid ad|广告|商业片|投放|品牌/.test(lower))
    return "commercial_campaign";
  if (/demo|mechanism|appliance|product|feature|演示|产品|功能|卖点/.test(lower))
    return "product_demo";
  return "";
}

function splitListText(value) {
  return String(value || "")
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function extractCommercialLabel(message, labels) {
  const source = String(message || "");
  const allLabels = [
    "brand",
    "品牌",
    "product",
    "产品",
    "category",
    "品类",
    "audience",
    "受众",
    "target",
    "目标",
    "benefit",
    "卖点",
    "核心卖点",
    "cta",
    "行动号召",
    "colors?",
    "颜色",
    "色彩",
  ];
  const wanted = labels.join("|");
  const boundary = allLabels.join("|");
  const pattern = new RegExp(
    `(?:^|\\s)(?:${wanted})\\s*[:：]\\s*([\\s\\S]*?)(?=\\s+(?:${boundary})\\s*[:：]|\\n|$)`,
    "i",
  );
  const match = source.match(pattern);
  return match ? match[1].trim() : "";
}

function updateCommercialArtifacts(chat, text) {
  const message = String(text || "").trim();
  const artifacts = chat.artifacts || emptyCommercialArtifacts();
  const brief = artifacts.marketingBrief || {};
  const brand = artifacts.brandGuidelines || {};

  const mode = inferCommercialMode(message);
  if (mode) chat.mode = mode;

  const pairs = [
    ["productName", ["product", "产品"]],
    ["productCategory", ["category", "品类"]],
    ["targetAudience", ["audience", "target", "受众", "目标"]],
    ["coreBenefit", ["benefit", "卖点", "核心卖点"]],
    ["ctaCopy", ["cta", "行动号召"]],
  ];
  for (const [key, labels] of pairs) {
    const value = extractCommercialLabel(message, labels);
    if (value) brief[key] = value.slice(0, 240);
  }

  const brandValue = extractCommercialLabel(message, ["brand", "品牌"]);
  if (brandValue) brand.brandName = brandValue.slice(0, 120);

  const colorValue = extractCommercialLabel(message, ["colors?", "颜色", "色彩"]);
  if (colorValue) {
    brand.colors ||= {};
    brand.colors.primary = splitListText(colorValue);
  }

  if (!brief.productName && message.length < 120) brief.productName = message;
  brief.updatedAt = new Date().toISOString();
  brand.updatedAt = new Date().toISOString();
  artifacts.marketingBrief = brief;
  artifacts.brandGuidelines = brand;
  chat.artifacts = artifacts;
}

function commercialMissingFields(chat) {
  const artifacts = chat.artifacts || emptyCommercialArtifacts();
  const brief = artifacts.marketingBrief || {};
  const brand = artifacts.brandGuidelines || {};
  const missing = [];
  if (!chat.mode) missing.push("工作流模式");
  if (!brand.brandName) missing.push("品牌名称");
  if (!brief.productName) missing.push("产品名称");
  if (!brief.targetAudience) missing.push("目标受众");
  if (!brief.coreBenefit) missing.push("核心卖点");
  if (!brief.ctaCopy) missing.push("行动号召");
  return missing;
}

function nextCommercialStage(chat) {
  const missing = commercialMissingFields(chat);
  if (missing.includes("工作流模式")) return "scope_mode";
  if (missing.includes("品牌名称")) return "brand_guidelines";
  if (
    missing.includes("产品名称") ||
    missing.includes("目标受众") ||
    missing.includes("核心卖点") ||
    missing.includes("行动号召")
  )
    return "marketing_brief";
  const artifacts = chat.artifacts || emptyCommercialArtifacts();
  if (!artifacts.script?.length) return "script";
  if (!artifacts.shotList?.length) return "shot_list";
  if (!artifacts.storyboardPrompts?.length) return "storyboard";
  if (!artifacts.generationModes?.length) return "generation_mode";
  return "review";
}

const COMMERCIAL_WORKFLOW_STAGE_CHANNELS = new Set([
  "marketing_brief",
  "script",
  "shot_list",
  "storyboard",
  "generation_mode",
]);

function normalizeCommercialWorkflowStage(value) {
  const stage = String(value || "").trim();
  return COMMERCIAL_WORKFLOW_STAGE_CHANNELS.has(stage) ? stage : "";
}

function commercialWorkflowChannelMessage({ stage, instruction, message, attachments }) {
  const parts = [];
  if (stage || instruction) {
    parts.push(
      [
        stage ? `当前选项通道：${stage}` : "当前选项通道：已选择",
        instruction ? `选项指引：${instruction}` : "",
        "必须按当前通道执行本轮任务。用户输入是该通道下的补充要求，不能替代或绕过当前通道。",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  if (message) parts.push(`用户补充要求：\n${message}`);
  if (!parts.length && attachments?.length) {
    parts.push("请参考上传图片，继续推进商业视频工作流。");
  }
  return parts.join("\n\n").trim();
}

function ensureCommercialDraftArtifacts(chat) {
  const artifacts = chat.artifacts || emptyCommercialArtifacts();
  const brief = artifacts.marketingBrief || {};
  const product = brief.productName || "产品";
  const benefit = brief.coreBenefit || "核心卖点";
  const audience = brief.targetAudience || "目标受众";
  const cta = brief.ctaCopy || "了解更多";

  if (!artifacts.script.length && brief.productName && brief.coreBenefit) {
    artifacts.script = [
      {
        id: "scene-hook",
        title: "开场钩子",
        text: `开场直接呈现 ${product} 为 ${audience} 解决一个明确痛点。`,
        durationEstimate: 4,
        hookScene: true,
      },
      {
        id: "scene-demo",
        title: "产品演示",
        text: `展示产品核心卖点：${benefit}。保持产品外观和品牌识别稳定。`,
        durationEstimate: 8,
      },
      {
        id: "scene-cta",
        title: "行动号召",
        text: `结尾明确呈现：${cta}。`,
        durationEstimate: 3,
        ctaScene: true,
      },
    ];
  }

  if (!artifacts.shotList.length && artifacts.script.length) {
    artifacts.shotList = [
      {
        id: "shot-01",
        sceneId: "scene-hook",
        summary: "产品清晰露出的主视觉开场",
        camera: "缓慢推进",
        visualIntent: `让 ${audience} 立刻理解问题和使用场景。`,
      },
      {
        id: "shot-02",
        sceneId: "scene-demo",
        summary: "稳定呈现产品身份的功能演示",
        camera: "受控产品特写",
        visualIntent: benefit,
      },
      {
        id: "shot-03",
        sceneId: "scene-cta",
        summary: "干净明确的品牌收尾画面",
        camera: "固定机位产品定帧",
        visualIntent: cta,
      },
    ];
  }

  if (!artifacts.storyboardPrompts.length && artifacts.shotList.length) {
    artifacts.storyboardPrompts = artifacts.shotList.map((shot, index) => ({
      id: `storyboard-${index + 1}`,
      shotId: shot.id,
      prompt: `${shot.summary}。产品：${product}。受众：${audience}。商业广告级灯光，产品轮廓清晰，品牌标识不变形，主体身份不漂移。`,
      timing: index === 1 ? "mid" : "start",
    }));
  }

  if (!artifacts.generationModes.length && artifacts.storyboardPrompts.length) {
    artifacts.generationModes = artifacts.storyboardPrompts.map((item) => ({
      storyboardId: item.id,
      recommended: item.shotId === "shot-02" ? "first_last" : "i2v",
      reason:
        item.shotId === "shot-02"
          ? "功能演示适合用首尾帧控制起点和终点，保证动作结果明确。"
          : "图生视频更容易保持产品外观一致。",
      requiresUserConfirmation: true,
    }));
  }

  if (!artifacts.reviewChecklist.length && artifacts.generationModes.length) {
    artifacts.reviewChecklist = [
      "产品外观和品牌识别在所有镜头中保持稳定。",
      "行动号召清晰可见，并且与营销简报一致。",
      "没有在用户明确确认前提交任何付费生成。",
      "发布前根据不同平台适配比例、节奏和字幕。",
    ];
  }

  chat.artifacts = artifacts;
}

function commercialReferenceUsageText(artifacts) {
  const references = Array.isArray(artifacts.referenceAssets)
    ? artifacts.referenceAssets.filter((item) => item?.type === "image")
    : [];
  if (!references.length) {
    return [
      "参考素材：当前未上传可用参考图；若产品结构要求严格，优先补充产品正面/侧面/安装场景参考图。",
    ];
  }
  return references.slice(0, 6).map((item, index) => {
    const role =
      index === 0
        ? "产品外观、结构比例、材质、出风口/面板位置"
        : index === 1
          ? "安装场景、空间布局、黑金视觉氛围"
          : "补充的构图、材质或品牌视觉参考";
    return `参考图${index + 1}《${item.name || "未命名图片"}》仅用于${role}；不得把参考图当成全风格迁移，不得改变产品结构。`;
  });
}

function commercialReferenceRoles(artifacts) {
  const references = Array.isArray(artifacts.referenceAssets)
    ? artifacts.referenceAssets.filter((item) => item?.type === "image")
    : [];
  return references.slice(0, 12).map((item, index) => {
    const role =
      index === 0
        ? "product_shape"
        : index === 1
          ? "scene_layout"
          : "brand_look";
    const notes =
      role === "product_shape"
        ? "控制产品外观、比例、材质、面板和出风口位置；不得改变产品结构。"
        : role === "scene_layout"
          ? "控制安装空间、背景布局、光影和黑金视觉氛围；不得覆盖产品结构。"
          : "作为补充品牌视觉参考；不得作为全量风格迁移。";
    return {
      id: item.id || `reference-${index + 1}`,
      assetId: item.id || "",
      name: item.name || `参考图 ${index + 1}`,
      source: item.source || item.url || "",
      role,
      strength: index === 0 ? "high" : "medium",
      notes,
    };
  });
}

function commercialIsAirConditioner(brief) {
  const text = [
    brief.productName,
    brief.productCategory,
    brief.coreBenefit,
  ]
    .filter(Boolean)
    .join(" ");
  return /空调|天花机|风管机|中央空调|新风|出风|送风|制冷|制热|air\s*conditioner/i.test(text);
}

function commercialWorkflowModeForState(chat, message = "") {
  const artifacts = chat.artifacts || emptyCommercialArtifacts();
  const brief = artifacts.marketingBrief || {};
  const brand = artifacts.brandGuidelines || {};
  const source = [
    message,
    brand.brandName,
    brief.productName,
    brief.productCategory,
    brief.coreBenefit,
    brief.ctaCopy,
  ]
    .filter(Boolean)
    .join(" ");
  if (/多平台|多尺寸|竖版|横版|小红书|抖音|TikTok|Reels|YouTube|locali[sz]ation|本地化/i.test(source)) {
    return "multi_platform_campaign";
  }
  if (brand.brandName || brief.ctaCopy || /广告|商业|营销|campaign|立即购买|购买|CTA/i.test(source)) {
    return "commercial_campaign";
  }
  if (commercialIsAirConditioner(brief) || /产品演示|功能演示|机械|家电|appliance|demo/i.test(source)) {
    return "product_demo";
  }
  return chat.mode || inferCommercialMode(source) || "commercial_campaign";
}

function commercialProductPreservationBlock(brief) {
  const product = brief.productName || "产品";
  const lines = [
    "产品保护约束：",
    `${product} 的主体外形、面板、边缘、比例、材质、安装方式和可见结构必须与参考图一致。`,
    "只有明确指定的出风/气流/功能表现可以变化；产品本体不得变形、拉伸、融化、倾斜、重设计或改变轮廓。",
    "不得新增孔洞、按钮、屏幕、灯带、把手、机械臂、额外出风口、额外缝隙或不存在的内部结构。",
  ];
  if (commercialIsAirConditioner(brief)) {
    lines.push(
      "空调/天花机专项约束：气流只能从产品参考图中可见的出风口区域产生，不得从侧面、顶部、墙面或不存在的开口出风；不得打开其他结构；不得暴露参考图中不可见的内部零件。",
    );
  }
  return lines.join("\n");
}

function commercialBrandConstraintBlock(brand) {
  const colors = brand?.colors?.primary || [];
  const colorText = colors.length ? colors.join("、") : "品牌已确认色彩";
  return [
    "品牌约束：",
    `整体视觉使用 ${colorText} 的高级商业广告质感。`,
    "不要让视频模型直接生成品牌 logo、价格、CTA 或大段文字；logo、卖点文案和购买按钮应预留安全区域，后期用 overlay 添加。",
    "不得出现竞品标识、错误品牌字样、乱码文字、扭曲 logo 或不符合品牌调性的杂乱背景。",
  ].join("\n");
}

function commercialNegativePrompt(brief) {
  const negatives = [
    "no product deformation",
    "no changed silhouette",
    "no extra openings",
    "no wrong vent position",
    "no changed display panel",
    "no warped body",
    "no tilted top surface",
    "no floating parts",
    "no duplicated product",
    "no incorrect mechanical structure",
    "no unwanted camera angle change",
    "no additional buttons",
    "no extra screens",
    "no added handles",
    "no redesigned body",
    "no melted or stretched edges",
    "no fake logo",
    "no unreadable text",
    "no competitor logos",
    "no unapproved colors as brand color",
    "no cluttered background",
  ];
  if (commercialIsAirConditioner(brief)) {
    negatives.push(
      "no random side airflow",
      "no airflow from wrong outlet",
      "no exposed internal air-conditioner parts",
      "no extra vents",
    );
  }
  return `负面提示词：${[...new Set(negatives)].join(", ")}`;
}

function commercialShotQualityIssues(shot) {
  const text = [shot.summary, shot.visualIntent, shot.action, shot.motion]
    .filter(Boolean)
    .join(" ");
  const issues = [];
  if (!shot.duration) issues.push("missing_duration");
  if (!shot.aspectRatio) issues.push("missing_aspect_ratio");
  if (!shot.camera) issues.push("missing_camera");
  if (!shot.referenceUsage) issues.push("missing_reference_usage");
  if (!shot.productPreservation) issues.push("missing_product_preservation");
  if (!shot.negativePrompt) issues.push("missing_negative_prompt");
  if (/展示|突出|体现|呈现/.test(text) && text.length < 80) {
    issues.push("vague_visual_description");
  }
  return issues;
}

function commercialNormalizeShotList(chat) {
  const artifacts = chat.artifacts || emptyCommercialArtifacts();
  const brief = artifacts.marketingBrief || {};
  const product = brief.productName || "产品";
  const benefit = brief.coreBenefit || "核心卖点";
  const references = commercialReferenceUsageText(artifacts).join("\n");
  const shots = Array.isArray(artifacts.shotList) ? artifacts.shotList : [];
  if (!shots.length) return [];
  artifacts.shotList = shots.map((shot, index) => {
    const shotId = shot.id || `shot-${String(index + 1).padStart(2, "0")}`;
    const isFirst = index === 0;
    const isLast = index === shots.length - 1;
    const isMiddle = !isFirst && !isLast;
    const subject = shot.subject || product;
    const scene =
      shot.scene ||
      (isFirst
        ? "现代室内安装场景，产品居中清晰可见"
        : isMiddle
          ? "产品功能特写，突出出风口/功能区域和空间气流"
          : "真实使用空间与干净收尾画面，预留 CTA overlay 区域");
    const action =
      shot.action ||
      (isFirst
        ? "镜头从稳定全景缓慢推近，展示完整外观、安装方式和产品比例"
        : isMiddle
          ? `只用可视化气流或功能效果表现 ${benefit}，产品结构保持不变`
          : "空间内形成舒适空气覆盖感，产品保持稳定，画面转入购买引导收尾");
    const movingParts =
      shot.movingParts ||
      (commercialIsAirConditioner(brief)
        ? ["仅允许可视化气流从参考图中可见出风口区域产生"]
        : ["仅允许提示词明确指定的功能表现发生变化"]);
    const normalized = {
      ...shot,
      id: shotId,
      sceneId: shot.sceneId || (isFirst ? "scene-hook" : isLast ? "scene-cta" : "scene-demo"),
      duration: Number(shot.duration || shot.durationEstimate || 5),
      aspectRatio: shot.aspectRatio || "16:9",
      subject,
      scene,
      action,
      camera: shot.camera || (isFirst ? "缓慢推近" : isMiddle ? "受控产品特写" : "固定中景收尾"),
      lighting: shot.lighting || "柔和商业广告布光，产品边缘清晰，黑金高级质感",
      style: shot.style || "真实产品广告，干净背景，克制科技感，不生成文字",
      motion: shot.motion || commercialShotTimeline({ ...shot, action }, index, shots.length),
      staticParts:
        shot.staticParts || [
          "主机外形",
          "面板",
          "边缘轮廓",
          "安装位置",
          "材质比例",
          "出风口位置",
        ],
      movingParts,
      finalMechanicalState:
        shot.finalMechanicalState ||
        (isMiddle
          ? "功能效果达到稳定状态，产品外形、面板和出风口位置不变"
          : "产品保持参考图一致的稳定最终画面"),
      referenceUsage: shot.referenceUsage || references,
      productPreservation: shot.productPreservation || commercialProductPreservationBlock(brief),
      negativePrompt: shot.negativePrompt || commercialNegativePrompt(brief),
      validationIssues: [],
    };
    normalized.validationIssues = commercialShotQualityIssues(normalized);
    return normalized;
  });
  chat.artifacts = artifacts;
  return artifacts.shotList;
}

function commercialShotTimeline(shot, index, total) {
  const shotId = shot.id || `shot-${String(index + 1).padStart(2, "0")}`;
  const summary = shot.summary || "产品镜头";
  const camera = shot.camera || "稳定商业广告镜头";
  const intent = shot.visualIntent || summary;
  if (index === 0) {
    return [
      `0-1s：${summary}。产品居中，画面稳定，先让观众看清完整外观、安装位置和主体比例。`,
      `1-4s：${camera}，镜头缓慢推进或轻微环绕，突出 ${intent}。产品结构保持完全不变。`,
      "4-5s：镜头短暂停留，预留后期品牌 logo 或产品名 overlay 安全区域，视频模型不要生成文字。",
    ].join("\n");
  }
  if (index === total - 1) {
    return [
      `0-2s：进入真实使用场景，中景展示产品与空间关系，画面干净、稳定。`,
      `2-4s：${camera}，表现 ${intent}，让核心利益点自然落到用户生活场景中。`,
      "4-5s：形成清爽收尾画面，右下或下方预留 CTA overlay 区域；视频模型不要生成购买文字、价格或按钮。",
    ].join("\n");
  }
  return [
    `0-1s：产品特写或功能区域入画，保持参考图中的结构和比例。`,
    `1-4s：${camera}，用可视化但克制的方式展示 ${intent}；若表现气流，只从指定出风口均匀扩散。`,
    "4-5s：功能效果达到最终状态并保持，产品外形、面板和出风口位置不发生变化。",
  ].join("\n");
}

function commercialBuildFinalVideoPrompt({ chat, shot, index, total }) {
  const artifacts = chat.artifacts || emptyCommercialArtifacts();
  const brief = artifacts.marketingBrief || {};
  const brand = artifacts.brandGuidelines || {};
  const product = brief.productName || "产品";
  const shotId = shot.id || `shot-${String(index + 1).padStart(2, "0")}`;
  const existingPrompt =
    (artifacts.storyboardPrompts || []).find((item) => item.shotId === shotId)
      ?.prompt || "";
  const referenceUsage = commercialReferenceUsageText(artifacts).join("\n");
  return [
    `${shotId} 最终视频生成提示词（5秒，中文，商业产品广告，建议 i2v/first_last 时使用已审核参考帧）：`,
    "",
    `产品：${product}`,
    `目标受众：${brief.targetAudience || "目标消费者"}`,
    `核心卖点：${brief.coreBenefit || "突出产品核心优势"}`,
    `营销信息：${shot.visualIntent || shot.summary || brief.coreBenefit || ""}`,
    "",
    referenceUsage,
    "",
    commercialBrandConstraintBlock(brand),
    "",
    commercialProductPreservationBlock(brief),
    "",
    "镜头时间轴：",
    commercialShotTimeline(shot, index, total),
    "",
    existingPrompt ? `原始创意意图：${existingPrompt}` : "",
    "",
    commercialNegativePrompt(brief),
  ]
    .filter(Boolean)
    .join("\n");
}

function commercialPromptLooksFinal(prompt) {
  const text = String(prompt || "");
  return (
    /0-\d+s|0-\d+秒/.test(text) &&
    text.includes("产品保护约束") &&
    text.includes("负面提示词") &&
    text.includes("参考图")
  );
}

function ensureCommercialPromptQuality(chat) {
  const artifacts = chat.artifacts || emptyCommercialArtifacts();
  ensureCommercialDraftArtifacts(chat);
  const nextArtifacts = chat.artifacts || artifacts;
  chat.mode = commercialWorkflowModeForState(chat);
  nextArtifacts.referenceRoles = commercialReferenceRoles(nextArtifacts);
  const shots = commercialNormalizeShotList(chat);
  if (!shots.length) return;

  nextArtifacts.storyboardPrompts = shots.map((shot, index) => {
    const shotId = shot.id || `shot-${String(index + 1).padStart(2, "0")}`;
    const existing =
      (Array.isArray(nextArtifacts.storyboardPrompts)
        ? nextArtifacts.storyboardPrompts
        : []
      ).find((item) => item.shotId === shotId || item.id === `storyboard-${index + 1}`) || {};
    const finalPrompt = commercialPromptLooksFinal(existing.prompt)
      ? existing.prompt
      : commercialBuildFinalVideoPrompt({
          chat,
          shot,
          index,
          total: shots.length,
        });
    return {
      ...existing,
      id: existing.id || `storyboard-${index + 1}`,
      shotId,
      timing: existing.timing || (index === 0 ? "start" : index === shots.length - 1 ? "end" : "mid"),
      prompt: finalPrompt,
      negativePrompt: commercialNegativePrompt(nextArtifacts.marketingBrief || {}),
      qualityLocked: true,
    };
  });

  nextArtifacts.generationModes = shots.map((shot, index) => {
    const shotId = shot.id || `shot-${String(index + 1).padStart(2, "0")}`;
    const storyboardId = `storyboard-${index + 1}`;
    const existing =
      (Array.isArray(nextArtifacts.generationModes)
        ? nextArtifacts.generationModes
        : []
      ).find((item) => item.shotId === shotId || item.storyboardId === storyboardId) || {};
    const isMiddle = index > 0 && index < shots.length - 1;
    const recommended = existing.recommended || (isMiddle ? "first_last" : "i2v");
    const requiredFrames =
      recommended === "first_last"
        ? ["start", "end"]
        : recommended === "keyframe_seq"
          ? ["start", "mid", "end"]
          : recommended === "i2v"
            ? ["start"]
            : [];
    return {
      ...existing,
      shotId,
      storyboardId: existing.storyboardId || storyboardId,
      recommended,
      reason:
        existing.reason ||
        (recommended === "first_last"
          ? "该镜头包含功能/气流/状态变化，适合用首尾帧控制产品结构和最终状态。"
          : "该镜头需要保持产品外观与构图稳定，适合使用图生视频。"),
      providerCapabilityChecked: true,
      providerSupported: true,
      requiredFrames,
      approvedFramesAvailable: false,
      confirmed: Boolean(existing.confirmed),
      status: existing.confirmed ? "confirmed" : "needs_user_confirmation",
      requiresUserConfirmation: true,
    };
  });

  const qualityItems = [
    "最终视频提示词必须包含分秒时间轴。",
    "每个产品镜头必须包含产品保护约束和空调/天花机专项约束。",
    "每张参考图必须声明用途，不能作为全量风格迁移。",
    "logo、CTA、价格和大段文字使用后期 overlay，不要求视频模型直接生成。",
    "每个镜头必须包含负面提示词，防止产品变形、错误出风口、假 logo 和乱码文字。",
  ];
  const existingChecklist = Array.isArray(nextArtifacts.reviewChecklist)
    ? nextArtifacts.reviewChecklist
    : [];
  nextArtifacts.reviewChecklist = [
    ...qualityItems,
    ...existingChecklist.filter((item) => !qualityItems.includes(item)),
  ].slice(0, 24);
  const issues = [
    ...shots.flatMap((shot) =>
      (shot.validationIssues || []).map((issue) => `${shot.id}: ${issue}`),
    ),
    ...nextArtifacts.storyboardPrompts.flatMap((item) =>
      commercialPromptLooksFinal(item.prompt) ? [] : [`${item.shotId}: prompt_not_final`],
    ),
    ...nextArtifacts.generationModes.flatMap((item) =>
      item.confirmed ? [] : [`${item.shotId || item.storyboardId}: generation_mode_unconfirmed`],
    ),
  ];
  nextArtifacts.qualityGate = {
    status: issues.length ? "needs_review" : "passed",
    issues,
    checkedAt: new Date().toISOString(),
  };
  chat.artifacts = nextArtifacts;
}

function commercialAssistantText(chat, skill) {
  const missing = commercialMissingFields(chat);
  if (missing.length) {
    return `我正在按照「${skill.title}」整理工作流。还需要补充：${missing.join("、")}。你可以自然描述，也可以用“品牌：/ 产品：/ 受众：/ 卖点：/ CTA：”来填写。`;
  }
  ensureCommercialDraftArtifacts(chat);
  return [
    `已根据「${skill.title}」生成 ${chat.mode || "商业视频"} 工作流草稿。`,
    "我已整理脚本、镜头清单、分镜提示词、生成模式建议和审核清单。",
    "当前只是策划与拆解，没有提交任何付费生成；请确认生成模式后再进入上游生成。",
  ].join(" ");
}

function publicCommercialAgentRuntime() {
  return {
    provider: COMMERCIAL_AGENT_PROVIDER,
    localConfigured: Boolean(LOCAL_LLM_BASE_URL),
    localBaseUrl: LOCAL_LLM_BASE_URL,
    localModel: LOCAL_LLM_MODEL,
  };
}

function publicCommercialVideoChat(chat, skill) {
  return {
    id: chat.id,
    mode: chat.mode,
    stage: chat.stage,
    messages: chat.messages.slice(-80),
    artifacts: chat.artifacts,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    skill,
    agentRuntime: publicCommercialAgentRuntime(),
  };
}

async function normalizeCommercialAttachments(rawAttachments) {
  const sourceItems = Array.isArray(rawAttachments) ? rawAttachments : [];
  const attachments = [];
  for (const item of sourceItems.slice(0, 4)) {
    const mimeType = String(item?.mimeType || "").toLowerCase();
    if (!mimeType.startsWith("image/")) continue;
    const name = String(item?.name || item?.fileName || "参考图片").slice(0, 120);
    const source = String(item?.source || item?.dataUrl || item?.url || "");
    if (!source) continue;
    let savedSource = source;
    let size = Number(item?.size || 0);
    if (source.startsWith("data:")) {
      const dataUrl = parseDataUrl(source);
      if (!dataUrl || !dataUrl.contentType.startsWith("image/")) continue;
      if (dataUrl.buffer.length > 6 * 1024 * 1024) {
        throw new Error("单张参考图片不能超过 6MB");
      }
      savedSource = await saveGeneratedBinary(
        dataUrl.buffer,
        dataUrl.contentType,
        extensionFromMime(dataUrl.contentType),
      );
      size = dataUrl.buffer.length;
    }
    attachments.push({
      id: crypto.randomUUID(),
      type: "image",
      name,
      mimeType,
      size,
      source: savedSource,
      createdAt: new Date().toISOString(),
    });
  }
  return attachments;
}

function commercialAttachmentPromptText(attachments) {
  const items = Array.isArray(attachments) ? attachments : [];
  if (!items.length) return "";
  return items
    .map(
      (item, index) =>
        `参考图片${index + 1}：${item.name || "未命名图片"}，类型 ${item.mimeType || "image"}，地址 ${item.source || ""}`,
    )
    .join("\n");
}

function parseCommercialAgentJson(text) {
  const source = String(text || "").trim();
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced
    ? fenced[1].trim()
    : source.slice(source.indexOf("{"), source.lastIndexOf("}") + 1);
  if (!candidate || candidate === source.slice(0, 0)) {
    throw new Error("Agent did not return JSON");
  }
  return JSON.parse(candidate);
}

function mergeCommercialArtifacts(existing, patch) {
  const base = safeJsonClone(existing, emptyCommercialArtifacts());
  const incoming = patch && typeof patch === "object" ? patch : {};
  const next = {
    ...emptyCommercialArtifacts(),
    ...base,
  };
  for (const key of [
    "brandGuidelines",
    "marketingBrief",
    "script",
    "shotList",
    "storyboardPrompts",
    "generationModes",
    "reviewChecklist",
    "referenceRoles",
    "modelOutputs",
  ]) {
    if (incoming[key] === undefined || incoming[key] === null) continue;
    if (Array.isArray(next[key])) {
      next[key] = Array.isArray(incoming[key]) ? incoming[key].slice(0, 24) : next[key];
    } else if (typeof next[key] === "object" && !Array.isArray(next[key])) {
      next[key] = {
        ...next[key],
        ...(typeof incoming[key] === "object" && !Array.isArray(incoming[key])
          ? incoming[key]
          : {}),
      };
    } else {
      next[key] = incoming[key];
    }
  }
  if (incoming.qualityGate && typeof incoming.qualityGate === "object") {
    next.qualityGate = {
      ...(next.qualityGate || {}),
      ...incoming.qualityGate,
    };
  }
  return next;
}

function commercialAgentPrompt({ chat, message, skill }) {
  const history = (chat.messages || [])
    .slice(-10)
    .map((item) => {
      const attachmentText = commercialAttachmentPromptText(item.attachments);
      return `${item.role}: ${item.content}${attachmentText ? `\n${attachmentText}` : ""}`;
    })
    .join("\n");
  return [
    "/no_think",
    "你是商业产品视频工作流 Agent，不是普通聊天机器人。",
    "你必须读取并遵循下方 Skill 规范，把用户需求推进到可执行的视频生产工作流。",
    "你可以执行的 Agent 动作：选择工作流模式、判断下一阶段、追问缺失信息、维护结构化产物、生成脚本、镜头清单、分镜提示词、生成模式建议和审核清单。",
    "不要声称已经提交视频生成任务；只有用户明确确认生成模式后，才建议进入真实生成。",
    "如果用户最新输入或当前状态中已经包含品牌、产品、目标受众、核心卖点、CTA 等信息，必须写入 artifacts，并且不要重复追问这些已知信息。",
    "如果用户上传了参考图片，必须把它作为产品、人物、品牌视觉或分镜参考素材记录，并在脚本、镜头清单、分镜提示词或生成模式建议中体现；如果需要识别图片细节，可以追问用户补充说明。",
    "生成 storyboardPrompts 时，prompt 不是一句分镜摘要，而是最终可交给视频模型的中文视频提示词。必须包含：参考图用途、品牌约束、产品保护约束、分秒时间轴、镜头运动、静态部件、允许变化部件、最终状态、负面提示词。",
    "产品、家电、空调、天花机、机械结构类镜头必须写清哪些部分不变、哪些部分可动、气流/机械动作从哪里发生；不得只写“展示功能”“突出技术优势”“高级质感”这类抽象词。",
    "logo、购买信息、CTA、价格和大段文字默认后期 overlay 添加；不要要求视频模型直接生成文字或 logo，只能预留安全区域。",
    "generationModes 必须按 shotId 或 storyboardId 逐条输出，每个镜头都要有建议模式和原因；商业产品镜头优先 i2v，功能/机械变化镜头优先 first_last。",
    "missingFields 只能列出当前状态和用户最新输入中确实没有的信息；如果信息足够，就直接进入下一阶段并生成对应产物。",
    "必须全程中文。必须只返回 JSON，不要返回 Markdown，不要输出思考过程，不要输出 <think>。",
    "",
    "Skill 规范摘录：",
    skill.excerpt || "",
    "",
    "当前工作流状态 JSON：",
    JSON.stringify(
      {
        mode: chat.mode || "",
        stage: chat.stage || "scope_mode",
        artifacts: chat.artifacts || emptyCommercialArtifacts(),
      },
      null,
      2,
    ),
    "",
    "最近对话：",
    history || "无",
    "",
    `用户最新输入：${message}`,
    "",
    "返回 JSON schema：",
    JSON.stringify(
      {
        mode: "quick_prompt | single_shot | product_demo | commercial_campaign | multi_platform_campaign",
        stage: "scope_mode | brand_guidelines | marketing_brief | script | shot_list | storyboard | generation_mode | review | export",
        assistant: "给用户的中文回复，说明你作为 Agent 做了什么、下一步需要什么",
        missingFields: ["仍缺失的信息"],
        artifacts: {
          brandGuidelines: {
            brandName: "",
            tone: "",
            colors: { primary: [] },
            mustKeep: [],
          },
          marketingBrief: {
            productName: "",
            productCategory: "",
            targetAudience: "",
            coreBenefit: "",
            ctaCopy: "",
          },
          script: [
            {
              id: "scene-01",
              title: "",
              text: "",
              durationEstimate: 0,
            },
          ],
          shotList: [
            {
              id: "shot-01",
              sceneId: "scene-01",
              summary: "",
              duration: 5,
              aspectRatio: "16:9",
              subject: "",
              scene: "",
              action: "",
              camera: "",
              visualIntent: "",
              lighting: "",
              style: "",
              motion: "",
              staticParts: [],
              movingParts: [],
              finalMechanicalState: "",
              referenceUsage: "",
              productPreservation: "",
              negativePrompt: "",
              validationIssues: [],
            },
          ],
          storyboardPrompts: [
            {
              id: "storyboard-01",
              shotId: "shot-01",
              timing: "start | mid | end",
              prompt: "最终视频生成提示词，必须包含参考图用途、品牌约束、产品保护约束、分秒时间轴和负面提示词",
              negativePrompt: "",
              qualityLocked: true,
            },
          ],
          generationModes: [
            {
              storyboardId: "storyboard-01",
              shotId: "shot-01",
              recommended: "t2v | i2v | first_last | reference_video",
              reason: "",
              providerCapabilityChecked: true,
              providerSupported: true,
              requiredFrames: ["start"],
              approvedFramesAvailable: false,
              confirmed: false,
              status: "needs_user_confirmation | confirmed",
              requiresUserConfirmation: true,
            },
          ],
          referenceRoles: [
            {
              id: "reference-1",
              assetId: "",
              name: "",
              source: "",
              role: "product_shape | product_material | scene_layout | lighting | color | brand_look",
              strength: "low | medium | high",
              notes: "",
            },
          ],
          qualityGate: {
            status: "pending | needs_review | passed",
            issues: [],
          },
          reviewChecklist: [""],
        },
      },
      null,
      2,
    ),
  ].join("\n");
}

async function runCommercialVideoAgent(chat, message, skill) {
  const prompt = commercialAgentPrompt({ chat, message, skill });
  let output;
  let engine = "";
  const request = {
    temperature: 0.35,
    messages: [{ role: "user", content: prompt }],
  };
  const provider = COMMERCIAL_AGENT_PROVIDER;
  if (provider === "local") {
    output = await callLocalChatCompletion({ ...request, model: LOCAL_LLM_MODEL });
    engine = `local:${output.model}`;
  } else if (provider === "openai") {
    output = await callOpenAIChatCompletion({ ...request, model: "openai-chat" });
    engine = `openai-chat:${output.model}`;
  } else {
    try {
      if (!LOCAL_LLM_BASE_URL) throw new Error("LOCAL_LLM_BASE_URL not configured");
      output = await callLocalChatCompletion({ ...request, model: LOCAL_LLM_MODEL });
      engine = `local:${output.model}`;
    } catch (localError) {
      try {
        output = await callOpenAIChatCompletion({
          ...request,
          model: "openai-chat",
        });
        engine = `openai-chat:${output.model}`;
      } catch (openaiError) {
        output = await callPollinationsChatCompletion({
          ...request,
          model: "dreamehub-free-chat",
        });
        engine = `dreamehub-free-chat:${output.model}`;
      }
    }
  }

  const agentResult = parseCommercialAgentJson(output.content);
  const now = new Date().toISOString();
  chat.mode = String(agentResult.mode || chat.mode || inferCommercialMode(message) || "commercial_campaign");
  chat.artifacts = mergeCommercialArtifacts(chat.artifacts, agentResult.artifacts);
  updateCommercialArtifacts(chat, message);
  ensureCommercialPromptQuality(chat);
  chat.stage = nextCommercialStage(chat) || String(agentResult.stage || "marketing_brief");
  chat.artifacts.modelOutputs ||= [];
  chat.artifacts.modelOutputs.unshift({
    title: `Agent ${engine}`,
    text: output.content,
    createdAt: now,
  });
  chat.artifacts.modelOutputs = chat.artifacts.modelOutputs.slice(0, 8);
  chat.messages.push({
    role: "assistant",
    content:
      String(agentResult.assistant || "").trim() ||
      "Agent 已根据 Skill 规范更新工作流，请继续补充品牌、产品、受众、卖点或生成目标。",
    createdAt: now,
    agent: true,
    engine,
    missingFields: Array.isArray(agentResult.missingFields)
      ? agentResult.missingFields
      : [],
  });
  chat.updatedAt = now;
  return chat;
}

function normalizeImageSize(size) {
  const allowedSizes = new Set(["1024x1024", "1024x1536", "1536x1024", "auto"]);
  return allowedSizes.has(size) ? size : "1024x1024";
}

function normalizeImageQuality(quality) {
  const allowedQualities = new Set(["low", "medium", "high", "auto"]);
  return allowedQualities.has(quality) ? quality : "medium";
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function optionalBoolean(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return Boolean(value);
}

function arkSafetyIdentifier(user) {
  const source = String(user?.id || user?.email || "guest").slice(0, 128);
  return crypto.createHash("sha256").update(source).digest("hex").slice(0, 64);
}

function resolveImageModel(modelId) {
  const requested = modelId || "openai:gpt-image-2";
  return (
    IMAGE_MODEL_REGISTRY.find(
      (model) => model.id === requested || model.upstreamModel === requested,
    ) || IMAGE_MODEL_REGISTRY[0]
  );
}

function imageDimensions(size) {
  const normalized = normalizeImageSize(size);
  if (normalized === "1024x1536") return { width: 1024, height: 1536 };
  if (normalized === "1536x1024") return { width: 1536, height: 1024 };
  return { width: 1024, height: 1024 };
}

function mimeFromContentType(contentType) {
  const type = String(contentType || "")
    .split(";")[0]
    .trim();
  if (type) return type;
  return "image/png";
}

function extensionFromMime(mimeType) {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return ".jpg";
  if (normalized.includes("webp")) return ".webp";
  if (normalized.includes("png")) return ".png";
  if (normalized.includes("mp4")) return ".mp4";
  if (normalized.includes("quicktime")) return ".mov";
  if (normalized.includes("mpeg")) return ".mpg";
  if (normalized.includes("wav")) return ".wav";
  if (normalized.includes("mp3")) return ".mp3";
  return ".png";
}

async function referenceImageToFile(asset, index = 0) {
  const source = String(asset?.source || "");
  if (!source) return null;
  if (source.startsWith("data:image/")) {
    const match = source.match(/^data:([^;,]+);base64,(.+)$/);
    if (!match) return null;
    const mimeType = mimeFromContentType(match[1]);
    return {
      buffer: Buffer.from(match[2], "base64"),
      mimeType,
      filename: `${asset.refName || `reference-${index + 1}`}${extensionFromMime(mimeType)}`,
    };
  }
  if (/^https?:\/\//i.test(source)) {
    const remote = await storedObjectToBuffer(source);
    if (!remote.contentType.startsWith("image/")) return null;
    return {
      buffer: remote.buffer,
      mimeType: mimeFromContentType(remote.contentType),
      filename: `${asset.refName || `reference-${index + 1}`}${extensionFromMime(remote.contentType)}`,
    };
  }

  const localPrefix = "/generated/";
  const publicUrlPrefix = `${process.env.PUBLIC_BASE_URL || ""}/generated/`;
  let relativePath = "";

  if (source.startsWith(localPrefix)) {
    relativePath = source;
  } else if (publicUrlPrefix && source.startsWith(publicUrlPrefix)) {
    relativePath = source.slice((process.env.PUBLIC_BASE_URL || "").length);
  } else {
    try {
      const sourceUrl = new URL(source);
      if (
        ["localhost", "127.0.0.1"].includes(sourceUrl.hostname) &&
        sourceUrl.pathname.startsWith(localPrefix)
      ) {
        relativePath = sourceUrl.pathname;
      }
    } catch {
      return null;
    }
  }

  if (!relativePath) return null;
  const fileName = path.basename(relativePath);
  const ext = path.extname(fileName).toLowerCase();
  const mimeType = mimeTypes[ext] || "image/png";
  const file = await fs.readFile(path.join(GENERATED_DIR, fileName));
  return {
    buffer: file,
    mimeType: mimeFromContentType(mimeType),
    filename: fileName,
  };
}

function buildPollinationsImageUrl(body, imageModel) {
  const { width, height } = imageDimensions(body.size);
  const prompt = [
    String(body.prompt || "").trim(),
    Number(body.strength)
      ? `style strength ${Number(body.strength)} of 100`
      : "",
  ]
    .filter(Boolean)
    .join(", ");
  const params = new URLSearchParams({
    model: imageModel.upstreamModel,
    width: String(width),
    height: String(height),
    nologo: "true",
    seed: String(Math.floor(Math.random() * 100000000)),
  });
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params.toString()}`;
}

function requestBinaryDirect(url) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = https.request(
      {
        method: "GET",
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        timeout: 120000,
        headers: {
          Accept: "image/avif,image/webp,image/png,image/jpeg,image/*,*/*",
          "User-Agent": "DreameHub/1.0",
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`图片服务返回 HTTP ${res.statusCode}`));
            return;
          }
          const contentType = res.headers["content-type"] || "";
          if (!contentType.startsWith("image/")) {
            reject(
              new Error(
                `图片服务返回了非图片响应：${contentType || "unknown"}`,
              ),
            );
            return;
          }
          resolve({
            buffer: Buffer.concat(chunks),
            contentType,
          });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("IMAGE_REQUEST_TIMEOUT")));
    req.on("error", reject);
    req.end();
  });
}

function requestBinaryViaHttpProxy(url, proxyUrl) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const proxy = new URL(proxyUrl);
    const socket = net.connect(Number(proxy.port || 80), proxy.hostname);
    socket.setTimeout(120000);
    socket.once("connect", () => {
      const auth = proxy.username
        ? `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}\r\n`
        : "";
      socket.write(
        `CONNECT ${target.hostname}:443 HTTP/1.1\r\nHost: ${target.hostname}:443\r\n${auth}\r\n`,
      );
    });

    let buffered = Buffer.alloc(0);
    socket.on("data", function onProxyData(chunk) {
      buffered = Buffer.concat([buffered, chunk]);
      const headerEnd = buffered.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      const header = buffered.slice(0, headerEnd).toString("utf8");
      if (!/^HTTP\/1\.[01] 200/i.test(header)) {
        socket.destroy();
        reject(new Error(`代理 CONNECT 失败：${header.split("\r\n")[0]}`));
        return;
      }

      socket.removeListener("data", onProxyData);
      const secureSocket = tls.connect({ socket, servername: target.hostname });
      const req = https.request(
        {
          method: "GET",
          hostname: target.hostname,
          path: `${target.pathname}${target.search}`,
          createConnection: () => secureSocket,
          timeout: 120000,
          headers: {
            Accept: "image/avif,image/webp,image/png,image/jpeg,image/*,*/*",
            "User-Agent": "DreameHub/1.0",
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (data) => chunks.push(data));
          res.on("end", () => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              reject(new Error(`图片服务返回 HTTP ${res.statusCode}`));
              return;
            }
            const contentType = res.headers["content-type"] || "";
            if (!contentType.startsWith("image/")) {
              reject(
                new Error(
                  `图片服务返回了非图片响应：${contentType || "unknown"}`,
                ),
              );
              return;
            }
            resolve({
              buffer: Buffer.concat(chunks),
              contentType,
            });
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error("IMAGE_REQUEST_TIMEOUT")));
      req.on("error", reject);
      req.end();
    });

    socket.on("timeout", () =>
      socket.destroy(new Error("IMAGE_PROXY_TIMEOUT")),
    );
    socket.on("error", reject);
  });
}

function isProxyConnectionError(error) {
  const message = String(error?.message || "");
  return [
    "ECONNREFUSED",
    "ECONNRESET",
    "ENOTFOUND",
    "EHOSTUNREACH",
    "OPENAI_PROXY_TIMEOUT",
    "IMAGE_PROXY_TIMEOUT",
    "代理 CONNECT 失败",
  ].some((fragment) => message.includes(fragment) || error?.code === fragment);
}

async function requestImageBinary(url) {
  if (OPENAI_PROXY) {
    try {
      return await requestBinaryViaHttpProxy(url, OPENAI_PROXY);
    } catch (error) {
      if (!isProxyConnectionError(error)) throw error;
      try {
        return await requestBinaryDirect(url);
      } catch (directError) {
        throw new Error(
          `代理不可用且直连图片服务失败。代理错误：${error.message}；直连错误：${directError.message}`,
        );
      }
    }
  }
  return requestBinaryDirect(url);
}

function imageExtension(contentType) {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  return "jpg";
}

function generatedExtension(contentType, fallback = ".bin") {
  const normalized = String(contentType || "").toLowerCase();
  if (normalized.includes("mp4")) return ".mp4";
  if (normalized.includes("quicktime")) return ".mov";
  if (normalized.includes("webm")) return ".webm";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return ".jpg";
  if (normalized.includes("png")) return ".png";
  if (normalized.includes("webp")) return ".webp";
  return fallback;
}

function r2Configured() {
  return Boolean(
    R2_ACCOUNT_ID &&
      R2_ACCESS_KEY_ID &&
      R2_SECRET_ACCESS_KEY &&
      R2_BUCKET &&
      r2PublicBaseUrlValid(),
  );
}

function r2CredentialsConfigured() {
  return Boolean(
    R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET,
  );
}

function r2PublicBaseUrlValid() {
  if (!R2_PUBLIC_BASE_URL) return false;
  try {
    const url = new URL(R2_PUBLIC_BASE_URL);
    return (
      url.protocol === "https:" &&
      !url.hostname.endsWith(".r2.cloudflarestorage.com")
    );
  } catch {
    return false;
  }
}

function r2ConfigurationError() {
  if (!r2CredentialsConfigured()) return "R2 credentials are incomplete";
  if (!R2_PUBLIC_BASE_URL) return "R2_PUBLIC_BASE_URL is missing";
  if (!r2PublicBaseUrlValid()) {
    return "R2_PUBLIC_BASE_URL must be an r2.dev or custom public domain, not the S3 API endpoint";
  }
  return "";
}

function getR2Client() {
  if (!r2CredentialsConfigured()) return null;
  if (!r2Client) {
    r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
      ...(R2_PROXY
        ? {
            requestHandler: new NodeHttpHandler({
              httpsAgent: new HttpsProxyAgent(R2_PROXY),
            }),
          }
        : {}),
    });
  }
  return r2Client;
}

function safeUploadFileName(fileName, mimeType) {
  const extension =
    path.extname(String(fileName || "")).toLowerCase() ||
    generatedExtension(mimeType, ".bin");
  const base =
    path
      .basename(String(fileName || "upload"), extension)
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "upload";
  return `${base}${extension}`;
}

function r2ObjectKey(user, fileName, mimeType) {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return [
    "users",
    user.id,
    "canvas",
    String(now.getUTCFullYear()),
    month,
    `${crypto.randomUUID()}-${safeUploadFileName(fileName, mimeType)}`,
  ].join("/");
}

function r2GeneratedObjectKey(fileName) {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return [
    "generated",
    String(now.getUTCFullYear()),
    month,
    safeUploadFileName(fileName, "application/octet-stream"),
  ].join("/");
}

function r2PublicUrl(key) {
  return `${R2_DELIVERY_BASE_URL}/${key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

function r2ExternalPublicUrl(key) {
  if (!R2_PUBLIC_BASE_URL || !key) return "";
  return `${R2_PUBLIC_BASE_URL.replace(/\/+$/, "")}/${String(key)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

function r2KeyFromPublicUrl(value) {
  const source = String(value || "");
  if (source.startsWith("/r2/")) {
    return source
      .slice("/r2/".length)
      .split("/")
      .map((part) => decodeURIComponent(part))
      .join("/");
  }
  try {
    const target = new URL(value);
    for (const configuredBase of [
      R2_DELIVERY_BASE_URL,
      R2_PUBLIC_BASE_URL,
    ].filter((item) => /^https?:\/\//i.test(item))) {
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
    return "";
  } catch {
    return "";
  }
}

function r2KeysInValue(value) {
  if (typeof value !== "string" || !value) return [];
  const candidates = new Set([value]);
  for (const match of value.matchAll(/https?:\/\/[^\s"'<>\\]+|\/r2\/[^\s"'<>\\]+/g)) {
    candidates.add(match[0]);
  }
  return [...candidates]
    .map(r2KeyFromPublicUrl)
    .filter(Boolean);
}

function collectR2ReferenceCounts(value, counts = new Map()) {
  if (typeof value === "string") {
    for (const key of r2KeysInValue(value)) {
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectR2ReferenceCounts(item, counts);
    return counts;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectR2ReferenceCounts(item, counts);
    }
  }
  return counts;
}

function collectR2ObjectKeys(value) {
  return new Set(collectR2ReferenceCounts(value).keys());
}

function r2ObjectEligibleForGc(key) {
  return (
    String(key || "").startsWith("users/") ||
    String(key || "").startsWith("generated/") ||
    String(key || "").startsWith("migrated/data/")
  );
}

async function recycleUnreferencedR2Objects(db, candidates) {
  if (!r2CredentialsConfigured()) return [];
  const referenceCounts = collectR2ReferenceCounts(db);
  const recycled = [];
  for (const key of new Set(candidates || [])) {
    if (!r2ObjectEligibleForGc(key) || referenceCounts.get(key)) continue;
    try {
      await getR2Client().send(
        new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }),
      );
      recycled.push(key);
    } catch (error) {
      console.error(
        JSON.stringify({
          type: "r2_gc_error",
          key,
          message: error.message,
        }),
      );
    }
  }
  return recycled;
}

async function serveR2Object(req, res, url) {
  const client = getR2Client();
  if (!client) return sendError(res, 503, "R2 storage is not configured", req);
  const key = url.pathname
    .slice("/r2/".length)
    .split("/")
    .map((part) => decodeURIComponent(part))
    .join("/");
  if (!key || key.includes("../")) {
    return sendError(res, 400, "Invalid R2 object key", req);
  }
  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        ...(req.headers.range ? { Range: String(req.headers.range) } : {}),
      }),
    );
    const status = response.ContentRange ? 206 : 200;
    const headers = {
      "Accept-Ranges": response.AcceptRanges || "bytes",
      "Cache-Control":
        response.CacheControl || "public, max-age=31536000, immutable",
      "Content-Type": response.ContentType || "application/octet-stream",
      ETag: response.ETag || "",
    };
    if (response.ContentLength !== undefined) {
      headers["Content-Length"] = String(response.ContentLength);
    }
    if (response.ContentRange) headers["Content-Range"] = response.ContentRange;
    if (response.LastModified) {
      headers["Last-Modified"] = response.LastModified.toUTCString();
    }
    res.writeHead(status, headers);
    if (req.method === "HEAD") return res.end();
    response.Body.pipe(res);
  } catch (error) {
    if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) {
      return sendError(res, 404, "R2 object not found", req);
    }
    throw error;
  }
}

async function storedObjectToBuffer(value) {
  const key = r2KeyFromPublicUrl(value);
  if (key && r2CredentialsConfigured()) {
    const response = await getR2Client().send(
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }),
    );
    return {
      buffer: Buffer.from(await response.Body.transformToByteArray()),
      contentType: String(response.ContentType || "application/octet-stream"),
    };
  }
  return requestAnyBinaryDirect(value);
}

async function putR2Object(key, buffer, contentType, metadata = {}) {
  const client = getR2Client();
  if (!client || !r2Configured()) {
    throw new Error(r2ConfigurationError() || "R2 storage is not configured");
  }
  await client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType || "application/octet-stream",
      CacheControl: "public, max-age=31536000, immutable",
      Metadata: Object.fromEntries(
        Object.entries(metadata)
          .filter(([, value]) => value !== undefined && value !== null)
          .map(([name, value]) => [name, String(value)]),
      ),
    }),
  );
  return r2PublicUrl(key);
}

async function createR2Upload(user, { fileName, mimeType, size }) {
  const client = getR2Client();
  if (!client) return null;
  const key = r2ObjectKey(user, fileName, mimeType);
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      ContentType: mimeType,
      Metadata: {
        userId: user.id,
        expectedSize: String(size),
      },
    }),
    { expiresIn: R2_PRESIGN_TTL_SECONDS },
  );
  return {
    key,
    uploadUrl,
    publicUrl: r2PublicUrl(key),
    expiresIn: R2_PRESIGN_TTL_SECONDS,
  };
}

async function completeR2Upload(user, { key, mimeType, size }) {
  const client = getR2Client();
  if (!client) throw new Error("R2 storage is not configured");
  const expectedPrefix = `users/${user.id}/canvas/`;
  if (!String(key || "").startsWith(expectedPrefix)) {
    const error = new Error("Invalid upload key");
    error.statusCode = 403;
    throw error;
  }
  const head = await client.send(
    new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }),
  );
  const actualSize = Number(head.ContentLength || 0);
  const actualType = String(head.ContentType || "");
  const invalid =
    !actualSize ||
    actualSize > MAX_UPLOAD_BYTES ||
    (Number(size) > 0 && actualSize !== Number(size)) ||
    (mimeType && actualType && actualType !== mimeType);
  if (invalid) {
    await client.send(
      new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }),
    );
    const error = new Error("Uploaded object failed validation");
    error.statusCode = 422;
    throw error;
  }
  return {
    url: r2PublicUrl(key),
    source: r2PublicUrl(key),
    mimeType: actualType || mimeType,
    size: actualSize,
    storage: "r2",
  };
}

async function saveGeneratedImage(buffer, contentType) {
  const fileName = `${crypto.randomUUID()}.${imageExtension(contentType)}`;
  if (r2Configured()) {
    return putR2Object(
      r2GeneratedObjectKey(fileName),
      buffer,
      contentType || "image/png",
      { kind: "generated-image" },
    );
  }
  await fs.mkdir(GENERATED_DIR, { recursive: true });
  await fs.writeFile(path.join(GENERATED_DIR, fileName), buffer);
  return `/generated/${fileName}`;
}

async function saveGeneratedBinary(
  buffer,
  contentType,
  fallbackExtension = ".bin",
) {
  const fileName = `${crypto.randomUUID()}${generatedExtension(contentType, fallbackExtension)}`;
  if (r2Configured()) {
    return putR2Object(
      r2GeneratedObjectKey(fileName),
      buffer,
      contentType || "application/octet-stream",
      { kind: "generated-binary" },
    );
  }
  await fs.mkdir(GENERATED_DIR, { recursive: true });
  await fs.writeFile(path.join(GENERATED_DIR, fileName), buffer);
  return `/generated/${fileName}`;
}

function requestJsonDirect(
  url,
  payload,
  headers,
  timeoutMs = 120000,
  { timeoutError = "OPENAI_REQUEST_TIMEOUT" } = {},
) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === "http:" ? http : https;
    const req = client.request(
      {
        method: "POST",
        hostname: target.hostname,
        port: target.port || (target.protocol === "http:" ? 80 : 443),
        path: `${target.pathname}${target.search}`,
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              json: JSON.parse(text),
            });
          } catch {
            reject(
              new Error(`OpenAI 返回了非 JSON 响应：HTTP ${res.statusCode}`),
            );
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(timeoutError)));
    req.on("error", reject);
    req.write(JSON.stringify(payload));
    req.end();
  });
}

function requestJsonViaHttpProxy(url, payload, headers, proxyUrl) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const proxy = new URL(proxyUrl);
    const proxyPort = Number(proxy.port || 80);

    const socket = net.connect(proxyPort, proxy.hostname);
    socket.setTimeout(120000);
    socket.once("connect", () => {
      const auth = proxy.username
        ? `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}\r\n`
        : "";
      socket.write(
        `CONNECT ${target.hostname}:443 HTTP/1.1\r\nHost: ${target.hostname}:443\r\n${auth}\r\n`,
      );
    });

    let buffered = Buffer.alloc(0);
    socket.on("data", function onProxyData(chunk) {
      buffered = Buffer.concat([buffered, chunk]);
      const headerEnd = buffered.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      const header = buffered.slice(0, headerEnd).toString("utf8");
      if (!/^HTTP\/1\.[01] 200/i.test(header)) {
        socket.destroy();
        reject(new Error(`代理 CONNECT 失败：${header.split("\r\n")[0]}`));
        return;
      }

      socket.removeListener("data", onProxyData);
      const secureSocket = tls.connect({ socket, servername: target.hostname });
      const req = https.request(
        {
          method: "POST",
          hostname: target.hostname,
          path: `${target.pathname}${target.search}`,
          headers,
          createConnection: () => secureSocket,
          timeout: 120000,
        },
        (res) => {
          const chunks = [];
          res.on("data", (data) => chunks.push(data));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            try {
              resolve({
                ok: res.statusCode >= 200 && res.statusCode < 300,
                status: res.statusCode,
                json: JSON.parse(text),
              });
            } catch {
              reject(
                new Error(`OpenAI 返回了非 JSON 响应：HTTP ${res.statusCode}`),
              );
            }
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error("OPENAI_REQUEST_TIMEOUT")));
      req.on("error", reject);
      req.write(JSON.stringify(payload));
      req.end();
    });

    socket.on("timeout", () =>
      socket.destroy(new Error("OPENAI_PROXY_TIMEOUT")),
    );
    socket.on("error", reject);
  });
}

async function requestOpenAIJson(pathname, payload) {
  const url = `${OPENAI_BASE_URL}${pathname}`;
  const body = JSON.stringify(payload);
  const headers = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  };

  if (OPENAI_PROXY) {
    try {
      return await requestJsonViaHttpProxy(url, payload, headers, OPENAI_PROXY);
    } catch (error) {
      if (!isProxyConnectionError(error)) throw error;
      try {
        return await requestJsonDirect(url, payload, headers);
      } catch (directError) {
        throw new Error(
          `代理不可用且直连 OpenAI 失败。代理错误：${error.message}；直连错误：${directError.message}`,
        );
      }
    }
  }

  return requestJsonDirect(url, payload, headers);
}

async function requestProviderJson(
  url,
  payload,
  headers = {},
  timeoutMs = 120000,
  options = {},
) {
  const body = JSON.stringify(payload);
  const requestHeaders = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    ...headers,
  };
  return requestJsonDirect(url, payload, requestHeaders, timeoutMs, options);
}

function apiRelayModelDefinitions() {
  const definitions = [];
  for (const channel of API_RELAY_CHANNELS) {
    for (const [publicModel, upstreamModel] of Object.entries(
      channel.modelMap,
    )) {
      definitions.push({
        id: publicModel,
        upstreamModel,
        channelId: channel.id,
        channelName: channel.name,
        capabilities: channel.capabilities,
        priority: channel.priority,
      });
    }
  }
  return definitions;
}

function apiRelayCandidates(model, capability) {
  const publicModel = String(model || "").trim();
  return API_RELAY_CHANNELS.filter(
    (channel) =>
      channel.capabilities.includes(capability) &&
      Object.prototype.hasOwnProperty.call(channel.modelMap, publicModel),
  );
}

function apiRelayHasModel(model, capability) {
  return apiRelayCandidates(model, capability).length > 0;
}

function apiRelayEndpointUrl(channel, endpoint) {
  return `${channel.baseUrl}/${String(endpoint || "").replace(/^\/+/, "")}`;
}

function apiRelayErrorMessage(payload, fallback) {
  return (
    payload?.error?.message ||
    payload?.error ||
    payload?.message ||
    fallback
  );
}

async function requestConfiguredApiRelay(endpoint, capability, body) {
  const publicModel = String(body?.model || "").trim();
  const candidates = apiRelayCandidates(publicModel, capability);
  if (!candidates.length) return null;

  const attemptLimit = Math.max(
    1,
    Math.min(candidates.length, API_RELAY_MAX_RETRIES + 1),
  );
  const failures = [];
  for (const channel of candidates.slice(0, attemptLimit)) {
    const upstreamModel = channel.modelMap[publicModel];
    const headers = {
      ...channel.headers,
      ...(channel.apiKey
        ? { Authorization: `Bearer ${channel.apiKey}` }
        : {}),
    };
    try {
      const response = await requestProviderJson(
        apiRelayEndpointUrl(channel, endpoint),
        {
          ...body,
          model: upstreamModel,
          stream: false,
        },
        headers,
        API_RELAY_TIMEOUT_MS,
      );
      if (!response.ok) {
        failures.push(
          `${channel.name}: ${apiRelayErrorMessage(
            response.json,
            `HTTP ${response.status}`,
          )}`,
        );
        continue;
      }
      return {
        channel,
        publicModel,
        upstreamModel,
        payload: response.json,
      };
    } catch (error) {
      failures.push(`${channel.name}: ${error.message}`);
    }
  }

  throw new Error(`全部中转渠道调用失败：${failures.join("；")}`);
}

function publicApiRelayChannels() {
  const builtInChannels = [
    {
      id: "pollinations",
      name: "Pollinations",
      type: "built-in",
      status: "active",
      capabilities: ["chat", "images"],
      modelCount:
        (API_CAPABILITIES.text.models || []).filter(
          (model) => model.provider === "pollinations",
        ).length +
        IMAGE_MODEL_REGISTRY.filter(
          (model) => model.provider === "pollinations",
        ).length,
    },
    ...(localLlmConfigured()
      ? [
          {
            id: "local",
            name: "Local OpenAI-compatible",
            type: "built-in",
            status: "active",
            capabilities: ["chat"],
            modelCount: 1,
          },
        ]
      : []),
    ...(process.env.OPENAI_API_KEY
      ? [
          {
            id: "openai",
            name: "OpenAI",
            type: "built-in",
            status: "active",
            capabilities: ["chat", "images"],
            modelCount: 2,
          },
        ]
      : []),
  ];
  return [
    ...builtInChannels,
    ...API_RELAY_CHANNELS.map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: "relay",
      status: channel.apiKey ? "active" : "configured",
      capabilities: channel.capabilities,
      modelCount: Object.keys(channel.modelMap).length,
      priority: channel.priority,
    })),
  ];
}

function publicApiRelayModels() {
  const builtIn = (API_CAPABILITIES.text.models || []).map((model) => ({
    id: model.id,
    name: model.label,
    provider: model.provider,
    channel:
      model.provider === "openai"
        ? "OpenAI"
        : model.provider === "pollinations"
          ? "Pollinations"
          : model.provider === "local"
            ? "本地部署"
            : model.provider,
    capabilities: ["chat"],
    available: model.capabilities?.realApi !== false,
    description:
      model.provider === "local"
        ? "通过本地 OpenAI-compatible 服务运行，适合内网与隐私任务。"
        : model.provider === "openai"
          ? "由 OpenAI 官方渠道提供的通用文本生成能力。"
          : "免额外上游密钥的文本生成通道，适合快速接入与测试。",
    endpoint: "/v1/chat/completions",
    billing: model.provider === "pollinations" ? "免费额度" : "按量计费",
    domains:
      model.provider === "local"
        ? ["私有部署", "通用对话"]
        : ["通用对话", "内容创作"],
  }));
  const configured = apiRelayModelDefinitions().map((model) => ({
    id: model.id,
    name: model.id,
    provider: model.channelId,
    channel: model.channelName,
    capabilities: model.capabilities,
    available: true,
    description: `由 ${model.channelName} 渠道提供，支持自动路由与失败切换。`,
    endpoint: model.capabilities.includes("embeddings")
      ? "/v1/embeddings"
      : model.capabilities.includes("responses")
        ? "/v1/responses"
        : "/v1/chat/completions",
    billing: "按量计费",
    domains: ["通用对话", "API 聚合"],
  }));
  const imageModels = IMAGE_MODEL_REGISTRY.map((model) => ({
    id: model.id,
    name: model.label,
    provider: model.provider,
    channel: model.provider === "openai" ? "OpenAI" : "Pollinations",
    capabilities: ["images"],
    available: model.capabilities?.realApi !== false,
    description: model.description,
    endpoint: "/v1/images/generations",
    billing: model.requiresKey ? "按量计费" : "免费额度",
    domains: ["图像生成", "视觉创作"],
  }));
  const domesticCatalog = [
    {
      id: "deepseek-chat",
      name: "DeepSeek Chat",
      provider: "deepseek",
      channel: "DeepSeek",
      capabilities: ["chat"],
      description: "适合中文通用对话、知识问答、内容生成与工具调用。",
      endpoint: "/v1/chat/completions",
      billing: "按量计费",
      domains: ["通用对话", "中文理解", "工具调用"],
    },
    {
      id: "deepseek-reasoner",
      name: "DeepSeek Reasoner",
      provider: "deepseek",
      channel: "DeepSeek",
      capabilities: ["chat"],
      description: "强化复杂推理、数学、代码分析与多步骤问题求解。",
      endpoint: "/v1/chat/completions",
      billing: "按量计费",
      domains: ["深度推理", "数学", "代码"],
    },
    {
      id: "qwen-plus",
      name: "通义千问 Plus",
      provider: "alibaba",
      channel: "阿里云百炼",
      capabilities: ["chat"],
      description: "兼顾效果、速度和成本，适合企业问答、办公与内容生产。",
      endpoint: "/v1/chat/completions",
      billing: "按量计费",
      domains: ["企业应用", "办公", "通用对话"],
    },
    {
      id: "qwen-max",
      name: "通义千问 Max",
      provider: "alibaba",
      channel: "阿里云百炼",
      capabilities: ["chat"],
      description: "面向高质量复杂任务、长文本理解和高要求内容生成。",
      endpoint: "/v1/chat/completions",
      billing: "按量计费",
      domains: ["复杂任务", "长文本", "内容创作"],
    },
    {
      id: "qwen-coder-plus",
      name: "通义千问 Coder Plus",
      provider: "alibaba",
      channel: "阿里云百炼",
      capabilities: ["chat"],
      description: "专注代码生成、代码解释、重构与软件工程任务。",
      endpoint: "/v1/chat/completions",
      billing: "按量计费",
      domains: ["代码", "软件工程", "Agent"],
    },
    {
      id: "text-embedding-v3",
      name: "通义文本向量 V3",
      provider: "alibaba",
      channel: "阿里云百炼",
      capabilities: ["embeddings"],
      description: "用于语义检索、知识库、聚类和 RAG 向量化。",
      endpoint: "/v1/embeddings",
      billing: "按量计费",
      domains: ["向量检索", "RAG", "知识库"],
    },
    {
      id: "doubao-seed",
      name: "豆包 Seed",
      provider: "bytedance",
      channel: "字节火山方舟",
      capabilities: ["chat"],
      description: "适合中文对话、内容创作和多轮企业应用；需配置方舟推理接入点 ID。",
      endpoint: "/v1/chat/completions",
      billing: "按量计费",
      domains: ["中文对话", "内容创作", "企业应用"],
    },
    {
      id: "moonshot-v1-32k",
      name: "Kimi 32K",
      provider: "moonshot",
      channel: "月之暗面 Kimi",
      capabilities: ["chat"],
      description: "适合长文本阅读、文档总结和资料分析。",
      endpoint: "/v1/chat/completions",
      billing: "按量计费",
      domains: ["长文本", "文档分析", "总结"],
    },
    {
      id: "glm-4-plus",
      name: "GLM-4 Plus",
      provider: "zhipu",
      channel: "智谱 AI",
      capabilities: ["chat"],
      description: "适合中文通用任务、知识问答和智能体应用。",
      endpoint: "/v1/chat/completions",
      billing: "按量计费",
      domains: ["通用对话", "知识问答", "Agent"],
    },
  ].map((model) => ({
    ...model,
    available: apiRelayHasModel(model.id, model.capabilities[0]),
  }));
  return [...builtIn, ...domesticCatalog, ...configured, ...imageModels].filter(
    (model, index, list) =>
      list.findIndex(
        (candidate) =>
          candidate.id === model.id &&
          candidate.capabilities.join(",") === model.capabilities.join(","),
      ) === index,
  );
}

function requestFormJsonDirect(url, fields, headers = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = new URLSearchParams(fields).toString();
    const client = target.protocol === "http:" ? http : https;
    const req = client.request(
      {
        method: "POST",
        hostname: target.hostname,
        port: target.port || (target.protocol === "http:" ? 80 : 443),
        path: `${target.pathname}${target.search}`,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
          ...headers,
        },
        timeout: 120000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            json,
            text,
          });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("FORM_REQUEST_TIMEOUT")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function requestJsonBodyDirect(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === "http:" ? http : https;
    const req = client.request(
      {
        method: "POST",
        hostname: target.hostname,
        port: target.port || (target.protocol === "http:" ? 80 : 443),
        path: `${target.pathname}${target.search}`,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          ...headers,
        },
        timeout: 120000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            json,
            text,
            headers: res.headers,
          });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("JSON_BODY_TIMEOUT")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function requestJsonGetDirect(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === "http:" ? http : https;
    const req = client.request(
      {
        method: "GET",
        hostname: target.hostname,
        port: target.port || (target.protocol === "http:" ? 80 : 443),
        path: `${target.pathname}${target.search}`,
        headers,
        timeout: 120000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              json: JSON.parse(text),
            });
          } catch {
            reject(new Error(`服务返回了非 JSON 响应：HTTP ${res.statusCode}`));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("JSON_GET_TIMEOUT")));
    req.on("error", reject);
    req.end();
  });
}

function requestJsonMethodDirect(url, method = "GET", headers = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === "http:" ? http : https;
    const req = client.request(
      {
        method,
        hostname: target.hostname,
        port: target.port || (target.protocol === "http:" ? 80 : 443),
        path: `${target.pathname}${target.search}`,
        headers,
        timeout: 120000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = text ? JSON.parse(text) : {};
          } catch {}
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            json,
            text,
          });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("JSON_METHOD_TIMEOUT")));
    req.on("error", reject);
    req.end();
  });
}

function requestAnyBinaryDirect(url) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === "http:" ? http : https;
    const req = client.request(
      {
        method: "GET",
        hostname: target.hostname,
        port: target.port || (target.protocol === "http:" ? 80 : 443),
        path: `${target.pathname}${target.search}`,
        timeout: 120000,
        headers: { "User-Agent": "DreameHub/1.0" },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`二进制资源返回 HTTP ${res.statusCode}`));
            return;
          }
          resolve({
            buffer: Buffer.concat(chunks),
            contentType:
              res.headers["content-type"] || "application/octet-stream",
          });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("BINARY_REQUEST_TIMEOUT")));
    req.on("error", reject);
    req.end();
  });
}

function requestMultipartForm(url, parts, headers = {}) {
  const multipart = buildMultipartBody(parts);
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === "http:" ? http : https;
    const req = client.request(
      {
        method: "POST",
        hostname: target.hostname,
        port: target.port || (target.protocol === "http:" ? 80 : 443),
        path: `${target.pathname}${target.search}`,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${multipart.boundary}`,
          "Content-Length": multipart.body.length,
          ...headers,
        },
        timeout: 120000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              json: JSON.parse(text),
            });
          } catch {
            reject(new Error(`服务返回了非 JSON 响应：HTTP ${res.statusCode}`));
          }
        });
      },
    );
    req.on("timeout", () =>
      req.destroy(new Error("MULTIPART_REQUEST_TIMEOUT")),
    );
    req.on("error", reject);
    req.write(multipart.body);
    req.end();
  });
}

function extractOpenAIText(payload) {
  if (payload.output_text) return String(payload.output_text);
  const chunks = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.text) chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

function seedancePromptInput(prompt) {
  const userPrompt = String(prompt || "").trim();
  return [
    "你是即梦 Seedance 2.0 的中文视频提示词工程师。请把用户的想法改写成可直接用于 Seedance 2.0 的高质量视频生成提示词。",
    "",
    "必须遵守：",
    "- 用中文输出，只输出最终提示词，不要解释你的思路。",
    "- 适合文本、图片、视频、音频多模态输入；如果用户提到素材，请使用 @图片1、@视频1、@音频1 等引用，并明确每个引用的用途。",
    "- 优先写清主体、场景、动作、运镜、分时段画面、转场/特效、音效/音乐和风格氛围。",
    "- 8 秒以上或信息较多的视频，按 0-3 秒、3-6 秒、6-10 秒、10-15 秒这类时间段拆分。",
    "- 引用不能含糊，不要只写“参考 @视频1”，要说明参考运镜、动作、节奏、特效、音色或场景。",
    "- 避免同一段里出现互相冲突的镜头指令；不要在 4-5 秒内塞入过多场景。",
    "- 如果用户没有指定时长，默认生成 10-15 秒竖版短视频提示词。",
    "- 可以加入电影级质感、浅景深、冷暖对比、音效、BGM、旁白语气等增强描述。",
    "- 不要要求上传写实真人清晰脸部素材。",
    "",
    "推荐结构：",
    "[主体/人物设定] + [场景/环境] + [动作/运动描述] + [运镜语言] + [分时段描述] + [转场/特效] + [音频/音效设计] + [风格/氛围]",
    "",
    "用户想法：",
    userPrompt,
  ].join("\n");
}

function chatMessageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text") return part.text || "";
      return part?.text || "";
    })
    .join("\n")
    .trim();
}

function normalizeChatMessages(messages) {
  return messages
    .filter((item) => ["system", "user", "assistant"].includes(item?.role))
    .map((item) => ({
      role: item.role,
      content: chatMessageText(item.content),
    }))
    .filter((item) => item.content);
}

function pollinationsModelName(model) {
  if (!model || model === "dreamehub-free-chat") return POLLINATIONS_TEXT_MODEL;
  if (String(model).startsWith("pollinations:"))
    return String(model).slice("pollinations:".length);
  return POLLINATIONS_TEXT_MODEL;
}

async function callPollinationsChatCompletion(body) {
  const messages = normalizeChatMessages(
    Array.isArray(body.messages) ? body.messages : [],
  );
  if (!messages.some((item) => item.role === "user")) {
    throw new Error("messages 中至少需要一条 user 消息");
  }
  const response = await requestProviderJson(
    "https://text.pollinations.ai/openai",
    {
      model: pollinationsModelName(body.model),
      messages,
      temperature: body.temperature ?? 0.7,
      max_tokens: body.max_tokens || body.max_completion_tokens || undefined,
    },
  );
  const payload = response.json;
  if (!response.ok) {
    throw new Error(
      payload.error?.message ||
        payload.message ||
        "Pollinations text generation failed",
    );
  }
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("免费文本模型未返回内容");
  return {
    id: payload.id || `chatcmpl_${crypto.randomUUID()}`,
    model: payload.model || pollinationsModelName(body.model),
    content,
    usage: payload.usage || null,
  };
}

function openAIModelName(model) {
  if (!model || model === "openai-chat")
    return OPENAI_TEXT_MODEL;
  if (String(model).startsWith("openai:"))
    return String(model).slice("openai:".length);
  return OPENAI_TEXT_MODEL;
}

function isLocalTextModel(model) {
  const value = String(model || "");
  return (
    value === LOCAL_LLM_MODEL ||
    value === "qwen3:14b" ||
    value.startsWith("qwen") ||
    value.startsWith("ollama:") ||
    value.startsWith("local:")
  );
}

async function callOpenAIChatCompletion(body) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("缺少 OPENAI_API_KEY，无法调用 OpenAI 文本接口");
  }
  const messages = normalizeChatMessages(
    Array.isArray(body.messages) ? body.messages : [],
  );
  if (!messages.some((item) => item.role === "user")) {
    throw new Error("messages 中至少需要一条 user 消息");
  }
  const response = await requestOpenAIJson("/v1/responses", {
    model: openAIModelName(body.model),
    input: messages.map((item) => `${item.role}: ${item.content}`).join("\n\n"),
    temperature: body.temperature ?? 0.7,
  });
  const payload = response.json;
  if (!response.ok) {
    throw new Error(payload.error?.message || "OpenAI text generation failed");
  }
  const content = extractOpenAIText(payload);
  if (!content) throw new Error("OpenAI 未返回文本内容");
  return {
    id: payload.id || `chatcmpl_${crypto.randomUUID()}`,
    model: openAIModelName(body.model),
    content,
    usage: payload.usage || null,
  };
}

async function callLocalChatCompletion(body) {
  if (!LOCAL_LLM_BASE_URL) {
    throw new Error("未配置 LOCAL_LLM_BASE_URL，无法调用本地 Agent 模型");
  }
  const messages = normalizeChatMessages(
    Array.isArray(body.messages) ? body.messages : [],
  );
  if (!messages.some((item) => item.role === "user")) {
    throw new Error("messages 中至少需要一条 user 消息");
  }
  const maxTokens = Math.min(
    LOCAL_LLM_MAX_TOKENS,
    Math.max(
      1,
      Number(body.max_tokens || body.max_completion_tokens || LOCAL_LLM_MAX_TOKENS),
    ),
  );
  const localModel = localLlmModelName(body.model);
  const isOllamaLocal =
    /127\.0\.0\.1:11434|localhost:11434|host\.docker\.internal:11434/.test(
      LOCAL_LLM_BASE_URL,
    );
  if (isOllamaLocal) {
    const ollamaBaseUrl = LOCAL_LLM_BASE_URL.replace(/\/v1$/, "");
    let response;
    try {
      response = await requestProviderJson(
        `${ollamaBaseUrl}/api/chat`,
        {
          model: localModel,
          messages,
          stream: false,
          think: false,
          options: {
            temperature: body.temperature ?? 0.35,
        num_predict: maxTokens,
          },
        },
        {},
        LOCAL_LLM_TIMEOUT_MS,
        { timeoutError: "LOCAL_LLM_REQUEST_TIMEOUT" },
      );
    } catch (error) {
      if (error.message === "LOCAL_LLM_REQUEST_TIMEOUT") {
        throw new Error(
          `本地 Qwen/Ollama 请求超过 ${Math.round(LOCAL_LLM_TIMEOUT_MS / 1000)} 秒仍未返回，请减少输出长度或换用更小模型。`,
        );
      }
      throw error;
    }
    const payload = response.json || {};
    if (!response.ok) {
      throw new Error(
        payload.error ||
          payload.message ||
          `本地 Ollama 调用失败：HTTP ${response.status}`,
      );
    }
    const content = payload.message?.content || payload.response || "";
    if (!content) throw new Error("本地 Ollama 模型未返回文本内容");
    return {
      id: payload.id || `local_${crypto.randomUUID()}`,
      model: payload.model || localModel,
      content,
      usage: {
        prompt_eval_count: payload.prompt_eval_count,
        eval_count: payload.eval_count,
      },
    };
  }
  const headers = {};
  if (localLlmUsesOpenRouter() && !LOCAL_LLM_API_KEY) {
    throw new Error("未配置 OPENROUTER_API_KEY，无法调用 OpenRouter 文本模型");
  }
  if (LOCAL_LLM_API_KEY) headers.Authorization = `Bearer ${LOCAL_LLM_API_KEY}`;
  const chatCompletionsUrl = LOCAL_LLM_BASE_URL.endsWith("/v1")
    ? `${LOCAL_LLM_BASE_URL}/chat/completions`
    : `${LOCAL_LLM_BASE_URL}/v1/chat/completions`;
  let response;
  try {
    response = await requestProviderJson(
      chatCompletionsUrl,
      {
        model: localModel,
        messages,
        temperature: body.temperature ?? 0.35,
      max_tokens: maxTokens,
      },
      headers,
      LOCAL_LLM_TIMEOUT_MS,
      { timeoutError: "LOCAL_LLM_REQUEST_TIMEOUT" },
    );
  } catch (error) {
    if (error.message === "LOCAL_LLM_REQUEST_TIMEOUT") {
      throw new Error(
        `本地模型请求超过 ${Math.round(LOCAL_LLM_TIMEOUT_MS / 1000)} 秒仍未返回，请减少输出长度或换用更小模型。`,
      );
    }
    throw error;
  }
  const payload = response.json || {};
  if (!response.ok) {
    throw new Error(
      payload.error?.message ||
        payload.message ||
        `本地模型调用失败：HTTP ${response.status}`,
    );
  }
  const content =
    payload.choices?.[0]?.message?.content || payload.choices?.[0]?.text;
  if (!content) throw new Error("本地模型未返回文本内容");
  return {
    id: payload.id || `local_${crypto.randomUUID()}`,
    model: payload.model || localModel,
    content,
    usage: payload.usage || null,
  };
}

async function callPlainTextGeneration(body) {
  const selectedModel = body.imageModel || body.model || "dreamehub-free-chat";
  const request = {
    model: selectedModel,
    temperature: body.temperature ?? 0.7,
    max_tokens: body.max_tokens || 1200,
    messages: [
      {
        role: "user",
        content: String(body.prompt || "").trim(),
      },
    ],
  };
  const useLocalModel = isLocalTextModel(selectedModel);
  const useOpenAIModel =
    selectedModel === "openai-chat" || String(selectedModel).startsWith("openai:");
  let output;
  let provider;
  try {
    if (useLocalModel) {
      output = await callLocalChatCompletion(request);
      provider = localLlmUsesOpenRouter() ? "openrouter" : "local";
    } else if (useOpenAIModel) {
      output = await callOpenAIChatCompletion(request);
      provider = "openai";
    } else {
      output = await callPollinationsChatCompletion(request);
      provider = "pollinations";
    }
  } catch (error) {
    if (!useLocalModel) throw error;
    console.warn(
      JSON.stringify({
        type: "text_generation_fallback",
        from: localLlmUsesOpenRouter() ? "openrouter" : "local",
        model: localLlmModelName(selectedModel),
        to: "pollinations",
        message: error.message,
      }),
    );
    output = await callPollinationsChatCompletion({
      ...request,
      model: "dreamehub-free-chat",
    });
    provider = "pollinations";
    return {
      provider,
      engine: `${selectedModel}->dreamehub-free-chat:${output.model}`,
      text: output.content,
      usage: output.usage,
      fallback: {
        from: localLlmUsesOpenRouter() ? "openrouter" : "local",
        model: localLlmModelName(selectedModel),
        reason: error.message,
      },
    };
  }
  return {
    provider,
    engine: `${selectedModel}:${output.model}`,
    text: output.content,
    usage: output.usage,
  };
}

function buildMultipartBody(parts) {
  const boundary = `----DreameHub${crypto.randomUUID().replace(/-/g, "")}`;
  const chunks = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (part.buffer) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename || "file"}"\r\nContent-Type: ${part.mimeType || "application/octet-stream"}\r\n\r\n`,
        ),
      );
      chunks.push(part.buffer);
      chunks.push(Buffer.from("\r\n"));
    } else {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"\r\n\r\n${String(part.value || "")}\r\n`,
        ),
      );
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(chunks) };
}

function requestMultipartDirect(url, body, headers) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = https.request(
      {
        method: "POST",
        hostname: target.hostname,
        path: `${target.pathname}${target.search}`,
        headers,
        timeout: 120000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (data) => chunks.push(data));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              json: JSON.parse(text),
            });
          } catch {
            reject(
              new Error(`OpenAI 返回了非 JSON 响应：HTTP ${res.statusCode}`),
            );
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("OPENAI_REQUEST_TIMEOUT")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function requestMultipartViaHttpProxy(url, body, headers, proxyUrl) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const proxy = new URL(proxyUrl);
    const proxyPort = Number(proxy.port || 80);
    const socket = net.connect(proxyPort, proxy.hostname);
    socket.setTimeout(120000);
    socket.once("connect", () => {
      const auth = proxy.username
        ? `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}\r\n`
        : "";
      socket.write(
        `CONNECT ${target.hostname}:443 HTTP/1.1\r\nHost: ${target.hostname}:443\r\n${auth}\r\n`,
      );
    });

    let buffered = Buffer.alloc(0);
    socket.on("data", function onProxyData(chunk) {
      buffered = Buffer.concat([buffered, chunk]);
      const headerEnd = buffered.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      const header = buffered.slice(0, headerEnd).toString("utf8");
      if (!/^HTTP\/1\.[01] 200/i.test(header)) {
        socket.destroy();
        reject(new Error(`代理 CONNECT 失败：${header.split("\r\n")[0]}`));
        return;
      }

      socket.removeListener("data", onProxyData);
      const secureSocket = tls.connect({ socket, servername: target.hostname });
      const req = https.request(
        {
          method: "POST",
          hostname: target.hostname,
          path: `${target.pathname}${target.search}`,
          headers,
          createConnection: () => secureSocket,
          timeout: 120000,
        },
        (res) => {
          const chunks = [];
          res.on("data", (data) => chunks.push(data));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            try {
              resolve({
                ok: res.statusCode >= 200 && res.statusCode < 300,
                status: res.statusCode,
                json: JSON.parse(text),
              });
            } catch {
              reject(
                new Error(`OpenAI 返回了非 JSON 响应：HTTP ${res.statusCode}`),
              );
            }
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error("OPENAI_REQUEST_TIMEOUT")));
      req.on("error", reject);
      req.write(body);
      req.end();
    });

    socket.on("timeout", () =>
      socket.destroy(new Error("OPENAI_PROXY_TIMEOUT")),
    );
    socket.on("error", reject);
  });
}

async function requestOpenAIMultipart(pathname, parts) {
  const url = `${OPENAI_BASE_URL}${pathname}`;
  const multipart = buildMultipartBody(parts);
  const headers = {
    "Content-Type": `multipart/form-data; boundary=${multipart.boundary}`,
    "Content-Length": multipart.body.length,
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  };

  if (OPENAI_PROXY) {
    try {
      return await requestMultipartViaHttpProxy(
        url,
        multipart.body,
        headers,
        OPENAI_PROXY,
      );
    } catch (error) {
      if (!isProxyConnectionError(error)) throw error;
      try {
        return await requestMultipartDirect(url, multipart.body, headers);
      } catch (directError) {
        throw new Error(
          `代理不可用且直连 OpenAI 失败。代理错误：${error.message}；直连错误：${directError.message}`,
        );
      }
    }
  }

  return requestMultipartDirect(url, multipart.body, headers);
}

async function callOpenAIImageGeneration(body, modelName) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("缺少 OPENAI_API_KEY，无法调用真实 GPT Images 2.0 接口");
  }

  let response;
  try {
    response = await requestOpenAIJson("/v1/images/generations", {
      model: body.model || OPENAI_IMAGE_MODEL,
      prompt: [
        String(body.prompt || "").trim(),
        modelName
          ? `\n\nUse the visual direction of this marketplace model: ${modelName}.`
          : "",
        Number(body.strength)
          ? `\nStyle strength: ${Number(body.strength)} / 100.`
          : "",
      ].join(""),
      size: normalizeImageSize(body.size),
      quality: normalizeImageQuality(body.quality),
      n: 1,
    });
  } catch (error) {
    throw new Error(
      `无法连接 OpenAI API：${error.message}。请检查 VPN 代理，并在 .env 设置 OPENAI_PROXY。`,
    );
  }

  const payload = response.json;
  if (!response.ok) {
    const message = payload.error?.message || "OpenAI image generation failed";
    throw new Error(message);
  }

  const base64Image = payload.data?.[0]?.b64_json;
  if (!base64Image) {
    throw new Error("OpenAI 未返回 b64_json 图片数据");
  }

  return {
    image: await saveGeneratedImage(
      Buffer.from(base64Image, "base64"),
      "image/png",
    ),
    provider: "openai",
    engine: body.model || OPENAI_IMAGE_MODEL,
    usage: payload.usage || null,
  };
}

async function callOpenAIImageEdit(body, modelName) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("缺少 OPENAI_API_KEY，无法调用真实 OpenAI 图片参考接口");
  }

  const imageReferences = Array.isArray(body.referenceAssets)
    ? body.referenceAssets.filter((asset) => asset.type === "image")
    : [];
  if (!imageReferences.length) {
    return callOpenAIImageGeneration(body, modelName);
  }

  const imageFiles = [];
  for (const [index, asset] of imageReferences.entries()) {
    const imageFile = await referenceImageToFile(asset, index);
    if (imageFile) imageFiles.push(imageFile);
  }

  if (!imageFiles.length) throw new Error("没有可提交给 OpenAI 的参考图片");

  let response;
  try {
    response = await requestOpenAIMultipart("/v1/images/edits", [
      { name: "model", value: body.model || OPENAI_IMAGE_MODEL },
      {
        name: "prompt",
        value: [
          String(body.prompt || "").trim(),
          modelName
            ? `\n\nUse the visual direction of this marketplace model: ${modelName}.`
            : "",
          Number(body.strength)
            ? `\nStyle strength: ${Number(body.strength)} / 100.`
            : "",
        ].join(""),
      },
      { name: "size", value: normalizeImageSize(body.size) },
      { name: "quality", value: normalizeImageQuality(body.quality) },
      { name: "n", value: "1" },
      ...imageFiles.map((file) => ({
        name: "image[]",
        ...file,
      })),
    ]);
  } catch (error) {
    throw new Error(
      `无法连接 OpenAI 图片参考接口：${error.message}。请检查 VPN 代理，并在 .env 设置 OPENAI_PROXY。`,
    );
  }

  const payload = response.json;
  if (!response.ok) {
    const message = payload.error?.message || "OpenAI image edit failed";
    throw new Error(message);
  }

  const base64Image = payload.data?.[0]?.b64_json;
  if (!base64Image) {
    throw new Error("OpenAI 未返回 b64_json 图片数据");
  }

  return {
    image: await saveGeneratedImage(
      Buffer.from(base64Image, "base64"),
      "image/png",
    ),
    provider: "openai",
    engine: body.model || OPENAI_IMAGE_MODEL,
    referenceInputSupported: true,
    referenceWarning: "",
    usage: payload.usage || null,
  };
}

async function callImageGeneration(body, modelName) {
  const imageModel = resolveImageModel(body.imageModel || body.model);
  const referenceAssetCount = Array.isArray(body.referenceAssets)
    ? body.referenceAssets.length
    : 0;

  if (imageModel.provider === "pollinations") {
    const remoteUrl = buildPollinationsImageUrl(body, imageModel);
    const image = await requestImageBinary(remoteUrl);
    return {
      image: await saveGeneratedImage(image.buffer, image.contentType),
      provider: "pollinations",
      engine: imageModel.id,
      referenceInputSupported: false,
      referenceWarning: referenceAssetCount
        ? "当前 Pollinations 模型只接收文本 prompt，不接收图片二进制参考。参考素材已记录到 DreameHub API，但未被上游模型消费。"
        : "",
      usage: null,
    };
  }

  const openaiBody = {
    ...body,
    model: imageModel.upstreamModel,
  };
  if (referenceAssetCount) return callOpenAIImageEdit(openaiBody, modelName);
  return callOpenAIImageGeneration(openaiBody, modelName);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractVideoId(payload) {
  return (
    payload.video_id ||
    payload.id ||
    payload.data?.video_id ||
    payload.data?.id ||
    payload.task_id ||
    payload.data?.task_id ||
    ""
  );
}

function extractVideoUrl(payload) {
  return (
    payload.video_url ||
    payload.url ||
    payload.output_url ||
    payload.content?.video_url ||
    payload.content?.videoUrl ||
    payload.data?.video_url ||
    payload.data?.url ||
    payload.data?.output_url ||
    payload.data?.content?.video_url ||
    payload.data?.content?.videoUrl ||
    payload.result?.video_url ||
    payload.result?.url ||
    ""
  );
}

function extractLastFrameUrl(payload) {
  return (
    payload.last_frame_url ||
    payload.lastFrameUrl ||
    payload.content?.last_frame_url ||
    payload.content?.lastFrameUrl ||
    payload.data?.last_frame_url ||
    payload.data?.lastFrameUrl ||
    payload.data?.content?.last_frame_url ||
    payload.data?.content?.lastFrameUrl ||
    payload.result?.last_frame_url ||
    payload.result?.lastFrameUrl ||
    ""
  );
}

function extractVideoStatus(payload) {
  return String(
    payload.status ||
      payload.data?.status ||
      payload.result?.status ||
      payload.task?.status ||
      "",
  ).toLowerCase();
}

function faceRestoreVideoInput(body) {
  const references = Array.isArray(body.referenceAssets)
    ? body.referenceAssets
    : [];
  const referenceVideo = references.find(
    (asset) => asset.type === "video" && asset.source,
  );
  if (referenceVideo) return referenceVideo;
  const node = body.node || {};
  if (node.type === "video" && (node.source || node.videoUrl)) {
    return {
      displayName: node.title || "当前视频",
      mimeType: node.mimeType || "video/mp4",
      size: Number(node.size || 0),
      source: node.source || node.videoUrl,
    };
  }
  return null;
}

function faceSwapImageInput(body) {
  const references = Array.isArray(body.referenceAssets)
    ? body.referenceAssets
    : [];
  const referenceImage = references.find(
    (asset) => asset.type === "image" && asset.source,
  );
  if (referenceImage) return referenceImage;
  const node = body.node || {};
  if (node.type === "image" && (node.source || node.image)) {
    return {
      displayName: node.title || "参考脸图",
      mimeType: node.mimeType || "image/png",
      size: Number(node.size || 0),
      source: node.source || node.image,
    };
  }
  return null;
}

function parseDataUrl(value) {
  const match = String(value || "").match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) return null;
  const mimeType = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const data = isBase64
    ? Buffer.from(match[3], "base64")
    : Buffer.from(decodeURIComponent(match[3]), "utf8");
  return { buffer: data, contentType: mimeType };
}

async function videoSourceToBuffer(input) {
  const source = String(input.source || "");
  const dataUrl = parseDataUrl(source);
  if (dataUrl) return dataUrl;
  if (/^https?:\/\//i.test(source)) return storedObjectToBuffer(source);
  throw new Error("视频素材必须是 data URL 或 http(s) URL。");
}

async function imageSourceToBuffer(input) {
  const source = String(input.source || "");
  const dataUrl = parseDataUrl(source);
  if (dataUrl) return dataUrl;
  if (/^https?:\/\//i.test(source)) return storedObjectToBuffer(source);
  if (source.startsWith("/generated/")) {
    const fileName = path.basename(source);
    const ext = path.extname(fileName).toLowerCase();
    return {
      buffer: await fs.readFile(path.join(GENERATED_DIR, fileName)),
      contentType: mimeTypes[ext] || "image/png",
    };
  }
  throw new Error(
    "换脸参考图必须是 data URL、http(s) URL 或 /generated/ 本地图片。",
  );
}

function comfyWorkflowPath(workflowPath = COMFYUI_FACE_RESTORE_WORKFLOW) {
  return path.isAbsolute(workflowPath)
    ? workflowPath
    : path.join(ROOT, workflowPath);
}

function replaceComfyPlaceholders(value, replacements) {
  if (typeof value === "string") {
    return Object.entries(replacements).reduce(
      (result, [key, replacement]) =>
        result.replaceAll(`{{${key}}}`, String(replacement)),
      value,
    );
  }
  if (Array.isArray(value))
    return value.map((item) => replaceComfyPlaceholders(item, replacements));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        replaceComfyPlaceholders(item, replacements),
      ]),
    );
  }
  return value;
}

async function loadComfyWorkflow(
  workflowPath,
  replacements,
  label = "ComfyUI 工作流",
) {
  let raw;
  try {
    raw = await fs.readFile(comfyWorkflowPath(workflowPath), "utf8");
  } catch {
    throw new Error(`找不到 ${label} 文件：${workflowPath}`);
  }
  return replaceComfyPlaceholders(JSON.parse(raw), replacements);
}

async function loadComfyFaceRestoreWorkflow(replacements) {
  return loadComfyWorkflow(
    COMFYUI_FACE_RESTORE_WORKFLOW,
    replacements,
    "ComfyUI 面部修复工作流",
  );
}

async function uploadVideoToComfyUI(input) {
  const binary = await videoSourceToBuffer(input);
  const extension =
    extensionFromMime(input.mimeType || binary.contentType || "video/mp4") ||
    ".mp4";
  const filename = `${crypto.randomUUID()}${extension}`;
  const response = await requestMultipartForm(
    `${COMFYUI_BASE_URL}/upload/image`,
    [
      {
        name: "image",
        filename,
        mimeType: input.mimeType || binary.contentType || "video/mp4",
        buffer: binary.buffer,
      },
      { name: "type", value: "input" },
      { name: "overwrite", value: "true" },
    ],
  );
  if (!response.ok) {
    throw new Error(
      response.json?.error?.message ||
        response.json?.message ||
        "ComfyUI 视频上传失败",
    );
  }
  return response.json?.name || response.json?.filename || filename;
}

async function uploadImageToComfyUI(input) {
  const binary = await imageSourceToBuffer(input);
  const extension =
    extensionFromMime(input.mimeType || binary.contentType || "image/png") ||
    ".png";
  const filename = `${crypto.randomUUID()}${extension}`;
  const response = await requestMultipartForm(
    `${COMFYUI_BASE_URL}/upload/image`,
    [
      {
        name: "image",
        filename,
        mimeType: input.mimeType || binary.contentType || "image/png",
        buffer: binary.buffer,
      },
      { name: "type", value: "input" },
      { name: "overwrite", value: "true" },
    ],
  );
  if (!response.ok) {
    throw new Error(
      response.json?.error?.message ||
        response.json?.message ||
        "ComfyUI 图片上传失败",
    );
  }
  return response.json?.name || response.json?.filename || filename;
}

function updateGenerationJob(jobId, patch) {
  if (!jobId) return;
  const job = generationJobs.get(jobId);
  if (!job) return;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  upsertPostgresItems("generationJobs", job).catch((error) => {
    console.error(
      JSON.stringify({
        type: "generation_job_persist_error",
        jobId,
        message: error.message,
      }),
    );
  });
}

function findComfyOutputVideo(
  historyPayload,
  promptId,
  outputNodeId = COMFYUI_FACE_RESTORE_OUTPUT_NODE,
) {
  const history = historyPayload?.[promptId] || historyPayload;
  const outputs = history?.outputs || {};
  const selectedNodes = outputNodeId ? [outputNodeId] : Object.keys(outputs);
  for (const nodeId of selectedNodes) {
    const output = outputs[nodeId] || {};
    const videos = output.videos || output.gifs || output.images || [];
    for (const item of videos) {
      const filename = item.filename || item.name;
      if (!filename) continue;
      const params = new URLSearchParams({
        filename,
        type: item.type || "output",
      });
      if (item.subfolder) params.set("subfolder", item.subfolder);
      return `${COMFYUI_BASE_URL}/view?${params.toString()}`;
    }
  }
  return "";
}

async function waitForComfyOutput(
  promptId,
  outputNodeId = COMFYUI_FACE_RESTORE_OUTPUT_NODE,
  label = "ComfyUI 工作流",
  jobId = "",
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < COMFYUI_TIMEOUT_MS) {
    await delay(2000);
    updateGenerationJob(jobId, {
      message: "ComfyUI 正在执行工作流",
      elapsedMs: Date.now() - startedAt,
      progress: await comfyLogProgress(),
    });
    const response = await requestJsonGetDirect(
      `${COMFYUI_BASE_URL}/history/${encodeURIComponent(promptId)}`,
    );
    if (!response.ok) continue;
    const videoUrl = findComfyOutputVideo(
      response.json,
      promptId,
      outputNodeId,
    );
    if (videoUrl) {
      updateGenerationJob(jobId, {
        message: "ComfyUI 已生成视频，正在保存到本地",
      });
      return videoUrl;
    }
    const history = response.json?.[promptId] || response.json;
    if (history?.status?.status_str === "error") {
      throw new Error(`${label} 执行失败`);
    }
  }
  throw new Error(`${label} 超时，请检查工作流或调大 COMFYUI_TIMEOUT_MS。`);
}

async function comfyLogProgress() {
  try {
    const text = await fs.readFile(COMFYUI_LOG_FILE, "utf8");
    const lines = text.split(/\r?\n/).slice(-180);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      const processed = line.match(
        /\[DreameHubFaceSwap\] Processed (\d+)\/([^ ]+) frames \(([^)]+)\)/,
      );
      if (processed) {
        const current = Number(processed[1] || 0);
        const total = processed[2] === "?" ? 0 : Number(processed[2] || 0);
        return {
          label: total
            ? `已处理 ${current}/${total} 帧`
            : `已处理 ${current} 帧`,
          current,
          total,
          percent: total
            ? Math.min(99, Math.round((current / total) * 100))
            : 0,
          rate: processed[3],
        };
      }
      const start = line.match(/\[DreameHubFaceSwap\] Start (.+)$/);
      if (start)
        return {
          label: `已开始处理：${start[1]}`,
          current: 0,
          total: 0,
          percent: 0,
          rate: "",
        };
      const finalizing = line.match(/\[DreameHubFaceSwap\] Finalizing (.+)$/);
      if (finalizing)
        return {
          label: "正在封装浏览器可播放 MP4",
          current: 0,
          total: 0,
          percent: 99,
          rate: "",
        };
    }
  } catch {
    return null;
  }
  return null;
}

async function persistComfyOutputVideo(videoUrl) {
  const binary = await requestAnyBinaryDirect(videoUrl);
  const publicPath = await saveGeneratedBinary(
    binary.buffer,
    binary.contentType || "video/mp4",
    ".mp4",
  );
  return publicPath;
}

async function persistRemoteVideoOutput(videoUrl, jobId = "") {
  updateGenerationJob(jobId, {
    message: "正在保存视频到本地素材库",
    progress: {
      label: "正在保存视频",
      current: 1,
      total: 1,
      percent: 99,
      rate: "",
    },
  });
  const binary = await requestAnyBinaryDirect(videoUrl);
  return saveGeneratedBinary(
    binary.buffer,
    binary.contentType || "video/mp4",
    ".mp4",
  );
}

async function persistRemoteLastFrameOutput(lastFrameUrl, jobId = "") {
  if (!lastFrameUrl) return "";
  updateGenerationJob(jobId, {
    message: "正在保存尾帧到素材库",
    progress: {
      label: "正在保存尾帧",
      current: 1,
      total: 1,
      percent: 99,
      rate: "",
    },
  });
  try {
    const binary = await requestAnyBinaryDirect(lastFrameUrl);
    return saveGeneratedBinary(
      binary.buffer,
      binary.contentType || "image/png",
      ".png",
    );
  } catch (error) {
    console.warn(
      JSON.stringify({
        type: "seedance_last_frame_persist_failed",
        message: error.message,
      }),
    );
    return lastFrameUrl;
  }
}

async function submitComfyWorkflow(workflow, outputNodeId, label, jobId = "") {
  const clientId = crypto.randomUUID();
  const response = await requestProviderJson(`${COMFYUI_BASE_URL}/prompt`, {
    prompt: workflow,
    client_id: clientId,
  });
  if (!response.ok) {
    throw new Error(
      response.json?.error?.message ||
        response.json?.message ||
        `${label} 提交失败`,
    );
  }
  const promptId = response.json?.prompt_id;
  if (!promptId) throw new Error("ComfyUI 未返回 prompt_id");
  updateGenerationJob(jobId, {
    promptId,
    message: "已提交到 ComfyUI，等待执行",
    progress: null,
  });
  const comfyVideoUrl = await waitForComfyOutput(
    promptId,
    outputNodeId,
    label,
    jobId,
  );
  const videoUrl = await persistComfyOutputVideo(comfyVideoUrl);
  return { promptId, videoUrl, comfyVideoUrl };
}

async function callComfyUIFaceRestoreGeneration(body) {
  const input = faceRestoreVideoInput(body);
  if (!input?.source) {
    throw new Error(
      "请先上传或连接一个视频素材，再使用 ComfyUI 面部高清修复。",
    );
  }
  const uploadedVideoName = await uploadVideoToComfyUI(input);
  const workflow = await loadComfyFaceRestoreWorkflow({
    VIDEO_NAME: uploadedVideoName,
    PROMPT:
      String(body.prompt || "").trim() ||
      "restore face, high definition, keep identity and motion stable",
    STRENGTH: clampNumber(body.strength, 55, 0, 100) / 100,
    FIDELITY: clampNumber(body.faceRestoreFidelity, 50, 0, 100) / 100,
    SCALE: clampNumber(body.faceRestoreScale, 1.25, 1, 2),
    PADDING: clampNumber(body.faceRestorePadding, 0.12, 0, 0.35),
    QUALITY: body.quality || "high",
  });
  const { promptId, videoUrl } = await submitComfyWorkflow(
    workflow,
    COMFYUI_FACE_RESTORE_OUTPUT_NODE,
    "ComfyUI 面部修复工作流",
    body.__jobId || "",
  );
  return {
    image: videoUrl,
    videoUrl,
    provider: "comfyui",
    engine: "face-restore:hd:comfyui",
    taskId: promptId,
    referenceInputSupported: true,
    referenceWarning: "",
    usage: null,
  };
}

function buildGenerationRecord({
  body,
  user,
  model,
  prompt = String(body?.prompt || "").trim(),
  referenceAssets = [],
  output,
}) {
  const mode = body.mode || "image";
  return {
    id: crypto.randomUUID(),
    userId: user?.id || "guest",
    prompt,
    mode,
    workflowMode: String(body.workflowMode || ""),
    node: body.node || null,
    referenceAssets,
    modelId: model.id,
    modelName: model.title,
    strength: Number(body.strength || 72),
    faceRestoreParams:
      mode === "video-face-restore" || mode === "video-face-swap"
        ? {
            fidelity: clampNumber(body.faceRestoreFidelity, 50, 0, 100),
            scale: clampNumber(body.faceRestoreScale, 1.25, 1, 2),
            padding: clampNumber(body.faceRestorePadding, 0.12, 0, 0.35),
            feather: clampNumber(body.faceSwapFeather, 22, 2, 50),
            colorMatch: clampNumber(body.faceSwapColorMatch, 75, 0, 100),
          }
        : null,
    size: normalizeImageSize(body.size),
    quality: normalizeImageQuality(body.quality),
    seedanceParams:
      mode === "video"
        ? {
            ratio: normalizeSeedanceRatio(body.aspectRatio),
            resolution: normalizeSeedanceResolution(body.resolution),
            duration: normalizeSeedanceDuration(body.duration),
            generateAudio: optionalBoolean(body.generateAudio),
            watermark: optionalBoolean(body.watermark),
            returnLastFrame:
              optionalBoolean(body.returnLastFrame) === undefined
                ? true
                : optionalBoolean(body.returnLastFrame),
            cameraFixed: optionalBoolean(body.cameraFixed),
            seed:
              body.seed !== undefined && body.seed !== ""
                ? Number(body.seed)
                : null,
            serviceTier: String(body.serviceTier || ""),
            draft: optionalBoolean(body.draft),
            draftTaskId: String(body.draftTaskId || ""),
            webSearch: optionalBoolean(body.webSearch),
            callbackUrl: String(body.callbackUrl || ""),
            executionExpiresAfter: String(body.executionExpiresAfter || ""),
          }
        : null,
    image: output.image || "",
    text: output.text || "",
    videoUrl: output.videoUrl || "",
    lastFrameUrl: output.lastFrameUrl || "",
    taskId: output.taskId || "",
    provider: output.provider,
    engine: output.engine,
    referenceInputSupported: Boolean(output.referenceInputSupported),
    referenceWarning: output.referenceWarning || "",
    usage: output.usage,
    status: "completed",
    createdAt: new Date().toISOString(),
  };
}

async function callComfyUIFaceSwapGeneration(body) {
  const input = faceRestoreVideoInput(body);
  if (!input?.source) {
    throw new Error("请先上传或连接一个视频素材，再使用 ComfyUI 视频换脸。");
  }
  const faceImage = faceSwapImageInput(body);
  if (!faceImage?.source) {
    throw new Error("请先连接或上传一张参考脸图，再使用视频换脸。");
  }
  const uploadedVideoName = await uploadVideoToComfyUI(input);
  const uploadedFaceImageName = await uploadImageToComfyUI(faceImage);
  const workflow = await loadComfyWorkflow(
    COMFYUI_FACE_SWAP_WORKFLOW,
    {
      VIDEO_NAME: uploadedVideoName,
      FACE_IMAGE_NAME: uploadedFaceImageName,
      PROMPT:
        String(body.prompt || "").trim() ||
        "swap face, keep target video motion and lighting",
      STRENGTH: clampNumber(body.strength, 82, 0, 100) / 100,
      FEATHER: clampNumber(body.faceSwapFeather, 22, 2, 50) / 100,
      COLOR_MATCH: clampNumber(body.faceSwapColorMatch, 75, 0, 100) / 100,
      QUALITY: body.quality || "high",
    },
    "ComfyUI 视频换脸工作流",
  );
  const { promptId, videoUrl } = await submitComfyWorkflow(
    workflow,
    COMFYUI_FACE_SWAP_OUTPUT_NODE,
    "ComfyUI 视频换脸工作流",
    body.__jobId || "",
  );
  return {
    image: videoUrl,
    videoUrl,
    provider: "comfyui",
    engine: "face-swap:insightface:comfyui",
    taskId: promptId,
    referenceInputSupported: true,
    referenceWarning: "",
    usage: null,
  };
}

async function callVideoFaceRestoreGeneration(body) {
  if (configuredFaceRestoreProvider() === "comfyui") {
    return callComfyUIFaceRestoreGeneration(body);
  }
  if (!FACE_RESTORE_API_URL) {
    throw new Error(
      "缺少 FACE_RESTORE_API_URL，无法调用视频面部高清修复接口。请在 .env 配置上游修复服务地址。",
    );
  }
  const input = faceRestoreVideoInput(body);
  if (!input?.source) {
    throw new Error("请先上传或连接一个视频素材，再使用面部高清修复。");
  }
  const response = await requestProviderJson(
    FACE_RESTORE_API_URL,
    {
      video: input.source,
      videoName: input.displayName || input.originalName || "input-video",
      mimeType: input.mimeType || "video/mp4",
      prompt:
        String(body.prompt || "").trim() ||
        "对视频中的人脸进行高清修复，增强五官清晰度、皮肤细节和稳定性，保持原始身份、表情、动作和背景不变。",
      task: "video-face-restoration",
      faceRestore: true,
      quality: body.quality || "high",
      strength: Number(body.strength || 72),
    },
    FACE_RESTORE_API_KEY
      ? { Authorization: `Bearer ${FACE_RESTORE_API_KEY}` }
      : {},
  );
  if (!response.ok) {
    throw new Error(
      response.json?.error?.message ||
        response.json?.message ||
        "视频面部高清修复失败",
    );
  }
  const videoUrl = extractVideoUrl(response.json);
  if (!videoUrl) {
    throw new Error("视频面部高清修复接口未返回 video_url/url/output_url");
  }
  return {
    image: videoUrl,
    videoUrl,
    provider: "face-restore",
    engine: "face-restore:hd",
    taskId: extractVideoId(response.json),
    referenceInputSupported: true,
    referenceWarning: "",
    usage: response.json?.usage || null,
  };
}

function seedanceAuthorizationHeader() {
  return { Authorization: `Bearer ${SEEDANCE_API_KEY}` };
}

async function resolveSeedanceImageUrl(source) {
  const value = String(source || "").trim();
  const publicBaseUrl = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const localGeneratedPath = localGeneratedPublicPath(value);
  if (localGeneratedPath) {
    if (!publicBaseUrl) {
      throw new Error(
        "Seedance 图生视频需要可公网访问的图片 URL。请配置 PUBLIC_BASE_URL 后再使用本地图片。",
      );
    }
    const publicUrl = `${publicBaseUrl}${localGeneratedPath}`;
    await assertRemoteAssetDownloadable(publicUrl, "image");
    return publicUrl;
  }
  if (value.startsWith("data:image/")) {
    const dataUrl = parseDataUrl(value);
    if (!dataUrl) throw new Error("参考图 data URL 无法解析，请重新上传图片。");
    const publicPath = await saveGeneratedImage(
      dataUrl.buffer,
      dataUrl.contentType,
    );
    if (publicBaseUrl) {
      const publicUrl = `${publicBaseUrl}${publicPath}`;
      await assertRemoteAssetDownloadable(publicUrl, "image");
      return publicUrl;
    }
    throw new Error(
      "Ark Seedance 图生视频需要可公网访问的图片 URL。参考图已保存到本地，请先配置 PUBLIC_BASE_URL 后重试。",
    );
  }
  if (/^https?:\/\//i.test(value)) {
    const r2Key = r2KeyFromPublicUrl(value);
    const r2ExternalUrl = r2ExternalPublicUrl(r2Key);
    if (r2ExternalUrl) return r2ExternalUrl;
    await assertRemoteAssetDownloadable(value, "image");
    return value;
  }
  if (value.startsWith("blob:")) {
    throw new Error(
      "Seedance 参考图片仍是浏览器临时 blob 地址，服务端无法访问。请等待素材上传完成后再提交生成。",
    );
  }
  throw new Error(
    "Seedance 参考图片需要公网可访问的 http(s) URL，请重新上传素材后再提交生成。",
  );
}

async function resolveSeedanceAudioUrl(source, mimeType = "audio/mpeg") {
  const value = String(source || "").trim();
  const publicBaseUrl = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const localGeneratedPath = localGeneratedPublicPath(value);
  if (localGeneratedPath) {
    if (!publicBaseUrl) {
      throw new Error(
        "Seedance 音频参考需要可公网访问的音频 URL。请配置 PUBLIC_BASE_URL 后再使用本地音频。",
      );
    }
    const publicUrl = `${publicBaseUrl}${localGeneratedPath}`;
    await assertRemoteAssetDownloadable(publicUrl, "audio");
    return publicUrl;
  }
  if (value.startsWith("data:audio/")) {
    const dataUrl = parseDataUrl(value);
    if (!dataUrl) throw new Error("音频 data URL 无法解析，请重新上传音频。");
    const publicPath = await saveGeneratedBinary(
      dataUrl.buffer,
      dataUrl.contentType || mimeType,
      extensionFromMime(dataUrl.contentType || mimeType),
    );
    if (publicBaseUrl) {
      const publicUrl = `${publicBaseUrl}${publicPath}`;
      await assertRemoteAssetDownloadable(publicUrl, "audio");
      return publicUrl;
    }
    throw new Error(
      "Ark Seedance 音频参考需要可公网访问的音频 URL。音频已保存到本地，请先配置 PUBLIC_BASE_URL 后重试。",
    );
  }
  if (/^https?:\/\//i.test(value)) {
    const r2Key = r2KeyFromPublicUrl(value);
    const r2ExternalUrl = r2ExternalPublicUrl(r2Key);
    if (r2ExternalUrl) return r2ExternalUrl;
    await assertRemoteAssetDownloadable(value, "audio");
    return value;
  }
  if (value.startsWith("blob:")) {
    throw new Error(
      "Seedance 参考音频仍是浏览器临时 blob 地址，服务端无法访问。请等待素材上传完成后再提交生成。",
    );
  }
  throw new Error(
    "Seedance 参考音频需要公网可访问的 http(s) URL，请重新上传素材后再提交生成。",
  );
}

async function resolveSeedanceVideoUrl(source, mimeType = "video/mp4") {
  const value = String(source || "").trim();
  const publicBaseUrl = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const localGeneratedPath = localGeneratedPublicPath(value);
  if (localGeneratedPath) {
    if (!publicBaseUrl) {
      throw new Error(
        "Seedance 视频参考需要可公网访问的视频 URL。请配置 PUBLIC_BASE_URL 后再使用本地视频。",
      );
    }
    const publicUrl = `${publicBaseUrl}${localGeneratedPath}`;
    await assertRemoteAssetDownloadable(publicUrl, "video");
    return publicUrl;
  }
  if (value.startsWith("data:video/")) {
    const dataUrl = parseDataUrl(value);
    if (!dataUrl) throw new Error("视频 data URL 无法解析，请重新上传视频。");
    const publicPath = await saveGeneratedBinary(
      dataUrl.buffer,
      dataUrl.contentType || mimeType,
      extensionFromMime(dataUrl.contentType || mimeType),
    );
    if (publicBaseUrl) {
      const publicUrl = `${publicBaseUrl}${publicPath}`;
      await assertRemoteAssetDownloadable(publicUrl, "video");
      return publicUrl;
    }
    throw new Error(
      "Ark Seedance 视频参考需要可公网访问的视频 URL。视频已保存到本地，请先配置 PUBLIC_BASE_URL 后重试。",
    );
  }
  if (/^https?:\/\//i.test(value)) {
    const r2Key = r2KeyFromPublicUrl(value);
    const r2ExternalUrl = r2ExternalPublicUrl(r2Key);
    if (r2ExternalUrl) return r2ExternalUrl;
    await assertRemoteAssetDownloadable(value, "video");
    return value;
  }
  if (value.startsWith("blob:")) {
    throw new Error(
      "Seedance 参考视频仍是浏览器临时 blob 地址，服务端无法访问。请等待素材上传完成后再提交生成。",
    );
  }
  throw new Error(
    "Seedance 参考视频需要公网可访问的 http(s) URL，请重新上传素材后再提交生成。",
  );
}

function localGeneratedPublicPath(value) {
  const source = String(value || "").trim();
  if (source.startsWith("/generated/")) return source;
  const publicBaseUrl = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (publicBaseUrl && source.startsWith(`${publicBaseUrl}/generated/`))
    return source.slice(publicBaseUrl.length);
  try {
    const sourceUrl = new URL(source);
    if (
      ["localhost", "127.0.0.1", "::1"].includes(sourceUrl.hostname) &&
      sourceUrl.pathname.startsWith("/generated/")
    ) {
      return sourceUrl.pathname;
    }
  } catch {}
  return "";
}

function isOwnPublicBaseUrl(url) {
  const publicBaseUrl = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (!publicBaseUrl) return false;
  try {
    const target = new URL(url);
    const base = new URL(publicBaseUrl);
    return target.protocol === base.protocol && target.hostname === base.hostname;
  } catch {
    return false;
  }
}

async function assertRemoteAssetDownloadable(url, expectedKind) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const binary = await requestAnyBinaryDirect(
        `${url}${url.includes("?") ? "&" : "?"}_dh_probe=${Date.now()}-${attempt}`,
      );
      const contentType = String(binary.contentType || "").toLowerCase();
      if (!contentType.startsWith(`${expectedKind}/`)) {
        throw new Error(
          `PUBLIC_BASE_URL 返回的资源不是 ${expectedKind} 文件：${url}（Content-Type: ${contentType || "unknown"}）。请检查公网隧道是否直连到本服务，localtunnel 验证页会导致 Seedance 下载失败。`,
        );
      }
      return true;
    } catch (error) {
      lastError = error;
      if (
        isOwnPublicBaseUrl(url) &&
        /ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(String(error.message || ""))
      ) {
        console.warn(
          `PUBLIC_BASE_URL 本机 DNS 暂未解析，跳过本机预检：${url}`,
        );
        return true;
      }
      if (!/HTTP 408|TIMEOUT/i.test(String(error.message || ""))) throw error;
      await delay(800 * attempt);
    }
  }
  throw new Error(
    `公网二进制资源多次下载失败：${url}。最后错误：${lastError?.message || "unknown"}。localtunnel 临时隧道对二进制资源可能会间歇 408，请重启隧道或改用 Cloudflare/ngrok 固定隧道。`,
  );
}

function seedanceReferenceAssets(body, type) {
  return (
    Array.isArray(body.referenceAssets) ? body.referenceAssets : []
  ).filter((asset) => asset.type === type && asset.source);
}

function seedanceAssetText(asset) {
  return [
    asset?.instruction,
    asset?.displayName,
    asset?.originalName,
    asset?.title,
    asset?.role,
  ]
    .filter(Boolean)
    .join(" ");
}

function normalizeSeedanceImageRole(value) {
  const role = String(value || "").trim();
  if (["first_frame", "last_frame", "reference_image"].includes(role))
    return role;
  return "";
}

function normalizeSeedanceReferenceRole(asset) {
  const explicit = String(asset?.seedanceRole || "").trim();
  if (
    [
      "first_frame",
      "last_frame",
      "reference_image",
      "reference_video",
      "reference_audio",
    ].includes(explicit)
  )
    return explicit;
  if (asset?.type === "image") return normalizeSeedanceImageRole(explicit);
  if (asset?.type === "video" && explicit === "reference_video") return explicit;
  if (asset?.type === "audio" && explicit === "reference_audio") return explicit;
  return "";
}

function arkSeedanceImageAssets(body, fallbackImageReference = null) {
  const imageAssets = seedanceReferenceAssets(body, "image");
  const workflowMode = String(body?.workflowMode || body?.model || "").trim();
  const roleAssets = imageAssets
    .map((asset) => ({
      ...asset,
      seedanceRole: normalizeSeedanceImageRole(asset.seedanceRole),
    }))
    .filter((asset) => asset.seedanceRole);
  const firstLastAssets = roleAssets.filter((asset) =>
    ["first_frame", "last_frame"].includes(asset.seedanceRole),
  );
  if (firstLastAssets.length) {
    const sameAsset = (left, right) =>
      Boolean(
        left &&
          right &&
          ((left.source && left.source === right.source) ||
            (left.refName && left.refName === right.refName) ||
            (left.id && left.id === right.id)),
      );
    const firstRole = firstLastAssets.find(
      (asset) => asset.seedanceRole === "first_frame",
    );
    const lastRole = firstLastAssets.find(
      (asset) => asset.seedanceRole === "last_frame",
    );
    const first =
      firstRole || imageAssets.find((asset) => !sameAsset(asset, lastRole));
    const last =
      lastRole || imageAssets.find((asset) => !sameAsset(asset, first));
    return [first, last].filter(Boolean);
  }
  const referenceAssets = roleAssets.filter(
    (asset) => asset.seedanceRole === "reference_image",
  );
  if (referenceAssets.length) return referenceAssets;
  if (/全能参考|reference-to-video|all-reference/i.test(workflowMode)) {
    return imageAssets.map((asset) => ({
      ...asset,
      seedanceRole: "reference_image",
    }));
  }
  if (/首尾帧|first-last|first_last/i.test(workflowMode)) {
    const first = imageAssets[0]
      ? { ...imageAssets[0], seedanceRole: "first_frame" }
      : null;
    const last = imageAssets[1]
      ? { ...imageAssets[1], seedanceRole: "last_frame" }
      : null;
    return [first, last].filter(Boolean);
  }
  if (/图生视频|image-to-video|首帧/i.test(workflowMode) && imageAssets[0]) {
    return [{ ...imageAssets[0], seedanceRole: "first_frame" }];
  }
  return fallbackImageReference ? [fallbackImageReference] : [];
}

function arkSeedanceVideoAssets(body) {
  return seedanceReferenceAssets(body, "video")
    .map((asset) => ({
      ...asset,
      seedanceRole: normalizeSeedanceReferenceRole(asset) || "reference_video",
    }))
    .filter((asset) => asset.seedanceRole === "reference_video");
}

function arkSeedanceAudioAssets(body) {
  return seedanceReferenceAssets(body, "audio")
    .map((asset) => ({
      ...asset,
      seedanceRole: normalizeSeedanceReferenceRole(asset) || "reference_audio",
    }))
    .filter((asset) => asset.seedanceRole === "reference_audio");
}

function seedanceImageReferenceScore(asset) {
  const text = seedanceAssetText(asset);
  let score = 0;
  if (/首帧|第一帧|开场|起始|开始画面|场景|背景|环境|空间|室内|客厅|全景|构图/u.test(text))
    score += 20;
  if (/产品|商品|外观|造型|机身|设备|冰箱|相机|参考图|严格参考/u.test(text))
    score -= 15;
  return score;
}

function selectSeedanceImageReference(body, audioReferences = []) {
  const imageReferences = seedanceReferenceAssets(body, "image");
  if (!imageReferences.length) return null;
  const workflowMode = String(body?.workflowMode || body?.model || "").trim();
  const scored = imageReferences
    .map((asset, index) => ({
      asset,
      index,
      score: seedanceImageReferenceScore(asset),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  if (/图生视频|image-to-video|首帧/u.test(workflowMode))
    return scored[0]?.asset || imageReferences[0];

  const sceneReference = scored.find((item) => item.score > 0)?.asset || null;
  if (sceneReference) return sceneReference;

  const hasProductReference = scored.some((item) => item.score < 0);
  if (hasProductReference) {
    const neutralReference = scored.find((item) => item.score >= 0)?.asset;
    if (neutralReference) return neutralReference;
  }

  if (audioReferences.length) return imageReferences[0];
  return null;
}

function validateSeedanceOfficialRequest(body) {
  const workflowMode = String(body?.workflowMode || body?.model || "").trim();
  const references = Array.isArray(body?.referenceAssets)
    ? body.referenceAssets
    : [];
  const imageReferences = references.filter((asset) => asset.type === "image");
  const videoReferences = references.filter((asset) => asset.type === "video");
  const audioReferences = references.filter((asset) => asset.type === "audio");
  const roles = references.map(normalizeSeedanceReferenceRole).filter(Boolean);
  const hasFirstFrameRole = roles.includes("first_frame");
  const hasLastFrameRole = roles.includes("last_frame");
  const isFirstLastMode =
    /首尾帧|first-last|first_last/i.test(workflowMode) || hasLastFrameRole;
  const isImageToVideoMode = /图生视频|image-to-video|首帧/i.test(workflowMode);
  const isFirstFrameMode =
    isImageToVideoMode || (hasFirstFrameRole && !hasLastFrameRole);
  const isReferenceMode =
    /全能参考|reference-to-video|all-reference/i.test(workflowMode) ||
    roles.some((role) =>
      ["reference_image", "reference_video", "reference_audio"].includes(role),
    ) ||
    videoReferences.length ||
    audioReferences.length;

  if (imageReferences.length > SEEDANCE_REFERENCE_IMAGE_LIMIT)
    return `Seedance 2.0 参考图片最多 ${SEEDANCE_REFERENCE_IMAGE_LIMIT} 张。`;
  if (videoReferences.length > SEEDANCE_REFERENCE_VIDEO_LIMIT)
    return `Seedance 2.0 参考视频最多 ${SEEDANCE_REFERENCE_VIDEO_LIMIT} 个。`;
  if (audioReferences.length > SEEDANCE_REFERENCE_AUDIO_LIMIT)
    return `Seedance 2.0 参考音频最多 ${SEEDANCE_REFERENCE_AUDIO_LIMIT} 个。`;
  if (audioReferences.length && !imageReferences.length && !videoReferences.length)
    return "Seedance 2.0 参考音频不能单独输入，需要同时连接至少一张图片或一个视频参考。";

  if (isFirstLastMode) {
    if (imageReferences.length < 2)
      return "首尾帧视频需要至少连接两张图片素材。";
    if (videoReferences.length || audioReferences.length)
      return "官方首尾帧场景不能混用参考视频或参考音频。";
    if (roles.some((role) => role.startsWith("reference_")))
      return "官方首尾帧场景不能混用多模态 reference_* 参考素材。";
  }

  if (isFirstFrameMode && !isFirstLastMode) {
    if (!imageReferences.length) return "图生视频至少需要一张图片素材。";
    if (videoReferences.length || audioReferences.length)
      return "官方图生视频首帧场景不能混用参考视频或参考音频。";
  }

  if (isReferenceMode && (hasFirstFrameRole || hasLastFrameRole))
    return "官方多模态参考场景不能混用 first_frame / last_frame。";

  return "";
}

function normalizeSeedanceRatio(value, { autoValue = "auto" } = {}) {
  const ratio = String(value || "auto").trim();
  if (!ratio || ratio === "智能比例" || ratio === "auto" || ratio === "adaptive")
    return autoValue;
  const supported = new Set(SEEDANCE_SUPPORTED_RATIOS);
  return supported.has(ratio) ? ratio : autoValue;
}

function normalizeSeedanceDuration(value) {
  const duration = Number(value || 5);
  if (!Number.isFinite(duration) || duration <= 0) return 5;
  return Math.max(
    SEEDANCE_DURATION_MIN,
    Math.min(SEEDANCE_DURATION_MAX, Math.round(duration)),
  );
}

function normalizeSeedanceResolution(value) {
  const resolution = String(value || "720p").trim().toLowerCase();
  const supported = new Set(SEEDANCE_SUPPORTED_RESOLUTIONS);
  return supported.has(resolution) ? resolution : "720p";
}

async function buildArkSeedanceRequestBody(
  body,
  imageReference,
  audioReferences = [],
) {
  const prompt = String(body.prompt || "").trim();
  const content = [];
  if (prompt) content.push({ type: "text", text: prompt });
  if (body.draftTaskId) {
    content.push({
      type: "draft_task",
      draft_task: { id: String(body.draftTaskId).trim() },
    });
  }
  const imageAssets = arkSeedanceImageAssets(body, imageReference);
  for (const imageAsset of imageAssets) {
    if (!imageAsset?.source) continue;
    const role = normalizeSeedanceImageRole(imageAsset.seedanceRole);
    content.push({
      type: "image_url",
      ...(role ? { role } : {}),
      image_url: { url: await resolveSeedanceImageUrl(imageAsset.source) },
    });
  }
  const videoAssets = arkSeedanceVideoAssets(body);
  for (const videoAsset of videoAssets) {
    if (!videoAsset?.source) continue;
    content.push({
      type: "video_url",
      role: "reference_video",
      video_url: {
        url: await resolveSeedanceVideoUrl(
          videoAsset.source,
          videoAsset.mimeType || "video/mp4",
        ),
      },
    });
  }
  const audioAssets = audioReferences.length
    ? audioReferences
    : arkSeedanceAudioAssets(body);
  for (const audioReference of audioAssets) {
    content.push({
      type: "audio_url",
      role: "reference_audio",
      audio_url: {
        url: await resolveSeedanceAudioUrl(
          audioReference.source,
          audioReference.mimeType || "audio/mpeg",
        ),
      },
    });
  }
  if (!content.length) {
    throw new Error("Seedance 2.0 至少需要文本提示词或一个参考素材。");
  }
  const requestBody = {
    model: SEEDANCE_MODEL,
    content,
    resolution: normalizeSeedanceResolution(body.resolution),
    duration: normalizeSeedanceDuration(body.duration),
  };
  const ratio = normalizeSeedanceRatio(body.aspectRatio, { autoValue: "adaptive" });
  if (ratio) requestBody.ratio = ratio;
  if (body.seed !== undefined && body.seed !== "")
    requestBody.seed = Number(body.seed);
  const generateAudio = optionalBoolean(body.generateAudio);
  if (generateAudio !== undefined) requestBody.generate_audio = generateAudio;
  const watermark = optionalBoolean(body.watermark);
  if (watermark !== undefined) requestBody.watermark = watermark;
  const returnLastFrame = optionalBoolean(body.returnLastFrame);
  requestBody.return_last_frame =
    returnLastFrame === undefined ? true : returnLastFrame;
  const cameraFixed = optionalBoolean(body.cameraFixed);
  if (cameraFixed !== undefined) requestBody.camera_fixed = cameraFixed;
  if (body.serviceTier)
    requestBody.service_tier = String(body.serviceTier).trim();
  const draft = optionalBoolean(body.draft);
  if (draft !== undefined) requestBody.draft = draft;
  if (body.callbackUrl)
    requestBody.callback_url = String(body.callbackUrl).trim();
  if (body.executionExpiresAfter)
    requestBody.execution_expires_after = String(
      body.executionExpiresAfter,
    ).trim();
  if (body.safetyIdentifier)
    requestBody.safety_identifier = String(body.safetyIdentifier).trim();
  if (optionalBoolean(body.webSearch))
    requestBody.tools = [{ type: "web_search" }];
  return requestBody;
}

function seedanceProgress(attempt, total, label) {
  const current = Math.min(attempt + 1, total);
  return {
    label,
    current,
    total,
    percent: Math.min(99, Math.max(1, Math.round((current / total) * 100))),
    rate: "",
  };
}

function arkSeedanceCreateErrorMessage(message, requestId = "") {
  const raw = String(message || "");
  let friendly = raw || "Ark Seedance 2.0 video generation failed";
  if (
    /real person|PrivacyInformation|InputImageSensitiveContentDetected/i.test(raw)
  ) {
    friendly =
      "Seedance 拒绝了参考图：输入图片可能包含真人/人脸隐私信息，任务未进入生成队列。请去掉人物参考图，或改用非真人、明显二次元/卡通化、遮挡/裁掉真实面部后的角色参考图；本次失败会自动退回算力点。";
  } else if (/image_url/i.test(raw) && /timeout while fetching resource/i.test(raw)) {
    friendly =
      "Seedance 无法及时下载参考图，任务未进入生成队列。已改用 R2 公共直链提交；如果仍失败，请压缩参考图或使用可被火山方舟访问的素材域名。";
  } else if (/image_url/i.test(raw)) {
    friendly =
      "Seedance 参考图 URL 无效，任务未进入生成队列。请确认素材已上传完成，并且图片地址可公网访问。";
  }
  return requestId ? `${friendly} Request id: ${requestId}` : friendly;
}

async function waitForArkSeedanceVideo(videoId, jobId = "") {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await delay(5000);
    updateGenerationJob(jobId, {
      message: "Seedance 2.0 正在生成视频",
      progress: seedanceProgress(attempt, 120, "等待 Seedance 2.0 返回视频"),
    });
    const statusResponse = await requestJsonGetDirect(
      `${SEEDANCE_BASE_URL}/contents/generations/tasks/${encodeURIComponent(videoId)}`,
      seedanceAuthorizationHeader(),
    );
    if (!statusResponse.ok) continue;
    const videoUrl = extractVideoUrl(statusResponse.json);
    const lastFrameUrl = extractLastFrameUrl(statusResponse.json);
    const status = extractVideoStatus(statusResponse.json);
    if (videoUrl)
      return { videoUrl, lastFrameUrl, payload: statusResponse.json };
    if (["failed", "error", "canceled", "cancelled"].includes(status)) {
      throw new Error(
        statusResponse.json.error?.message ||
          statusResponse.json.message ||
          "Ark Seedance 2.0 生成失败",
      );
    }
  }
  return { videoUrl: "", payload: null };
}

async function callArkSeedanceVideoGeneration(
  body,
  imageReference,
  audioReferences = [],
) {
  const jobId = body.__jobId || "";
  updateGenerationJob(jobId, {
    message: "正在提交到 Seedance 2.0",
    progress: {
      label: "提交生成任务",
      current: 0,
      total: 1,
      percent: 1,
      rate: "",
    },
  });
  const createResponse = await requestProviderJson(
    `${SEEDANCE_BASE_URL}/contents/generations/tasks`,
    await buildArkSeedanceRequestBody(body, imageReference, audioReferences),
    seedanceAuthorizationHeader(),
  );
  if (!createResponse.ok) {
    const arkImageAssets = arkSeedanceImageAssets(body, imageReference);
    const arkVideoAssets = arkSeedanceVideoAssets(body);
    const errorPayload = createResponse.json?.error || {};
    const requestId =
      createResponse.json?.request_id ||
      createResponse.json?.requestId ||
      errorPayload.request_id ||
      errorPayload.requestId ||
      "";
    const message =
      errorPayload.message ||
      createResponse.json?.message ||
      createResponse.json?.error?.code ||
      "Ark Seedance 2.0 video generation failed";
    console.error("Ark Seedance create failed", {
      status: createResponse.status,
      requestId,
      message,
      body: {
        mode: body.mode,
        aspectRatio: body.aspectRatio,
        resolution: body.resolution,
        duration: body.duration,
        count: body.count,
        generateAudio: body.generateAudio,
        imageReferences: arkImageAssets.length,
        videoReferences: arkVideoAssets.length,
        audioReferences: audioReferences.length,
      },
      response: createResponse.json,
    });
    throw new Error(arkSeedanceCreateErrorMessage(message, requestId));
  }

  let videoUrl = extractVideoUrl(createResponse.json);
  let lastFrameUrl = extractLastFrameUrl(createResponse.json);
  const videoId = extractVideoId(createResponse.json);
  updateGenerationJob(jobId, {
    promptId: videoId || "",
    message: videoUrl
      ? "Seedance 2.0 已返回视频，正在保存"
      : "Seedance 2.0 任务已提交，等待生成结果",
    progress: {
      label: videoUrl ? "正在保存视频" : "已进入 Seedance 2.0 队列",
      current: videoUrl ? 1 : 0,
      total: 1,
      percent: videoUrl ? 99 : 3,
      rate: "",
    },
  });
  if (!videoUrl && videoId) {
    const result = await waitForArkSeedanceVideo(videoId, jobId);
    videoUrl = result.videoUrl;
    lastFrameUrl = result.lastFrameUrl || lastFrameUrl;
  }

  if (!videoUrl) {
    throw new Error(
      videoId
        ? `Ark Seedance 2.0 任务已提交但暂未返回视频 URL：${videoId}`
        : "Ark Seedance 2.0 未返回视频 URL",
    );
  }

  const remoteVideoUrl = videoUrl;
  videoUrl = await persistRemoteVideoOutput(remoteVideoUrl, jobId);
  lastFrameUrl = await persistRemoteLastFrameOutput(lastFrameUrl, jobId);

  return {
    image: videoUrl,
    videoUrl,
    remoteVideoUrl,
    lastFrameUrl,
    provider: "ark",
    engine: SEEDANCE_MODEL,
    taskId: videoId,
    referenceInputSupported: Boolean(
      arkSeedanceImageAssets(body, imageReference).length ||
        arkSeedanceVideoAssets(body).length ||
        audioReferences.length
    ),
    usage: createResponse.json?.usage || null,
  };
}

async function callThirdPartySeedanceVideoGeneration(
  body,
  imageReference,
  audioReferences = [],
) {
  const jobId = body.__jobId || "";
  const mode = imageReference ? "image_to_video" : "text_to_video";
  const requestBody = {
    model: SEEDANCE_MODEL,
    task_type: mode,
    mode,
    prompt: String(body.prompt || "").trim(),
    duration: normalizeSeedanceDuration(body.duration),
    aspect_ratio: normalizeSeedanceRatio(body.aspectRatio),
    resolution: normalizeSeedanceResolution(body.resolution),
  };
  if (imageReference?.source)
    requestBody.image_url = await resolveSeedanceImageUrl(imageReference.source);
  if (audioReferences.length) {
    const audioUrls = [];
    for (const asset of audioReferences) {
      audioUrls.push(
        await resolveSeedanceAudioUrl(asset.source, asset.mimeType || "audio/mpeg"),
      );
    }
    requestBody.audio_url = audioUrls[0];
    requestBody.audio_urls = audioUrls;
  }
  const returnLastFrame = optionalBoolean(body.returnLastFrame);
  requestBody.return_last_frame =
    returnLastFrame === undefined ? true : returnLastFrame;

  const createResponse = await requestProviderJson(
    `${SEEDANCE_BASE_URL}/generate`,
    requestBody,
    seedanceAuthorizationHeader(),
  );
  if (!createResponse.ok) {
    throw new Error(
      createResponse.json?.error?.message ||
        createResponse.json?.message ||
        "Seedance 2.0 video generation failed",
    );
  }

  let videoUrl = extractVideoUrl(createResponse.json);
  let lastFrameUrl = extractLastFrameUrl(createResponse.json);
  const videoId = extractVideoId(createResponse.json);
  updateGenerationJob(jobId, {
    promptId: videoId || "",
    message: videoUrl
      ? "Seedance 2.0 已返回视频，正在保存"
      : "Seedance 2.0 任务已提交，等待生成结果",
    progress: {
      label: videoUrl ? "正在保存视频" : "已进入 Seedance 2.0 队列",
      current: videoUrl ? 1 : 0,
      total: 1,
      percent: videoUrl ? 99 : 5,
      rate: "",
    },
  });
  if (!videoUrl && videoId) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await delay(2000);
      updateGenerationJob(jobId, {
        message: "Seedance 2.0 正在生成视频",
        progress: seedanceProgress(
          attempt,
          30,
          "等待 Seedance 2.0 返回视频",
        ),
      });
      const statusResponse = await requestProviderJson(
        `${SEEDANCE_BASE_URL}/videos/${encodeURIComponent(videoId)}`,
        {},
        seedanceAuthorizationHeader(),
      );
      if (!statusResponse.ok) continue;
      videoUrl = extractVideoUrl(statusResponse.json);
      lastFrameUrl = extractLastFrameUrl(statusResponse.json) || lastFrameUrl;
      const status = extractVideoStatus(statusResponse.json);
      if (videoUrl) break;
      if (["failed", "error", "canceled", "cancelled"].includes(status)) {
        throw new Error(statusResponse.json.message || "Seedance 2.0 生成失败");
      }
    }
  }

  if (!videoUrl) {
    throw new Error(
      videoId
        ? `Seedance 2.0 任务已提交但暂未返回视频 URL：${videoId}`
        : "Seedance 2.0 未返回视频 URL",
    );
  }

  const remoteVideoUrl = videoUrl;
  videoUrl = await persistRemoteVideoOutput(remoteVideoUrl, jobId);
  lastFrameUrl = await persistRemoteLastFrameOutput(lastFrameUrl, jobId);

  return {
    image: videoUrl,
    videoUrl,
    remoteVideoUrl,
    lastFrameUrl,
    provider: "seedance",
    engine: SEEDANCE_MODEL,
    taskId: videoId,
    referenceInputSupported: Boolean(
      imageReference?.source || audioReferences.length,
    ),
    usage: null,
  };
}

async function callSeedanceVideoGeneration(body) {
  if (!SEEDANCE_API_KEY) {
    throw new Error("缺少 SEEDANCE_API_KEY，无法调用 Seedance 2.0 视频接口");
  }
  const audioReferences = seedanceReferenceAssets(body, "audio");
  const videoReferences = seedanceReferenceAssets(body, "video");
  const imageReferences = seedanceReferenceAssets(body, "image");
  const imageReference = selectSeedanceImageReference(body, audioReferences);
  if (audioReferences.length && !imageReferences.length && !videoReferences.length) {
    throw new Error(
      "Seedance 音频参考需要同时连接至少 1 个图片或视频参考素材。请再连接参考素材后提交。",
    );
  }
  if (SEEDANCE_PROVIDER === "ark" || SEEDANCE_PROVIDER === "volcengine") {
    return callArkSeedanceVideoGeneration(
      body,
      imageReference,
      audioReferences,
    );
  }
  if (
    videoReferences.length ||
    imageReferences.length > 1 ||
    imageReferences.some((asset) => normalizeSeedanceReferenceRole(asset)) ||
    audioReferences.length > 1
  ) {
    throw new Error(
      "当前非 Ark Seedance 网关不支持完整官方多模态参考，请切换 SEEDANCE_PROVIDER=ark。",
    );
  }
  return callThirdPartySeedanceVideoGeneration(
    body,
    imageReference,
    audioReferences,
  );
}

function createMockTextGeneration(prompt, referenceAssets = []) {
  const source = prompt || "未填写提示词";
  const refs = referenceAssets.length
    ? `\n\n参考素材：${referenceAssets
        .map(
          (asset) => asset.displayName || asset.originalName || asset.refName,
        )
        .filter(Boolean)
        .join("、")}`
    : "";
  return `【生成文本】\n${source}\n\n【结构建议】\n1. 明确主体、场景与情绪。\n2. 补充镜头、动作与视觉风格。\n3. 如果要继续接图片或视频节点，可直接把这段文本作为上游输入。${refs}`;
}

async function createGeneration(body, db, user) {
  const mode = body.mode || "image";
  const model =
    db.models.find((item) => item.id === body.modelId) ||
    db.models.find((item) => item.category === mode) ||
    fallbackGenerationModel(mode);
  const prompt = String(body.prompt || "").trim();
  const referenceAssets = Array.isArray(body.referenceAssets)
    ? body.referenceAssets.map((asset) => ({
        refName: String(asset.refName || ""),
        displayName: String(asset.displayName || ""),
        originalName: String(asset.originalName || ""),
        type: String(asset.type || "asset"),
        title: String(asset.title || ""),
        role: String(asset.role || ""),
        seedanceRole: String(asset.seedanceRole || ""),
        instruction: String(asset.instruction || ""),
        mimeType: String(asset.mimeType || ""),
        size: Number(asset.size || 0),
        source: String(asset.source || ""),
      }))
    : [];
  let output;
  if (mode === "image") {
    output = await callImageGeneration(body, model.title);
  } else if (mode === "text") {
    output = await callPlainTextGeneration(body);
  } else if (mode === "video-face-restore") {
    output = await callVideoFaceRestoreGeneration(body);
  } else if (mode === "video-face-swap") {
    output = await callComfyUIFaceSwapGeneration(body);
  } else if (mode === "video") {
    output = await callSeedanceVideoGeneration({
      ...body,
      safetyIdentifier: body.safetyIdentifier || arkSafetyIdentifier(user),
    });
  } else {
    output = {
      image:
        db.previewImages[Math.floor(Math.random() * db.previewImages.length)],
      provider: "mock",
      engine: "mock-training",
      usage: null,
    };
  }

  return {
    id: crypto.randomUUID(),
    userId: user?.id || "guest",
    prompt,
    mode,
    workflowMode: String(body.workflowMode || ""),
    node: body.node || null,
    referenceAssets,
    modelId: model.id,
    modelName: model.title,
    strength: Number(body.strength || 72),
    faceRestoreParams:
      mode === "video-face-restore" || mode === "video-face-swap"
        ? {
            fidelity: clampNumber(body.faceRestoreFidelity, 50, 0, 100),
            scale: clampNumber(body.faceRestoreScale, 1.25, 1, 2),
            padding: clampNumber(body.faceRestorePadding, 0.12, 0, 0.35),
            feather: clampNumber(body.faceSwapFeather, 22, 2, 50),
            colorMatch: clampNumber(body.faceSwapColorMatch, 75, 0, 100),
          }
        : null,
    size: normalizeImageSize(body.size),
    quality: normalizeImageQuality(body.quality),
    seedanceParams:
      mode === "video"
        ? {
            ratio: normalizeSeedanceRatio(body.aspectRatio),
            resolution: normalizeSeedanceResolution(body.resolution),
            duration: normalizeSeedanceDuration(body.duration),
            generateAudio: optionalBoolean(body.generateAudio),
            watermark: optionalBoolean(body.watermark),
            returnLastFrame:
              optionalBoolean(body.returnLastFrame) === undefined
                ? true
                : optionalBoolean(body.returnLastFrame),
            cameraFixed: optionalBoolean(body.cameraFixed),
            seed:
              body.seed !== undefined && body.seed !== ""
                ? Number(body.seed)
                : null,
            serviceTier: String(body.serviceTier || ""),
            draft: optionalBoolean(body.draft),
            draftTaskId: String(body.draftTaskId || ""),
            webSearch: optionalBoolean(body.webSearch),
            callbackUrl: String(body.callbackUrl || ""),
            executionExpiresAfter: String(body.executionExpiresAfter || ""),
          }
        : null,
    image: output.image,
    text: output.text || "",
    videoUrl: output.videoUrl || "",
    lastFrameUrl: output.lastFrameUrl || "",
    taskId: output.taskId || "",
    provider: output.provider,
    engine: output.engine,
    referenceInputSupported: Boolean(output.referenceInputSupported),
    referenceWarning: output.referenceWarning || "",
    usage: output.usage,
    status: "completed",
    createdAt: new Date().toISOString(),
  };
}

function publicGenerationJob(job, user = null) {
  return {
    id: job.id,
    status: job.status,
    mode: job.mode,
    promptId: job.promptId || "",
    message: job.message || "",
    progress: job.progress || null,
    error: job.error || "",
    generation: job.generation || null,
    elapsedMs: Date.now() - job.startedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    user: user ? publicUser(user) : undefined,
  };
}

async function refreshGenerationJobProgress(job) {
  if (!job || job.status !== "running") return job;
  if (!["video-face-restore", "video-face-swap"].includes(job.mode)) return job;
  const progress = await comfyLogProgress();
  if (progress) {
    job.progress = progress;
    job.updatedAt = new Date().toISOString();
  }
  return job;
}

function startGenerationJob({ body, db, user, cost }) {
  const job = {
    id: crypto.randomUUID(),
    userId: user.id,
    mode: body.mode || "image",
    status: "queued",
    message: "已提交，正在准备素材",
    promptId: "",
    progress: null,
    error: "",
    generation: null,
    body: safeJsonClone(body, {}),
    cost: Number(cost || 0),
    refunded: false,
    startedAt: Date.now(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  generationJobs.set(job.id, job);
  db.generationJobs ||= [];
  db.generationJobs.unshift(job);

  setTimeout(async () => {
    job.status = "running";
    job.message =
      job.mode === "video" ? "正在准备 Seedance 2.0 请求" : "正在上传素材到 ComfyUI";
    job.progress = {
      label: "准备素材",
      current: 0,
      total: 1,
      percent: 1,
      rate: "",
    };
    job.updatedAt = new Date().toISOString();
    try {
      const generation = await createGeneration(
        { ...body, __jobId: job.id },
        db,
        user,
      );
      if (job.status === "cancelled") {
        user.credits += cost;
        await writeDb(db);
        return;
      }
      db.generations.unshift(generation);
      await writeDb(db);
      job.status = "completed";
      job.message = "生成完成";
      job.progress = {
        label: "生成完成",
        current: 1,
        total: 1,
        percent: 100,
        rate: "",
      };
      job.generation = generation;
      job.updatedAt = new Date().toISOString();
      await upsertPostgresItems("generationJobs", job);
    } catch (error) {
      user.credits += cost;
      job.refunded = true;
      await writeDb(db);
      job.status = "failed";
      job.error = error.message;
      job.message = `生成失败：${error.message}`;
      job.updatedAt = new Date().toISOString();
      await upsertPostgresItems("generationJobs", job);
    }
  }, 0);

  return job;
}

async function resumePersistedGenerationJob(job, db) {
  if (!job || !["queued", "running"].includes(job.status)) return;
  const user = db.users.find((item) => item.id === job.userId);
  if (!user) return;
  if (
    job.mode !== "video" ||
    !job.promptId ||
    !["ark", "volcengine"].includes(SEEDANCE_PROVIDER)
  ) {
    if (!job.refunded) {
      user.credits += Number(job.cost || 0);
      job.refunded = true;
    }
    job.status = "failed";
    job.error = "服务重启前任务尚未取得可恢复的上游任务 ID";
    job.message = `生成失败：${job.error}`;
    job.updatedAt = new Date().toISOString();
    await writeDb(db);
    await upsertPostgresItems("generationJobs", job);
    return;
  }

  job.status = "running";
  job.message = "正在恢复 Seedance 2.0 任务";
  job.updatedAt = new Date().toISOString();
  await upsertPostgresItems("generationJobs", job);
  try {
    const result = await waitForArkSeedanceVideo(job.promptId, job.id);
    if (!result.videoUrl) {
      setTimeout(() => {
        resumePersistedGenerationJob(job, db).catch((error) =>
          console.error(`Generation job resume failed: ${error.message}`),
        );
      }, 60_000);
      return;
    }
    const videoUrl = await persistRemoteVideoOutput(result.videoUrl, job.id);
    const lastFrameUrl = await persistRemoteLastFrameOutput(
      result.lastFrameUrl || "",
      job.id,
    );
    const body = job.body || { mode: job.mode };
    const model =
      db.models.find((item) => item.id === body.modelId) ||
      db.models.find((item) => item.category === "video") ||
      fallbackGenerationModel("video");
    const referenceAssets = Array.isArray(body.referenceAssets)
      ? safeJsonClone(body.referenceAssets, [])
      : [];
    const generation =
      db.generations.find((item) => item.taskId === job.promptId) ||
      buildGenerationRecord({
        body,
        user,
        model,
        referenceAssets,
        output: {
          image: videoUrl,
          videoUrl,
          lastFrameUrl,
          taskId: job.promptId,
          provider: "ark",
          engine: SEEDANCE_MODEL,
          referenceInputSupported: Boolean(referenceAssets.length),
          referenceWarning: "",
          usage: result.payload?.usage || null,
        },
      });
    if (!db.generations.some((item) => item.id === generation.id)) {
      db.generations.unshift(generation);
    }
    job.status = "completed";
    job.message = "生成完成";
    job.progress = {
      label: "生成完成",
      current: 1,
      total: 1,
      percent: 100,
      rate: "",
    };
    job.generation = generation;
    job.updatedAt = new Date().toISOString();
    await writeDb(db);
    await upsertPostgresItems("generationJobs", job);
  } catch (error) {
    if (!job.refunded) {
      user.credits += Number(job.cost || 0);
      job.refunded = true;
    }
    job.status = "failed";
    job.error = error.message;
    job.message = `生成失败：${error.message}`;
    job.updatedAt = new Date().toISOString();
    await writeDb(db);
    await upsertPostgresItems("generationJobs", job);
  }
}

function resumePersistedGenerationJobs(db) {
  for (const job of db.generationJobs || []) {
    if (!["queued", "running"].includes(job?.status)) continue;
    generationJobs.set(job.id, job);
    setTimeout(() => {
      resumePersistedGenerationJob(job, db).catch((error) =>
        console.error(`Generation job resume failed: ${error.message}`),
      );
    }, 0);
  }
}

function createOrder(plan, user, method, provider = method) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    orderNo: `MH${Date.now()}${Math.floor(Math.random() * 900 + 100)}`,
    userId: user.id,
    planId: plan.id,
    planName: plan.name,
    amount: plan.price,
    currency: PAYMENT_CURRENCY.toUpperCase(),
    credits: plan.credits,
    method,
    provider,
    status: "pending",
    checkoutUrl: "",
    providerSessionId: "",
    providerPaymentId: "",
    paidAt: "",
    creditedAt: "",
    createdAt: now,
    updatedAt: now,
  };
}

function paymentReturnUrl(req, pathName) {
  const publicBaseUrl = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (publicBaseUrl) return `${publicBaseUrl}${pathName}`;
  return absoluteUrl(req, pathName);
}

function paymentProviderEnabled(method) {
  const providers = PAYMENT_PROVIDER.split(/[,;\s]+/).filter(Boolean);
  return providers.includes(method);
}

async function createStripeCheckoutSession(req, order, user) {
  if (!STRIPE_SECRET_KEY) {
    throw new Error("缺少 STRIPE_SECRET_KEY，无法创建真实支付订单");
  }
  const amount = Math.round(Number(order.amount || 0) * 100);
  if (!Number.isFinite(amount) || amount <= 0)
    throw new Error("订单金额必须大于 0");
  const fields = {
    mode: "payment",
    success_url: paymentReturnUrl(
      req,
      `/#/pricing?payment=success&order=${encodeURIComponent(order.id)}`,
    ),
    cancel_url: paymentReturnUrl(
      req,
      `/#/pricing?payment=cancel&order=${encodeURIComponent(order.id)}`,
    ),
    client_reference_id: order.id,
    "customer_email": user.email || "",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": PAYMENT_CURRENCY,
    "line_items[0][price_data][unit_amount]": String(amount),
    "line_items[0][price_data][product_data][name]": `${order.planName} 算力点`,
    "line_items[0][price_data][product_data][description]": `${order.credits} 算力点充值`,
    "metadata[orderId]": order.id,
    "metadata[orderNo]": order.orderNo,
    "metadata[userId]": user.id,
    "metadata[planId]": order.planId,
  };
  const response = await requestFormJsonDirect(
    "https://api.stripe.com/v1/checkout/sessions",
    fields,
    { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  );
  if (!response.ok) {
    const message =
      response.json?.error?.message ||
      response.text ||
      `Stripe Checkout 创建失败：HTTP ${response.status}`;
    throw new Error(message);
  }
  order.providerSessionId = response.json.id;
  order.checkoutUrl = response.json.url || "";
  order.updatedAt = new Date().toISOString();
  if (!order.checkoutUrl) throw new Error("Stripe 未返回支付链接");
  return response.json;
}

function alipayTimestamp() {
  return new Date()
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "");
}

function alipaySignParams(params) {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== "" && key !== "sign")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
}

function rsaPrivateSign(content, privateKey) {
  return crypto.createSign("RSA-SHA256").update(content, "utf8").sign(privateKey, "base64");
}

function rsaPublicVerify(content, signature, publicKey) {
  return crypto
    .createVerify("RSA-SHA256")
    .update(content, "utf8")
    .verify(publicKey, signature, "base64");
}

function alipayConfigIssues() {
  const issues = [];
  if (!ALIPAY_APP_ID) {
    issues.push("缺少 ALIPAY_APP_ID");
  } else if (
    !/^\d{10,32}$/.test(ALIPAY_APP_ID) ||
    /BEGIN|PRIVATE KEY|PUBLIC KEY|MII[A-Za-z0-9+/=]{20}/.test(ALIPAY_APP_ID)
  ) {
    issues.push("ALIPAY_APP_ID 格式不对，应填写支付宝开放平台应用 App ID，不是密钥内容");
  }
  if (!ALIPAY_PRIVATE_KEY) {
    issues.push("缺少 ALIPAY_PRIVATE_KEY");
  } else if (!/-----BEGIN (RSA )?PRIVATE KEY-----/.test(ALIPAY_PRIVATE_KEY)) {
    issues.push("ALIPAY_PRIVATE_KEY 格式不对，应填写应用私钥");
  } else {
    try {
      crypto.createPrivateKey(ALIPAY_PRIVATE_KEY);
    } catch {
      issues.push("ALIPAY_PRIVATE_KEY 无法解析，请检查是否混入 App ID 或复制了错误的应用私钥");
    }
  }
  if (!ALIPAY_PUBLIC_KEY) {
    issues.push("缺少 ALIPAY_PUBLIC_KEY");
  } else if (!/-----BEGIN PUBLIC KEY-----/.test(ALIPAY_PUBLIC_KEY)) {
    issues.push("ALIPAY_PUBLIC_KEY 格式不对，应填写支付宝公钥");
  } else {
    try {
      crypto.createPublicKey(ALIPAY_PUBLIC_KEY);
    } catch {
      issues.push("ALIPAY_PUBLIC_KEY 无法解析，请检查是否填写支付宝公钥而不是应用公钥");
    }
  }
  return issues;
}

function createAlipayPagePay(req, order) {
  const configIssues = alipayConfigIssues();
  if (configIssues.length)
    throw new Error(`支付宝配置无效：${configIssues.join("；")}`);
  const params = {
    app_id: ALIPAY_APP_ID,
    method: "alipay.trade.page.pay",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: alipayTimestamp(),
    version: "1.0",
    notify_url: paymentReturnUrl(req, "/api/payments/alipay/notify"),
    return_url: paymentReturnUrl(
      req,
      `/#/pricing?payment=return&order=${encodeURIComponent(order.id)}`,
    ),
    biz_content: JSON.stringify({
      out_trade_no: order.orderNo,
      product_code: "FAST_INSTANT_TRADE_PAY",
      total_amount: Number(order.amount).toFixed(2),
      subject: `${order.planName} 算力点`,
      body: `${order.credits} 算力点充值`,
      passback_params: order.id,
    }),
  };
  params.sign = rsaPrivateSign(alipaySignParams(params), ALIPAY_PRIVATE_KEY);
  order.checkoutUrl = `${ALIPAY_GATEWAY}?${new URLSearchParams(params).toString()}`;
  order.updatedAt = new Date().toISOString();
  return { checkoutUrl: order.checkoutUrl };
}

function verifyAlipayNotify(params) {
  if (!ALIPAY_PUBLIC_KEY) throw new Error("缺少 ALIPAY_PUBLIC_KEY，无法验证支付宝通知");
  const signature = params.sign || "";
  if (!signature) throw new Error("支付宝通知缺少 sign");
  const content = alipaySignParams(params);
  if (!rsaPublicVerify(content, signature, ALIPAY_PUBLIC_KEY))
    throw new Error("支付宝通知验签失败");
  return true;
}

function wechatPayPrivateKey() {
  if (WECHAT_PAY_PRIVATE_KEY) return WECHAT_PAY_PRIVATE_KEY;
  const keyPath = (process.env.WECHAT_PAY_PRIVATE_KEY_PATH || "").trim();
  if (keyPath && fsNative.existsSync(keyPath)) {
    return fsNative.readFileSync(keyPath, "utf8");
  }
  return "";
}

function wechatAuthorization(method, pathname, body) {
  const privateKey = wechatPayPrivateKey();
  if (
    !WECHAT_PAY_APP_ID ||
    !WECHAT_PAY_MCH_ID ||
    !WECHAT_PAY_MCH_SERIAL_NO ||
    !privateKey
  ) {
    throw new Error(
      "缺少微信支付商户配置：WECHAT_PAY_APP_ID / WECHAT_PAY_MCH_ID / WECHAT_PAY_MCH_SERIAL_NO / WECHAT_PAY_PRIVATE_KEY",
    );
  }
  const nonce = crypto.randomBytes(16).toString("hex");
  const timestamp = String(Math.floor(Date.now() / 1000));
  const message = `${method}\n${pathname}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = rsaPrivateSign(message, privateKey);
  return `WECHATPAY2-SHA256-RSA2048 mchid="${WECHAT_PAY_MCH_ID}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${WECHAT_PAY_MCH_SERIAL_NO}",signature="${signature}"`;
}

async function createWechatNativePayment(req, order) {
  const pathname = "/v3/pay/transactions/native";
  const payload = {
    appid: WECHAT_PAY_APP_ID,
    mchid: WECHAT_PAY_MCH_ID,
    description: `${order.planName} 算力点`,
    out_trade_no: order.orderNo,
    notify_url: paymentReturnUrl(req, "/api/payments/wechat/notify"),
    amount: {
      total: Math.round(Number(order.amount || 0) * 100),
      currency: "CNY",
    },
    attach: order.id,
  };
  const body = JSON.stringify(payload);
  const response = await requestJsonBodyDirect(
    `https://api.mch.weixin.qq.com${pathname}`,
    body,
    {
      Authorization: wechatAuthorization("POST", pathname, body),
      Accept: "application/json",
    },
  );
  if (!response.ok) {
    const message =
      response.json?.message ||
      response.json?.code ||
      response.text ||
      `微信支付下单失败：HTTP ${response.status}`;
    throw new Error(message);
  }
  order.qrText = response.json.code_url || "";
  if (!order.qrText) throw new Error("微信支付未返回 code_url");
  order.qrImage = await QRCode.toDataURL(order.qrText, { margin: 1, width: 240 });
  order.updatedAt = new Date().toISOString();
  return { qrText: order.qrText, qrImage: order.qrImage };
}

function verifyWechatNotifySignature(req, rawBody) {
  if (!WECHAT_PAY_PLATFORM_CERT_PEM) {
    throw new Error("缺少 WECHAT_PAY_PLATFORM_CERT_PEM，无法验证微信支付通知");
  }
  const timestamp = req.headers["wechatpay-timestamp"];
  const nonce = req.headers["wechatpay-nonce"];
  const signature = req.headers["wechatpay-signature"];
  if (!timestamp || !nonce || !signature)
    throw new Error("微信支付通知缺少签名头");
  const message = `${timestamp}\n${nonce}\n${rawBody.toString("utf8")}\n`;
  if (!rsaPublicVerify(message, signature, WECHAT_PAY_PLATFORM_CERT_PEM))
    throw new Error("微信支付通知验签失败");
  return true;
}

function decryptWechatResource(resource) {
  if (!WECHAT_PAY_API_V3_KEY) throw new Error("缺少 WECHAT_PAY_API_V3_KEY，无法解密微信通知");
  const key = Buffer.from(WECHAT_PAY_API_V3_KEY, "utf8");
  const nonce = Buffer.from(resource.nonce || "", "utf8");
  const ciphertext = Buffer.from(resource.ciphertext || "", "base64");
  const associatedData = Buffer.from(resource.associated_data || "", "utf8");
  const authTag = ciphertext.slice(ciphertext.length - 16);
  const encrypted = ciphertext.slice(0, ciphertext.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(authTag);
  decipher.setAAD(associatedData);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}

function parseStripeSignature(signatureHeader) {
  const parts = String(signatureHeader || "").split(",");
  const result = { signatures: [] };
  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key === "t") result.timestamp = value;
    if (key === "v1") result.signatures.push(value);
  }
  return result;
}

function verifyStripeWebhook(rawBody, signatureHeader) {
  if (!STRIPE_WEBHOOK_SECRET) {
    throw new Error("缺少 STRIPE_WEBHOOK_SECRET，无法验签 Stripe Webhook");
  }
  const parsed = parseStripeSignature(signatureHeader);
  if (!parsed.timestamp || !parsed.signatures.length)
    throw new Error("Stripe Webhook 签名格式无效");
  const signedPayload = `${parsed.timestamp}.${rawBody.toString("utf8")}`;
  const expected = crypto
    .createHmac("sha256", STRIPE_WEBHOOK_SECRET)
    .update(signedPayload)
    .digest("hex");
  const valid = parsed.signatures.some((signature) => {
    const left = Buffer.from(signature, "hex");
    const right = Buffer.from(expected, "hex");
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  });
  if (!valid) throw new Error("Stripe Webhook 签名验证失败");
  return JSON.parse(rawBody.toString("utf8"));
}

function applyPaidOrder(db, order, payment = {}) {
  if (!order) throw new Error("订单不存在");
  if (order.status === "paid" && order.creditedAt) return { credited: false };
  const user = db.users.find((item) => item.id === order.userId);
  if (!user) throw new Error("订单用户不存在");
  const { wallet } = ensureUserInfrastructure(db, user);
  const now = new Date().toISOString();
  order.status = "paid";
  order.providerPaymentId =
    payment.payment_intent || payment.paymentIntent || order.providerPaymentId || "";
  order.paidAt = order.paidAt || now;
  order.creditedAt = order.creditedAt || now;
  order.updatedAt = now;
  user.credits = Number(user.credits || 0) + Number(order.credits || 0);
  user.plan = order.planName || user.plan;
  wallet.balance = Number(wallet.balance || 0) + Number(order.amount || 0);
  wallet.updatedAt = now;
  return { credited: true, user, wallet };
}

function absoluteUrl(req, pathname) {
  if (/^https?:\/\//i.test(pathname)) return pathname;
  const proto = req.headers["x-forwarded-proto"] || "http";
  return `${proto}://${req.headers.host}${pathname}`;
}

async function handleExternalApi(req, res, url) {
  const db = await readDb();
  ensureCollections(db);

  if (req.method === "GET" && url.pathname === "/v1/quota") {
    const apiKey = requirePlatformApiKey(req, res, db, "billing:read");
    if (!apiKey) return;
    sendJson(res, 200, {
      object: "quota",
      apiKey: publicApiKey(apiKey),
      quota: quotaSummary(apiKey),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/models") {
    const apiKey = requirePlatformApiKey(
      req,
      res,
      db,
      "models:read",
      "models:list",
    );
    if (!apiKey) return;
    consumeApiQuota(apiKey, "models:list");
    await writeDb(db);
    const textModels = (API_CAPABILITIES.text.models || []).map((model) => ({
      id: model.id,
      object: "model",
      name: model.label,
      category: "text",
      provider: model.provider,
      capabilities: model.capabilities?.modes || ["text-to-text"],
    }));
    const relayModels = apiRelayModelDefinitions().map((model) => ({
      id: model.id,
      object: "model",
      name: model.id,
      category: "text",
      provider: "relay",
      channel: model.channelName,
      capabilities: model.capabilities,
    }));
    const modelData = [
      ...textModels,
      ...relayModels,
      ...db.models.map((model) => ({
        id: model.id,
        object: "model",
        name: model.title,
        category: model.category,
        provider: "community",
        capabilities: model.category === "video" ? ["video"] : ["image"],
      })),
    ];
    sendJson(res, 200, {
      object: "list",
      data: modelData,
      quota: quotaSummary(apiKey).endpoints["models:list"],
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/image-models") {
    const apiKey = requirePlatformApiKey(
      req,
      res,
      db,
      "models:read",
      "models:list",
    );
    if (!apiKey) return;
    consumeApiQuota(apiKey, "models:list");
    await writeDb(db);
    sendJson(res, 200, {
      object: "list",
      data: IMAGE_MODEL_REGISTRY.map((model) => ({
        id: model.id,
        object: "image_model",
        provider: model.provider,
        name: model.label,
        description: model.description,
        requiresKey: model.requiresKey,
        sizes: model.sizes,
        qualities: model.qualities,
        capabilities: model.capabilities,
      })),
      quota: quotaSummary(apiKey).endpoints["models:list"],
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/images/generations") {
    const apiKey = requirePlatformApiKey(
      req,
      res,
      db,
      "images:create",
      "images:generations",
    );
    if (!apiKey) return;

    const body = await readBody(req);
    if (!body) return sendError(res, 400, "请求体必须是合法 JSON");
    if (!String(body.prompt || "").trim())
      return sendError(res, 422, "prompt 不能为空");
    const imageModel =
      body.model || body.imageModel || "openai:gpt-image-2";

    let output;
    try {
      output = await callImageGeneration(
        {
          ...body,
          imageModel,
          size: normalizeImageSize(body.size),
          quality: normalizeImageQuality(body.quality),
        },
        "External API",
      );
    } catch (error) {
      return sendError(
        res,
        process.env.OPENAI_API_KEY ? 502 : 503,
        error.message,
      );
    }

    consumeApiQuota(apiKey, "images:generations");
    db.generations.unshift({
      id: crypto.randomUUID(),
      userId: apiKey.userId,
      workspaceId: apiKey.workspaceId,
      apiKeyId: apiKey.id,
      prompt: String(body.prompt || "").trim(),
      mode: "image",
      modelId: body.modelId || null,
      modelName: "External API",
      strength: Number(body.strength || 72),
      size: normalizeImageSize(body.size),
      quality: normalizeImageQuality(body.quality),
      image: output.image,
      provider: output.provider,
      engine: output.engine,
      usage: output.usage,
      status: "completed",
      source: "platform-api",
      createdAt: new Date().toISOString(),
    });
    await writeDb(db);

    sendJson(res, 200, {
      id: crypto.randomUUID(),
      object: "image.generation",
      created: Math.floor(Date.now() / 1000),
      model: output.engine,
      data: [
        {
          url: absoluteUrl(req, output.image),
        },
      ],
      usage: output.usage,
      quota: {
        ...quotaSummary(apiKey).endpoints["images:generations"],
        all: quotaSummary(apiKey),
      },
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    const apiKey = requirePlatformApiKey(
      req,
      res,
      db,
      "chat:create",
      "chat:completions",
    );
    if (!apiKey) return;
    const body = await readBody(req);
    if (!body) return sendError(res, 400, "请求体必须是合法 JSON");
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastUserMessage = chatMessageText(
      [...messages].reverse().find((item) => item.role === "user")?.content ||
        "",
    );
    if (!String(lastUserMessage).trim())
      return sendError(res, 422, "messages 中至少需要一条 user 消息");
    const model = body.model || "dreamehub-free-chat";
    if (body.stream === true) {
      return sendError(
        res,
        422,
        "当前 API 中转仅支持非流式请求，请设置 stream=false",
      );
    }
    if (apiRelayHasModel(model, "chat")) {
      try {
        const output = await requestConfiguredApiRelay(
          "chat/completions",
          "chat",
          body,
        );
        consumeApiQuota(apiKey, "chat:completions");
        await writeDb(db);
        res.setHeader("X-DreameHub-Relay-Channel", output.channel.id);
        sendJson(res, 200, {
          ...output.payload,
          model,
          quota: quotaSummary(apiKey).endpoints["chat:completions"],
        });
      } catch (error) {
        sendError(res, 502, error.message);
      }
      return;
    }
    let responseId = `chatcmpl_${crypto.randomUUID()}`;
    let responseModel = model;
    let content = "";
    let usage = null;
    try {
      if (isLocalTextModel(model)) {
        const output = await callLocalChatCompletion({
          ...body,
          model,
        });
        responseId = output.id;
        responseModel = output.model;
        content = output.content;
        usage = output.usage;
      } else if (
        model === "openai-chat" ||
        String(model).startsWith("openai:")
      ) {
        const output = await callOpenAIChatCompletion(body);
        responseId = output.id;
        responseModel = output.model;
        content = output.content;
        usage = output.usage;
      } else {
        const output = await callPollinationsChatCompletion(body);
        responseId = output.id;
        responseModel = output.model;
        content = output.content;
        usage = output.usage;
      }
    } catch (error) {
      return sendError(
        res,
        String(model).includes("openai") && !process.env.OPENAI_API_KEY
          ? 503
          : 502,
        error.message,
      );
    }
    consumeApiQuota(apiKey, "chat:completions");
    await writeDb(db);
    sendJson(res, 200, {
      id: responseId,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: responseModel,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content,
          },
          finish_reason: "stop",
        },
      ],
      usage,
      quota: quotaSummary(apiKey).endpoints["chat:completions"],
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/responses") {
    const apiKey = requirePlatformApiKey(
      req,
      res,
      db,
      "chat:create",
      "responses:create",
    );
    if (!apiKey) return;
    const body = await readBody(req);
    if (!body) return sendError(res, 400, "请求体必须是合法 JSON");
    if (!String(body.model || "").trim())
      return sendError(res, 422, "model 不能为空");
    if (body.stream === true) {
      return sendError(
        res,
        422,
        "当前 API 中转仅支持非流式请求，请设置 stream=false",
      );
    }
    if (!apiRelayHasModel(body.model, "responses")) {
      return sendError(res, 404, `模型 ${body.model} 未配置 Responses 中转渠道`);
    }
    try {
      const output = await requestConfiguredApiRelay(
        "responses",
        "responses",
        body,
      );
      consumeApiQuota(apiKey, "responses:create");
      await writeDb(db);
      res.setHeader("X-DreameHub-Relay-Channel", output.channel.id);
      sendJson(res, 200, {
        ...output.payload,
        model: body.model,
        quota: quotaSummary(apiKey).endpoints["responses:create"],
      });
    } catch (error) {
      sendError(res, 502, error.message);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/embeddings") {
    const apiKey = requirePlatformApiKey(
      req,
      res,
      db,
      "chat:create",
      "embeddings:create",
    );
    if (!apiKey) return;
    const body = await readBody(req);
    if (!body) return sendError(res, 400, "请求体必须是合法 JSON");
    if (!String(body.model || "").trim())
      return sendError(res, 422, "model 不能为空");
    if (body.input === undefined || body.input === null)
      return sendError(res, 422, "input 不能为空");
    if (!apiRelayHasModel(body.model, "embeddings")) {
      return sendError(res, 404, `模型 ${body.model} 未配置 Embeddings 中转渠道`);
    }
    try {
      const output = await requestConfiguredApiRelay(
        "embeddings",
        "embeddings",
        body,
      );
      consumeApiQuota(apiKey, "embeddings:create");
      await writeDb(db);
      res.setHeader("X-DreameHub-Relay-Channel", output.channel.id);
      sendJson(res, 200, {
        ...output.payload,
        model: body.model,
        quota: quotaSummary(apiKey).endpoints["embeddings:create"],
      });
    } catch (error) {
      sendError(res, 502, error.message);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/workflows/run") {
    const apiKey = requirePlatformApiKey(
      req,
      res,
      db,
      "workflows:run",
      "workflows:run",
    );
    if (!apiKey) return;
    const body = await readBody(req);
    if (!body) return sendError(res, 400, "请求体必须是合法 JSON");
    const workflow =
      db.workflows.find((item) => item.id === body.workflowId) ||
      db.workflows[0];
    consumeApiQuota(apiKey, "workflows:run");
    await writeDb(db);
    sendJson(res, 200, {
      id: `wfrun_${crypto.randomUUID()}`,
      object: "workflow.run",
      workflow: {
        id: workflow.id,
        title: workflow.title,
        nodes: workflow.nodes,
        activeNode: workflow.activeNode,
      },
      input: body.input || {},
      status: "completed",
      output: {
        summary: `${workflow.title} 已完成模拟运行`,
        nextAction: "可将该接口接入真实工作流执行器",
      },
      quota: quotaSummary(apiKey).endpoints["workflows:run"],
    });
    return;
  }

  sendError(res, 404, "External API route not found");
}

async function handleApi(req, res, url) {
  const db = await readDb();
  ensureCollections(db);

  if (
    req.method === "POST" &&
    url.pathname === "/api/payments/stripe/webhook"
  ) {
    let event;
    try {
      const rawBody = await readRawBody(req);
      event = verifyStripeWebhook(rawBody, req.headers["stripe-signature"]);
    } catch (error) {
      return sendError(res, 400, error.message);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data?.object || {};
      const orderId = session.metadata?.orderId || session.client_reference_id;
      const order = db.orders.find(
        (item) =>
          item.id === orderId ||
          item.providerSessionId === session.id ||
          item.orderNo === session.metadata?.orderNo,
      );
      if (!order) return sendError(res, 404, "支付订单不存在");
      try {
        applyPaidOrder(db, order, session);
        await writeDb(db);
      } catch (error) {
        return sendError(res, 422, error.message);
      }
    }

    sendJson(res, 200, { received: true });
    return;
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/payments/alipay/notify"
  ) {
    try {
      const params = await readFormBody(req);
      verifyAlipayNotify(params);
      if (["TRADE_SUCCESS", "TRADE_FINISHED"].includes(params.trade_status)) {
        const order = db.orders.find((item) => item.orderNo === params.out_trade_no);
        if (!order) {
          res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("failure");
          return;
        }
        if (Math.abs(Number(params.total_amount || 0) - Number(order.amount || 0)) > 0.01) {
          throw new Error("支付宝通知金额与订单不一致");
        }
        applyPaidOrder(db, order, {
          payment_intent: params.trade_no,
          channel: "alipay",
        });
        order.provider = "alipay";
        await writeDb(db);
      }
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("success");
    } catch (error) {
      console.error(error);
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("failure");
    }
    return;
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/payments/wechat/notify"
  ) {
    try {
      const rawBody = await readRawBody(req);
      verifyWechatNotifySignature(req, rawBody);
      const event = JSON.parse(rawBody.toString("utf8"));
      const transaction = decryptWechatResource(event.resource || {});
      if (transaction.trade_state === "SUCCESS") {
        const order = db.orders.find(
          (item) => item.orderNo === transaction.out_trade_no,
        );
        if (!order) throw new Error("微信支付订单不存在");
        const paidAmount = Number(transaction.amount?.total || 0);
        const expectedAmount = Math.round(Number(order.amount || 0) * 100);
        if (paidAmount !== expectedAmount) throw new Error("微信支付通知金额与订单不一致");
        applyPaidOrder(db, order, {
          payment_intent: transaction.transaction_id,
          channel: "wechat",
        });
        order.provider = "wechat";
        await writeDb(db);
      }
      sendJson(res, 200, { code: "SUCCESS", message: "成功" });
    } catch (error) {
      console.error(error);
      sendJson(res, 500, { code: "FAIL", message: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/api-relay") {
    const user = currentUser(req, db);
    let apiKeys = [];
    if (user) {
      const { workspace } = ensureUserInfrastructure(db, user);
      apiKeys = db.apiKeys
        .filter((item) => item.workspaceId === workspace.id)
        .map((item) => publicApiKey(item, { includeSecret: true }));
    }
    const channels = publicApiRelayChannels();
    const models = publicApiRelayModels();
    sendJson(res, 200, {
      baseUrl: absoluteUrl(req, "/v1"),
      compatibility: "OpenAI-compatible",
      streaming: false,
      retryCount: API_RELAY_MAX_RETRIES,
      channelCount: channels.length,
      modelCount: models.filter((model) => model.available).length,
      channels,
      models,
      endpoints: [
        {
          method: "GET",
          path: "/v1/models",
          capability: "models",
        },
        {
          method: "POST",
          path: "/v1/chat/completions",
          capability: "chat",
        },
        {
          method: "POST",
          path: "/v1/responses",
          capability: "responses",
        },
        {
          method: "POST",
          path: "/v1/embeddings",
          capability: "embeddings",
        },
        {
          method: "POST",
          path: "/v1/images/generations",
          capability: "images",
        },
      ],
      apiKeys,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    const user = currentUser(req, db);
    if (user) {
      const infrastructure = ensureUserInfrastructure(db, user);
      if (infrastructure.created) await writeDb(db);
    }
    sendJson(res, 200, {
      stats: db.stats,
      user: publicUser(user),
      models: db.models,
      imageModels: IMAGE_MODEL_REGISTRY,
      capabilities: API_CAPABILITIES,
      workflows: db.workflows,
    });
    return;
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/auth/verification/start"
  ) {
    const body = await readBody(req);
    if (!body) return sendError(res, 400, "请求体必须是合法 JSON");

    if (body.channel === "phone")
      return sendError(res, 410, "手机验证入口已关闭，请使用邮箱验证");
    const channel = "email";
    const target = String(body.email || body.target || "")
      .trim()
      .toLowerCase();

    if (!target) return sendError(res, 422, "邮箱不能为空");
    if (!validEmail(target)) return sendError(res, 422, "邮箱格式不正确");
    if (emailOwnedByAnotherUser(db, target)) {
      return sendError(res, 409, "该邮箱已注册，请直接登录");
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    let delivery;
    try {
      delivery = await sendVerificationCode(channel, target, code);
    } catch (error) {
      return sendError(res, 503, error.message);
    }

    const verification = {
      id: crypto.randomUUID(),
      channel,
      target,
      code,
      status: "pending",
      attempts: 0,
      provider: delivery.provider,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
    };
    db.verificationRequests.unshift(verification);
    await writeDb(db);
    const response = {
      verificationId: verification.id,
      expiresAt: verification.expiresAt,
      provider: delivery.provider,
      message: "邮箱验证码已发送",
    };
    if (delivery.devCode) response.devCode = delivery.devCode;
    sendJson(res, 201, response);
    return;
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/auth/verification/confirm"
  ) {
    const body = await readBody(req);
    if (!body) return sendError(res, 400, "请求体必须是合法 JSON");

    const verification = db.verificationRequests.find(
      (item) => item.id === body.verificationId,
    );
    if (!verification) return sendError(res, 404, "验证请求不存在");
    if (verification.status !== "pending")
      return sendError(res, 409, "该验证请求已处理");
    if (new Date(verification.expiresAt).getTime() < Date.now()) {
      verification.status = "expired";
      await writeDb(db);
      return sendError(res, 410, "验证码已过期");
    }

    verification.attempts += 1;
    if (String(body.code || "").trim() !== verification.code) {
      await writeDb(db);
      return sendError(res, 422, "验证码不正确");
    }

    verification.status = "verified";
    verification.verifiedAt = new Date().toISOString();
    verification.verificationToken = crypto.randomUUID();
    await writeDb(db);
    sendJson(res, 200, {
      verificationToken: verification.verificationToken,
      channel: verification.channel,
      target: verification.target,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readBody(req);
    if (!body) return sendError(res, 400, "请求体必须是合法 JSON");

    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    const user = db.users.find(
      (item) => normalizeEmail(item.email) === email,
    );
    if (!user) return sendError(res, 401, "邮箱或密码不正确");

    if (!verifyPassword(user, password))
      return sendError(res, 401, "Invalid email or password");

    if (needsPasswordUpgrade(user)) {
      upgradeUserPassword(user, password);
      await upsertDbItems("users", user);
    }

    const session = createSession(user);
    db.sessions.unshift(session);
    await upsertDbItems("sessions", session);
    sendJson(res, 200, { token: session.token, user: publicUser(user) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/register") {
    const body = await readBody(req);
    if (!body) return sendError(res, 400, "请求体必须是合法 JSON");

    const name = String(body.name || "").trim();
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    const verificationToken = String(body.verificationToken || "");
    const agreementAccepted = body.agreementAccepted === true ||
      body.agreementAccepted === "true";
    const agreementVersion = String(body.agreementVersion || "").trim();

    if (!name || !email || password.length < 6) {
      return sendError(res, 422, "请填写名称、邮箱和至少 6 位密码");
    }
    if (!agreementAccepted || agreementVersion !== "2026-06-18") {
      return sendError(res, 422, "请阅读并同意最新用户协议");
    }
    const verification = db.verificationRequests.find(
      (item) =>
        item.verificationToken === verificationToken &&
        item.status === "verified" &&
        item.channel === "email" &&
        item.target === email,
    );
    if (!verification) {
      return sendError(res, 403, "请先完成邮箱验证");
    }
    if (emailOwnedByAnotherUser(db, email)) {
      return sendError(res, 409, "该邮箱已注册");
    }

    const user = {
      id: crypto.randomUUID(),
      name,
      email,
      phone: "",
      passwordHash: hashPassword(password),
      passwordUpdatedAt: new Date().toISOString(),
      avatar: "会员中心",
      role: "creator",
      plan: "Free",
      credits: 0,
      agreementAcceptedAt: new Date().toISOString(),
      agreementVersion,
      createdAt: new Date().toISOString(),
    };
    const { workspace, wallet } = ensureUserInfrastructure(db, user);
    const session = createSession(user);
    verification.status = "consumed";
    verification.consumedAt = new Date().toISOString();
    db.users.push(user);
    db.sessions.unshift(session);
    await writeDb(db);
    sendJson(res, 201, {
      token: session.token,
      user: publicUser(user),
      workspace: publicWorkspace(workspace),
      wallet: publicWallet(wallet),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const user = currentUser(req, db);
    if (!user) return sendError(res, 401, "请先登录后使用创作功能");
    if (user) {
      ensureUserInfrastructure(db, user);
      await writeDb(db);
    }
    sendJson(res, 200, { user: publicUser(user) });
    return;
  }

  if (req.method === "PATCH" && url.pathname === "/api/auth/profile") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const body = await readBody(req);
    if (!body) return sendError(res, 400, "请求体必须是合法 JSON");
    const name = String(body.name || "").trim();
    const email = normalizeEmail(body.email);
    const currentPassword = String(body.currentPassword || "");
    if (!name || name.length > 80) {
      return sendError(res, 422, "昵称长度应为 1-80 个字符");
    }
    if (!validEmail(email)) return sendError(res, 422, "邮箱格式不正确");
    if (emailOwnedByAnotherUser(db, email, user.id)) {
      return sendError(res, 409, "该邮箱已被其他账户使用");
    }
    const emailChanged = email !== normalizeEmail(user.email);
    if (emailChanged && !verifyPassword(user, currentPassword)) {
      return sendError(res, 403, "修改邮箱需要输入当前密码");
    }
    user.name = name;
    user.email = email;
    user.profileUpdatedAt = new Date().toISOString();
    await upsertDbItems("users", user);
    sendJson(res, 200, { user: publicUser(user) });
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/auth/password") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const body = await readBody(req);
    if (!body) return sendError(res, 400, "请求体必须是合法 JSON");
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    if (!verifyPassword(user, currentPassword)) {
      return sendError(res, 403, "当前密码不正确");
    }
    if (newPassword.length < 8) {
      return sendError(res, 422, "新密码至少需要 8 位");
    }
    if (newPassword === currentPassword) {
      return sendError(res, 422, "新密码不能与当前密码相同");
    }
    user.passwordHash = hashPassword(newPassword);
    delete user.password;
    user.passwordUpdatedAt = new Date().toISOString();
    const currentToken = getToken(req);
    db.sessions = db.sessions.filter(
      (session) =>
        session.userId !== user.id || session.token === currentToken,
    );
    await writeDb(db);
    sendJson(res, 200, { ok: true, user: publicUser(user) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const token = getToken(req);
    db.sessions = db.sessions.filter((item) => item.token !== token);
    await writeDb(db);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/workspaces") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const { workspace } = ensureUserInfrastructure(db, user);
    await writeDb(db);
    sendJson(res, 200, {
      workspaces: [publicWorkspace(workspace)],
      current: publicWorkspace(workspace),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/wallet") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const { wallet } = ensureUserInfrastructure(db, user);
    await writeDb(db);
    sendJson(res, 200, { wallet: publicWallet(wallet) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/api-keys") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const { workspace } = ensureUserInfrastructure(db, user);
    const apiKeys = db.apiKeys
      .filter((item) => item.workspaceId === workspace.id)
      .map((item) => publicApiKey(item, { includeSecret: true }));
    await writeDb(db);
    sendJson(res, 200, { apiKeys });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/api-keys") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const body = await readBody(req);
    if (!body) return sendError(res, 400, "请求体必须是合法 JSON");

    const { workspace } = ensureUserInfrastructure(db, user);
    const name = String(body.name || "").trim();
    if (!name) return sendError(res, 422, "API Key 名称不能为空");
    const permissions = parsePermissions(body.permissions);

    const secret = `dh_live_${crypto.randomBytes(24).toString("base64url")}`;
    const freeQuota = parseFreeQuotas(body.freeQuota);
    const apiKey = {
      id: crypto.randomUUID(),
      userId: user.id,
      workspaceId: workspace.id,
      name,
      keyHash: hashSecret(secret),
      encryptedKey: encryptApiKeySecret(secret),
      maskedKey: maskApiKey(secret),
      permissions,
      quota: Math.max(
        0,
        Number(
          body.quota ||
            Object.values(freeQuota).reduce((sum, item) => sum + item, 0),
        ),
      ),
      used: 0,
      freeQuota,
      usage: Object.fromEntries(
        Object.keys(freeQuota).map((endpoint) => [endpoint, 0]),
      ),
      ipWhitelist: parseIpWhitelist(body.ipWhitelist),
      status: "active",
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };
    db.apiKeys.unshift(apiKey);
    await writeDb(db);
    sendJson(res, 201, {
      apiKey: publicApiKey(apiKey, { includeSecret: true }),
      secret,
    });
    return;
  }

  const apiKeyRevokeMatch = url.pathname.match(
    /^\/api\/api-keys\/([^/]+)\/revoke$/,
  );
  if (req.method === "POST" && apiKeyRevokeMatch) {
    const user = requireUser(req, res, db);
    if (!user) return;
    const { workspace } = ensureUserInfrastructure(db, user);
    const apiKey = db.apiKeys.find(
      (item) =>
        item.id === apiKeyRevokeMatch[1] && item.workspaceId === workspace.id,
    );
    if (!apiKey) return sendError(res, 404, "API Key 不存在");
    apiKey.status = "revoked";
    apiKey.revokedAt = new Date().toISOString();
    await writeDb(db);
    sendJson(res, 200, { apiKey: publicApiKey(apiKey) });
    return;
  }

  const apiKeyStatusMatch = url.pathname.match(
    /^\/api\/api-keys\/([^/]+)\/status$/,
  );
  if (req.method === "PATCH" && apiKeyStatusMatch) {
    const user = requireUser(req, res, db);
    if (!user) return;
    const body = await readBody(req);
    if (!body) return sendError(res, 400, "请求体必须是合法 JSON");
    const { workspace } = ensureUserInfrastructure(db, user);
    const apiKey = db.apiKeys.find(
      (item) =>
        item.id === apiKeyStatusMatch[1] && item.workspaceId === workspace.id,
    );
    if (!apiKey) return sendError(res, 404, "API Key 不存在");
    const status = String(body.status || "").trim();
    if (!["active", "disabled"].includes(status)) {
      return sendError(res, 422, "status 仅支持 active 或 disabled");
    }
    apiKey.status = status;
    apiKey.updatedAt = new Date().toISOString();
    if (status === "disabled") apiKey.disabledAt = apiKey.updatedAt;
    else delete apiKey.disabledAt;
    await writeDb(db);
    sendJson(res, 200, {
      apiKey: publicApiKey(apiKey, { includeSecret: true }),
    });
    return;
  }

  const apiKeyDeleteMatch = url.pathname.match(/^\/api\/api-keys\/([^/]+)$/);
  if (req.method === "DELETE" && apiKeyDeleteMatch) {
    const user = requireUser(req, res, db);
    if (!user) return;
    const { workspace } = ensureUserInfrastructure(db, user);
    const index = db.apiKeys.findIndex(
      (item) =>
        item.id === apiKeyDeleteMatch[1] && item.workspaceId === workspace.id,
    );
    if (index < 0) return sendError(res, 404, "API Key 不存在");
    const [deleted] = db.apiKeys.splice(index, 1);
    await writeDb(db);
    sendJson(res, 200, { deleted: true, id: deleted.id });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/models") {
    const category = url.searchParams.get("category");
    const models =
      category && category !== "all"
        ? db.models.filter((item) => item.category === category)
        : db.models;
    sendJson(res, 200, { models });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/image-models") {
    sendJson(res, 200, { imageModels: IMAGE_MODEL_REGISTRY });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/capabilities") {
    sendJson(res, 200, { capabilities: API_CAPABILITIES });
    return;
  }

  const modelMatch = url.pathname.match(/^\/api\/models\/([^/]+)$/);
  if (req.method === "GET" && modelMatch) {
    const model = db.models.find((item) => item.id === modelMatch[1]);
    if (!model) return sendError(res, 404, "模型不存在");
    sendJson(res, 200, { model });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/workflows") {
    sendJson(res, 200, { workflows: db.workflows });
    return;
  }

  const workflowMatch = url.pathname.match(/^\/api\/workflows\/([^/]+)$/);
  if (req.method === "GET" && workflowMatch) {
    const workflow = db.workflows.find((item) => item.id === workflowMatch[1]);
    if (!workflow) return sendError(res, 404, "工作流不存在");
    sendJson(res, 200, { workflow });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/community") {
    sendJson(res, 200, { works: db.communityWorks });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/commercial-video-agent") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const skill = await commercialSkillSpec();
    const requestedChatId = url.searchParams.get("chatId") || "";
    let chat =
      findCommercialVideoChat(db, user, requestedChatId) ||
      latestCommercialVideoChat(db, user);
    if (!chat) {
      chat = createCommercialVideoChat(user);
      chat.mode = chat.mode || "commercial_campaign";
      chat.stage = chat.stage || "marketing_brief";
      chat.artifacts ||= emptyCommercialArtifacts();
      chat.artifacts.modelOutputs ||= [];
      db.commercialVideoChats.unshift(chat);
      await upsertDbItems("commercialVideoChats", chat);
    }
    sendJson(res, 200, {
      chat: publicCommercialVideoChat(chat, skill),
      chats: commercialVideoChatsForUser(db, user).map(publicCommercialVideoChatSummary),
    });
    return;
  }

  const commercialVideoAgentMatch = url.pathname.match(
    /^\/api\/commercial-video-agent\/([^/]+)$/,
  );
  if (commercialVideoAgentMatch) {
    const user = requireUser(req, res, db);
    if (!user) return;
    const chatId = decodeURIComponent(commercialVideoAgentMatch[1]);
    const chatIndex = db.commercialVideoChats.findIndex(
      (item) => item.userId === user.id && item.id === chatId,
    );

    if (req.method === "DELETE") {
      if (chatIndex < 0) return sendError(res, 404, "对话记录不存在");
      const [removed] = db.commercialVideoChats.splice(chatIndex, 1);
      await writeDb(db);
      sendJson(res, 200, {
        ok: true,
        chat: publicCommercialVideoChatSummary(removed),
        chats: commercialVideoChatsForUser(db, user).map(publicCommercialVideoChatSummary),
      });
      return;
    }
  }

  if (req.method === "POST" && url.pathname === "/api/commercial-video-agent") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const body = (await readBody(req)) || {};
    const skill = await commercialSkillSpec();
    const requestedChatId = String(body.chatId || "").trim();
    let chat =
      findCommercialVideoChat(db, user, requestedChatId) ||
      latestCommercialVideoChat(db, user);
    if (!chat || body.reset) {
      chat = createCommercialVideoChat(user);
      chat.mode = "commercial_campaign";
      chat.stage = "marketing_brief";
      chat.artifacts = emptyCommercialArtifacts();
      db.commercialVideoChats = db.commercialVideoChats.filter(
        (item) => item.id !== chat.id,
      );
      db.commercialVideoChats.unshift(chat);
    }

    const attachments = await normalizeCommercialAttachments(body.attachments);
    const message = String(body.message || "").trim();
    const workflowInstruction = String(body.workflowInstruction || "").trim();
    const workflowStage = normalizeCommercialWorkflowStage(body.workflowStage);
    const effectiveMessage = commercialWorkflowChannelMessage({
      stage: workflowStage,
      instruction: workflowInstruction,
      message,
      attachments,
    });
    if (effectiveMessage) {
      chat.artifacts ||= emptyCommercialArtifacts();
      if (attachments.length) {
        chat.artifacts.referenceAssets ||= [];
        chat.artifacts.referenceAssets.unshift(...attachments);
        chat.artifacts.referenceAssets = chat.artifacts.referenceAssets.slice(0, 24);
      }
      chat.messages.push({
        role: "user",
        content: effectiveMessage,
        attachments,
        createdAt: new Date().toISOString(),
      });
      updateCommercialArtifacts(chat, effectiveMessage);
      chat.stage = workflowStage || nextCommercialStage(chat);
      try {
        chat = await runCommercialVideoAgent(chat, effectiveMessage, skill);
        if (workflowStage) chat.stage = workflowStage;
      } catch (error) {
        return sendError(res, process.env.OPENAI_API_KEY ? 502 : 503, error.message);
      }
    }

    await upsertDbItems("commercialVideoChats", chat);
    sendJson(res, 200, {
      chat: publicCommercialVideoChat(chat, skill),
      chats: commercialVideoChatsForUser(db, user).map(publicCommercialVideoChatSummary),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/commercial-video-chat") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const skill = await commercialSkillSpec();
    let chat = latestCommercialVideoChat(db, user);
    if (!chat) {
      chat = createCommercialVideoChat(user);
      db.commercialVideoChats.unshift(chat);
      await upsertDbItems("commercialVideoChats", chat);
    }
    sendJson(res, 200, { chat: publicCommercialVideoChat(chat, skill) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/commercial-video-chat") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const body = (await readBody(req)) || {};
    const skill = await commercialSkillSpec();

    let chat = latestCommercialVideoChat(db, user);
    if (!chat || body.reset) {
      chat = createCommercialVideoChat(user);
      db.commercialVideoChats = db.commercialVideoChats.filter(
        (item) => item.id !== chat.id,
      );
      db.commercialVideoChats.unshift(chat);
    }

    const message = String(body.message || "").trim();
    if (message) {
      const now = new Date().toISOString();
      chat.messages.push({ role: "user", content: message, createdAt: now });
      updateCommercialArtifacts(chat, message);
      chat.stage = nextCommercialStage(chat);
      const assistant = commercialAssistantText(chat, skill);
      chat.stage = nextCommercialStage(chat);
      chat.messages.push({
        role: "assistant",
        content: assistant,
        createdAt: new Date().toISOString(),
      });
      chat.updatedAt = new Date().toISOString();
    }

    await upsertDbItems("commercialVideoChats", chat);
    sendJson(res, 200, { chat: publicCommercialVideoChat(chat, skill) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/canvas-workflows") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const { workflows, created } = ensureUserCanvasWorkflows(db, user);
    if (created) await writeDb(db);
    sendJson(res, 200, { workflows: workflows.map(publicCanvasWorkflowSummary) }, req);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/canvas-workflows") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const body = (await readBody(req)) || {};
    const workflow = sanitizeCanvasWorkflowPayload(body, user, {});
    if (
      db.userWorkflows.some(
        (item) => item.userId === user.id && item.id === workflow.id,
      )
    ) {
      workflow.id = crypto.randomUUID();
    }
    db.userWorkflows.push(workflow);
    await writeDb(db);
    sendJson(res, 201, {
      workflow: publicCanvasWorkflow(workflow, { compactMedia: true }),
    }, req);
    return;
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/canvas-media/presign"
  ) {
    const user = requireUser(req, res, db);
    if (!user) return;
    const body = (await readBody(req)) || {};
    const fileName = String(body.fileName || "").trim();
    const mimeType = String(body.mimeType || "application/octet-stream")
      .split(";")[0]
      .trim();
    const size = Number(body.size || 0);
    if (!fileName || !Number.isFinite(size) || size <= 0) {
      return sendError(res, 422, "File name and size are required", req);
    }
    if (size > MAX_UPLOAD_BYTES) {
      return sendError(
        res,
        413,
        `File is too large. Max upload size is ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`,
        req,
      );
    }
    if (!ALLOWED_CANVAS_MEDIA_TYPES.has(mimeType)) {
      return sendError(res, 415, `Unsupported upload type: ${mimeType}`, req);
    }
    if (!r2Configured()) {
      sendJson(res, 200, { mode: "local" }, req);
      return;
    }
    const upload = await createR2Upload(user, { fileName, mimeType, size });
    sendJson(res, 201, { mode: "r2", upload }, req);
    return;
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/canvas-media/complete"
  ) {
    const user = requireUser(req, res, db);
    if (!user) return;
    if (!r2Configured()) {
      return sendError(res, 503, "R2 storage is not configured", req);
    }
    const body = (await readBody(req)) || {};
    const completed = await completeR2Upload(user, {
      key: String(body.key || ""),
      mimeType: String(body.mimeType || ""),
      size: Number(body.size || 0),
    });
    sendJson(res, 200, { ok: true, ...completed }, req);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/canvas-media") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const declaredLength = Number(req.headers["content-length"] || 0);
    if (declaredLength > MAX_UPLOAD_BYTES) {
      return sendError(
        res,
        413,
        `File is too large. Max upload size is ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`,
        req,
      );
    }
    const rawBody = await readRawBody(req, MAX_UPLOAD_BYTES);
    if (!rawBody.length) return sendError(res, 422, "上传文件为空", req);
    const contentType =
      String(req.headers["content-type"] || "application/octet-stream")
        .split(";")[0]
        .trim() || "application/octet-stream";
    if (rawBody.length > MAX_UPLOAD_BYTES) {
      return sendError(
        res,
        413,
        `File is too large. Max upload size is ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`,
        req,
      );
    }
    if (!ALLOWED_CANVAS_MEDIA_TYPES.has(contentType)) {
      return sendError(res, 415, `Unsupported upload type: ${contentType}`, req);
    }
    const fallbackExtension = contentType.startsWith("image/")
      ? ".jpg"
      : contentType.startsWith("video/")
        ? ".mp4"
        : contentType.startsWith("audio/")
          ? ".mp3"
          : ".bin";
    let urlPath;
    let storage = "local";
    if (r2Configured()) {
      const encodedName = String(
        req.headers["x-file-name"] || `upload${fallbackExtension}`,
      );
      let originalName = encodedName;
      try {
        originalName = decodeURIComponent(encodedName);
      } catch {}
      const key = r2ObjectKey(user, originalName, contentType);
      urlPath = await putR2Object(key, rawBody, contentType, {
        userId: user.id,
        kind: "canvas-server-upload",
      });
      storage = "r2";
    } else {
      urlPath = await saveGeneratedBinary(
        rawBody,
        contentType,
        fallbackExtension,
      );
    }
    sendJson(
      res,
      201,
      {
        ok: true,
        url: urlPath,
        source: urlPath,
        mimeType: contentType,
        size: rawBody.length,
        storage,
      },
      req,
    );
    return;
  }

  const canvasWorkflowPatchMatch = url.pathname.match(
    /^\/api\/canvas-workflows\/([^/]+)\/patch$/,
  );
  if (canvasWorkflowPatchMatch) {
    const user = requireUser(req, res, db);
    if (!user) return;
    if (!["PATCH", "POST"].includes(req.method))
      return sendError(res, 405, "Method not allowed", req);
    const workflowId = decodeURIComponent(canvasWorkflowPatchMatch[1]);
    const workflowIndex = db.userWorkflows.findIndex(
      (item) => item.userId === user.id && item.id === workflowId,
    );
    if (workflowIndex < 0) return sendError(res, 404, "工作流不存在", req);

    const body = (await readBody(req)) || {};
    const workflow = db.userWorkflows[workflowIndex];
    const now = new Date().toISOString();
    workflow.nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
    workflow.links = Array.isArray(workflow.links) ? workflow.links : [];

    const nodes = Array.isArray(body.nodes)
      ? safeJsonClone(body.nodes, []).map(compactCanvasNodeMedia)
      : [];
    const links = Array.isArray(body.links) ? safeJsonClone(body.links, []) : [];
    const removedNodeIds = new Set(
      (Array.isArray(body.removedNodeIds) ? body.removedNodeIds : [])
        .map((id) => String(id || ""))
        .filter(Boolean),
    );
    const removedNodes = workflow.nodes.filter((node) =>
      removedNodeIds.has(String(node?.id || "")),
    );
    const gcCandidates = collectR2ObjectKeys(removedNodes);

    if (removedNodeIds.size) {
      workflow.nodes = workflow.nodes.filter(
        (node) => !removedNodeIds.has(String(node?.id || "")),
      );
      workflow.links = workflow.links.filter(
        (link) =>
          !removedNodeIds.has(String(link?.from || "")) &&
          !removedNodeIds.has(String(link?.to || "")),
      );
    }

    for (const node of nodes) {
      if (!node || typeof node !== "object" || !node.id) continue;
      const index = workflow.nodes.findIndex((item) => item?.id === node.id);
      if (index >= 0) {
        workflow.nodes[index] = restoreExistingCanvasNodeMedia(
          [{ ...workflow.nodes[index], ...node }],
          workflow.nodes,
        )[0];
      } else {
        workflow.nodes.push(node);
      }
    }

    for (const link of links) {
      if (!link || typeof link !== "object" || !link.from || !link.to) continue;
      const exists = workflow.links.some(
        (item) =>
          (link.id && item.id === link.id) ||
          (item.from === link.from && item.to === link.to),
      );
      if (!exists) workflow.links.push(link);
    }

    workflow.updatedAt = now;
    await upsertDbItems("userWorkflows", workflow);
    const recycledObjects = await recycleUnreferencedR2Objects(
      db,
      gcCandidates,
    );
    sendJson(
      res,
      200,
      {
        ok: true,
        workflow: publicCanvasWorkflowSummary(workflow),
        nodeCount: workflow.nodes.length,
        linkCount: workflow.links.length,
        recycledObjects,
      },
      req,
    );
    return;
  }

  const canvasWorkflowMatch = url.pathname.match(
    /^\/api\/canvas-workflows\/([^/]+)$/,
  );
  if (canvasWorkflowMatch) {
    const user = requireUser(req, res, db);
    if (!user) return;
    const workflowId = decodeURIComponent(canvasWorkflowMatch[1]);
    const workflowIndex = db.userWorkflows.findIndex(
      (item) => item.userId === user.id && item.id === workflowId,
    );

    if (req.method === "GET") {
      if (workflowIndex < 0) return sendError(res, 404, "工作流不存在");
      sendJson(res, 200, {
        workflow: publicCanvasWorkflow(db.userWorkflows[workflowIndex], {
          compactMedia: true,
        }),
      }, req);
      return;
    }

    if (req.method === "PUT") {
      const body = (await readBody(req)) || {};
      const existing =
        workflowIndex >= 0
          ? db.userWorkflows[workflowIndex]
          : { id: workflowId, createdAt: new Date().toISOString() };
      const workflow = sanitizeCanvasWorkflowPayload(body, user, existing);
      const nextNodeIds = new Set(
        (workflow.nodes || []).map((node) => String(node?.id || "")),
      );
      const removedNodes = (existing.nodes || []).filter(
        (node) => !nextNodeIds.has(String(node?.id || "")),
      );
      const gcCandidates = collectR2ObjectKeys(removedNodes);
      if (workflowIndex >= 0) db.userWorkflows[workflowIndex] = workflow;
      else db.userWorkflows.push(workflow);
      await writeDb(db);
      const recycledObjects = await recycleUnreferencedR2Objects(
        db,
        gcCandidates,
      );
      sendJson(res, 200, {
        workflow: publicCanvasWorkflow(workflow, { compactMedia: true }),
        recycledObjects,
      }, req);
      return;
    }

    if (req.method === "DELETE") {
      if (workflowIndex < 0) return sendError(res, 404, "工作流不存在");
      if (userCanvasWorkflows(db, user).length <= 1)
        return sendError(res, 422, "至少保留一个工作流");
      const [removed] = db.userWorkflows.splice(workflowIndex, 1);
      const gcCandidates = collectR2ObjectKeys(removed);
      await writeDb(db);
      const recycledObjects = await recycleUnreferencedR2Objects(
        db,
        gcCandidates,
      );
      sendJson(res, 200, {
        ok: true,
        workflow: publicCanvasWorkflowSummary(removed),
        recycledObjects,
      }, req);
      return;
    }
  }

  if (req.method === "GET" && url.pathname === "/api/generations") {
    const user = currentUser(req, db);
    if (!user) return sendError(res, 401, "请先登录后查看生成历史");
    const generations = db.generations
      .filter((item) => item.userId === user.id)
      .sort(
        (a, b) =>
          new Date(b.createdAt || 0).getTime() -
          new Date(a.createdAt || 0).getTime(),
      );
    sendJson(res, 200, { generations: generations.slice(0, 24) });
    return;
  }

  const generationJobMatch = url.pathname.match(
    /^\/api\/generation-jobs\/([^/]+)$/,
  );
  if (req.method === "GET" && generationJobMatch) {
    const user = currentUser(req, db);
    if (!user) return sendError(res, 401, "请先登录后查看生成任务");
    const job = generationJobs.get(generationJobMatch[1]);
    if (!job || job.userId !== user.id)
      return sendError(res, 404, "生成任务不存在");
    await refreshGenerationJobProgress(job);
    sendJson(res, 200, { job: publicGenerationJob(job, user) });
    return;
  }

  if (req.method === "DELETE" && generationJobMatch) {
    const user = currentUser(req, db);
    if (!user) return sendError(res, 401, "请先登录后操作生成任务");
    const job = generationJobs.get(generationJobMatch[1]);
    if (!job || job.userId !== user.id)
      return sendError(res, 404, "生成任务不存在");
    if (job.promptId && (SEEDANCE_PROVIDER === "ark" || SEEDANCE_PROVIDER === "volcengine")) {
      const cancelResponse = await requestJsonMethodDirect(
        `${SEEDANCE_BASE_URL}/contents/generations/tasks/${encodeURIComponent(job.promptId)}`,
        "DELETE",
        seedanceAuthorizationHeader(),
      );
      if (!cancelResponse.ok) {
        return sendError(
          res,
          502,
          cancelResponse.json?.error?.message ||
            cancelResponse.json?.message ||
            `官方任务取消失败：HTTP ${cancelResponse.status}`,
        );
      }
    }
    job.status = "cancelled";
    job.message = "任务已取消";
    job.updatedAt = new Date().toISOString();
    sendJson(res, 200, { job: publicGenerationJob(job, user) });
    return;
  }

	  if (req.method === "POST" && url.pathname === "/api/generations") {
	    const body = await readBody(req);
	    if (!body) return sendError(res, 400, "请求体必须是合法 JSON");
	    const mode = body.mode || "image";
	    const imageModel =
	      mode === "image" ? resolveImageModel(body.imageModel || body.model) : null;
    const referenceAssetCount = Array.isArray(body.referenceAssets)
      ? body.referenceAssets.length
      : 0;
	    if (
      !String(body.prompt || "").trim() &&
      !["video-face-restore", "video-face-swap"].includes(mode) &&
      !(mode === "video" && (referenceAssetCount || body.draftTaskId))
    )
      return sendError(res, 422, "提示词不能为空");

    if (mode === "video" && !SEEDANCE_API_KEY) {
      return sendError(
        res,
        422,
        "缺少 SEEDANCE_API_KEY，无法启用 Seedance 2.0 视频生成 API。",
      );
    }
    if (mode === "video-face-restore" && !faceRestoreConfigured()) {
      return sendError(
        res,
        422,
        "缺少 FACE_RESTORE_API_URL 或 ComfyUI 面部修复配置，无法启用视频面部高清修复。",
      );
    }
    if (mode === "video-face-swap" && !faceSwapConfigured()) {
      return sendError(
        res,
        422,
        "缺少 ComfyUI 视频换脸工作流配置，无法启用视频换脸。",
      );
    }
    if (mode === "video-face-swap") {
      const references = Array.isArray(body.referenceAssets)
        ? body.referenceAssets
        : [];
      const hasImageReference = references.some(
        (asset) => asset.type === "image",
      );
      const hasVideoReference =
        references.some((asset) => asset.type === "video") ||
        body.node?.type === "video";
      if (!hasVideoReference)
        return sendError(res, 422, "视频换脸需要一个视频素材。");
      if (!hasImageReference)
        return sendError(res, 422, "视频换脸需要连接或上传一张参考脸图。");
    }
    if (mode === "video") {
      const seedanceError = validateSeedanceOfficialRequest(body);
      if (seedanceError) return sendError(res, 422, seedanceError);
	    }
	    if (mode === "image") {
	      const capabilities = imageModel.capabilities || {};
      const references = Array.isArray(body.referenceAssets)
        ? body.referenceAssets
        : [];
      const hasImageReference = references.some(
        (asset) => asset.type === "image",
      );
      const hasVideoReference = references.some(
        (asset) => asset.type === "video",
      );
      const hasAudioReference = references.some(
        (asset) => asset.type === "audio",
      );
      if (hasImageReference && !capabilities.supportsReferenceImage)
        return sendError(
          res,
          422,
          `${imageModel.label} 当前真实接口不支持图片参考输入。`,
        );
      if (hasVideoReference && !capabilities.supportsReferenceVideo)
        return sendError(
          res,
          422,
          `${imageModel.label} 当前真实接口不支持视频参考输入。`,
        );
      if (hasAudioReference && !capabilities.supportsReferenceAudio)
        return sendError(
          res,
          422,
          `${imageModel.label} 当前真实接口不支持音频参考输入。`,
        );
    }

    const user = currentUser(req, db);
    if (!user) return sendError(res, 401, "请先登录后使用创作功能");
    const quote = generationBillingQuote(body, imageModel);
    const cost = quote.credits;
    if (user.credits < cost)
      return sendError(
        res,
        402,
        `算力点不足，本次需要 ${cost} 点，当前剩余 ${user.credits} 点`,
      );
    user.credits -= cost;

    if (ASYNC_GENERATION_MODES.has(mode)) {
      const job = startGenerationJob({ body, db, user, cost });
      await writeDb(db);
      sendJson(res, 202, {
        job: publicGenerationJob(job, user),
        user: publicUser(user),
        billing: quote,
      });
      return;
    }

    let generation;
    try {
      generation = await createGeneration(body, db, user);
    } catch (error) {
      user.credits += cost;
      return sendError(
        res,
        process.env.OPENAI_API_KEY ? 502 : 503,
        error.message,
      );
    }
    db.generations.unshift(generation);
    await writeDb(db);
    sendJson(res, 201, { generation, user: publicUser(user), billing: quote });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/plans") {
    const plans = billablePlans(db).map(publicPlan);
    sendJson(res, 200, {
      plans,
      currency: PAYMENT_CURRENCY.toUpperCase(),
      minCreditPrice: CREDIT_MIN_CNY,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/orders") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const orders = db.orders
      .filter((item) => item.userId === user.id)
      .map(publicOrder);
    sendJson(res, 200, { orders });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/orders/test-payment") {
    if (!ENABLE_TEST_PAYMENT) {
      return sendError(res, 404, "Test payment is disabled");
    }
    const user = requireUser(req, res, db);
    if (!user) return;

    const body = await readBody(req);
    if (!body) return sendError(res, 400, "Request body must be valid JSON");

    const method = String(body.method || "alipay").trim().toLowerCase();
    if (!["alipay", "wechat"].includes(method)) {
      return sendError(res, 422, "Unsupported test payment method");
    }
    if (!paymentProviderEnabled(method)) {
      return sendError(res, 503, `Payment provider is not enabled: ${method}`);
    }

    const plan = {
      id: "test-payment-001",
      name: "0.01 CNY Test",
      price: 0.01,
      credits: 1,
    };
    const order = createOrder(plan, user, method, `${method}_test`);
    try {
      if (method === "alipay") createAlipayPagePay(req, order);
      else await createWechatNativePayment(req, order);
    } catch (error) {
      return sendError(res, 502, error.message);
    }
    db.orders.unshift(order);
    await upsertDbItems("orders", order);
    sendJson(res, 201, {
      order: publicOrder(order),
      checkoutUrl: order.checkoutUrl,
      qrText: order.qrText || "",
      qrImage: order.qrImage || "",
      user: publicUser(user),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/orders") {
    const user = requireUser(req, res, db);
    if (!user) return;

    const body = await readBody(req);
    if (!body) return sendError(res, 400, "请求体必须是合法 JSON");

    const plan = billablePlans(db).find((item) => item.id === body.planId);
    if (!plan) return sendError(res, 404, "套餐不存在");
    if (!isPlanProfitable(plan)) {
      return sendError(
        res,
        422,
        `套餐单点售价过低，已阻止真实收款。请提高 ${plan.name} 价格或降低积分数量。`,
      );
    }

    const method = String(body.method || "alipay").trim().toLowerCase();
    if (!["alipay", "wechat", "stripe"].includes(method)) {
      return sendError(res, 422, "不支持的支付方式");
    }
    if (!paymentProviderEnabled(method)) {
      return sendError(res, 503, `当前未启用 ${method} 支付，请检查 PAYMENT_PROVIDER`);
    }
    const order = createOrder(plan, user, method);
    try {
      if (method === "alipay") createAlipayPagePay(req, order);
      else if (method === "wechat") await createWechatNativePayment(req, order);
      else await createStripeCheckoutSession(req, order, user);
    } catch (error) {
      return sendError(res, 502, error.message);
    }
    db.orders.unshift(order);
    await upsertDbItems("orders", order);
    sendJson(res, 201, {
      order: publicOrder(order),
      checkoutUrl: order.checkoutUrl,
      qrText: order.qrText || "",
      qrImage: order.qrImage || "",
      user: publicUser(user),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/stats") {
    sendJson(res, 200, { stats: db.stats });
    return;
  }

  sendError(res, 404, "API route not found");
}

async function serveStatic(req, res, url) {
  if (
    r2Configured() &&
    (url.pathname.startsWith("/assets/") ||
      url.pathname.startsWith("/generated/"))
  ) {
    const objectKey = url.pathname.replace(/^\/+/, "");
    res.writeHead(302, {
      Location: r2PublicUrl(objectKey),
      "Cache-Control": "public, max-age=300",
    });
    res.end();
    return;
  }
  const requestedPath =
    url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (
    filePath !== PUBLIC_DIR &&
    !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)
  ) {
    sendError(res, 403, "Forbidden");
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return sendError(res, 404, "Static file not found");
    const ext = path.extname(filePath);
    const contentType = mimeTypes[ext] || "application/octet-stream";
    const etag = `"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
    const baseHeaders = {
      "Accept-Ranges": "bytes",
      "Cache-Control": staticCacheControl(filePath),
      "Content-Type": contentType,
      "Last-Modified": stat.mtime.toUTCString(),
      ETag: etag,
    };

    if (
      req.headers["if-none-match"] === etag ||
      (req.headers["if-modified-since"] &&
        new Date(req.headers["if-modified-since"]).getTime() >=
          Math.floor(stat.mtimeMs))
    ) {
      res.writeHead(304, baseHeaders);
      res.end();
      return;
    }

    const range = parseStaticRange(req.headers.range, stat.size);
    if (range?.invalid) {
      res.writeHead(416, {
        ...baseHeaders,
        "Content-Range": `bytes */${stat.size}`,
      });
      res.end();
      return;
    }

    if (range) {
      const contentLength = range.end - range.start + 1;
      res.writeHead(206, {
        ...baseHeaders,
        "Content-Length": contentLength,
        "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}`,
      });
      if (req.method === "HEAD") return res.end();
      fsNative
        .createReadStream(filePath, { start: range.start, end: range.end })
        .pipe(res);
      return;
    }

    if (isCompressibleStaticType(contentType) && stat.size > 1024 && acceptsGzip(req)) {
      const body = await fs.readFile(filePath);
      gzipResponse(req, res, 200, baseHeaders, body);
      return;
    }

    res.writeHead(200, {
      ...baseHeaders,
      "Content-Length": stat.size,
    });
    if (req.method === "HEAD") return res.end();
    fsNative.createReadStream(filePath).pipe(res);
  } catch (error) {
    if (error.code === "ENOENT") {
      const fallback = await fs.readFile(path.join(PUBLIC_DIR, "index.html"));
      res.writeHead(200, {
        "Content-Type": mimeTypes[".html"],
        "Cache-Control": "no-store",
      });
      res.end(fallback);
      return;
    }
    sendError(res, 500, "Static file error");
  }
}

function staticCacheControl(filePath) {
  const ext = path.extname(filePath);
  if (ext === ".html") return "no-store";
  if (ext === ".js" || ext === ".css") return "public, max-age=0, must-revalidate";
  if (
    filePath.includes(`${path.sep}assets${path.sep}`) ||
    filePath.includes(`${path.sep}generated${path.sep}`)
  ) {
    return "public, max-age=604800";
  }
  return "public, max-age=300";
}

function isCompressibleStaticType(contentType) {
  return /^(text\/|application\/javascript|application\/json)/i.test(
    String(contentType || ""),
  );
}

function parseStaticRange(rangeHeader, size) {
  if (!rangeHeader) return null;
  const match = String(rangeHeader).match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return { invalid: true };

  const [, startRaw, endRaw] = match;
  let start = startRaw === "" ? null : Number(startRaw);
  let end = endRaw === "" ? null : Number(endRaw);

  if (start === null && end === null) return { invalid: true };
  if (start === null) {
    const suffixLength = end;
    if (!Number.isFinite(suffixLength) || suffixLength <= 0)
      return { invalid: true };
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    if (!Number.isFinite(start) || start < 0) return { invalid: true };
    end = end === null ? size - 1 : end;
  }

  if (!Number.isFinite(end) || end < start || start >= size)
    return { invalid: true };
  return { start, end: Math.min(end, size - 1) };
}

const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();
  const requestId = String(req.headers["x-request-id"] || crypto.randomUUID());
  const url = new URL(req.url, `http://${req.headers.host}`);
  req.requestId = requestId;
  applySecurityHeaders(req, res, requestId);
  res.once("finish", () =>
    logHttpRequest(req, res, url, requestId, startedAt),
  );
  try {
    if (!enforceRateLimit(req, res, url)) return;

    if (
      ["GET", "HEAD"].includes(req.method) &&
      url.pathname.startsWith("/r2/")
    ) {
      await serveR2Object(req, res, url);
      return;
    }

    if (req.method === "GET" && url.pathname === "/healthz") {
      let databaseError = "";
      try {
        await checkPostgresHealth();
      } catch (error) {
        databaseError = error.code || error.message;
      }

      sendJson(res, databaseError ? 503 : 200, {
        ok: !databaseError,
        storage: "postgres",
        mediaStorage: r2Configured()
          ? "r2"
          : r2CredentialsConfigured()
            ? "r2-misconfigured"
            : "local",
        mediaDelivery: R2_DELIVERY_BASE_URL,
        ...(r2ConfigurationError()
          ? { mediaStorageError: r2ConfigurationError() }
          : {}),
        postgresConfigured: Boolean(process.env.DATABASE_URL),
        localStorage: false,
        ...(databaseError ? { databaseError } : {}),
        time: new Date().toISOString(),
      });
      return;
    }

    if (url.pathname.startsWith("/v1/")) {
      await handleExternalApi(req, res, url);
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    console.error(
      JSON.stringify({
        type: "server_error",
        requestId,
        method: req.method,
        path: url.pathname,
        message: error.message,
        stack: IS_PRODUCTION ? undefined : error.stack,
      }),
    );
    if (!res.headersSent) {
      sendError(
        res,
        Number(error.statusCode || 500),
        error.statusCode ? error.message : "Server error",
        req,
      );
    }
    else res.destroy();
  }
});

async function startServer() {
  try {
    const db = await readDb();
    ensureCollections(db);
    resumePersistedGenerationJobs(db);
  } catch (error) {
    console.error(`Database warmup failed: ${error.message}`);
  }

  server.listen(PORT, () => {
    console.log(`DreameHub full-stack app running at http://localhost:${PORT}`);
  });
}

startServer();

process.on("SIGINT", async () => {
  await closePostgres();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closePostgres();
  process.exit(0);
});
