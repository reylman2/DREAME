const http = require("http");
const https = require("https");
const net = require("net");
const tls = require("tls");
const fs = require("fs/promises");
const fsNative = require("fs");
const path = require("path");
const crypto = require("crypto");
const QRCode = require("qrcode");
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
const POLLINATIONS_TEXT_MODEL = process.env.POLLINATIONS_TEXT_MODEL || "openai";
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
const generationJobs = new Map();

const DEFAULT_FREE_QUOTAS = {
  "models:list": 1000,
  "images:generations": 5,
  "chat:completions": 50,
  "workflows:run": 30,
};

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
    description: "Pollinations 免费公开文生图模型，无需 OpenAI 额度。",
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
      {
        id: "seedance-prompt-zh",
        provider: "pollinations",
        label: "Seedance 中文提示词 免费版",
        engine: POLLINATIONS_TEXT_MODEL,
        capabilities: {
          output: "text",
          modes: ["text-to-text"],
          inputTypes: ["text"],
          realApi: true,
        },
      },
      {
        id: "seedance-prompt-zh-openai",
        provider: "openai",
        label: "Seedance 中文提示词 OpenAI",
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
  return dbCache;
}

async function writeDb(db) {
  requireDatabaseUrl();
  await writePostgresDb(db);
  dbCache = db;
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

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
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

function ensureCollections(db) {
  db.users ||= [];
  db.sessions ||= [];
  db.verificationRequests ||= [];
  db.workspaces ||= [];
  db.wallets ||= [];
  db.apiKeys ||= [];
  db.orders ||= [];
  db.generations ||= [];
  db.userWorkflows ||= [];

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

function publicCanvasWorkflow(workflow) {
  const payload = safeJsonClone(workflow, {});
  delete payload.userId;
  return payload;
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
    nodes: Array.isArray(source.nodes)
      ? safeJsonClone(source.nodes, [])
      : safeJsonClone(existing.nodes, []),
    links: Array.isArray(source.links)
      ? safeJsonClone(source.links, [])
      : safeJsonClone(existing.links, []),
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

function publicApiKey(apiKey) {
  ensureApiKeyQuotaShape(apiKey);
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
    const upstreamCost = body?.model === "seedance-prompt-zh-openai" ? 0.06 : 0;
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

async function saveGeneratedImage(buffer, contentType) {
  await fs.mkdir(GENERATED_DIR, { recursive: true });
  const fileName = `${crypto.randomUUID()}.${imageExtension(contentType)}`;
  await fs.writeFile(path.join(GENERATED_DIR, fileName), buffer);
  return `/generated/${fileName}`;
}

async function saveGeneratedBinary(
  buffer,
  contentType,
  fallbackExtension = ".bin",
) {
  await fs.mkdir(GENERATED_DIR, { recursive: true });
  const fileName = `${crypto.randomUUID()}${generatedExtension(contentType, fallbackExtension)}`;
  await fs.writeFile(path.join(GENERATED_DIR, fileName), buffer);
  return `/generated/${fileName}`;
}

function requestJsonDirect(url, payload, headers) {
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

async function requestProviderJson(url, payload, headers = {}) {
  const body = JSON.stringify(payload);
  const requestHeaders = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    ...headers,
  };
  return requestJsonDirect(url, payload, requestHeaders);
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
  if (
    !model ||
    model === "openai-chat" ||
    model === "seedance-prompt-zh-openai"
  )
    return OPENAI_TEXT_MODEL;
  if (String(model).startsWith("openai:"))
    return String(model).slice("openai:".length);
  return OPENAI_TEXT_MODEL;
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

async function callOpenAISeedancePromptTextGeneration(body) {
  const output = await callOpenAIChatCompletion({
    model: body.model || "seedance-prompt-zh-openai",
    temperature: body.temperature ?? 0.6,
    messages: [
      {
        role: "user",
        content: seedancePromptInput(body.prompt),
      },
    ],
  });
  return {
    provider: "openai",
    engine: `seedance-prompt-zh-openai:${output.model}`,
    text: output.content,
    usage: output.usage,
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
  const output =
    selectedModel === "openai-chat" ||
    String(selectedModel).startsWith("openai:")
      ? await callOpenAIChatCompletion(request)
      : await callPollinationsChatCompletion(request);
  return {
    provider:
      selectedModel === "openai-chat" ||
      String(selectedModel).startsWith("openai:")
        ? "openai"
        : "pollinations",
    engine: `${selectedModel}:${output.model}`,
    text: output.content,
    usage: output.usage,
  };
}

async function callSeedancePromptTextGeneration(body) {
  const selectedModel = body.imageModel || body.model || "";
  if (selectedModel === "seedance-prompt-zh-openai") {
    return callOpenAISeedancePromptTextGeneration({
      ...body,
      model: selectedModel,
    });
  }
  const output = await callPollinationsChatCompletion({
    model: body.model || "dreamehub-free-chat",
    temperature: body.temperature ?? 0.6,
    max_tokens: body.max_tokens || 1400,
    messages: [
      {
        role: "user",
        content: seedancePromptInput(body.prompt),
      },
    ],
  });
  return {
    provider: "pollinations",
    engine: `seedance-prompt-zh:${output.model}`,
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

  await fs.mkdir(GENERATED_DIR, { recursive: true });
  const fileName = `${crypto.randomUUID()}.png`;
  await fs.writeFile(
    path.join(GENERATED_DIR, fileName),
    Buffer.from(base64Image, "base64"),
  );

  return {
    image: `/generated/${fileName}`,
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

  await fs.mkdir(GENERATED_DIR, { recursive: true });
  const fileName = `${crypto.randomUUID()}.png`;
  await fs.writeFile(
    path.join(GENERATED_DIR, fileName),
    Buffer.from(base64Image, "base64"),
  );

  return {
    image: `/generated/${fileName}`,
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
  if (/^https?:\/\//i.test(source)) return requestAnyBinaryDirect(source);
  throw new Error("视频素材必须是 data URL 或 http(s) URL。");
}

async function imageSourceToBuffer(input) {
  const source = String(input.source || "");
  const dataUrl = parseDataUrl(source);
  if (dataUrl) return dataUrl;
  if (/^https?:\/\//i.test(source)) return requestAnyBinaryDirect(source);
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
    await assertRemoteAssetDownloadable(value, "image");
    return value;
  }
  return value;
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
    await assertRemoteAssetDownloadable(value, "audio");
    return value;
  }
  return value;
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
    await assertRemoteAssetDownloadable(value, "video");
    return value;
  }
  return value;
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
  if (returnLastFrame !== undefined)
    requestBody.return_last_frame = returnLastFrame;
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
    throw new Error(
      requestId ? `${message} Request id: ${requestId}` : message,
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

  return {
    image: videoUrl,
    videoUrl,
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

  return {
    image: videoUrl,
    videoUrl,
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
  const model =
    db.models.find((item) => item.id === body.modelId) || db.models[0];
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
  const mode = body.mode || "image";
  let output;
  if (mode === "image") {
    output = await callImageGeneration(body, model.title);
  } else if (mode === "text") {
    output =
      body.node?.type === "script"
        ? await callSeedancePromptTextGeneration(body)
        : await callPlainTextGeneration(body);
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
            returnLastFrame: optionalBoolean(body.returnLastFrame),
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
    startedAt: Date.now(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  generationJobs.set(job.id, job);

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
    } catch (error) {
      user.credits += cost;
      await writeDb(db);
      job.status = "failed";
      job.error = error.message;
      job.message = `生成失败：${error.message}`;
      job.updatedAt = new Date().toISOString();
    }
  }, 0);

  return job;
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
    sendJson(res, 200, {
      object: "list",
      data: [
        ...textModels,
        ...db.models.map((model) => ({
          id: model.id,
          object: "model",
          name: model.title,
          category: model.category,
          provider: "dreamehub",
          capabilities: model.category === "video" ? ["video"] : ["image"],
        })),
      ],
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

    let output;
    try {
      output = await callImageGeneration(
        {
          ...body,
          imageModel: body.model || body.imageModel || "openai:gpt-image-2",
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
    let responseId = `chatcmpl_${crypto.randomUUID()}`;
    let responseModel = model;
    let content = "";
    let usage = null;
    try {
      if (
        model === "seedance-prompt-zh" ||
        model === "seedance-prompt-zh-openai"
      ) {
        const output = await callSeedancePromptTextGeneration({
          prompt: lastUserMessage,
          model,
        });
        content = output.text;
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

    const email = String(body.email || "")
      .trim()
      .toLowerCase();
    const user = db.users.find(
      (item) => item.email === email && item.password === body.password,
    );
    if (!user) return sendError(res, 401, "邮箱或密码不正确");

    const session = {
      token: crypto.randomUUID(),
      userId: user.id,
      createdAt: new Date().toISOString(),
    };
    db.sessions.unshift(session);
    await upsertDbItems("sessions", session);
    sendJson(res, 200, { token: session.token, user: publicUser(user) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/register") {
    const body = await readBody(req);
    if (!body) return sendError(res, 400, "请求体必须是合法 JSON");

    const name = String(body.name || "").trim();
    const email = String(body.email || "")
      .trim()
      .toLowerCase();
    const password = String(body.password || "");
    const verificationToken = String(body.verificationToken || "");

    if (!name || !email || password.length < 6) {
      return sendError(res, 422, "请填写名称、邮箱和至少 6 位密码");
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
    if (db.users.some((item) => item.email === email)) {
      return sendError(res, 409, "该邮箱已注册");
    }

    const user = {
      id: crypto.randomUUID(),
      name,
      email,
      phone: "",
      password,
      avatar: "会员中心",
      role: "creator",
      plan: "Free",
      credits: 0,
      createdAt: new Date().toISOString(),
    };
    const { workspace, wallet } = ensureUserInfrastructure(db, user);
    const session = {
      token: crypto.randomUUID(),
      userId: user.id,
      createdAt: new Date().toISOString(),
    };
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
      .map(publicApiKey);
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

    const secret = `dh_live_${crypto.randomBytes(24).toString("base64url")}`;
    const freeQuota = parseFreeQuotas(body.freeQuota);
    const apiKey = {
      id: crypto.randomUUID(),
      userId: user.id,
      workspaceId: workspace.id,
      name,
      keyHash: hashSecret(secret),
      maskedKey: maskApiKey(secret),
      permissions: parsePermissions(body.permissions),
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
    sendJson(res, 201, { apiKey: publicApiKey(apiKey), secret });
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

  if (req.method === "GET" && url.pathname === "/api/canvas-workflows") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const { workflows, created } = ensureUserCanvasWorkflows(db, user);
    if (created) await writeDb(db);
    sendJson(res, 200, { workflows: workflows.map(publicCanvasWorkflow) });
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
    sendJson(res, 201, { workflow: publicCanvasWorkflow(workflow) });
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

    if (req.method === "PUT") {
      const body = (await readBody(req)) || {};
      const existing =
        workflowIndex >= 0
          ? db.userWorkflows[workflowIndex]
          : { id: workflowId, createdAt: new Date().toISOString() };
      const workflow = sanitizeCanvasWorkflowPayload(body, user, existing);
      if (workflowIndex >= 0) db.userWorkflows[workflowIndex] = workflow;
      else db.userWorkflows.push(workflow);
      await writeDb(db);
      sendJson(res, 200, { workflow: publicCanvasWorkflow(workflow) });
      return;
    }

    if (req.method === "DELETE") {
      if (workflowIndex < 0) return sendError(res, 404, "工作流不存在");
      if (userCanvasWorkflows(db, user).length <= 1)
        return sendError(res, 422, "至少保留一个工作流");
      const [removed] = db.userWorkflows.splice(workflowIndex, 1);
      await writeDb(db);
      sendJson(res, 200, { ok: true, workflow: publicCanvasWorkflow(removed) });
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
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
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
    console.error(error);
    sendError(res, 500, "Server error");
  }
});

async function startServer() {
  try {
    await readDb();
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
