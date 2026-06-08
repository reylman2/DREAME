const state = {
  user: null,
  token: localStorage.getItem("DreameHub_token") || "",
  models: [],
  imageModels: [],
  apiCapabilities: null,
  selectedImageModelId: sessionStorage.getItem("DreameHub_imageModel") || "",
  workflows: [],
  mode: "image",
  selectedWorkflowId: sessionStorage.getItem("DreameHub_workflow") || "",
  canvasZoom: Number(sessionStorage.getItem("DreameHub_canvasZoom") || 0.89),
  canvasPanX: Number(sessionStorage.getItem("DreameHub_canvasPanX") || 0),
  canvasPanY: Number(sessionStorage.getItem("DreameHub_canvasPanY") || 0),
  isCanvasDragging: false,
  canvasDragStartX: 0,
  canvasDragStartY: 0,
  canvasDragOriginX: 0,
  canvasDragOriginY: 0,
  draggingNodeId: "",
  nodeDragStartX: 0,
  nodeDragStartY: 0,
  nodeDragOriginX: 0,
  nodeDragOriginY: 0,
  isNodeDragging: false,
  isNodeResizing: false,
  resizingNodeId: "",
  nodeResizeDir: "",
  nodeResizeStartX: 0,
  nodeResizeStartY: 0,
  nodeResizeStartWidth: 0,
  nodeResizeStartHeight: 0,
  nodeResizeOriginX: 0,
  nodeResizeOriginY: 0,
  isPortDragging: false,
  portDragNodeId: "",
  portDragType: "",
  suppressPortClick: false,
  isMarkingAsset: false,
  markingNodeId: "",
  markStartX: 0,
  markStartY: 0,
  activeComposerTab:
    sessionStorage.getItem("DreameHub_composerTab") || "全能参考",
  canvasHistoryOpen: false,
  canvasDrawer: "",
  canvasWorkflows: {},
  canvasWorkflowsLoaded: false,
  canvasWorkflowSaveTimers: new Map(),
  canvasUndoStacks: new Map(),
  canvasRedoStacks: new Map(),
  isApplyingCanvasHistory: false,
  generationHistory: [],
  generationHistoryLoaded: false,
  generationHistoryLoading: false,
  selectedNodeId: "",
  generationJobPollers: new Set(),
  pendingLinkNodeId: "",
  contextMenu: null,
  contextMenuNodeId: "",
};

const appView = document.querySelector("#appView");
const toastHost = document.querySelector("#toastHost");

const prompts = [
  "银色运动耳机广告，水花飞溅，硬光，黑色背景",
  "国风机甲少女，竹林晨雾，电影镜头，精致线稿",
  "现代客厅软装方案，自然光，橄榄绿点缀，高级样板间",
  "城市天台音乐短片，夕阳逆光，手持镜头，真实胶片质感",
];

const apiPermissionOptions = [
  ["images:create", "文生图"],
  ["chat:create", "免费对话"],
  ["videos:create", "视频生成"],
  ["models:read", "读取模型"],
  ["workflows:run", "运行工作流"],
  ["billing:read", "读取账单"],
];

let pendingVerification = null;
let pendingUploadNodeId = "";
let pendingUploadMode = "node";

const FREE_CANVAS_ID = "free-canvas";
const MIN_MEDIA_NODE_WIDTH = 220;
const MAX_MEDIA_NODE_WIDTH = 1200;
const CANVAS_HISTORY_LIMIT = 60;
const SEEDANCE_DURATION_MIN = 4;
const SEEDANCE_DURATION_MAX = 15;

const composerTabs = [
  "文生视频",
  "面部修复",
  "视频换脸",
  "全能参考",
  "图生视频",
  "首尾帧",
  "图片参考",
];

const composerModeConfig = {
  文生视频: {
    mode: "video",
    engine: "Seedance 2.0",
    modelValue: "seedance:text-to-video",
    cost: 85,
    hint: "纯文本生成视频，不绑定素材时会完全按文字指令生成。",
    requires: [],
    mention: false,
  },
  全能参考: {
    mode: "video",
    engine: "Seedance 2.0 VIP",
    modelValue: "seedance:all-reference",
    cost: 135,
    hint: "支持 @Image / @Video / @Audio 精确绑定素材用途，适合角色、动作、运镜、音乐多参考。",
    requires: ["asset"],
    mention: true,
  },
  图生视频: {
    mode: "video",
    engine: "Seedance 2.0",
    modelValue: "seedance:image-to-video",
    cost: 110,
    hint: "以图片作为首帧或视觉参考生成视频，建议至少上传 1 张图片素材。",
    requires: ["image"],
    mention: true,
  },
  面部修复: {
    mode: "video-face-restore",
    engine: "面部高清修复",
    modelValue: "face-restore:hd",
    cost: 8,
    hint: "上传或连接视频素材后，使用保守强度增强人脸清晰度，尽量保持身份、表情、动作和背景不变。",
    requires: ["video"],
    mention: false,
    defaultStrength: 55,
  },
  视频换脸: {
    mode: "video-face-swap",
    engine: "InsightFace 换脸",
    modelValue: "face-swap:light",
    cost: 10,
    hint: "上传或连接视频素材，再连接一张参考脸图；使用真实人脸换脸模型生成新视频节点。",
    requires: ["video", "image"],
    mention: false,
    defaultStrength: 82,
  },
  首尾帧: {
    mode: "video",
    engine: "Seedance 2.0",
    modelValue: "seedance:first-last-frame",
    cost: 150,
    hint: "使用首帧与尾帧控制视频起止画面，建议绑定两个图片素材。",
    requires: ["image", "image"],
    mention: true,
  },
  图片参考: {
    mode: "image",
    engine: "Lib Nayo Pro",
    modelValue: "pollinations:flux",
    cost: 14,
    hint: "使用图片素材控制画面风格、角色外观或局部细节。",
    requires: ["image"],
    mention: true,
  },
  文生图: {
    mode: "image",
    engine: "Lib Nayo Pro",
    modelValue: "pollinations:flux",
    cost: 18,
    hint: "纯文本生成图片，不强制上传参考素材；输入 @ 时可选择已上传素材作为可选参考。",
    requires: [],
    mention: false,
  },
};

const canvasWorkflowPresets = [
  {
    id: "story-script",
    title: "故事脚本生成",
    subtitle: "上传设定后生成完整分集脚本",
    icon: "▤",
    accent: "cyan",
    mode: "train",
    composerKind: "text",
    modelLabel: "GVLM 3.1",
    cost: 6,
    prompt:
      "根据我上传的世界观和人物设定，生成一个 60-90 秒短剧脚本，包含场景、对白、镜头节奏和情绪转折。",
    nodes: [
      {
        type: "script",
        label: "剧本",
        title: "《我在盛唐写天下》",
        meta: "古风 / 穿越 / 爽文漫剧",
        content:
          "时长建议：60-90 秒\n基调：热血 x 盛唐史诗感 x 爽点节奏\n\n【序幕】\n【现代 · 深夜办公室】\n键盘声急促，电脑屏幕蓝光刺眼。沈昭昭伏案醒来，手里握着一枚陌生玉牌。",
      },
      {
        type: "text",
        label: "大纲",
        title: "分集结构",
        content: "1. 现代落点\n2. 误入宫宴\n3. 诗文破局\n4. 暗线反转",
      },
      {
        type: "result",
        label: "脚本包",
        title: "可编辑脚本",
        content: "角色表、分镜表、旁白、对白、镜头节奏",
      },
    ],
  },
  {
    id: "character-views",
    title: "角色三视图",
    subtitle: "从角色图扩展正侧背三视图",
    icon: "▣",
    accent: "green",
    mode: "image",
    composerKind: "image",
    modelLabel: "Lib Nayo Pro",
    cost: 14,
    prompt:
      "保持角色身份、服装材质、发型和色彩一致，生成正面、侧面、背面三视图，白底角色设定稿，高可用制作参考。",
    nodes: [
      {
        type: "image",
        label: "角色图",
        title: "古风女主",
        image:
          "https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=900&q=80",
      },
      {
        type: "image",
        label: "角色三视图",
        title: "设定稿输出",
        image:
          "https://images.unsplash.com/photo-1558769132-cb1aea458c5e?auto=format&fit=crop&w=1100&q=80",
      },
      {
        type: "result",
        label: "资产库",
        title: "角色一致性",
        content: "发型、服装、配色、道具、表情参考已锁定",
      },
    ],
  },
  {
    id: "first-frame-video",
    title: "首帧图生视频",
    subtitle: "用首帧生成 5 秒动态镜头",
    icon: "▶",
    accent: "blue",
    mode: "video",
    composerKind: "video-reference",
    modelLabel: "Seedance 2.0 VIP",
    cost: 135,
    prompt:
      "以首帧为强参考，生成 5 秒 16:9 电影镜头：角色向前冲刺，电光环绕，云雾翻涌，镜头缓慢推进，动作连贯。",
    nodes: [
      {
        type: "image",
        label: "首帧",
        title: "动作关键帧",
        image:
          "https://images.unsplash.com/photo-1518709268805-4e9042af2176?auto=format&fit=crop&w=900&q=80",
      },
      {
        type: "video",
        label: "视频",
        title: "动态镜头",
        content: "16:9 · 720P · 5s · 摄像机推进",
      },
      {
        type: "result",
        label: "成片",
        title: "短视频片段",
        content: "首帧参考、运动描述、镜头语言、音效建议",
      },
    ],
  },
  {
    id: "audio-video",
    title: "音频生视频",
    subtitle: "根据音乐节奏生成表演镜头",
    icon: "♫",
    accent: "pink",
    mode: "video",
    composerKind: "video-reference",
    modelLabel: "Seedance 2.0 VIP",
    cost: 100,
    prompt:
      "根据上传音乐生成舞台短片：歌手站在暗色舞台中央，灯光随鼓点切换，镜头在近景和全景之间平滑转场。",
    nodes: [
      {
        type: "audio",
        label: "音频",
        title: "节奏分析",
        content: "BPM 128 · 副歌强拍 · 适合切换光束和推轨镜头",
      },
      {
        type: "video",
        label: "音乐视频",
        title: "舞台生成",
        content: "人像稳定、口型参考、灯光节奏、镜头运动",
      },
    ],
  },
  {
    id: "brand-visual",
    title: "品牌视觉套图",
    subtitle: "海报、详情页和社媒封面批量生成",
    icon: "◆",
    accent: "orange",
    mode: "image",
    composerKind: "image",
    modelLabel: "Lib Nayo Pro",
    cost: 18,
    prompt:
      "银色运动耳机广告，水花飞溅，黑色背景，硬光，高级科技品牌视觉，同时生成主海报、详情页首屏和社媒封面。",
    batchOutputs: [
      {
        label: "主海报",
        title: "主海报",
        size: "1024x1536",
        promptSuffix:
          "输出主海报 1 张：强视觉中心，适合广告投放，产品占画面主体，标题区域留白，竖版海报构图。",
      },
      {
        label: "详情页首屏",
        title: "详情页首屏",
        size: "1536x1024",
        promptSuffix:
          "输出详情页首屏 1 张：电商详情页第一屏，突出核心卖点、材质、水花和使用场景，横版宽屏构图。",
      },
      {
        label: "社媒封面",
        title: "社媒封面",
        size: "1024x1024",
        promptSuffix:
          "输出社媒封面 1 张：适合小红书/Instagram 方图封面，信息密度更高，视觉抓眼，可作为内容封面。",
      },
    ],
    nodes: [
      {
        type: "text",
        label: "品牌词",
        title: "视觉策略",
        content: "关键词：速度、防水、金属、清爽\n受众：运动与通勤用户",
      },
      {
        type: "image",
        label: "批量出图",
        title: "套图预览",
        image:
          "https://images.unsplash.com/photo-1524678606370-a47ad25cb82a?auto=format&fit=crop&w=1100&q=80",
      },
      {
        type: "result",
        label: "交付",
        title: "3 张主视觉",
        content: "海报 1 张、详情页 1 张、社媒封面 1 张",
      },
    ],
  },
  {
    id: "portrait-lora",
    title: "人像 LoRA 训练",
    subtitle: "清洗素材、打标、训练、发布模型",
    icon: "◎",
    accent: "violet",
    mode: "train",
    composerKind: "text",
    modelLabel: "GVLM 3.1",
    cost: 42,
    prompt:
      "清洗 20 张人像素材，生成训练标签，训练一个写实人像 LoRA，并输出测试样张、触发词和发布说明。",
    nodes: [
      {
        type: "text",
        label: "素材清洗",
        title: "数据集",
        content: "去重、裁脸、曝光检查、分辨率统一",
      },
      {
        type: "text",
        label: "训练评估",
        title: "LoRA",
        content:
          "触发词：dh_portrait_x\n步数：1800\n评估：身份相似度、过拟合检查",
      },
      {
        type: "result",
        label: "发布模型",
        title: "模型卡",
        content: "样张、参数、授权、推荐提示词",
      },
    ],
  },
];

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const response = await fetch(path, { ...options, headers });
  const raw = await response.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    const title = raw.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]?.trim();
    const preview = String(raw || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    throw new Error(
      `接口未返回 JSON：${path}，HTTP ${response.status}${
        title ? `，页面标题：${title}` : ""
      }${preview ? `，内容：${preview}` : ""}`,
    );
  }
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

function canvasNodeId() {
  return `node-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function materialRefName(name, type, index = 1) {
  const base = String(name || "")
    .replace(/\.[^.]+$/, "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .slice(0, 24);
  if (base) return base;
  const prefix =
    type === "image"
      ? "Image"
      : type === "video"
        ? "Video"
        : type === "audio"
          ? "Audio"
          : "Asset";
  return `${prefix}${index}`;
}

function cloneCanvasWorkflow(workflow) {
  const cloned =
    typeof structuredClone === "function"
      ? structuredClone(workflow)
      : JSON.parse(JSON.stringify(workflow));
  return {
    ...cloned,
    nodes: (cloned.nodes || []).map((node) => ({
      id: node.id || canvasNodeId(),
      ...node,
    })),
    links: (cloned.links || []).map((link) => ({ ...link })),
  };
}

function createFreeCanvasWorkflow() {
  return {
    id: FREE_CANVAS_ID,
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
  };
}

function baseCanvasWorkflow(id) {
  if (id === FREE_CANVAS_ID) return createFreeCanvasWorkflow();

  const preset = canvasWorkflowPresets.find((item) => item.id === id);
  if (preset) return cloneCanvasWorkflow(preset);

  const workflow = state.workflows.find((item) => item.id === id);
  if (!workflow) return null;
  return cloneCanvasWorkflow({
    id: workflow.id,
    title: workflow.title,
    subtitle: workflow.description,
    icon: workflow.index,
    accent: "blue",
    mode: workflow.id.includes("video") ? "video" : "image",
    composerKind: workflow.id.includes("video") ? "video-reference" : "image",
    modelLabel: workflow.id.includes("video")
      ? "Seedance 2.0 VIP"
      : "Lib Nayo Pro",
    cost: 12,
    prompt: `使用「${workflow.title}」工作流：${workflow.description}`,
    nodes: workflow.nodes.map((node) => ({
      type: node === workflow.activeNode ? "result" : "text",
      label: node,
      title: node,
      content:
        node === workflow.activeNode
          ? "当前关键节点，可直接编辑参数并运行生成。"
          : "该节点会接收上游内容，并输出给下一步继续生成。",
    })),
  });
}

function canvasWorkflowList() {
  return Object.values(state.canvasWorkflows || {}).sort((a, b) => {
    const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return bTime - aTime;
  });
}

async function ensureCanvasWorkflowsLoaded() {
  if (state.canvasWorkflowsLoaded) return;
  const payload = await api("/api/canvas-workflows");
  state.canvasWorkflows = {};
  (payload.workflows || []).forEach((workflow) => {
    state.canvasWorkflows[workflow.id] = cloneCanvasWorkflow(workflow);
  });
  state.canvasWorkflowsLoaded = true;

  const storedWorkflowId = sessionStorage.getItem("DreameHub_workflow") || "";
  if (storedWorkflowId && !state.canvasWorkflows[storedWorkflowId]) {
    const presetWorkflow = baseCanvasWorkflow(storedWorkflowId);
    if (presetWorkflow) {
      presetWorkflow.updatedAt = new Date().toISOString();
      state.canvasWorkflows[presetWorkflow.id] = presetWorkflow;
      scheduleCanvasWorkflowSave(presetWorkflow);
    }
  }

  if (
    state.selectedWorkflowId &&
    state.canvasWorkflows[state.selectedWorkflowId]
  )
    return;

  if (storedWorkflowId && state.canvasWorkflows[storedWorkflowId]) {
    state.selectedWorkflowId = storedWorkflowId;
  } else if (state.canvasWorkflows[FREE_CANVAS_ID]) {
    state.selectedWorkflowId = FREE_CANVAS_ID;
  } else {
    state.selectedWorkflowId = canvasWorkflowList()[0]?.id || FREE_CANVAS_ID;
  }
  sessionStorage.setItem("DreameHub_workflow", state.selectedWorkflowId);
}

function resetCanvasWorkflowCache({ clearSelection = false } = {}) {
  for (const timer of state.canvasWorkflowSaveTimers.values()) {
    clearTimeout(timer);
  }
  state.canvasWorkflowSaveTimers.clear();
  state.canvasUndoStacks.clear();
  state.canvasRedoStacks.clear();
  state.generationHistory = [];
  state.generationHistoryLoaded = false;
  state.generationHistoryLoading = false;
  state.canvasWorkflows = {};
  state.canvasWorkflowsLoaded = false;
  state.selectedNodeId = "";
  if (clearSelection) {
    state.selectedWorkflowId = "";
    sessionStorage.removeItem("DreameHub_workflow");
  }
}

function scheduleCanvasWorkflowSave(workflow) {
  if (!state.token || !workflow?.id) return;
  const workflowId = workflow.id;
  const oldTimer = state.canvasWorkflowSaveTimers.get(workflowId);
  if (oldTimer) clearTimeout(oldTimer);
  const timer = setTimeout(() => {
    state.canvasWorkflowSaveTimers.delete(workflowId);
    saveCanvasWorkflow(workflow).catch((error) => {
      toast(`工作流保存失败：${error.message}`);
    });
  }, 700);
  state.canvasWorkflowSaveTimers.set(workflowId, timer);
}

function canvasHistoryStack(map, workflowId = state.selectedWorkflowId) {
  if (!workflowId) return [];
  if (!map.has(workflowId)) map.set(workflowId, []);
  return map.get(workflowId);
}

function pushCanvasHistorySnapshot(workflowOrSnapshot) {
  if (state.isApplyingCanvasHistory || !workflowOrSnapshot?.id) return;
  const snapshot = cloneCanvasWorkflow(workflowOrSnapshot);
  const stack = canvasHistoryStack(state.canvasUndoStacks, snapshot.id);
  stack.push(snapshot);
  if (stack.length > CANVAS_HISTORY_LIMIT) stack.shift();
  state.canvasRedoStacks.set(snapshot.id, []);
}

function captureCanvasHistory() {
  const workflow = currentCanvasWorkflow();
  if (workflow) pushCanvasHistorySnapshot(workflow);
}

function applyCanvasHistorySnapshot(snapshot) {
  if (!snapshot?.id) return false;
  state.isApplyingCanvasHistory = true;
  state.canvasWorkflows[snapshot.id] = cloneCanvasWorkflow(snapshot);
  const workflow = state.canvasWorkflows[snapshot.id];
  if (!workflow.nodes.some((node) => node.id === state.selectedNodeId)) {
    state.selectedNodeId = workflow.nodes[0]?.id || "";
  }
  scheduleCanvasWorkflowSave(workflow);
  state.isApplyingCanvasHistory = false;
  return true;
}

function undoCanvasWorkflow() {
  const workflow = currentCanvasWorkflow();
  if (!workflow?.id) return false;
  const undoStack = canvasHistoryStack(state.canvasUndoStacks, workflow.id);
  const previous = undoStack.pop();
  if (!previous) {
    toast("没有可撤销的操作");
    return false;
  }
  const redoStack = canvasHistoryStack(state.canvasRedoStacks, workflow.id);
  redoStack.push(cloneCanvasWorkflow(workflow));
  if (redoStack.length > CANVAS_HISTORY_LIMIT) redoStack.shift();
  applyCanvasHistorySnapshot(previous);
  toast("已撤销");
  refreshCanvasWorkflow();
  return true;
}

function redoCanvasWorkflow() {
  const workflow = currentCanvasWorkflow();
  if (!workflow?.id) return false;
  const redoStack = canvasHistoryStack(state.canvasRedoStacks, workflow.id);
  const next = redoStack.pop();
  if (!next) {
    toast("没有可重做的操作");
    return false;
  }
  const undoStack = canvasHistoryStack(state.canvasUndoStacks, workflow.id);
  undoStack.push(cloneCanvasWorkflow(workflow));
  if (undoStack.length > CANVAS_HISTORY_LIMIT) undoStack.shift();
  applyCanvasHistorySnapshot(next);
  toast("已重做");
  refreshCanvasWorkflow();
  return true;
}

async function saveCanvasWorkflow(workflow) {
  if (!workflow?.id) return null;
  workflow.updatedAt = new Date().toISOString();
  const payload = await api(
    `/api/canvas-workflows/${encodeURIComponent(workflow.id)}`,
    {
      method: "PUT",
      body: JSON.stringify({ workflow }),
    },
  );
  if (state.canvasWorkflows[payload.workflow.id] === workflow) {
    workflow.updatedAt = payload.workflow.updatedAt || workflow.updatedAt;
  } else if (!state.canvasWorkflows[payload.workflow.id]) {
    state.canvasWorkflows[payload.workflow.id] = cloneCanvasWorkflow(
      payload.workflow,
    );
  }
  return payload.workflow;
}

async function createUserCanvasWorkflow() {
  const workflow = createFreeCanvasWorkflow();
  workflow.id =
    globalThis.crypto?.randomUUID?.() || canvasNodeId().replace(/^node-/, "");
  workflow.title = `未命名 ${canvasWorkflowList().length + 1}`;
  workflow.createdAt = new Date().toISOString();
  workflow.updatedAt = workflow.createdAt;
  const payload = await api("/api/canvas-workflows", {
    method: "POST",
    body: JSON.stringify({ workflow }),
  });
  state.canvasWorkflows[payload.workflow.id] = cloneCanvasWorkflow(
    payload.workflow,
  );
  state.selectedWorkflowId = payload.workflow.id;
  state.selectedNodeId = "";
  state.canvasDrawer = "";
  sessionStorage.setItem("DreameHub_workflow", state.selectedWorkflowId);
  sessionStorage.removeItem("DreameHub_prompt");
  toast("已创建新工作流");
  await renderStudio();
}

async function switchCanvasWorkflow(workflowId) {
  if (!workflowId || !state.canvasWorkflows[workflowId]) return;
  state.selectedWorkflowId = workflowId;
  state.selectedNodeId = "";
  state.canvasDrawer = "";
  sessionStorage.setItem("DreameHub_workflow", workflowId);
  sessionStorage.removeItem("DreameHub_prompt");
  await renderStudio();
}

function currentCanvasWorkflow() {
  if (!state.selectedWorkflowId) state.selectedWorkflowId = FREE_CANVAS_ID;
  if (!state.selectedWorkflowId) return null;
  if (!state.canvasWorkflows[state.selectedWorkflowId]) {
    const workflow = baseCanvasWorkflow(state.selectedWorkflowId);
    if (!workflow) return null;
    state.canvasWorkflows[state.selectedWorkflowId] = workflow;
    if (state.canvasWorkflowsLoaded) scheduleCanvasWorkflowSave(workflow);
  }
  return state.canvasWorkflows[state.selectedWorkflowId];
}

function updateCanvasWorkflow(updater, { history = true } = {}) {
  const workflow = currentCanvasWorkflow();
  if (!workflow) return null;
  workflow.links ||= [];
  if (history && !state.isApplyingCanvasHistory) {
    pushCanvasHistorySnapshot(workflow);
  }
  updater(workflow);
  scheduleCanvasWorkflowSave(workflow);
  return workflow;
}

function refreshCanvasWorkflow() {
  renderStudio().catch((error) => toast(error.message));
}

function currentCanvasNode(nodeId) {
  const workflow = currentCanvasWorkflow();
  return workflow?.nodes.find((node) => node.id === nodeId) || null;
}

function currentComposerConfig() {
  return (
    composerModeConfig[state.activeComposerTab] ||
    composerModeConfig["全能参考"]
  );
}

function supportedVideoComposerTabs(
  node = selectedCanvasNode(),
  workflow = currentCanvasWorkflow(),
) {
  const capabilities = videoCapabilities();
  const modes = capabilities.modes || [];
  const hasImageReference = nodeReferenceAssets(node, workflow).some(
    (asset) => asset.type === "image",
  );
  const hasVideoReference = nodeReferenceAssets(node, workflow).some(
    (asset) => asset.type === "video",
  );
  const imageReferenceCount = nodeReferenceAssets(node, workflow).filter(
    (asset) => asset.type === "image",
  ).length;
  const hasAudioReference = nodeReferenceAssets(node, workflow).some(
    (asset) => asset.type === "audio",
  );
  const hasVideoInput =
    (node?.type === "video" && nodeHasReferenceSource(node)) ||
    nodeReferenceAssets(node, workflow).some((asset) => asset.type === "video");
  const tabs = [];
  if (modes.includes("text-to-video")) tabs.push("文生视频");
  if (
    (hasImageReference || hasVideoReference || hasAudioReference) &&
    (modes.includes("reference-to-video") || modes.includes("image-to-video"))
  )
    tabs.push("全能参考");
  if (modes.includes("face-restoration") && hasVideoInput)
    tabs.push("面部修复");
  if (modes.includes("face-swap") && hasVideoInput && hasImageReference)
    tabs.push("视频换脸");
  if (hasImageReference && modes.includes("image-to-video"))
    tabs.push("图生视频");
  if (imageReferenceCount >= 2 && modes.includes("image-to-video"))
    tabs.push("首尾帧");
  return tabs;
}

function currentVideoComposerConfig(
  node = selectedCanvasNode(),
  workflow = currentCanvasWorkflow(),
) {
  const tabs = supportedVideoComposerTabs(node, workflow);
  const hasImageReference = nodeReferenceAssets(node, workflow).some(
    (asset) => asset.type === "image",
  );
  const hasGeneralReference = nodeReferenceAssets(node, workflow).some((asset) =>
    ["image", "video", "audio"].includes(asset.type),
  );
  const hasVideoInput =
    (node?.type === "video" && nodeHasReferenceSource(node)) ||
    nodeReferenceAssets(node, workflow).some((asset) => asset.type === "video");
  const activeTab = tabs.includes(state.activeComposerTab)
    ? state.activeComposerTab
    : hasVideoInput && hasImageReference && tabs.includes("视频换脸")
      ? "视频换脸"
      : hasGeneralReference && tabs.includes("全能参考")
        ? "全能参考"
        : hasImageReference && tabs.includes("图生视频")
          ? "图生视频"
        : tabs[0] || "文生视频";

  if (activeTab === "首尾帧") {
    return {
      ...composerModeConfig["首尾帧"],
      mode: "video",
      engine: "Seedance 2.0",
      modelValue: "seedance:first-last-frame",
      cost: 150,
      hint: "第一张图片作为首帧，第二张图片作为尾帧；也可在图片说明中标注首帧/尾帧。",
      activeTab,
    };
  }
  if (activeTab === "图生视频") {
    return {
      ...composerModeConfig["图生视频"],
      mode: "video",
      engine: "Seedance 2.0",
      modelValue: "seedance:image-to-video",
      cost: 110,
      hint: "读取上游图片节点作为首帧/视觉参考，并结合文本提示生成视频。",
      activeTab,
    };
  }
  if (activeTab === "全能参考") {
    return {
      ...composerModeConfig["全能参考"],
      mode: "video",
      engine: "Seedance 2.0",
      modelValue: "seedance:all-reference",
      cost: 135,
      hint: "读取上游素材作为 reference_image 参考；不会把产品图强制当作第一帧。",
      activeTab,
    };
  }
  if (activeTab === "面部修复") {
    return {
      ...composerModeConfig["面部修复"],
      activeTab,
    };
  }
  if (activeTab === "视频换脸") {
    return {
      ...composerModeConfig["视频换脸"],
      activeTab,
    };
  }

  return {
    ...composerModeConfig["文生视频"],
    activeTab,
  };
}

function imageModelById(modelId) {
  return (
    state.imageModels.find((model) => model.id === modelId) ||
    state.imageModels[0] ||
    null
  );
}

function imageModelCapabilities(modelId) {
  return imageModelById(modelId)?.capabilities || {};
}

function realImageModels() {
  return state.imageModels.filter((model) => model.capabilities?.realApi);
}

function supportsAnyVideoGeneration() {
  return Boolean(state.apiCapabilities?.video?.realApi);
}

function supportsAnyTextGeneration() {
  return Boolean(state.apiCapabilities?.text?.realApi);
}

function supportsImageReference(modelId) {
  return Boolean(imageModelCapabilities(modelId).supportsReferenceImage);
}

function supportsRegionMask(modelId) {
  return Boolean(imageModelCapabilities(modelId).supportsRegionMask);
}

function videoCapabilities() {
  const models = state.apiCapabilities?.video?.models || [];
  const modes = new Set();
  const inputTypes = new Set();
  const merged = {
    output: "video",
    modes: [],
    inputTypes: [],
    supportsReferenceImage: false,
    supportsReferenceVideo: false,
    supportsReferenceAudio: false,
    supportsRegionMask: false,
    supportsFirstLastFrame: false,
    realApi: Boolean(state.apiCapabilities?.video?.realApi),
  };
  for (const model of models) {
    const capabilities = model.capabilities || {};
    for (const mode of capabilities.modes || []) modes.add(mode);
    for (const type of capabilities.inputTypes || []) inputTypes.add(type);
    merged.supportsReferenceImage ||= Boolean(
      capabilities.supportsReferenceImage,
    );
    merged.supportsReferenceVideo ||= Boolean(
      capabilities.supportsReferenceVideo,
    );
    merged.supportsReferenceAudio ||= Boolean(
      capabilities.supportsReferenceAudio,
    );
    merged.supportsRegionMask ||= Boolean(capabilities.supportsRegionMask);
    merged.supportsFirstLastFrame ||= Boolean(
      capabilities.supportsFirstLastFrame,
    );
  }
  merged.modes = [...modes];
  merged.inputTypes = [...inputTypes];
  return merged;
}

function imageCapabilitiesAvailable(capability) {
  return realImageModels().some((model) => model.capabilities?.[capability]);
}

function nodeSemantic(node) {
  const type = node?.type || "text";
  const semantics = {
    text: {
      output: "text",
      accepts: ["text"],
      action: supportsAnyTextGeneration() ? "text-to-text" : "manual-text",
      label: "文本输出",
    },
    script: {
      output: "text",
      accepts: ["text"],
      action: supportsAnyTextGeneration() ? "text-to-text" : "manual-text",
      label: "脚本/文本输出",
    },
    image: {
      output: "image",
      accepts: ["text", "image"],
      action: "image-generation",
      label: "图片输出",
    },
    video: {
      output: "video",
      accepts: ["text", "image", "video", "audio"],
      action: "video-generation",
      label: "视频输出",
    },
    audio: {
      output: "audio",
      accepts: [],
      action: "asset-source",
      label: "音频素材",
    },
  };
  return semantics[type] || semantics.text;
}

function nodeOutputKind(node) {
  return nodeSemantic(node).output;
}

function canConnectNodes(fromNode, toNode) {
  if (!fromNode || !toNode || fromNode.id === toNode.id)
    return { ok: false, reason: "请选择两个不同节点进行连接" };

  const fromKind = nodeOutputKind(fromNode);
  const toType = toNode.type;
  const toSemantic = nodeSemantic(toNode);

  if (!toSemantic.accepts.includes(fromKind)) {
    return {
      ok: false,
      reason: `${toNode.label || toNode.title} 不接收 ${fromNode.label || fromNode.title} 的 ${fromKind} 输出`,
    };
  }

  if (toType === "image" && fromKind === "image") {
    if (!imageCapabilitiesAvailable("supportsReferenceImage")) {
      return {
        ok: false,
        reason:
          "当前真实生图接口都不支持图片参考输入，不能建立图片到图片的参考链路。",
      };
    }
  }

  if (toType === "video") {
    const capabilities = videoCapabilities();
    const modes = capabilities.modes || [];
    if (fromKind === "text" && !modes.includes("text-to-video")) {
      return {
        ok: false,
        reason: "当前视频接口不支持文生视频。",
      };
    }
    if (
      fromKind === "image" &&
      !modes.includes("image-to-video") &&
      !modes.includes("face-swap")
    ) {
      return {
        ok: false,
        reason: "当前视频接口不支持图生视频或视频换脸图片输入。",
      };
    }
    if (
      fromKind === "video" &&
      !modes.includes("face-restoration") &&
      !modes.includes("face-swap")
    ) {
      return {
        ok: false,
        reason: "当前视频接口不支持视频输入。",
      };
    }
    if (fromKind === "audio" && !capabilities.supportsReferenceAudio) {
      return {
        ok: false,
        reason: "当前视频接口不支持音频参考输入。",
      };
    }
  }

  return { ok: true };
}

function workflowComposerKind(workflow = currentCanvasWorkflow()) {
  return (
    workflow?.composerKind ||
    (workflow?.mode === "video"
      ? "video-reference"
      : workflow?.mode === "image"
        ? "image"
        : "text")
  );
}

function selectedCanvasNode(workflow = currentCanvasWorkflow()) {
  if (!workflow || !state.selectedNodeId) return null;
  return (
    workflow.nodes.find((node) => node.id === state.selectedNodeId) || null
  );
}

function canvasIncomingNodes(nodeId, workflow = currentCanvasWorkflow()) {
  if (!workflow || !nodeId) return [];
  const links = workflow.links || [];
  return links
    .filter((link) => link.to === nodeId)
    .map((link) => workflow.nodes.find((node) => node.id === link.from))
    .filter(Boolean);
}

function canvasOutgoingNodes(nodeId, workflow = currentCanvasWorkflow()) {
  if (!workflow || !nodeId) return [];
  return (workflow.links || [])
    .filter((link) => link.from === nodeId)
    .map((link) => workflow.nodes.find((node) => node.id === link.to))
    .filter(Boolean);
}

function canvasAncestorNodes(nodeId, workflow = currentCanvasWorkflow()) {
  if (!workflow || !nodeId) return [];
  const visited = new Set();
  const result = [];
  const walk = (targetId) => {
    (workflow.links || [])
      .filter((link) => link.to === targetId)
      .forEach((link) => {
        if (visited.has(link.from)) return;
        visited.add(link.from);
        const node = workflow.nodes.find((item) => item.id === link.from);
        if (!node) return;
        result.push(node);
        walk(node.id);
      });
  };
  walk(nodeId);
  return result;
}

function nodeTextValue(node) {
  return String(node?.content || node?.prompt || node?.title || "").trim();
}

function isPlaceholderNodeContent(node) {
  const content = String(node?.content || "").trim();
  return [
    "上传或生成图片素材。",
    "视频预览、动作参考或生成结果。",
    "音频、节拍或情绪参考。",
    "双击节点或点击编辑按钮，可直接修改这里的内容。",
  ].includes(content);
}

function nodeComposerPrompt(node, fallback = "") {
  const incomingText = canvasAncestorNodes(node.id)
    .filter((item) => item.type === "text" || item.type === "script")
    .map(nodeTextValue)
    .filter(Boolean)
    .join("\n\n");
  if (node.type === "text" || node.type === "script") {
    return String(node.content || incomingText || fallback || "").trim();
  }
  const ownContent = isPlaceholderNodeContent(node) ? "" : node.content;
  return String(incomingText || ownContent || fallback || "").trim();
}

function clampMediaNodeWidth(width) {
  const value = Number(width || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(MIN_MEDIA_NODE_WIDTH, Math.min(MAX_MEDIA_NODE_WIDTH, value));
}

function mediaNodeDefaultWidth(node) {
  if (node?.type === "image") return 520;
  if (node?.type === "video") return 450;
  return 380;
}

function mediaNodeWidth(node) {
  return (
    clampMediaNodeWidth(node?.mediaWidth) ||
    clampMediaNodeWidth(node?.width) ||
    mediaNodeDefaultWidth(node)
  );
}

function mediaNodePreviewHeight(node, width = mediaNodeWidth(node)) {
  const ratio = Number(node?.aspectRatio || 0);
  if (ratio > 0) return width / ratio;
  return node?.type === "image" ? 370 : 250;
}

function nodeDimensions(node) {
  if (node?.type === "image") {
    const width = mediaNodeWidth(node);
    const height = mediaNodePreviewHeight(node, width);
    return { width, height };
  }
  if (node?.type === "video") {
    const width = mediaNodeWidth(node);
    const mediaHeight = mediaNodePreviewHeight(node, width);
    return { width, height: Math.max(310, mediaHeight + 130) };
  }
  return { width: 380, height: 260 };
}

function ensureNodePosition(node, index = 0) {
  if (!Number.isFinite(Number(node.x))) node.x = 300 + index * 520;
  if (!Number.isFinite(Number(node.y))) node.y = 260;
  return { x: Number(node.x), y: Number(node.y) };
}

function nodeReferenceAssets(node, workflow = currentCanvasWorkflow()) {
  if (!node) return [];
  const incomingIds = new Set(
    canvasIncomingNodes(node.id, workflow).map((item) => item.id),
  );
  return canvasReferenceAssets(workflow).filter((asset) =>
    incomingIds.has(asset.id),
  );
}

function nodeHasReferenceSource(node) {
  if (!node) return false;
  if (node.type === "image") return Boolean(node.image || node.source);
  if (node.type === "video") return Boolean(node.videoUrl || node.source);
  if (node.type === "audio") return Boolean(node.source);
  return false;
}

function nodeWorkflowInputs(node, workflow = currentCanvasWorkflow()) {
  if (!node) return [];
  return canvasIncomingNodes(node.id, workflow).map((input) => ({
    id: input.id,
    type: input.type,
    output: nodeOutputKind(input),
    title: input.title || input.label || "",
    content: nodeTextValue(input),
    hasSource: Boolean(input.source || input.image || input.videoUrl),
  }));
}

function applyReferenceUsageFromPrompt(assets, prompt) {
  const text = String(prompt || "");
  return assets.map((asset) => {
    const ref = escapeRegExp(asset.refName || "");
    if (!ref) return asset;
    const match = text.match(
      new RegExp(`@${ref}(?:\\s*[:：]?\\s*([^@；;\\n]+))?`, "u"),
    );
    return {
      ...asset,
      instruction: match?.[1]?.trim() || "",
    };
  });
}

function referenceRoleText(asset) {
  return [
    asset?.instruction,
    asset?.displayName,
    asset?.originalName,
    asset?.title,
    asset?.label,
    asset?.role,
  ]
    .filter(Boolean)
    .join(" ");
}

function attachVideoReferenceRoles(assets, workflowMode) {
  const modeText = String(workflowMode || "");
  const output = assets.map((asset) => ({ ...asset }));
  const imageIndexes = output
    .map((asset, index) => ({ asset, index }))
    .filter((item) => item.asset.type === "image");
  if (!imageIndexes.length) return output;

  if (/首尾帧|first-last|first_last/i.test(modeText)) {
    const first =
      imageIndexes.find((item) =>
        /首帧|第一帧|开场|起始|开始/u.test(referenceRoleText(item.asset)),
      ) || imageIndexes[0];
    const last =
      imageIndexes.find(
        (item) =>
          item.index !== first.index &&
          /尾帧|末帧|第二帧|第二张关键帧|结束|最终|收尾/u.test(
            referenceRoleText(item.asset),
          ),
      ) ||
      imageIndexes.find((item) => item.index !== first.index) ||
      null;
    if (first) output[first.index].seedanceRole = "first_frame";
    if (last) output[last.index].seedanceRole = "last_frame";
    return output;
  }

  if (/图生视频|image-to-video|首帧/i.test(modeText)) {
    const first =
      imageIndexes.find((item) =>
        /首帧|第一帧|开场|起始|开始/u.test(referenceRoleText(item.asset)),
      ) || imageIndexes[0];
    if (first) output[first.index].seedanceRole = "first_frame";
    return output;
  }

  if (/全能参考|all-reference/i.test(modeText)) {
    for (const [index, asset] of output.entries()) {
      if (asset.type === "image") output[index].seedanceRole = "reference_image";
      if (asset.type === "video") output[index].seedanceRole = "reference_video";
      if (asset.type === "audio") output[index].seedanceRole = "reference_audio";
    }
  }
  return output;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function canvasReferenceAssets(workflow = currentCanvasWorkflow()) {
  if (!workflow) return [];
  const counts = { image: 0, video: 0, audio: 0 };
  let mentionIndex = 0;
  return workflow.nodes
    .filter((node) => ["image", "video", "audio"].includes(node.type))
    .filter(nodeHasReferenceSource)
    .map((node) => {
      counts[node.type] += 1;
      mentionIndex += 1;
      const typeLabel =
        node.type === "image"
          ? "图片"
          : node.type === "video"
            ? "视频"
            : "音频";
      return {
        ...node,
        refName: node.refName || String(mentionIndex),
        displayName: node.displayName || `${typeLabel} ${counts[node.type]}`,
        originalName: materialRefName(
          node.title || node.label,
          node.type,
          counts[node.type],
        ),
        role: node.role || "",
      };
    });
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toast(message) {
  toastHost.innerHTML = `<div class="app-toast">${message}</div>`;
  setTimeout(() => {
    toastHost.innerHTML = "";
  }, 2400);
}

function setButtonLoading(button, loadingText) {
  if (!button) return () => {};
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = loadingText;
  return () => {
    button.disabled = false;
    button.textContent = originalText;
  };
}

async function loadPanel(label, request) {
  try {
    const payload = await request();
    return { ok: true, payload };
  } catch (error) {
    toast(`${label}加载失败：${error.message}`);
    return { ok: false, error };
  }
}

function money(value) {
  return `¥${Number(value).toFixed(0)}`;
}

function setRoute(route) {
  window.location.hash = route;
}

function requireLogin(nextRoute = window.location.hash || "#/studio") {
  if (state.user) return true;
  sessionStorage.setItem("DreameHub_afterLogin", nextRoute);
  toast("请先登录后使用该功能");
  setRoute("#/login");
  return false;
}

async function refreshGenerationHistoryCache({ updateDom = true } = {}) {
  if (!state.user || state.generationHistoryLoading)
    return state.generationHistory;
  state.generationHistoryLoading = true;
  try {
    const payload = await api("/api/generations");
    state.generationHistory = payload.generations || [];
    state.generationHistoryLoaded = true;
    if (updateDom) updateGenerationHistoryPanels();
  } catch (error) {
    toast(`历史记录加载失败：${error.message}`);
  } finally {
    state.generationHistoryLoading = false;
  }
  return state.generationHistory;
}

function updateGenerationHistoryPanels() {
  const html = historyHtml(state.generationHistory);
  const compact = document.querySelector("#generationHistory");
  if (compact) compact.innerHTML = html;
  const drawer = document.querySelector("#drawerHistoryList");
  if (drawer) drawer.innerHTML = html;
}

function routeParts() {
  const route = window.location.hash.replace(/^#/, "") || "/";
  return route.split("/").filter(Boolean);
}

function renderAuthArea() {
  const authArea = document.querySelector("#authArea");
  if (!state.user) {
    authArea.innerHTML = `
      <a class="ghost-link route-link" href="#/login">登录</a>
      <a class="primary-link route-link" href="#/login">开始创作</a>
    `;
    return;
  }

  authArea.innerHTML = `
    <a class="user-chip route-link" href="#/console">
      <span>会员中心</span>
      <strong>${state.user.credits}</strong> 点
    </a>
    <button class="ghost-btn" id="logoutBtn" type="button">退出</button>
  `;
  document.querySelector("#logoutBtn").addEventListener("click", logout);
}

function shellHeading(eyebrow, title, copy = "") {
  return `
    <div class="page-heading">
      <p class="eyebrow">${eyebrow}</p>
      <h1>${title}</h1>
      ${copy ? `<p>${copy}</p>` : ""}
    </div>
  `;
}

async function loadCommon() {
  const payload = await api("/api/bootstrap");
  state.models = payload.models || [];
  state.imageModels = payload.imageModels || [];
  state.apiCapabilities = payload.capabilities || null;
  state.workflows = payload.workflows || [];
  state.user = payload.user;
  renderAuthArea();
}

async function renderHome() {
  const [{ stats }, { works }] = await Promise.all([
    api("/api/stats"),
    api("/api/community"),
  ]);
  const seedancePromoVideo = "/assets/seedance2/promo-main.mp4";
  const seedanceSecondaryVideo = "/assets/seedance2/promo-secondary.mp4";
  const seedanceGifDemos = [
    {
      src: "/assets/seedance2/demo-1.gif",
      title: "多模态参考",
      subtitle: "图片、视频、音频素材可灵活组合",
    },
    {
      src: "/assets/seedance2/demo-2.gif",
      title: "视频智能创作",
      subtitle: "可视频延长、衔接补全、精准编辑",
    },
    {
      src: "/assets/seedance2/demo-3.gif",
      title: "还原真实世界",
      subtitle: "符合物理规律，运动质量大幅提升",
    },
    {
      src: "/assets/seedance2/demo-4.gif",
      title: "聪明也更听话",
      subtitle: "意图理解更强，能推理、精准遵循",
    },
  ];
  const gptImagePromo = "/assets/gpt-image-2-promo.png";
  appView.innerHTML = `
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-media seedance-hero-media" aria-hidden="true">
        <video src="${seedancePromoVideo}" muted autoplay loop playsinline preload="metadata"></video>
      </div>
      <div class="hero-content">
        <p class="eyebrow">Seedance 2.0 · GPT Images 2.0 · DreameHub</p>
        <h1 id="hero-title" class="seedance-title"><span>Seedance</span><em>2.0</em></h1>
        <form class="prompt-shell" id="heroForm">
          <input id="heroPrompt" type="text" value="商业人像广告，真实镜头运动，清晰产品展示，电影级光影" aria-label="输入创作提示词" />
          <button class="primary-btn" type="submit">生成</button>
        </form>
        <div class="hero-stats">
          <span><strong>${stats.models}</strong> 模型</span>
          <span><strong>${stats.works}</strong> 作品</span>
          <span><strong>${stats.calls}</strong> 调用</span>
          <span><strong>${stats.creators}</strong> 创作者</span>
        </div>
      </div>
    </section>
    <section class="section ai-promo-section" aria-label="Seedance 2.0 与 GPT Images 2.0 宣传素材">
      <article class="ai-promo-card image gpt-promo-card">
        <div class="promo-media-frame">
          <img src="${gptImagePromo}" alt="GPT Images 2.0 宣传图" />
        </div>
        <div class="promo-card-copy gpt-promo-card-copy">
          <span>GPT Images 2.0</span>
          <h2>高质量图像创作</h2>
          <p>从产品图、人物肖像到空间设计，用统一提示词和节点引用生成可继续迭代的视觉资产。</p>
        </div>
      </article>
      <div class="seedance-gif-showcase">
        ${seedanceGifDemos
          .map(
            (demo, index) => `
          <figure>
            <img src="${demo.src}" alt="${demo.title}" loading="lazy" />
            <figcaption>
              <span>AI</span>
              <div>
                <h3>${demo.title}</h3>
                <p>${demo.subtitle}</p>
              </div>
              <a class="route-link" href="#/studio">立即体验 ›</a>
            </figcaption>
          </figure>
        `,
          )
          .join("")}
      </div>
    </section>
    <section class="section">
      <div class="section-heading">
        <div><p class="eyebrow">Featured</p><h2>热门模型</h2></div>
        <a class="ghost-link route-link" href="#/models">查看全部</a>
      </div>
      <div class="model-grid">${state.models.slice(0, 3).map(modelCard).join("")}</div>
    </section>
    <section class="section">
      <div class="section-heading">
        <div><p class="eyebrow">Community</p><h2>社区作品流</h2></div>
      </div>
      <div class="community-grid">${works.map(workCard).join("")}</div>
    </section>
  `;

  document.querySelector("#heroForm").addEventListener("submit", (event) => {
    event.preventDefault();
    sessionStorage.setItem(
      "DreameHub_prompt",
      document.querySelector("#heroPrompt").value,
    );
    if (!requireLogin("#/studio")) return;
    setRoute("#/studio");
  });
}

function modelCard(model) {
  return `
    <article class="model-card">
      <a class="route-link" href="#/models/${model.id}">
        <img src="${model.image}" alt="${model.title}" />
        <div class="card-body">
          <h3>${model.title}</h3>
          <p>${model.description}</p>
          <div class="meta"><span>${model.usage}</span><span>${model.score}</span></div>
        </div>
      </a>
    </article>
  `;
}

function workCard(work) {
  return `
    <article class="community-card">
      <img src="${work.image}" alt="${work.title}" />
      <div><h3>${work.title}</h3><p>@${work.creator}</p></div>
    </article>
  `;
}

async function renderModels(category = "all") {
  const payload = await api(`/api/models?category=${category}`);
  appView.innerHTML = `
    <section class="section page-section">
      ${shellHeading("Models", "模型广场", "筛选模型、查看详情，并直接进入创作工作台。")}
      <div class="filter-tabs" id="modelFilters">
        ${[
          "all:全部",
          "portrait:人像",
          "anime:动漫",
          "product:商品",
          "video:视频",
        ]
          .map((item) => {
            const [key, label] = item.split(":");
            return `<button class="${category === key ? "active" : ""}" type="button" data-filter="${key}">${label}</button>`;
          })
          .join("")}
      </div>
      <div class="model-grid spacious">${payload.models.map(modelCard).join("")}</div>
    </section>
  `;
  document.querySelector("#modelFilters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    toast(`正在筛选：${button.textContent}`);
    renderModels(button.dataset.filter).catch((error) => toast(error.message));
  });
}

async function renderModelDetail(id) {
  const { model } = await api(`/api/models/${id}`);
  appView.innerHTML = `
    <section class="section detail-layout page-section">
      <div>
        <img class="detail-media" src="${model.image}" alt="${model.title}" />
        <div class="sample-grid">${model.samples.map((sample) => `<img src="${sample}" alt="${model.title} 样张" />`).join("")}</div>
      </div>
      <div class="detail-panel">
        <span class="badge">${model.badge}</span>
        <h1>${model.title}</h1>
        <p>${model.description}</p>
        <dl class="spec-list">
          <div><dt>作者</dt><dd>${model.creator}</dd></div>
          <div><dt>价格</dt><dd>${model.price}</dd></div>
          <div><dt>授权</dt><dd>${model.license}</dd></div>
          <div><dt>评分</dt><dd>${model.score}</dd></div>
        </dl>
        <div class="tag-row">${model.tags.map((tag) => `<span>${tag}</span>`).join("")}</div>
        <button class="primary-btn" id="useModelBtn" type="button">使用该模型创作</button>
      </div>
    </section>
  `;
  document.querySelector("#useModelBtn").addEventListener("click", () => {
    sessionStorage.setItem("DreameHub_model", model.id);
    if (!requireLogin("#/studio")) return;
    toast("正在打开创作工作台");
    setRoute("#/studio");
  });
}

async function renderStudio() {
  if (!requireLogin("#/studio")) return;
  await ensureCanvasWorkflowsLoaded();
  if (!state.generationHistoryLoaded) {
    refreshGenerationHistoryCache().catch((error) => toast(error.message));
  }
  const workflow = selectedCanvasWorkflow();
  workflow.links ||= [];
  const selectedNode = selectedCanvasNode(workflow);
  const prompt = selectedNode
    ? nodeComposerPrompt(selectedNode, "")
    : sessionStorage.getItem("DreameHub_prompt") || workflow?.prompt || "";
  const defaultImageModel =
    state.imageModels.find((item) => item.id === "openai:gpt-image-2") ||
    state.imageModels.find((item) => item.id === "openai:gpt-image-1") ||
    state.imageModels.find((item) => item.id === "pollinations:flux") ||
    state.imageModels[0];
  appView.innerHTML = `
    <section class="canvas-workbench" aria-label="创作画布工作台">
      ${canvasTopbar()}
      <div class="canvas-shell">
        ${canvasSideRail()}
        <div class="infinite-canvas has-workflow">
          <div class="canvas-viewport" style="--canvas-zoom: ${state.canvasZoom}; --canvas-pan-x: ${state.canvasPanX}px; --canvas-pan-y: ${state.canvasPanY}px;">
            ${workflowBoardHtml(workflow, prompt, defaultImageModel)}
          </div>
          ${canvasFixedOverlayHtml(workflow, state.generationHistory)}
          ${nodeComposerHtml(workflow, selectedNode, prompt, defaultImageModel)}
        </div>
        <div class="zoom-dock" aria-label="画布缩放">
          <button type="button" data-zoom-action="grid" title="网格视图">⌘</button>
          <button type="button" data-zoom-action="fit" title="定位">⌖</button>
          <button class="active" type="button" data-zoom-action="snap" title="吸附">⌁</button>
          <button type="button" id="zoomOut">−</button>
          <strong id="zoomValue">${Math.round(state.canvasZoom * 100)}%</strong>
          <button type="button" id="zoomIn">＋</button>
        </div>
        <div class="canvas-drawer" id="canvasDrawer" ${state.canvasDrawer ? "" : "hidden"}>${canvasDrawerHtml()}</div>
        <div class="canvas-context-menu" id="canvasContextMenu" hidden>
          ${canvasContextMenuHtml()}
        </div>
        <div class="add-node-menu" id="addNodeMenu" hidden>
          <strong>添加节点</strong>
          <button type="button" data-add-node-type="text"><span>☰</span><b>文本</b></button>
          <button type="button" data-add-node-type="image"><span>▧</span><b>图片</b><em>海报、分镜、角色设计</em></button>
          ${supportsAnyVideoGeneration() ? '<button type="button" data-add-node-type="video"><span>▶</span><b>视频</b></button>' : ""}
          <button type="button" data-add-node-type="audio"><span>≋</span><b>音频</b></button>
          <button type="button" data-add-node-type="script"><span>▤</span><b>脚本（已接入skill）</b></button>
        </div>
        <input id="canvasFileInput" type="file" accept="image/*,audio/*,video/*,.txt,.md" hidden />
      </div>
    </section>
  `;
  bindStudio();
}

function selectedCanvasWorkflow() {
  return currentCanvasWorkflow();
}

function canvasTopbar() {
  const workflow = currentCanvasWorkflow();
  const workflows = canvasWorkflowList();
  const options = workflows
    .map(
      (item) =>
        `<option value="${escapeHtml(item.id)}" ${item.id === state.selectedWorkflowId ? "selected" : ""}>${escapeHtml(item.title || "未命名工作流")}</option>`,
    )
    .join("");
  return `
    <div class="canvas-topbar">
      <a class="canvas-brand route-link" href="#/">
        <span class="canvas-logo">D</span>
        <strong>DreameHub</strong>
      </a>
      <div class="workflow-switcher">
        <span>${escapeHtml(workflow?.title || "未命名工作流")}</span>
        <select id="canvasWorkflowSelect" aria-label="切换工作流">${options}</select>
        <button type="button" id="createCanvasWorkflowBtn" title="新建工作流">＋</button>
      </div>
      <div class="canvas-actions">
        <a class="credit-pill route-link" href="#/pricing"><span>限时 37 折</span><strong>会员特惠37折</strong><em>✦ ${state.user.credits}</em></a>
      </div>
    </div>
  `;
}

function canvasSideRail() {
  return `
    <aside class="canvas-rail" aria-label="画布工具">
      <button class="rail-add" type="button" id="newWorkflowBtn" title="新建">＋</button>
      <button type="button" data-rail-action="workflows" title="工作流">⌘</button>
      <button type="button" data-rail-action="assets" title="素材">◇</button>
      <button type="button" data-rail-action="history" title="历史">◷</button>
      <span></span>
      <button type="button" data-rail-action="help" title="帮助">?</button>
      <button type="button" data-rail-action="support" title="客服">☊</button>
    </aside>
  `;
}

function workflowLauncherHtml() {
  return `
    <div class="launcher-center">
      <div class="double-click-hint">◒ <span>双击画布 自由生成节点</span></div>
      <div class="preset-strip">
        ${canvasWorkflowPresets.slice(0, 4).map(presetCardHtml).join("")}
      </div>
      <div class="preset-grid">
        ${canvasWorkflowPresets.slice(4).map(presetCardHtml).join("")}
      </div>
    </div>
  `;
}

function canvasDrawerHtml() {
  const workflow = currentCanvasWorkflow();
  const drawerTitle =
    {
      workflows: "工作流预设",
      assets: "素材库",
      history: "历史记录",
      help: "工作台帮助",
      params: "参数面板",
    }[state.canvasDrawer] || "画布面板";

  if (!state.canvasDrawer) return "";

  if (state.canvasDrawer === "workflows") {
    const savedWorkflows = canvasWorkflowList()
      .map(
        (item) => `
        <button class="${item.id === state.selectedWorkflowId ? "active" : ""}" type="button" data-switch-workflow="${escapeHtml(item.id)}">
          <span>${item.id === state.selectedWorkflowId ? "当前工作流" : "已保存"}</span>
          <strong>${escapeHtml(item.title || "未命名工作流")}</strong>
        </button>
      `,
      )
      .join("");
    return `
      <div class="drawer-head"><strong>工作流</strong><button type="button" data-drawer-close>×</button></div>
      <button class="drawer-upload" type="button" data-create-workflow>新建工作流</button>
      <div class="drawer-list workflow-saved-list">
        ${savedWorkflows || '<p class="empty-state">暂无已保存工作流。</p>'}
      </div>
      <div class="drawer-head drawer-subhead"><strong>自由节点</strong></div>
      <div class="drawer-list">
        <button type="button" data-add-node-type="text"><span>文本</span><strong>手写内容或用模型生成文本</strong></button>
        <button type="button" data-add-node-type="image"><span>图片</span><strong>接入文本后文生图，也可上传图片</strong></button>
        ${supportsAnyVideoGeneration() ? '<button type="button" data-add-node-type="video"><span>视频</span><strong>接入文本或图片，实现文生视频/图生视频</strong></button>' : ""}
        <button type="button" data-add-node-type="audio"><span>音频</span><strong>作为节奏、音乐或情绪参考</strong></button>
      </div>
    `;
  }

  if (state.canvasDrawer === "assets") {
    return `
      <div class="drawer-head"><strong>${drawerTitle}</strong><button type="button" data-drawer-close>×</button></div>
      <button class="drawer-upload" type="button" data-asset-action="upload">上传图片 / 音频 / 文档</button>
      <div class="drawer-list">
        ${
          (workflow?.nodes || [])
            .map(
              (node) => `
          <button type="button" data-select-node="${node.id}">
            <span>${node.savedToAssets ? "我的素材" : node.type}</span>
            <strong>${escapeHtml(node.label || node.title)}</strong>
          </button>
        `,
            )
            .join("") ||
          '<p class="empty-state">先添加或上传节点，再管理素材。</p>'
        }
      </div>
    `;
  }

  if (state.canvasDrawer === "history") {
    return `
      <div class="drawer-head"><strong>${drawerTitle}</strong><button type="button" data-drawer-close>×</button></div>
      <div class="drawer-list history-list" id="drawerHistoryList">${historyHtml(state.generationHistory)}</div>
    `;
  }

  if (state.canvasDrawer === "params") {
    return `
      <div class="drawer-head"><strong>${drawerTitle}</strong><button type="button" data-drawer-close>×</button></div>
      <div class="drawer-list">
        <label>镜头运动<select data-param-select="camera"><option>摄像机推进</option><option>环绕</option><option>固定镜头</option></select></label>
        <label>画面节奏<select data-param-select="pace"><option>自然</option><option>快速切换</option><option>慢镜头</option></select></label>
        <label>一致性<input type="range" min="0" max="100" value="82" data-param-range="consistency" /></label>
      </div>
    `;
  }

  return `
    <div class="drawer-head"><strong>${drawerTitle}</strong><button type="button" data-drawer-close>×</button></div>
    <div class="drawer-list">
      <p>双击节点可编辑内容；点击连线加号可插入节点；上传按钮可替换素材；底部箭头会调用现有生成接口。</p>
      <p>左下角支持缩放、定位和吸附切换，顶部工具栏支持分享、下载、全屏和画布模式切换。</p>
    </div>
  `;
}

function presetCardHtml(preset) {
  return `
    <button class="preset-card ${preset.accent}" type="button" data-workflow-id="${preset.id}">
      <span>${preset.icon}</span>
      <strong>${preset.title}</strong>
      <small>${preset.subtitle}</small>
    </button>
  `;
}

function workflowBoardHtml(workflow, prompt, defaultImageModel) {
  const nodeHtml = workflow.nodes.length
    ? workflow.nodes
        .map((node, index) => workflowNodeHtml(node, index))
        .join("")
    : "";
  return `
    <div class="workflow-stage" style="--node-count: ${workflow.nodes.length}">
      <div class="workflow-node-layer">
        ${workflowLinksHtml(workflow)}
        ${nodeHtml}
      </div>
    </div>
  `;
}

function canvasFixedOverlayHtml(workflow, generations) {
  return `
    ${
      workflow.nodes.length
        ? ""
        : `<div class="canvas-empty-hint">
      <strong>右键空白处或点击左侧 + 添加节点</strong>
      <span>文本节点可以手写或调用模型；图片/视频节点会读取上游连线内容。</span>
    </div>`
    }
    <div class="canvas-history ${state.canvasHistoryOpen ? "open" : ""}">
      <button type="button" id="historyToggle">生成历史</button>
      <div id="generationHistory" class="history-list compact-history">${historyHtml(generations)}</div>
    </div>
  `;
}

function nodeComposerHtml(workflow, node, prompt, defaultImageModel) {
  if (!node) return "";
  if (node.type === "text" || node.type === "script")
    return textComposerHtml(workflow, node, node.content || prompt || "");
  if (node.type === "image")
    return imageComposerHtml(
      workflow,
      node,
      nodeComposerPrompt(node, prompt),
      defaultImageModel,
    );
  if (node.type === "video")
    return supportsAnyVideoGeneration()
      ? videoReferenceComposerHtml(
          workflow,
          node,
          nodeComposerPrompt(node, prompt),
          defaultImageModel,
        )
      : unavailableComposerHtml(
          "视频生成",
          state.apiCapabilities?.video?.reason ||
            "当前未接入真实视频生成 API。",
        );
  return assetComposerHtml(workflow, node);
}

function unavailableComposerHtml(title, reason) {
  return `
    <div class="prompt-composer asset-composer">
      <div class="mode-status">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(reason)}</span>
      </div>
      <p class="form-hint">该功能没有对应的真实 API，已隐藏生成参数和提交按钮。</p>
    </div>
  `;
}

function textComposerHtml(workflow, node, prompt) {
  const canGenerateText = supportsAnyTextGeneration();
  const isScript = node.type === "script";
  const modelOptions = isScript
    ? `
            <option value="seedance-prompt-zh" selected>脚本免费</option>
            <option value="seedance-prompt-zh-openai">脚本 OpenAI</option>`
    : `
            <option value="dreamehub-free-chat" selected>文本免费</option>
            <option value="openai-chat">文本 OpenAI</option>`;
  const defaultModel = isScript ? "seedance-prompt-zh" : "dreamehub-free-chat";
  const hint = isScript
    ? `当前选中「${escapeHtml(node.label || node.title)}」。脚本节点会接入 Seedance 2.0 skill，生成分镜、时间轴和视频提示词。`
    : `当前选中「${escapeHtml(node.label || node.title)}」。文本节点只做普通文本生成，不接入 Seedance 2.0 skill。`;
  return `
    <form class="prompt-composer text-composer" id="generationForm" data-composer-kind="text">
      <div class="composer-assets text-only">
        <div class="composer-node-icon">▤<sup>${canvasIncomingNodes(node.id).length}</sup></div>
      </div>
      <textarea id="promptInput" rows="4" aria-label="输入文本内容或生成提示词">${escapeHtml(prompt || "")}</textarea>
      <div class="composer-footer">
        <label class="engine-select">✣
          <select id="imageModelSelect">
${modelOptions}
          </select>
        </label>
        <input id="workflowMode" type="hidden" value="text" />
        <input id="workflowEngine" type="hidden" value="${defaultModel}" />
        <span class="composer-spacer"></span>
        <button class="text-tool" type="button" data-composer-action="translate" title="翻译">文A</button>
        ${canGenerateText ? '<span class="cost-pill">✦ 6</span><button class="send-btn" id="submitGenerationBtn" type="submit" title="生成">↑</button>' : ""}
      </div>
      <p class="form-hint" id="imageEngineHint">${canGenerateText ? hint : "当前未接入真实文本生成 API；文本节点仅支持手写和编辑。"}</p>
    </form>
  `;
}

function batchOutputEditorHtml(workflow) {
  if (!workflow?.batchOutputs?.length) return "";

  return `
    <div class="batch-output-editor">
      <div class="batch-output-editor-head">
        <strong>批量输出设置</strong>
        <span>这里可以编辑每张图的标题、尺寸和 promptSuffix</span>
      </div>

      ${workflow.batchOutputs
        .map(
          (output, index) => `
            <div class="batch-output-item">
              <div class="batch-output-row">
                <label>
                  <span>输出标题</span>
                  <input
                    type="text"
                    value="${escapeHtml(output.title || "")}"
                    data-batch-output-index="${index}"
                    data-batch-output-field="title"
                    placeholder="例如：主海报"
                  />
                </label>

                <label>
                  <span>输出尺寸</span>
                  <select
                    data-batch-output-index="${index}"
                    data-batch-output-field="size"
                  >
                    <option value="1024x1536" ${output.size === "1024x1536" ? "selected" : ""}>9:16 · 竖版</option>
                    <option value="1536x1024" ${output.size === "1536x1024" ? "selected" : ""}>16:9 · 横版</option>
                    <option value="1024x1024" ${output.size === "1024x1024" ? "selected" : ""}>1:1 · 方图</option>
                    <option value="auto" ${output.size === "auto" ? "selected" : ""}>自动</option>
                  </select>
                </label>
              </div>

              <label>
                <span>promptSuffix</span>
                <textarea
                  rows="3"
                  data-batch-output-index="${index}"
                  data-batch-output-field="promptSuffix"
                  placeholder="例如：输出主海报 1 张，突出产品主体，标题区域留白。"
                >${escapeHtml(output.promptSuffix || "")}</textarea>
              </label>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function imageComposerHtml(workflow, node, prompt, defaultImageModel) {
  const references = nodeReferenceAssets(node, workflow).filter(
    (asset) => asset.id !== node.id || asset.source || asset.image,
  );
  const hasImageReferences = references.some((asset) => asset.type === "image");
  const imageModels = realImageModels();
  const selectedModel =
    (hasImageReferences
      ? imageModels.find(
          (model) =>
            model.id === state.selectedImageModelId &&
            model.capabilities?.supportsReferenceImage,
        ) ||
        imageModels.find((model) => model.id === "openai:gpt-image-2") ||
        imageModels.find((model) => model.capabilities?.supportsReferenceImage)
      : imageModels.find((model) => model.id === state.selectedImageModelId)) ||
    imageModels.find((model) => model.id === "openai:gpt-image-2") ||
    imageModels.find((model) => model.id === "pollinations:flux") ||
    imageModels[0] ||
    defaultImageModel;
  const capabilities = selectedModel?.capabilities || {};
  const supportedReferences = references.filter(
    (asset) => asset.type !== "image" || capabilities.supportsReferenceImage,
  );
  const unsupportedReferences = references.filter(
    (asset) => asset.type === "image" && !capabilities.supportsReferenceImage,
  );
  const canGenerate = Boolean(selectedModel) && !unsupportedReferences.length;
  const config = composerModeConfig["文生图"];

  return `
    <form class="prompt-composer image-composer" id="generationForm" data-composer-kind="image">
      <div class="mode-status">
        <strong>${selectedModel?.label || config.engine}</strong>
        <span>${unsupportedReferences.length ? "当前真实生图 API 不支持图片参考输入；请移除图片上游，或接入支持参考图的模型。" : "当前真实接口支持文生图；只显示该接口实际支持的参数。"}</span>
      </div>

      ${
        supportedReferences.length
          ? `<div class="composer-assets">
        ${supportedReferences
          .slice(0, 4)
          .map(
            (asset) =>
              `<button class="asset-token" type="button" data-insert-mention="${asset.refName}">
                ${
                  asset.image
                    ? `<img src="${asset.image}" alt="${escapeHtml(asset.displayName)}" />`
                    : `<strong>${escapeHtml(asset.displayName)}</strong>`
                }
                <span>${escapeHtml(asset.displayName)}</span>
              </button>`,
          )
          .join("")}
      </div>`
          : ""
      }

      ${referencePromptHtml(supportedReferences, prompt)}

      <div class="composer-footer">
        <label class="engine-select">✣
          <select id="imageModelSelect">
            ${imageModels
              .map(
                (model) =>
                  `<option value="${model.id}" ${model.id === selectedModel?.id ? "selected" : ""}>${model.label}</option>`,
              )
              .join("")}
          </select>
        </label>

        ${imageSettingControls(selectedModel)}

        <span class="composer-spacer"></span>

        <button class="text-tool" type="button" data-composer-action="translate" title="翻译">文A</button>
        <span class="cost-pill">✦ ${config.cost}</span>
        ${canGenerate ? '<button class="send-btn" id="submitGenerationBtn" type="submit" title="生成">↑</button>' : ""}
      </div>

      <input id="workflowMode" type="hidden" value="image" />
      <input id="workflowEngine" type="hidden" value="${selectedModel?.id || ""}" />

      <p class="form-hint" id="imageEngineHint">
        ${unsupportedReferences.length ? "已隐藏 @参考和标记等不支持功能；当前模型不会消费图片 1。" : "直接输入画面描述即可生成图片；文本上游会作为提示词来源。"}
      </p>
    </form>
  `;
}

function videoReferenceComposerHtml(workflow, node, prompt, defaultImageModel) {
  const references = nodeReferenceAssets(node, workflow);
  const supportedTabs = supportedVideoComposerTabs(node, workflow);
  const config = currentVideoComposerConfig(node, workflow);
  const videoModels = state.apiCapabilities?.video?.models || [];
  const imageRefs = references.filter((asset) => asset.type === "image");
  const isFaceRestore = config.activeTab === "面部修复";
  const isFaceSwap = config.activeTab === "视频换脸";
  const strengthValue = config.defaultStrength || 72;
  const strengthLabel = isFaceRestore
    ? "修复强度"
    : isFaceSwap
      ? "换脸强度"
      : "风格";
  const faceSpecialControls = isFaceRestore
    ? `<div class="face-restore-controls">
        <label class="style-inline">模型保真 <span id="faceRestoreFidelityValue">50</span><input id="faceRestoreFidelity" type="range" min="0" max="100" value="50" /></label>
        <label class="style-inline">细节放大 <span id="faceRestoreScaleValue">1.25</span><input id="faceRestoreScale" type="range" min="100" max="200" step="5" value="125" /></label>
        <label class="style-inline">边缘范围 <span id="faceRestorePaddingValue">12</span><input id="faceRestorePadding" type="range" min="0" max="35" value="12" /></label>
      </div>`
	    : isFaceSwap
	      ? `<div class="face-restore-controls">
	          <label class="style-inline">边缘羽化 <span id="faceSwapFeatherValue">22</span><input id="faceSwapFeather" type="range" min="2" max="50" value="22" /></label>
	          <label class="style-inline">色彩匹配 <span id="faceSwapColorMatchValue">75</span><input id="faceSwapColorMatch" type="range" min="0" max="100" value="75" /></label>
	        </div>`
	      : "";
  const seedanceControls =
    isFaceRestore || isFaceSwap
      ? ""
      : `
        <div class="seedance-video-controls">
          <label>
            <span>视频比例</span>
            <select id="videoAspectRatio">
              <option value="auto">智能比例</option>
              <option value="21:9">21:9</option>
              <option value="16:9" selected>16:9</option>
              <option value="4:3">4:3</option>
              <option value="1:1">1:1</option>
              <option value="3:4">3:4</option>
              <option value="9:16">9:16</option>
            </select>
          </label>
          <label>
            <span>分辨率</span>
            <select id="videoResolution">
              <option value="480p">480p</option>
              <option value="720p" selected>720p</option>
              <option value="1080p">1080p</option>
            </select>
          </label>
          <label>
            <span>视频时长</span>
            <input id="videoDuration" type="number" min="${SEEDANCE_DURATION_MIN}" max="${SEEDANCE_DURATION_MAX}" step="1" value="5" />
          </label>
          <label>
            <span>生成数量</span>
            <input id="videoCount" type="number" min="1" max="4" step="1" value="1" />
          </label>
          <label class="check-row seedance-audio-toggle">
            <input id="videoGenerateAudio" type="checkbox" />
            输出声音
          </label>
          <label class="check-row seedance-audio-toggle">
            <input id="videoWatermark" type="checkbox" />
            水印
          </label>
          <label class="check-row seedance-audio-toggle">
            <input id="videoReturnLastFrame" type="checkbox" />
            返回尾帧
          </label>
          <label class="check-row seedance-audio-toggle">
            <input id="videoCameraFixed" type="checkbox" />
            固定镜头
          </label>
          <label class="check-row seedance-audio-toggle">
            <input id="videoDraft" type="checkbox" />
            Draft
          </label>
          <label class="check-row seedance-audio-toggle">
            <input id="videoWebSearch" type="checkbox" />
            联网搜索
          </label>
          <label>
            <span>随机种子</span>
            <input id="videoSeed" type="number" step="1" placeholder="随机" />
          </label>
          <label>
            <span>Draft ID</span>
            <input id="videoDraftTaskId" type="text" placeholder="可选" />
          </label>
          <label>
            <span>服务等级</span>
            <select id="videoServiceTier">
              <option value="">默认</option>
              <option value="default">default</option>
            </select>
          </label>
        </div>`;
  const modeSummary = isFaceRestore
    ? "将使用当前视频节点或上游视频素材进行保真人脸增强；强度越高越容易改变原片质感。"
    : isFaceSwap
      ? `将使用当前视频和 ${imageRefs[0]?.displayName || "参考脸图"} 进行逐帧换脸，并输出新视频节点。`
      : config.activeTab === "首尾帧"
        ? "第一张上游图片作为首帧，第二张上游图片作为尾帧；可用图片标题或提示词标注首帧/尾帧。"
      : config.activeTab === "图生视频"
        ? `已接入 ${imageRefs.length} 张上游图片，将作为 Seedance 图生视频输入。`
        : config.activeTab === "全能参考"
          ? `已接入 ${imageRefs.length} 张图片参考，会作为 reference_image 提交。`
          : "未绑定图片时按纯文本生成视频；连接图片节点后可选择全能参考、图生视频或首尾帧。";
  return `
      <form class="prompt-composer" id="generationForm" data-composer-kind="video">
        <div class="composer-tabs">
          ${supportedTabs
            .map(
              (tab) =>
                `<button class="${config.activeTab === tab ? "active" : ""}" type="button" data-composer-tab="${tab}">${tab}</button>`,
            )
            .join("")}
          <button class="composer-expand" type="button" data-composer-action="expand" title="展开">↗</button>
        </div>
        <div class="mode-status">
          <strong>${config.engine}</strong>
          <span>${modeSummary}</span>
        </div>
        <div class="composer-assets">
          <button type="button" data-asset-action="mark"><strong>⌖</strong><span>标记</span></button>
          <button type="button" data-asset-action="focus"><strong>◫</strong><span>聚焦</span></button>
          <button type="button" data-asset-action="upload"><strong>▣</strong><span>素材</span></button>
          ${references
            .slice(0, 4)
            .map(
              (asset) =>
                `<button class="asset-token" type="button" data-insert-mention="${asset.refName}">${asset.image ? `<img src="${asset.image}" alt="${escapeHtml(asset.displayName)}" />` : `<strong>${asset.displayName}</strong>`}<span>${escapeHtml(asset.displayName)}</span></button>`,
            )
            .join("")}
          <div class="asset-thumb">▶</div>
        </div>
	        ${referencePromptHtml(references, prompt)}
	        ${faceSpecialControls}
	        ${seedanceControls}
	        <div class="composer-footer">
          <label class="engine-select">✣
            <select id="imageModelSelect">
              <option value="${config.modelValue}" selected>${config.engine}</option>
            </select>
          </label>
          <label class="style-inline">${strengthLabel} <span id="styleValue">${strengthValue}</span><input id="styleRange" type="range" min="0" max="100" value="${strengthValue}" /></label>
          <span class="composer-spacer"></span>
          <button class="text-tool" type="button" data-composer-action="translate" title="翻译">文A</button>
          <button class="text-tool" type="button" data-composer-action="params" title="参数">⌘</button>
          <span class="cost-pill">✦ ${config.cost}</span>
          <button class="send-btn" id="submitGenerationBtn" type="submit" title="生成" ${node.activeGenerationJob ? "disabled" : ""}>↑</button>
        </div>
        <input id="workflowMode" type="hidden" value="${config.mode}" />
        <input id="workflowEngine" type="hidden" value="${config.modelValue}" />
        <p class="form-hint" id="imageEngineHint">${config.mention ? "输入 @ 可选择已上传素材；可直接提交，也可补充素材用途说明。" : config.hint}</p>
      </form>
  `;
}

function assetComposerHtml(workflow, node) {
  const incoming = canvasIncomingNodes(node.id)
    .map((item) => item.label || item.title)
    .filter(Boolean)
    .join("、");
  return `
    <div class="prompt-composer asset-composer">
      <div class="mode-status">
        <strong>${escapeHtml(node.label || node.title)}</strong>
        <span>${incoming ? `已接入：${escapeHtml(incoming)}` : "这是素材节点，可上传替换，也可连接给图片或视频节点作为参考。"}</span>
      </div>
      <div class="composer-assets">
        <button type="button" data-asset-action="upload"><strong>▣</strong><span>替换/上传</span></button>
      </div>
      <p class="form-hint">素材节点本身不调用生成模型；把它连到图片或视频节点后，会随该节点请求一起回传 API。</p>
    </div>
  `;
}

function referencePromptHtml(references, prompt) {
  return `
    <div class="prompt-input-wrap">
      <textarea id="promptInput" rows="3" aria-label="输入生成提示词">${escapeHtml(prompt)}</textarea>
      <div class="mention-menu" id="mentionMenu" hidden>
        <div class="mention-head">选择素材，仅插入 @引用；用途说明由你继续输入</div>
        ${
          references.length
            ? references
                .map(
                  (asset) => `
          <button type="button" data-insert-mention="${asset.refName}">
            ${asset.image ? `<img src="${asset.image}" alt="${escapeHtml(asset.displayName)}" />` : `<strong>${asset.type === "video" ? "▶" : asset.type === "audio" ? "♫" : "▤"}</strong>`}
            <span>${escapeHtml(asset.displayName)}</span>
            <em>(@${asset.refName})</em>
          </button>
        `,
                )
                .join("")
            : "<p>上传图片、视频或音频后，可在这里选择 @素材。</p>"
        }
      </div>
    </div>
  `;
}

function imageSettingControls(model) {
  const sizes = model?.sizes?.length ? model.sizes : ["auto"];
  const qualities = model?.qualities?.length ? model.qualities : ["auto"];
  const sizeLabels = {
    "1024x1024": "1:1 · 1024x1024",
    "1536x1024": "横版 · 1536x1024",
    "1024x1536": "竖版 · 1024x1536",
    auto: "自动",
  };
  const qualityLabels = {
    low: "草稿",
    medium: "高清",
    high: "超清",
    auto: "自动",
  };
  return `
    <label>
      <select id="imageSize">
        ${sizes.map((size) => `<option value="${size}">${sizeLabels[size] || size}</option>`).join("")}
      </select>
    </label>
    <label>
      <select id="imageQuality">
        ${qualities.map((quality) => `<option value="${quality}">${qualityLabels[quality] || quality}</option>`).join("")}
      </select>
    </label>
    <label class="style-inline">风格 <span id="styleValue">72</span><input id="styleRange" type="range" min="0" max="100" value="72" /></label>
  `;
}

function workflowLinksHtml(workflow) {
  const edges = (workflow.links || [])
    .map(
      (link, index) => `
        <g class="canvas-edge" data-link-index="${index}" data-link-from="${link.from}" data-link-to="${link.to}">
          <path class="canvas-edge-hit" data-link-index="${index}" />
          <path class="canvas-edge-path" />
        </g>
      `,
    )
    .join("");

  return `
    <svg class="canvas-edge-svg" id="canvasEdgeSvg" aria-hidden="true">
      <defs>
        <filter id="canvasEdgeGlow" color-interpolation-filters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
          <feFlood flood-color="rgba(83, 217, 255, 0.58)" result="glowColor" />
          <feComposite in="glowColor" in2="blur" operator="in" result="glow" />
          <feMerge>
            <feMergeNode in="glow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      ${edges}
      <g class="canvas-edge-preview" id="canvasEdgePreview" hidden>
        <path class="canvas-edge-preview-hit" />
        <path class="canvas-edge-preview-path" />
      </g>
    </svg>
  `;
}

function canvasLayerPointFromClient(clientX, clientY) {
  const layer = document.querySelector(".workflow-node-layer");
  if (!layer) return { x: 0, y: 0 };
  const rect = layer.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / state.canvasZoom,
    y: (clientY - rect.top) / state.canvasZoom,
  };
}

function portCenterPoint(nodeId, portType) {
  const mediaFramePoint = mediaNodeFramePortPoint(nodeId, portType);
  if (mediaFramePoint) return mediaFramePoint;

  const selector = `[data-node-id="${nodeId}"] [data-node-port="${portType}"]`;
  const port = document.querySelector(selector);
  if (!port) return null;
  const rect = port.getBoundingClientRect();
  return canvasLayerPointFromClient(
    rect.left + rect.width / 2,
    rect.top + rect.height / 2,
  );
}

function mediaNodeFramePortPoint(nodeId, portType) {
  const node = document.querySelector(`[data-node-id="${nodeId}"]`);
  if (!node?.classList.contains("image") && !node?.classList.contains("video"))
    return null;

  const frame = node.querySelector(".node-card");
  const rect = frame?.getBoundingClientRect();
  if (!rect?.width || !rect?.height) return null;

  return canvasLayerPointFromClient(
    portType === "input" ? rect.left : rect.right,
    rect.top + rect.height / 2,
  );
}

function edgePathFromPoints(start, end) {
  const distance = Math.abs(end.x - start.x);
  const control = Math.max(120, Math.min(360, distance * 0.5));
  const startControlX = start.x + control;
  const endControlX = end.x - control;
  return `M ${start.x} ${start.y} C ${startControlX} ${start.y}, ${endControlX} ${end.y}, ${end.x} ${end.y}`;
}

function setEdgeGeometry(edgeEl, start, end) {
  if (!edgeEl || !start || !end) return;
  const path = edgePathFromPoints(start, end);
  edgeEl
    .querySelectorAll("path")
    .forEach((item) => item.setAttribute("d", path));
}

function updateWorkflowLinkPositions() {
  document
    .querySelectorAll(".canvas-edge[data-link-from]")
    .forEach((edgeEl) => {
      const start = portCenterPoint(edgeEl.dataset.linkFrom, "output");
      const end = portCenterPoint(edgeEl.dataset.linkTo, "input");
      setEdgeGeometry(edgeEl, start, end);
    });
}

function updateLinkPreview(clientX, clientY) {
  const preview = document.querySelector("#canvasEdgePreview");
  if (!preview || !state.isPortDragging || !state.portDragNodeId) return;
  const fromPort = state.portDragType === "input" ? "input" : "output";
  const anchoredPoint = portCenterPoint(state.portDragNodeId, fromPort);
  const pointerPoint = canvasLayerPointFromClient(clientX, clientY);
  const start = state.portDragType === "input" ? pointerPoint : anchoredPoint;
  const end = state.portDragType === "input" ? anchoredPoint : pointerPoint;
  preview.removeAttribute("hidden");
  setEdgeGeometry(preview, start, end);
}

function hideLinkPreview() {
  const preview = document.querySelector("#canvasEdgePreview");
  if (preview) preview.setAttribute("hidden", "");
}

function nodeMediaKind(node) {
  const mimeType = String(node?.mimeType || "");
  if (node?.type === "video" || mimeType.startsWith("video/")) return "video";
  if (node?.type === "audio" || mimeType.startsWith("audio/")) return "audio";
  return "image";
}

function nodeMediaSource(node) {
  if (!node) return "";
  if (nodeMediaKind(node) === "video")
    return node.videoUrl || node.source || node.image || "";
  if (nodeMediaKind(node) === "audio")
    return node.source || node.audioUrl || "";
  return node.image || node.source || "";
}

function nodeMediaExtension(node) {
  const mimeType = String(node?.mimeType || "");
  const kind = nodeMediaKind(node);
  if (kind === "video") return "mp4";
  if (kind === "audio") {
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("ogg")) return "ogg";
    return "mp3";
  }
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  return "jpg";
}

function mediaDownloadName(node) {
  const base = String(node?.title || node?.label || "generated-media")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .slice(0, 80);
  return `${base || "generated-media"}.${nodeMediaExtension(node)}`;
}

function workflowNodeMediaHtml(node) {
  const kind = nodeMediaKind(node);
  const source = nodeMediaSource(node);
  if (!source) {
    return `<div class="node-placeholder ${node.type}">${node.type === "video" ? "▶" : node.type === "audio" ? "♫" : "▤"}</div>`;
  }
  const safeSource = escapeHtml(source);
  const safeTitle = escapeHtml(node.title || node.label || "媒体预览");
  if (kind === "video") {
    return `<video class="node-video-preview" src="${safeSource}" muted playsinline controls preload="metadata" data-node-video="${node.id}"></video>`;
  }
  if (kind === "audio") {
    return `<audio class="node-audio-preview" src="${safeSource}" controls preload="metadata"></audio>`;
  }
  return `<img src="${safeSource}" alt="${safeTitle}" data-node-image="${node.id}" />`;
}

function workflowNodeHtml(node, index) {
  const incoming = canvasIncomingNodes(node.id);
  const outgoing = canvasOutgoingNodes(node.id);
  const position = ensureNodePosition(node, index);
  const dimensions = nodeDimensions(node);
  const imageRatio = Number(node.aspectRatio || 0);
  const imageStyle =
    (node.type === "image" || node.type === "video") && imageRatio > 0
      ? `--media-ratio: ${imageRatio};`
      : "";
  const nodeStyle = `--node-index: ${index}; left:${position.x}px; top:${position.y}px; ${
    node.type === "image" || node.type === "video"
      ? `width:${dimensions.width}px;`
      : ""
  }`;
  const media = workflowNodeMediaHtml(node);
  const markBox = node.markBox
    ? `<div class="asset-mark-box" style="left:${node.markBox.x}%; top:${node.markBox.y}%; width:${node.markBox.width}%; height:${node.markBox.height}%;"><span>${escapeHtml(node.markLabel || "局部元素")}</span></div>`
    : "";
  const resizeHandles =
    node.type === "image" || node.type === "video"
      ? `<span class="node-resize-handle nw" data-node-resize="nw"></span><span class="node-resize-handle ne" data-node-resize="ne"></span><span class="node-resize-handle sw" data-node-resize="sw"></span><span class="node-resize-handle se" data-node-resize="se"></span>`
      : "";
  return `
    <article class="canvas-node ${node.type} ${node.marking ? "marking" : ""} ${state.selectedNodeId === node.id ? "selected" : ""}" data-node-id="${node.id}" style="${nodeStyle}">
      <div class="node-label">${escapeHtml(node.label)}</div>
      <button class="node-port node-port-in" type="button" data-node-port="input" title="连接到此节点">＋</button>
      <div class="node-card" style="${imageStyle}">
        <button class="node-upload-btn" type="button" data-node-upload="${node.id}" title="上传本地素材">⇧</button>
        ${resizeHandles}
        ${node.type === "image" ? `${media}${markBox}` : ""}
        ${node.type !== "image" ? `<div class="node-text"><h3>${escapeHtml(node.title)}</h3>${node.meta ? `<strong>${escapeHtml(node.meta)}</strong>` : ""}<p>${escapeHtml(node.content).replace(/\n/g, "<br>")}</p></div>${node.type === "video" || node.type === "audio" ? media : ""}` : `<div class="node-caption"><strong>${escapeHtml(node.title)}</strong></div>`}
        ${node.referenceStatus ? `<div class="node-reference-status">${escapeHtml(node.referenceStatus)}</div>` : ""}
        ${nodeGenerationJobStatusHtml(node)}
      </div>
      <button class="node-port node-port-out ${state.pendingLinkNodeId === node.id ? "active" : ""}" type="button" data-node-port="output" title="从此节点连接">＋</button>
      ${
        incoming.length || outgoing.length
          ? `<div class="node-flow-meta">${incoming.length ? `输入 ${incoming.length}` : ""}${incoming.length && outgoing.length ? " · " : ""}${outgoing.length ? `输出 ${outgoing.length}` : ""}</div>`
          : ""
      }
    </article>
  `;
}

function connectorHtml(index, active = false) {
  return `
    <div class="canvas-connector ${active ? "active" : ""}" style="--connector-index: ${index}">
      <span></span>
      <button type="button" data-connector-index="${index}" title="添加节点">＋</button>
    </div>
  `;
}

function generationMediaSource(item) {
  return item?.videoUrl || item?.image || "";
}

function generationMediaKind(item) {
  const source = generationMediaSource(item);
  if (
    item?.videoUrl ||
    item?.mode === "video" ||
    item?.mode === "video-face-restore" ||
    item?.mode === "video-face-swap"
  )
    return "video";
  if (/\.(mp4|mov|webm)(\?|#|$)/i.test(source)) return "video";
  return "image";
}

function historyHtml(generations) {
  if (!generations.length) return '<p class="empty-state">暂无生成记录。</p>';
  return generations
    .map((item) => {
      const source = generationMediaSource(item);
      const kind = generationMediaKind(item);
      const label = kind === "video" ? "历史视频" : "历史图片";
      const media =
        kind === "video"
          ? `<video src="${escapeHtml(source)}" muted playsinline preload="metadata"></video>`
          : `<img src="${escapeHtml(source)}" alt="${escapeHtml(item.prompt || label)}" />`;
      return `<button class="history-item ${kind}" type="button" data-source="${escapeHtml(source)}" data-kind="${kind}" data-model="${escapeHtml(item.modelName || item.engine || "")}">${media}<span>${escapeHtml(item.prompt || label)}</span><em>${escapeHtml(item.engine || item.mode || "")}</em></button>`;
    })
    .join("");
}

function handleHistoryItemClick(event) {
  const item = event.target.closest("[data-source]");
  if (!item) return;
  const media = item.querySelector("video, img");
  const aspectRatio =
    media?.videoWidth && media?.videoHeight
      ? media.videoWidth / media.videoHeight
      : media?.naturalWidth && media?.naturalHeight
        ? media.naturalWidth / media.naturalHeight
        : 0;
  addHistoryMediaNode(
    item.dataset.source,
    item.dataset.model,
    item.dataset.kind,
    aspectRatio,
  );
}

function bindStudio() {
  const activeNode = selectedCanvasNode();
  if (activeNode?.activeGenerationJob) resumeNodeGenerationJob(activeNode);

  document
    .querySelector("#canvasWorkflowSelect")
    ?.addEventListener("change", (event) => {
      switchCanvasWorkflow(event.target.value).catch((error) =>
        toast(error.message),
      );
    });

  document
    .querySelector("#createCanvasWorkflowBtn")
    ?.addEventListener("click", () => {
      createUserCanvasWorkflow().catch((error) => toast(error.message));
    });

  document.querySelectorAll("[data-switch-workflow]").forEach((button) => {
    button.addEventListener("click", () => {
      switchCanvasWorkflow(button.dataset.switchWorkflow).catch((error) =>
        toast(error.message),
      );
    });
  });

  document.querySelectorAll("[data-create-workflow]").forEach((button) => {
    button.addEventListener("click", () => {
      createUserCanvasWorkflow().catch((error) => toast(error.message));
    });
  });

  document.querySelectorAll("[data-workflow-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedWorkflowId = button.dataset.workflowId;
      state.canvasDrawer = "";
      state.selectedNodeId = "";
      sessionStorage.setItem("DreameHub_workflow", state.selectedWorkflowId);
      sessionStorage.removeItem("DreameHub_prompt");
      toast(
        `已打开：${button.querySelector("strong")?.textContent || "预设工作流"}`,
      );
      renderStudio().catch((error) => toast(error.message));
    });
  });

  document.querySelector("#newWorkflowBtn")?.addEventListener("click", () => {
    showAddNodeMenuAt(112, window.innerHeight / 2 - 160);
  });

  document.querySelector("#backToPresets")?.addEventListener("click", () => {
    state.selectedWorkflowId = "";
    state.selectedNodeId = "";
    sessionStorage.removeItem("DreameHub_workflow");
    renderStudio().catch((error) => toast(error.message));
  });

  document
    .querySelector(".infinite-canvas")
    ?.addEventListener("dblclick", (event) => {
      if (
        event.target.closest("button, a, textarea, select, input, .canvas-node")
      )
        return;
      addCanvasNode(currentCanvasWorkflow()?.nodes.length || 0, "自由节点");
    });

  document.querySelector("#styleRange")?.addEventListener("input", (event) => {
    document.querySelector("#styleValue").textContent = event.target.value;
  });
  document
    .querySelector("#faceRestoreFidelity")
    ?.addEventListener("input", (event) => {
      document.querySelector("#faceRestoreFidelityValue").textContent =
        event.target.value;
    });
  document
    .querySelector("#faceRestoreScale")
    ?.addEventListener("input", (event) => {
      document.querySelector("#faceRestoreScaleValue").textContent = (
        Number(event.target.value) / 100
      ).toFixed(2);
    });
  document
    .querySelector("#faceRestorePadding")
    ?.addEventListener("input", (event) => {
      document.querySelector("#faceRestorePaddingValue").textContent =
        event.target.value;
    });
  document
    .querySelector("#faceSwapFeather")
    ?.addEventListener("input", (event) => {
      document.querySelector("#faceSwapFeatherValue").textContent =
        event.target.value;
    });
  document
    .querySelector("#faceSwapColorMatch")
    ?.addEventListener("input", (event) => {
      document.querySelector("#faceSwapColorMatchValue").textContent =
        event.target.value;
    });

  document.querySelector("#modeTabs")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (!button) return;
    document
      .querySelectorAll("[data-mode]")
      .forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.mode = button.dataset.mode;
    toast(`已切换到${button.textContent}模式`);
  });
  document
    .querySelector("#imageModelSelect")
    ?.addEventListener("change", (event) => {
      const imageModel = state.imageModels.find(
        (item) => item.id === event.target.value,
      );
      state.selectedImageModelId = event.target.value;
      sessionStorage.setItem("DreameHub_imageModel", event.target.value);
      const config = currentComposerConfig();
      const hint = document.querySelector("#imageEngineHint");
      if (hint) hint.textContent = imageModel?.description || config.hint || "";
      const activeModel = document.querySelector("#activeModel");
      if (activeModel)
        activeModel.textContent = imageModel?.label || "生图预览";
      toast(`已选择 ${imageModel?.label || config.engine || "生成模型"}`);
      if (selectedCanvasNode()?.type === "image") refreshCanvasWorkflow();
    });
  document.querySelector("#randomPrompt")?.addEventListener("click", () => {
    document.querySelector("#promptInput").value =
      prompts[Math.floor(Math.random() * prompts.length)];
    toast("已填入随机灵感");
  });
  document
    .querySelector("#generationHistory")
    ?.addEventListener("click", handleHistoryItemClick);
  document
    .querySelector("#drawerHistoryList")
    ?.addEventListener("click", handleHistoryItemClick);
  document
    .querySelector("#generationForm")
    ?.addEventListener("submit", submitGeneration);

  document
    .querySelector(".canvas-workbench")
    ?.addEventListener("click", handleCanvasClick);
  document
    .querySelector(".canvas-workbench")
    ?.addEventListener("change", handleCanvasChange);
  document
    .querySelector(".canvas-workbench")
    ?.addEventListener("dblclick", handleCanvasDoubleClick);
  document
    .querySelector(".canvas-workbench")
    ?.addEventListener("input", handleCanvasInput);
  document
    .querySelector(".canvas-workbench")
    ?.addEventListener("keydown", handleCanvasKeydown);
  document
    .querySelector(".canvas-workbench")
    ?.addEventListener("load", handleCanvasMediaLoad, true);
  document
    .querySelector(".canvas-workbench")
    ?.addEventListener("loadedmetadata", handleCanvasMediaLoad, true);
  document
    .querySelector(".canvas-workbench")
    ?.addEventListener("wheel", handleCanvasWheel, { passive: false });
  document
    .querySelector(".canvas-workbench")
    ?.addEventListener("contextmenu", handleCanvasContextMenu);
  document
    .querySelector(".canvas-workbench")
    ?.addEventListener("mousedown", handleCanvasMouseDown);
  window.addEventListener("mousemove", handleCanvasMouseMove);
  window.addEventListener("mouseup", handleCanvasMouseUp);
  document.removeEventListener("keydown", handleCanvasGlobalKeydown);
  document.addEventListener("keydown", handleCanvasGlobalKeydown);
  document
    .querySelector("#canvasFileInput")
    ?.addEventListener("change", handleCanvasUpload);
  document
    .querySelector("#zoomIn")
    ?.addEventListener("click", () => setCanvasZoom(state.canvasZoom + 0.15));
  document
    .querySelector("#zoomOut")
    ?.addEventListener("click", () => setCanvasZoom(state.canvasZoom - 0.15));
  requestAnimationFrame(updateWorkflowLinkPositions);
}

function handleBatchOutputEdit(target) {
  const field = target?.dataset?.batchOutputField;
  if (!field) return false;

  const index = Number(target.dataset.batchOutputIndex);
  if (!Number.isInteger(index)) return false;

  updateCanvasWorkflow(
    (workflow) => {
      const output = workflow.batchOutputs?.[index];
      if (!output) return;

      output[field] = target.value;

      if (field === "title") {
        output.label = target.value.trim() || output.label || output.title;
      }
    },
    { history: false },
  );

  return true;
}

function handleCanvasInput(event) {
  if (handleBatchOutputEdit(event.target)) return;

  if (event.target.id !== "promptInput") return;

  sessionStorage.setItem("DreameHub_prompt", event.target.value);
  updateCanvasWorkflow(
    (workflow) => {
      const node = selectedCanvasNode(workflow);
      if (!node) return;
      node.content = event.target.value;
      if (node.type === "text" || node.type === "script") {
        node.title = node.title || "文本节点";
      }
    },
    { history: false },
  );
  updateMentionMenu(event.target);
}

function handleCanvasKeydown(event) {
  if (event.key === "Escape") hideMentionMenu();
}

function handleCanvasGlobalKeydown(event) {
  if (!document.querySelector(".canvas-workbench")) return;
  if (
    event.target?.closest?.(
      "input, textarea, select, [contenteditable='true'], .prompt-composer",
    )
  )
    return;
  const key = event.key.toLowerCase();
  const commandKey = event.ctrlKey || event.metaKey;
  if (commandKey && key === "z") {
    event.preventDefault();
    if (event.shiftKey) redoCanvasWorkflow();
    else undoCanvasWorkflow();
    return;
  }
  if (commandKey && key === "y") {
    event.preventDefault();
    redoCanvasWorkflow();
    return;
  }
  const nodeId = state.selectedNodeId;
  if (!nodeId) return;
  if (commandKey && key === "c") {
    event.preventDefault();
    duplicateCanvasNode(nodeId);
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    deleteCanvasNode(nodeId);
  }
}

function handleCanvasMediaLoad(event) {
  const video = event.target.closest?.("[data-node-video]");
  if (video?.videoWidth && video?.videoHeight) {
    const ratio = Number((video.videoWidth / video.videoHeight).toFixed(4));
    const nodeId = video.dataset.nodeVideo;
    const node = currentCanvasNode(nodeId);
    if (node && Math.abs(Number(node.aspectRatio || 0) - ratio) >= 0.001) {
      updateCanvasWorkflow(
        (workflow) => {
          const target = workflow.nodes.find((item) => item.id === nodeId);
          if (target) target.aspectRatio = ratio;
        },
        { history: false },
      );
      const card = video.closest(".node-card");
      if (card) card.style.setProperty("--media-ratio", ratio);
      requestAnimationFrame(updateWorkflowLinkPositions);
    }
    return;
  }

  const image = event.target.closest?.("[data-node-image]");
  if (!image?.naturalWidth || !image?.naturalHeight) return;
  const ratio = Number((image.naturalWidth / image.naturalHeight).toFixed(4));
  const nodeId = image.dataset.nodeImage;
  const node = currentCanvasNode(nodeId);
  if (!node || Math.abs(Number(node.aspectRatio || 0) - ratio) < 0.001) return;
  updateCanvasWorkflow(
    (workflow) => {
      const target = workflow.nodes.find((item) => item.id === nodeId);
      if (target) target.aspectRatio = ratio;
    },
    { history: false },
  );
  const card = image.closest(".node-card");
  if (card) card.style.setProperty("--media-ratio", ratio);
  requestAnimationFrame(updateWorkflowLinkPositions);
}

function handleCanvasWheel(event) {
  if (!isCanvasWheelPanTarget(event.target)) return;
  event.preventDefault();
  if (event.ctrlKey || event.metaKey) {
    const delta = event.deltaY > 0 ? -0.12 : 0.12;
    setCanvasZoom(state.canvasZoom + delta);
    return;
  }

  const deltaScale =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? window.innerHeight
        : 1;
  state.canvasPanX -= event.deltaX * deltaScale;
  state.canvasPanY -= event.deltaY * deltaScale;
  applyCanvasTransform();
  persistCanvasTransform();
}

function isCanvasWheelPanTarget(target) {
  return Boolean(
    target.closest(".infinite-canvas") &&
    !target.closest(
      "button, a, textarea, select, input, .prompt-composer, .canvas-drawer, .canvas-context-menu, .add-node-menu, .zoom-dock, .canvas-rail, .canvas-actions, .floating-toolbar, .canvas-history",
    ),
  );
}

function isCanvasDragTarget(target) {
  return Boolean(
    target.closest(".infinite-canvas") &&
    !target.closest(
      "button, a, textarea, select, input, .canvas-node, .prompt-composer, .canvas-drawer, .canvas-context-menu, .add-node-menu, .zoom-dock, .canvas-rail, .canvas-actions, .floating-toolbar, .canvas-history",
    ),
  );
}

function isCanvasBlankTarget(target) {
  return Boolean(
    target.closest(".canvas-viewport") &&
    !target.closest(
      "button, a, textarea, select, input, .canvas-node, .prompt-composer, .canvas-drawer, .canvas-context-menu, .add-node-menu, .zoom-dock, .canvas-rail, .canvas-actions, .floating-toolbar, .canvas-history, .back-to-presets",
    ),
  );
}

function handleCanvasMouseDown(event) {
  const resizeHandle = event.target.closest("[data-node-resize]");
  if (event.button === 0 && resizeHandle) {
    const nodeEl = resizeHandle.closest("[data-node-id]");
    const workflow = currentCanvasWorkflow();
    const node = workflow?.nodes.find(
      (item) => item.id === nodeEl?.dataset.nodeId,
    );
    if (node && (node.type === "image" || node.type === "video")) {
      const index = workflow.nodes.indexOf(node);
      const position = ensureNodePosition(node, index);
      const dimensions = nodeDimensions(node);
      state.isNodeResizing = true;
      state.resizingNodeId = node.id;
      state.nodeResizeDir = resizeHandle.dataset.nodeResize || "se";
      state.nodeResizeStartX = event.clientX;
      state.nodeResizeStartY = event.clientY;
      state.nodeResizeStartWidth = dimensions.width;
      state.nodeResizeStartHeight = dimensions.height;
      state.nodeResizeOriginX = position.x;
      state.nodeResizeOriginY = position.y;
      state.selectedNodeId = node.id;
      captureCanvasHistory();
      document.body.classList.add("canvas-resizing");
      event.preventDefault();
      event.stopPropagation();
      return;
    }
  }

  const portButton = event.target.closest("[data-node-port]");
  if (event.button === 0 && portButton) {
    const node = portButton.closest("[data-node-id]");
    state.isPortDragging = true;
    state.portDragNodeId = node?.dataset.nodeId || "";
    state.portDragType = portButton.dataset.nodePort || "";
    state.pendingLinkNodeId = state.portDragNodeId;
    updateLinkPreview(event.clientX, event.clientY);
    event.preventDefault();
    return;
  }

  const markingCard = event.target.closest(
    ".canvas-node.marking.image .node-card",
  );
  if (
    event.button === 0 &&
    markingCard &&
    !event.target.closest("button, .node-resize-handle")
  ) {
    const node = markingCard.closest("[data-node-id]");
    const rect = markingCard.getBoundingClientRect();
    state.isMarkingAsset = true;
    state.markingNodeId = node?.dataset.nodeId || "";
    state.markStartX = ((event.clientX - rect.left) / rect.width) * 100;
    state.markStartY = ((event.clientY - rect.top) / rect.height) * 100;
    captureCanvasHistory();
    event.preventDefault();
    return;
  }

  const draggableNode = event.target.closest(".canvas-node");
  if (
    event.button === 0 &&
    draggableNode &&
    !event.target.closest("button, a, textarea, select, input, .node-port")
  ) {
    const workflow = currentCanvasWorkflow();
    const node = workflow?.nodes.find(
      (item) => item.id === draggableNode.dataset.nodeId,
    );
    if (node) {
      const index = workflow.nodes.indexOf(node);
      const position = ensureNodePosition(node, index);
      state.isNodeDragging = true;
      state.draggingNodeId = node.id;
      state.nodeDragStartX = event.clientX;
      state.nodeDragStartY = event.clientY;
      state.nodeDragOriginX = position.x;
      state.nodeDragOriginY = position.y;
      state.selectedNodeId = node.id;
      captureCanvasHistory();
      document.body.classList.add("canvas-dragging");
      event.preventDefault();
      return;
    }
  }

  if (event.button !== 0 || !isCanvasDragTarget(event.target)) return;
  state.isCanvasDragging = true;
  state.canvasDragStartX = event.clientX;
  state.canvasDragStartY = event.clientY;
  state.canvasDragOriginX = state.canvasPanX;
  state.canvasDragOriginY = state.canvasPanY;
  document.body.classList.add("canvas-dragging");
  hideCanvasContextMenus();
}

function handleCanvasMouseMove(event) {
  if (state.isPortDragging) {
    updateLinkPreview(event.clientX, event.clientY);
    return;
  }

  if (state.isMarkingAsset) {
    const nodeEl = document.querySelector(
      `[data-node-id="${state.markingNodeId}"] .node-card`,
    );
    const rect = nodeEl?.getBoundingClientRect();
    if (!rect) return;
    const currentX = Math.max(
      0,
      Math.min(100, ((event.clientX - rect.left) / rect.width) * 100),
    );
    const currentY = Math.max(
      0,
      Math.min(100, ((event.clientY - rect.top) / rect.height) * 100),
    );
    const x = Math.min(state.markStartX, currentX);
    const y = Math.min(state.markStartY, currentY);
    const width = Math.abs(currentX - state.markStartX);
    const height = Math.abs(currentY - state.markStartY);
    updateCanvasWorkflow(
      (workflow) => {
        const node = workflow.nodes.find(
          (item) => item.id === state.markingNodeId,
        );
        if (node) node.markBox = { x, y, width, height };
      },
      { history: false },
    );
    const box =
      nodeEl.querySelector(".asset-mark-box") || document.createElement("div");
    if (!box.classList.contains("asset-mark-box")) {
      box.className = "asset-mark-box";
      box.innerHTML = "<span>局部元素</span>";
      nodeEl.appendChild(box);
    }
    box.style.left = `${x}%`;
    box.style.top = `${y}%`;
    box.style.width = `${width}%`;
    box.style.height = `${height}%`;
    return;
  }
  if (state.isNodeResizing) {
    const dx = (event.clientX - state.nodeResizeStartX) / state.canvasZoom;
    const dy = (event.clientY - state.nodeResizeStartY) / state.canvasZoom;
    const workflow = currentCanvasWorkflow();
    const node = workflow?.nodes.find(
      (item) => item.id === state.resizingNodeId,
    );
    if (!node) return;
    const ratio = Number(node.aspectRatio || 0);
    const horizontalDelta = state.nodeResizeDir.includes("w") ? -dx : dx;
    const verticalDelta =
      ratio > 0 ? (state.nodeResizeDir.includes("n") ? -dy : dy) * ratio : 0;
    const delta =
      Math.abs(verticalDelta) > Math.abs(horizontalDelta)
        ? verticalDelta
        : horizontalDelta;
    const newWidth = clampMediaNodeWidth(state.nodeResizeStartWidth + delta);
    const newHeight =
      node.type === "image"
        ? mediaNodePreviewHeight(node, newWidth)
        : Math.max(310, mediaNodePreviewHeight(node, newWidth) + 130);
    const nextX = state.nodeResizeDir.includes("w")
      ? state.nodeResizeOriginX + state.nodeResizeStartWidth - newWidth
      : state.nodeResizeOriginX;
    const nextY = state.nodeResizeDir.includes("n")
      ? state.nodeResizeOriginY + state.nodeResizeStartHeight - newHeight
      : state.nodeResizeOriginY;

    updateCanvasWorkflow(
      (workflow) => {
        const node = workflow.nodes.find(
          (item) => item.id === state.resizingNodeId,
        );

        if (!node) return;

        node.mediaWidth = Number(newWidth.toFixed(2));
        node.x = Number(nextX.toFixed(2));
        node.y = Number(nextY.toFixed(2));
      },
      { history: false },
    );

    const nodeElement = document.querySelector(
      `[data-node-id="${state.resizingNodeId}"]`,
    );

    if (nodeElement) {
      nodeElement.style.width = `${newWidth}px`;
      nodeElement.style.left = `${nextX}px`;
      nodeElement.style.top = `${nextY}px`;
    }

    updateWorkflowLinkPositions();
    return;
  }

  if (state.isNodeDragging) {
    const dx = (event.clientX - state.nodeDragStartX) / state.canvasZoom;
    const dy = (event.clientY - state.nodeDragStartY) / state.canvasZoom;
    const nextX = state.nodeDragOriginX + dx;
    const nextY = state.nodeDragOriginY + dy;
    updateCanvasWorkflow(
      (workflow) => {
        const node = workflow.nodes.find(
          (item) => item.id === state.draggingNodeId,
        );
        if (!node) return;
        node.x = nextX;
        node.y = nextY;
      },
      { history: false },
    );
    const nodeEl = document.querySelector(
      `[data-node-id="${state.draggingNodeId}"]`,
    );
    if (nodeEl) {
      nodeEl.style.left = `${nextX}px`;
      nodeEl.style.top = `${nextY}px`;
    }
    updateWorkflowLinkPositions();
    return;
  }

  if (!state.isCanvasDragging) return;
  state.canvasPanX =
    state.canvasDragOriginX + event.clientX - state.canvasDragStartX;
  state.canvasPanY =
    state.canvasDragOriginY + event.clientY - state.canvasDragStartY;
  applyCanvasTransform();
}

function handleCanvasMouseUp(event) {
  if (state.isPortDragging) {
    const targetPort = event.target.closest?.("[data-node-port]");
    const targetNode = targetPort?.closest?.("[data-node-id]");
    if (
      targetPort &&
      targetNode &&
      targetNode.dataset.nodeId !== state.portDragNodeId
    ) {
      const from =
        state.portDragType === "output"
          ? state.portDragNodeId
          : targetNode.dataset.nodeId;
      const to =
        state.portDragType === "output"
          ? targetNode.dataset.nodeId
          : state.portDragNodeId;
      connectCanvasNodes(from, to);
    }
    hideLinkPreview();
    state.isPortDragging = false;
    state.portDragNodeId = "";
    state.portDragType = "";
    state.pendingLinkNodeId = "";
    state.suppressPortClick = true;
    setTimeout(() => {
      state.suppressPortClick = false;
    }, 0);
    return;
  }

  if (state.isMarkingAsset) {
    updateCanvasWorkflow(
      (workflow) => {
        const node = workflow.nodes.find(
          (item) => item.id === state.markingNodeId,
        );
        if (node) {
          node.marking = false;
          node.markLabel = "局部元素";
        }
      },
      { history: false },
    );
    state.isMarkingAsset = false;
    state.markingNodeId = "";
    toast("局部元素已标记");
    refreshCanvasWorkflow();
    return;
  }

  if (state.isNodeResizing) {
    state.isNodeResizing = false;
    state.resizingNodeId = "";
    state.nodeResizeDir = "";
    document.body.classList.remove("canvas-resizing");
    refreshCanvasWorkflow();
    return;
  }

  if (state.isNodeDragging) {
    state.isNodeDragging = false;
    state.draggingNodeId = "";
    document.body.classList.remove("canvas-dragging");
    refreshCanvasWorkflow();
    return;
  }

  if (state.isCanvasDragging) {
    state.isCanvasDragging = false;
    document.body.classList.remove("canvas-dragging");
    persistCanvasTransform();
  }
}

function handleCanvasChange(event) {
  if (handleBatchOutputEdit(event.target)) {
    toast("批量输出设置已更新");
    return;
  }

  const select = event.target.closest("[data-param-select]");
  if (select) {
    const input = document.querySelector("#promptInput");
    if (input) input.value = `${input.value.trim()}\n参数：${select.value}`;
    toast(`参数已更新：${select.value}`);
    return;
  }

  const range = event.target.closest("[data-param-range]");
  if (range) {
    const input = document.querySelector("#promptInput");
    if (input) input.value = `${input.value.trim()}\n一致性：${range.value}`;
    toast(`一致性已设为 ${range.value}`);
  }
}

function handleCanvasClick(event) {
  if (!event.target.closest(".canvas-context-menu, .add-node-menu"))
    hideCanvasContextMenus();

  const contextButton = event.target.closest("[data-context-action]");
  if (contextButton) {
    handleContextAction(contextButton.dataset.contextAction);
    return;
  }

  const addNodeButton = event.target.closest("[data-add-node-type]");
  if (addNodeButton) {
    addCanvasNode(
      currentCanvasWorkflow()?.nodes.length || 0,
      undefined,
      addNodeButton.dataset.addNodeType,
    );
    hideCanvasContextMenus();
    return;
  }

  const linkButton = event.target.closest("[data-link-index]");
  if (linkButton) {
    disconnectCanvasLink(Number(linkButton.dataset.linkIndex));
    return;
  }

  const portButton = event.target.closest("[data-node-port]");
  if (portButton) {
    if (state.suppressPortClick) return;
    const node = portButton.closest("[data-node-id]");
    handleNodePort(portButton.dataset.nodePort, node?.dataset.nodeId);
    return;
  }

  const drawerClose = event.target.closest("[data-drawer-close]");
  if (drawerClose) {
    closeCanvasDrawer();
    return;
  }

  const drawerNode = event.target.closest("[data-select-node]");
  if (drawerNode) {
    selectCanvasNode(drawerNode.dataset.selectNode);
    return;
  }

  const railButton = event.target.closest("[data-rail-action]");
  if (railButton) {
    handleRailAction(railButton.dataset.railAction);
    return;
  }

  const topButton = event.target.closest("[data-top-action]");
  if (topButton) {
    handleTopAction(topButton.dataset.topAction);
    return;
  }

  const toolbarButton = event.target.closest("[data-toolbar-action]");
  if (toolbarButton) {
    handleToolbarAction(toolbarButton.dataset.toolbarAction);
    return;
  }

  const zoomButton = event.target.closest("[data-zoom-action]");
  if (zoomButton) {
    handleZoomAction(zoomButton.dataset.zoomAction);
    return;
  }

  const tabButton = event.target.closest("[data-composer-tab]");
  if (tabButton) {
    state.activeComposerTab = tabButton.dataset.composerTab;
    sessionStorage.setItem("DreameHub_composerTab", state.activeComposerTab);
    applyComposerMode(state.activeComposerTab);
    return;
  }

  const mentionButton = event.target.closest("[data-insert-mention]");
  if (mentionButton) {
    insertMaterialMention(mentionButton.dataset.insertMention);
    return;
  }

  const composerButton = event.target.closest("[data-composer-action]");
  if (composerButton) {
    handleComposerAction(composerButton.dataset.composerAction);
    return;
  }

  const assetButton = event.target.closest("[data-asset-action]");
  if (assetButton) {
    handleAssetAction(assetButton.dataset.assetAction, assetButton);
    return;
  }

  const nodeUploadButton = event.target.closest("[data-node-upload]");
  if (nodeUploadButton) {
    pendingUploadMode = "node";
    pendingUploadNodeId = nodeUploadButton.dataset.nodeUpload || "";
    state.selectedNodeId = pendingUploadNodeId;
    document.querySelector("#canvasFileInput")?.click();
    return;
  }

  const connectorButton = event.target.closest("[data-connector-index]");
  if (connectorButton) {
    addCanvasNode(
      Number(connectorButton.dataset.connectorIndex) + 1,
      undefined,
      "text",
    );
    return;
  }

  const canvasNode = event.target.closest("[data-node-id]");
  if (canvasNode) {
    selectCanvasNode(canvasNode.dataset.nodeId);
    return;
  }

  const historyToggle = event.target.closest("#historyToggle");
  if (historyToggle) {
    state.canvasHistoryOpen = !state.canvasHistoryOpen;
    document
      .querySelector(".canvas-history")
      ?.classList.toggle("open", state.canvasHistoryOpen);
    return;
  }

  if (isCanvasBlankTarget(event.target) && state.selectedNodeId) {
    state.selectedNodeId = "";
    refreshCanvasWorkflow();
  }
}

function handleCanvasContextMenu(event) {
  if (
    event.target.closest(
      "button, a, textarea, select, input, .prompt-composer, .canvas-drawer, .zoom-dock, .canvas-rail, .canvas-actions",
    )
  )
    return;
  const nodeEl = event.target.closest("[data-node-id]");
  if (!nodeEl && !isCanvasBlankTarget(event.target)) return;
  event.preventDefault();
  const menu = document.querySelector("#canvasContextMenu");
  if (!menu) return;
  hideMentionMenu();
  state.contextMenuNodeId = nodeEl?.dataset.nodeId || "";
  if (state.contextMenuNodeId) {
    state.selectedNodeId = state.contextMenuNodeId;
    menu.innerHTML = nodeContextMenuHtml(
      currentCanvasNode(state.contextMenuNodeId),
    );
  } else {
    menu.innerHTML = canvasContextMenuHtml();
  }
  menu.hidden = false;
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
}

function hideCanvasContextMenus() {
  const contextMenu = document.querySelector("#canvasContextMenu");
  const addNodeMenu = document.querySelector("#addNodeMenu");
  if (contextMenu) contextMenu.hidden = true;
  if (addNodeMenu) addNodeMenu.hidden = true;
  state.contextMenuNodeId = "";
}

function canvasContextMenuHtml() {
  const workflowId = currentCanvasWorkflow()?.id || "";
  const canUndo = canvasHistoryStack(state.canvasUndoStacks, workflowId).length;
  const canRedo = canvasHistoryStack(state.canvasRedoStacks, workflowId).length;
  return `
    <button type="button" data-context-action="upload">上传</button>
    <button type="button" data-context-action="add-node">添加节点</button>
    <span></span>
    <button type="button" data-context-action="undo" ${canUndo ? "" : "disabled"}>撤销</button>
    <button type="button" data-context-action="redo" ${canRedo ? "" : "disabled"}>重做</button>
    <span></span>
    <button type="button" data-context-action="paste">粘贴</button>
  `;
}

function nodeContextMenuHtml(node) {
  const canCopyImage =
    nodeMediaKind(node) === "image" && Boolean(nodeMediaSource(node));
  return `
    <button type="button" data-context-action="save-node-asset">保存到我的素材</button>
    <button type="button" data-context-action="copy-node-image" ${
      canCopyImage ? "" : "disabled"
    }>复制图片</button>
    <button type="button" data-context-action="duplicate-node">创建副本节点</button>
    <button type="button" data-context-action="delete-node">删除</button>
  `;
}

function showAddNodeMenuAt(x, y) {
  const menu = document.querySelector("#addNodeMenu");
  if (!menu) return;
  hideMentionMenu();
  menu.hidden = false;
  menu.style.left = `${Math.max(12, Math.min(window.innerWidth - 340, x))}px`;
  menu.style.top = `${Math.max(12, Math.min(window.innerHeight - 420, y))}px`;
}

function handleContextAction(action) {
  const nodeId = state.contextMenuNodeId || state.selectedNodeId;
  if (action === "save-node-asset") {
    saveNodeToMyAssets(nodeId);
    hideCanvasContextMenus();
    return;
  }
  if (action === "copy-node-image") {
    copyNodeImage(nodeId).catch((error) => toast(error.message));
    hideCanvasContextMenus();
    return;
  }
  if (action === "duplicate-node") {
    duplicateCanvasNode(nodeId);
    hideCanvasContextMenus();
    return;
  }
  if (action === "delete-node") {
    deleteCanvasNode(nodeId);
    hideCanvasContextMenus();
    return;
  }
  if (action === "upload") {
    pendingUploadMode = "append";
    pendingUploadNodeId = state.contextMenuNodeId || "";
    document.querySelector("#canvasFileInput")?.click();
    hideCanvasContextMenus();
    return;
  }
  if (action === "add-node") {
    const contextMenu = document.querySelector("#canvasContextMenu");
    showAddNodeMenuAt(
      Number.parseFloat(contextMenu?.style.left || "0") + 260,
      Number.parseFloat(contextMenu?.style.top || "0"),
    );
    return;
  }
  if (action === "undo") undoCanvasWorkflow();
  if (action === "redo") redoCanvasWorkflow();
  if (action === "paste") toast("请使用上传或添加节点导入内容");
  hideCanvasContextMenus();
}

function handleNodePort(port, nodeId) {
  if (!nodeId) return;
  if (port === "output") {
    state.pendingLinkNodeId = state.pendingLinkNodeId === nodeId ? "" : nodeId;
    state.selectedNodeId = nodeId;
    toast(state.pendingLinkNodeId ? "请选择目标节点左侧连接点" : "已取消连接");
    refreshCanvasWorkflow();
    return;
  }

  if (port === "input") {
    if (!state.pendingLinkNodeId) {
      state.pendingLinkNodeId = nodeId;
      toast("已选择当前节点，请点击目标节点左侧连接点完成连接");
      refreshCanvasWorkflow();
      return;
    }
    connectCanvasNodes(state.pendingLinkNodeId, nodeId);
  }
}

function handleCanvasDoubleClick(event) {
  const node = event.target.closest("[data-node-id]");
  if (!node || event.target.closest("button")) return;
  editCanvasNode(node.dataset.nodeId);
}

function handleRailAction(action) {
  if (action === "workflows")
    showAddNodeMenuAt(112, window.innerHeight / 2 - 160);
  if (action === "assets") openCanvasDrawer("assets");
  if (action === "history") {
    openCanvasDrawer("history");
    if (!state.generationHistoryLoaded)
      refreshGenerationHistoryCache().catch((error) => toast(error.message));
    state.canvasHistoryOpen = !state.canvasHistoryOpen;
    document
      .querySelector(".canvas-history")
      ?.classList.toggle("open", state.canvasHistoryOpen);
    toast(state.canvasHistoryOpen ? "历史面板已展开" : "历史面板已收起");
  }
  if (action === "help") openCanvasDrawer("help");
  if (action === "support") toast("已呼出客服入口：当前为演示模式");
}

function handleTopAction(action) {
  if (action === "connect") {
    document
      .querySelector(".workflow-node-layer")
      ?.classList.toggle("show-flow");
    toast("节点连接显示已切换");
  }
  if (action === "share") {
    const url = `${location.origin}${location.pathname}#/studio?workflow=${state.selectedWorkflowId || "preset"}`;
    navigator.clipboard?.writeText(url).then(
      () => toast("画布链接已复制"),
      () => toast(url),
    );
  }
  if (action === "notice") toast("暂无新的工作流通知");
}

function handleToolbarAction(action) {
  const promptInput = document.querySelector("#promptInput");
  const additions = {
    panorama: "，720 全景视角，空间关系清晰",
    angles: "，输出正面、侧面、背面和俯视多角度参考",
    lighting: "，增强电影布光，主光、轮廓光和环境光层次分明",
    grid: "，生成九宫格备选方案",
    quality: "，高清细节，干净边缘，减少伪影",
    split: "，按宫格切分输出可复用素材",
  };
  if (additions[action] && promptInput) {
    promptInput.value = `${promptInput.value.trim()}${additions[action]}`;
    toast("已写入生成指令");
  }
  if (action === "edit") promptInput?.focus();
  if (action === "download") downloadCanvasWorkflow();
  if (action === "fullscreen") toggleCanvasFullscreen();
}

function handleZoomAction(action) {
  if (action === "grid") {
    document.querySelector(".canvas-workbench")?.classList.toggle("dense-grid");
    toast("网格密度已切换");
  }
  if (action === "fit") {
    state.canvasPanX = 0;
    state.canvasPanY = 0;
    setCanvasZoom(0.89);
  }
  if (action === "snap") {
    document
      .querySelector("[data-zoom-action='snap']")
      ?.classList.toggle("active");
    toast("吸附模式已切换");
  }
}

function applyCanvasTransform() {
  const viewport = document.querySelector(".canvas-viewport");
  if (viewport) {
    viewport.style.setProperty("--canvas-zoom", state.canvasZoom);
    viewport.style.setProperty("--canvas-pan-x", `${state.canvasPanX}px`);
    viewport.style.setProperty("--canvas-pan-y", `${state.canvasPanY}px`);
  }
  const label = document.querySelector("#zoomValue");
  if (label) label.textContent = `${Math.round(state.canvasZoom * 100)}%`;
  requestAnimationFrame(updateWorkflowLinkPositions);
}

function persistCanvasTransform() {
  sessionStorage.setItem("DreameHub_canvasZoom", String(state.canvasZoom));
  sessionStorage.setItem(
    "DreameHub_canvasPanX",
    String(Math.round(state.canvasPanX)),
  );
  sessionStorage.setItem(
    "DreameHub_canvasPanY",
    String(Math.round(state.canvasPanY)),
  );
}

function handleComposerAction(action) {
  if (action === "expand") {
    document.querySelector(".prompt-composer")?.classList.toggle("expanded");
    toast("输入面板尺寸已切换");
  }
  if (action === "translate") translatePromptToEnglish();
  if (action === "params") openCanvasDrawer("params");
}

function handleAssetAction(action, trigger) {
  if (action === "mark") {
    const node = selectedCanvasNode();
    const target =
      node?.type === "image"
        ? node
        : nodeReferenceAssets(node || {}).find(
            (asset) => asset.type === "image",
          );
    if (!target) {
      toast("请先选择图片节点，或把图片节点连接到当前节点");
      return;
    }
    updateCanvasWorkflow((workflow) => {
      workflow.nodes.forEach((item) => {
        item.marking = item.id === target.id;
      });
      state.selectedNodeId = target.id;
    });
    toast("进入局部标记模式：在图片上拖拽框选元素");
    refreshCanvasWorkflow();
  }
  if (action === "focus") {
    state.canvasZoom = 1;
    setCanvasZoom(1);
    toast("已聚焦当前工作流");
  }
  if (action === "upload") {
    const shouldReplaceCurrentNode = Boolean(
      trigger?.closest(".asset-composer"),
    );
    pendingUploadMode = shouldReplaceCurrentNode ? "node" : "append";
    pendingUploadNodeId = state.selectedNodeId || "";
    document.querySelector("#canvasFileInput")?.click();
  }
}

function openCanvasDrawer(name) {
  state.canvasDrawer = state.canvasDrawer === name ? "" : name;
  refreshCanvasWorkflow();
}

function closeCanvasDrawer() {
  state.canvasDrawer = "";
  refreshCanvasWorkflow();
}

function saveNodeToMyAssets(nodeId) {
  const node = currentCanvasNode(nodeId);
  if (!node) return;
  if (
    !["image", "video", "audio"].includes(node.type) ||
    !nodeHasReferenceSource(node)
  ) {
    toast("当前节点没有可保存的素材");
    return;
  }
  updateCanvasWorkflow((workflow) => {
    const target = workflow.nodes.find((item) => item.id === nodeId);
    if (!target) return;
    const sameTypeIndex =
      workflow.nodes.filter(
        (item) => item.type === target.type && item.savedToAssets,
      ).length + 1;
    target.savedToAssets = true;
    target.displayName =
      target.displayName ||
      target.title ||
      target.label ||
      (target.type === "image"
        ? `图片 ${sameTypeIndex}`
        : target.type === "video"
          ? `视频 ${sameTypeIndex}`
          : `音频 ${sameTypeIndex}`);
    target.refName =
      target.refName ||
      materialRefName(target.displayName, target.type, sameTypeIndex);
  });
  toast("已保存到我的素材");
  refreshCanvasWorkflow();
}

async function copyNodeImage(nodeId) {
  const node = currentCanvasNode(nodeId);
  if (!node || nodeMediaKind(node) !== "image") {
    throw new Error("当前节点不是图片，无法复制图片");
  }
  const source = nodeMediaSource(node);
  if (!source) throw new Error("当前节点没有可复制的图片");

  if (navigator.clipboard && window.ClipboardItem) {
    try {
      const response = await fetch(source);
      const blob = await response.blob();
      const imageBlob = blob.type.startsWith("image/")
        ? blob
        : new Blob([blob], { type: node.mimeType || "image/png" });
      await navigator.clipboard.write([
        new ClipboardItem({ [imageBlob.type || "image/png"]: imageBlob }),
      ]);
      toast("图片已复制");
      return;
    } catch {}
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(source);
    toast("图片地址已复制");
    return;
  }
  throw new Error("当前浏览器不支持复制图片");
}

function selectCanvasNode(nodeId) {
  state.selectedNodeId = nodeId;
  const node = currentCanvasNode(nodeId);
  if (node) toast(`已选中节点：${node.label || node.title}`);
  refreshCanvasWorkflow();
}

function canvasNodeTemplate(type = "text", label) {
  const labels = {
    text: "文本",
    image: "图片",
    video: "视频",
    audio: "音频",
    script: "脚本",
  };
  const node = {
    id: canvasNodeId(),
    type,
    label: label || labels[type] || "节点",
    title: label || labels[type] || "节点",
    content: "双击节点或点击编辑按钮，可直接修改这里的内容。",
  };
  if (type === "image") {
    node.title = "图片节点";
    node.content = "";
  }
  if (type === "video") {
    node.title = "视频节点";
    node.content = "";
  }
  if (type === "audio") {
    node.title = "音频节点";
    node.content = "";
  }
  if (type === "script") {
    node.title = "脚本节点";
    node.content = "故事设定、分集脚本、对白或旁白。";
  }
  return node;
}

function addCanvasNode(index, label = "", type = "text") {
  const fromNodeId = state.selectedNodeId;
  const node = canvasNodeTemplate(type, label);
  updateCanvasWorkflow((workflow) => {
    const source = workflow.nodes.find((item) => item.id === fromNodeId);
    if (source) {
      const sourceIndex = workflow.nodes.indexOf(source);
      const sourcePosition = ensureNodePosition(source, sourceIndex);
      const sourceDimensions = nodeDimensions(source);
      node.x = sourcePosition.x + sourceDimensions.width + 140;
      node.y = sourcePosition.y;
    } else {
      node.x = 300 + workflow.nodes.length * 120;
      node.y = 280 + workflow.nodes.length * 40;
    }
    workflow.nodes.splice(Math.max(0, index), 0, node);
    if (fromNodeId && fromNodeId !== node.id) {
      workflow.links ||= [];
      if (source) {
        const validation = canConnectNodes(source, node);
        if (validation.ok)
          workflow.links.push({ from: fromNodeId, to: node.id });
      }
    }
  });
  state.selectedNodeId = node.id;
  toast(fromNodeId ? "已添加节点并连接上游" : "已添加节点");
  refreshCanvasWorkflow();
}

function connectCanvasNodes(from, to) {
  if (!from || !to || from === to) {
    toast("请选择两个不同节点进行连接");
    return;
  }
  const workflow = currentCanvasWorkflow();
  const fromNode = workflow?.nodes.find((node) => node.id === from);
  const toNode = workflow?.nodes.find((node) => node.id === to);
  const validation = canConnectNodes(fromNode, toNode);
  if (!validation.ok) {
    toast(validation.reason);
    return;
  }
  updateCanvasWorkflow((workflow) => {
    workflow.links ||= [];
    const exists = workflow.links.some(
      (link) => link.from === from && link.to === to,
    );
    if (!exists) workflow.links.push({ from, to });
  });
  state.pendingLinkNodeId = "";
  state.selectedNodeId = to;
  toast("节点已连接");
  refreshCanvasWorkflow();
}

function disconnectCanvasLink(index) {
  updateCanvasWorkflow((workflow) => {
    workflow.links = (workflow.links || []).filter(
      (_, itemIndex) => itemIndex !== index,
    );
  });
  toast("链接已切断");
  refreshCanvasWorkflow();
}

function readVideoAspectRatio(source) {
  return new Promise((resolve) => {
    if (!source) return resolve(0);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      if (video.videoWidth && video.videoHeight)
        resolve(video.videoWidth / video.videoHeight);
      else resolve(0);
      video.removeAttribute("src");
      video.load();
    };
    video.onerror = () => resolve(0);
    video.src = source;
  });
}

function addHistoryMediaNode(
  source,
  modelName,
  kind = "image",
  aspectRatio = 0,
) {
  if (!source) return;
  const isVideo = kind === "video";
  const ratio = Number(aspectRatio || 0);
  const node = {
    id: canvasNodeId(),
    type: isVideo ? "video" : "image",
    label: isVideo ? "历史视频" : "历史图片",
    title: modelName || "生成历史",
    image: isVideo ? "" : source,
    videoUrl: isVideo ? source : "",
    source,
    mimeType: isVideo ? "video/mp4" : "image/jpeg",
    aspectRatio: ratio > 0 ? Number(ratio.toFixed(4)) : "",
    content: "",
  };
  updateCanvasWorkflow((workflow) => workflow.nodes.push(node));
  state.selectedNodeId = node.id;
  toast("已把历史结果添加到画布");
  refreshCanvasWorkflow();
  if (isVideo && !node.aspectRatio) {
    readVideoAspectRatio(source).then((detectedRatio) => {
      if (!detectedRatio) return;
      updateCanvasWorkflow(
        (workflow) => {
          const target = workflow.nodes.find((item) => item.id === node.id);
          if (target) target.aspectRatio = Number(detectedRatio.toFixed(4));
        },
        { history: false },
      );
      requestAnimationFrame(() => refreshCanvasWorkflow());
    });
  }
}

function editCanvasNode(nodeId) {
  const node = currentCanvasNode(nodeId);
  if (!node) return;
  const nextTitle = window.prompt("节点标题", node.title || node.label);
  if (nextTitle === null) return;
  const nextContent = window.prompt(
    "节点内容",
    node.content || node.meta || "",
  );
  updateCanvasWorkflow((workflow) => {
    const target = workflow.nodes.find((item) => item.id === nodeId);
    if (!target) return;
    target.title = nextTitle.trim() || target.title;
    target.label = target.label || target.title;
    if (nextContent !== null) target.content = nextContent.trim();
  });
  toast("节点已更新");
  refreshCanvasWorkflow();
}

function duplicateCanvasNode(nodeId) {
  if (!nodeId || !currentCanvasNode(nodeId)) {
    toast("请先选中节点");
    return;
  }
  updateCanvasWorkflow((workflow) => {
    const index = workflow.nodes.findIndex((node) => node.id === nodeId);
    if (index < 0) return;
    const copy = {
      ...(typeof structuredClone === "function"
        ? structuredClone(workflow.nodes[index])
        : JSON.parse(JSON.stringify(workflow.nodes[index]))),
      id: canvasNodeId(),
      label: `${workflow.nodes[index].label || workflow.nodes[index].title} 副本`,
    };
    copy.x = Number(copy.x || 0) + 48;
    copy.y = Number(copy.y || 0) + 48;
    workflow.nodes.splice(index + 1, 0, copy);
    state.selectedNodeId = copy.id;
  });
  toast("节点已复制");
  refreshCanvasWorkflow();
}

function removeCanvasNodeElement(nodeId) {
  const safeNodeId = CSS.escape(nodeId);
  document.querySelector(`[data-node-id="${safeNodeId}"]`)?.remove();
  document
    .querySelectorAll(
      `.canvas-edge[data-link-from="${safeNodeId}"], .canvas-edge[data-link-to="${safeNodeId}"]`,
    )
    .forEach((edge) => edge.remove());
}

function deleteCanvasNode(nodeId) {
  if (!nodeId || !currentCanvasNode(nodeId)) {
    toast("请先选中节点");
    return;
  }
  updateCanvasWorkflow((workflow) => {
    workflow.nodes = workflow.nodes.filter((node) => node.id !== nodeId);
    workflow.links = (workflow.links || []).filter(
      (link) => link.from !== nodeId && link.to !== nodeId,
    );
    if (state.selectedNodeId === nodeId)
      state.selectedNodeId = workflow.nodes[0]?.id || "";
  });
  removeCanvasNodeElement(nodeId);
  toast("节点已删除");
  setTimeout(refreshCanvasWorkflow, 0);
}

function previewCanvasNodeMedia(nodeId) {
  const node = currentCanvasNode(nodeId);
  const source = nodeMediaSource(node);
  if (!source) {
    toast("当前节点没有可预览的媒体");
    return;
  }
  const old = document.querySelector("#mediaLightbox");
  if (old) old.remove();
  const lightbox = document.createElement("div");
  lightbox.id = "mediaLightbox";
  lightbox.className = "media-lightbox";
  const kind = nodeMediaKind(node);
  const safeSource = escapeHtml(source);
  const safeTitle = escapeHtml(node.title || node.label || "媒体预览");
  const preview =
    kind === "video"
      ? `<video src="${safeSource}" controls autoplay playsinline></video>`
      : kind === "audio"
        ? `<audio src="${safeSource}" controls autoplay></audio>`
        : `<img src="${safeSource}" alt="${safeTitle}" />`;
  lightbox.innerHTML = `
    <div>
      <button type="button" data-lightbox-close title="关闭">×</button>
      ${preview}
      <a href="${safeSource}" download="${escapeHtml(mediaDownloadName(node))}">下载</a>
    </div>
  `;
  lightbox.addEventListener("click", (event) => {
    if (
      event.target === lightbox ||
      event.target.closest("[data-lightbox-close]")
    ) {
      lightbox.remove();
    }
  });
  document.body.appendChild(lightbox);
}

function downloadCanvasNodeMedia(nodeId) {
  const node = currentCanvasNode(nodeId);
  const source = nodeMediaSource(node);
  if (!source) {
    toast("当前节点没有可下载的媒体");
    return;
  }
  const link = document.createElement("a");
  link.href = source;
  link.download = mediaDownloadName(node);
  link.click();
}

function handleCanvasUpload(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const isImage = file.type.startsWith("image/");
    const isAudio = file.type.startsWith("audio/");
    const isVideo = file.type.startsWith("video/");
    const payload = {
      id: canvasNodeId(),
      type: isImage ? "image" : isAudio ? "audio" : isVideo ? "video" : "text",
      label: isImage
        ? "上传图片"
        : isAudio
          ? "上传音频"
          : isVideo
            ? "上传视频"
            : "上传文档",
      title: file.name,
      content: "",
      uploadSummary: `${file.name} · ${(file.size / 1024).toFixed(1)} KB`,
      role: isImage
        ? "人物外貌与服装细节参考"
        : isAudio
          ? "背景音乐情绪与节拍点参考"
          : isVideo
            ? "动作节奏与镜头运动参考"
            : "文字设定参考",
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      source: reader.result,
      image: isImage ? reader.result : "",
    };

    const commitUploadPayload = () => {
      const targetNodeId =
        pendingUploadMode === "append" ? pendingUploadNodeId : "";
      updateCanvasWorkflow((workflow) => {
        const target = workflow.nodes.find(
          (node) => node.id === pendingUploadNodeId,
        );
        if (pendingUploadMode === "node" && target) {
          Object.assign(target, payload, { id: target.id });
          state.selectedNodeId = target.id;
          return;
        }
        const targetForAppend = workflow.nodes.find(
          (node) => node.id === targetNodeId,
        );
        if (targetForAppend) {
          const targetIndex = workflow.nodes.indexOf(targetForAppend);
          const targetPosition = ensureNodePosition(
            targetForAppend,
            targetIndex,
          );
          const payloadDimensions = nodeDimensions(payload);
          payload.x = targetPosition.x - payloadDimensions.width - 140;
          payload.y = targetPosition.y;
        } else {
          payload.x = 300 + workflow.nodes.length * 120;
          payload.y = 280 + workflow.nodes.length * 40;
        }
        workflow.nodes.push(payload);
        if (targetForAppend) {
          const validation = canConnectNodes(payload, targetForAppend);
          if (validation.ok) {
            workflow.links ||= [];
            workflow.links.push({ from: payload.id, to: targetForAppend.id });
            state.selectedNodeId = targetForAppend.id;
          } else {
            state.selectedNodeId = payload.id;
            toast(validation.reason);
          }
        } else {
          state.selectedNodeId = payload.id;
        }
      });
      toast(isImage ? "图片素材已加入画布" : "素材已加入画布");
      refreshCanvasWorkflow();
    };

    if (isVideo) {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        if (video.videoWidth && video.videoHeight) {
          payload.aspectRatio = video.videoWidth / video.videoHeight;
        }
        commitUploadPayload();
      };
      video.onerror = commitUploadPayload;
      video.src = reader.result;
      return;
    }

    commitUploadPayload();
  };
  reader.readAsDataURL(file);
}

function setCanvasZoom(value) {
  state.canvasZoom = Math.min(5, Math.max(0.1, Number(value.toFixed(2))));
  applyCanvasTransform();
  persistCanvasTransform();
}

function applyComposerMode(tab) {
  const modeInput = document.querySelector("#workflowMode");
  const promptInput = document.querySelector("#promptInput");
  const config = composerModeConfig[tab] || composerModeConfig["全能参考"];
  if (promptInput)
    sessionStorage.setItem("DreameHub_prompt", promptInput.value);
  if (modeInput) modeInput.value = config.mode;
  toast(`已切换到${tab}`);
  if (
    selectedCanvasNode()?.type === "video" ||
    workflowComposerKind() === "video-reference"
  )
    refreshCanvasWorkflow();
}

function translatePromptToEnglish() {
  const input = document.querySelector("#promptInput");
  if (!input) return;
  input.value = `${input.value.trim()}\nEnglish prompt: cinematic, consistent character, detailed lighting, production-ready output.`;
  toast("已追加英文提示词");
}

function updateMentionMenu(input) {
  const menu = document.querySelector("#mentionMenu");
  if (!menu) return;
  const beforeCursor = input.value.slice(0, input.selectionStart || 0);
  const node = selectedCanvasNode();
  const hasReferences =
    node &&
    ["image", "video"].includes(node.type) &&
    nodeReferenceAssets(node).length;
  if (!hasReferences || !/@[^\s@:：；;]*$/u.test(beforeCursor)) {
    hideMentionMenu();
    return;
  }
  menu.hidden = false;
}

function hideMentionMenu() {
  const menu = document.querySelector("#mentionMenu");
  if (menu) menu.hidden = true;
}

function insertMaterialMention(refName) {
  const input = document.querySelector("#promptInput");
  if (!input || !refName) return;
  const cursor = input.selectionStart || input.value.length;
  const before = input.value.slice(0, cursor);
  const after = input.value.slice(cursor);
  const nextBefore = before.replace(/@[^\s@:：；;]*$/u, "");
  const insertion = `@${refName}`;
  input.value = `${nextBefore}${insertion}${after}`;
  const nextCursor = nextBefore.length + insertion.length;
  input.focus();
  input.setSelectionRange(nextCursor, nextCursor);
  sessionStorage.setItem("DreameHub_prompt", input.value);
  hideMentionMenu();
  toast(`已插入 @${refName}`);
}

function validateReferencePrompt(
  prompt,
  config,
  assets = canvasReferenceAssets(),
) {
  if (!config.mention) return "";
  const requiredImages =
    config.requires?.filter((item) => item === "image").length || 0;
  const imageCount = assets.filter((asset) => asset.type === "image").length;
  if (config.requires?.includes("asset") && !assets.length)
    return `${state.activeComposerTab} 需要先上传或保留至少一个参考素材。`;
  if (requiredImages && imageCount < requiredImages)
    return `${state.activeComposerTab} 至少需要 ${requiredImages} 张图片素材。`;

  return "";
}

function downloadCanvasWorkflow() {
  const workflow = currentCanvasWorkflow();
  if (!workflow) {
    toast("请先打开一个工作流");
    return;
  }
  const blob = new Blob([JSON.stringify(workflow, null, 2)], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${workflow.id || "workflow"}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  toast("工作流 JSON 已下载");
}

function toggleCanvasFullscreen() {
  const target = document.querySelector(".canvas-workbench");
  if (!target) return;
  if (!document.fullscreenElement) {
    target.requestFullscreen?.();
    toast("已进入全屏");
  } else {
    document.exitFullscreen?.();
    toast("已退出全屏");
  }
}

function generationWorkflowMode(workflow, kind) {
  if (kind === "text") return workflow?.title || "文生文";
  if (kind === "image")
    return workflow?.batchOutputs?.length ? "批量文生图" : "文生图";
  return state.activeComposerTab;
}

function generationRequestBody({
  prompt,
  workflow,
  kind,
  mode,
  imageModelValue,
  size,
  quality,
  workflowMode,
  referenceAssets,
}) {
  const normalizeReferenceSource = (source) => {
    const value = String(source || "");
    if (value.startsWith("/")) return `${location.origin}${value}`;
    return value;
  };
  const node = selectedCanvasNode(workflow);
  const resolvedWorkflowMode = workflowMode || generationWorkflowMode(workflow, kind);
  const referencesWithUsage = attachVideoReferenceRoles(
    applyReferenceUsageFromPrompt(
    referenceAssets || canvasReferenceAssets(),
    prompt,
    ),
    resolvedWorkflowMode,
  );
  return {
    prompt,
    modelId: state.models[0]?.id,
    mode,
    workflowMode: resolvedWorkflowMode,
    node: node
      ? {
          id: node.id,
          type: node.type,
          title: node.title || node.label || "",
          semantic: nodeSemantic(node),
          inputs: nodeWorkflowInputs(node, workflow),
          source: normalizeReferenceSource(
            node.source || node.videoUrl || node.image || "",
          ),
          videoUrl: normalizeReferenceSource(node.videoUrl || ""),
          mimeType: node.mimeType || "",
          size: node.size || 0,
        }
      : null,
    referenceAssets: referencesWithUsage.map((asset) => ({
      refName: asset.refName,
      displayName: asset.displayName,
      originalName: asset.originalName || "",
      type: asset.type,
      title: asset.title,
      role: asset.role,
      seedanceRole: asset.seedanceRole || "",
      instruction: asset.instruction || "",
      mimeType: asset.mimeType || "",
      size: asset.size || 0,
      source: normalizeReferenceSource(
        asset.source || asset.videoUrl || asset.image || "",
      ),
    })),
    strength:
      document.querySelector("#styleRange")?.value ||
      (mode === "video-face-restore"
        ? 55
        : mode === "video-face-swap"
          ? 82
          : 72),
    faceRestoreFidelity:
      mode === "video-face-restore"
        ? document.querySelector("#faceRestoreFidelity")?.value || 50
        : undefined,
    faceRestoreScale:
      mode === "video-face-restore"
        ? Number(document.querySelector("#faceRestoreScale")?.value || 125) /
          100
        : undefined,
    faceRestorePadding:
      mode === "video-face-restore"
        ? Number(document.querySelector("#faceRestorePadding")?.value || 12) /
          100
        : undefined,
    faceSwapFeather:
      mode === "video-face-swap"
        ? document.querySelector("#faceSwapFeather")?.value || 22
        : undefined,
    faceSwapColorMatch:
      mode === "video-face-swap"
        ? document.querySelector("#faceSwapColorMatch")?.value || 75
        : undefined,
	    imageModel: imageModelValue,
	    size: size || document.querySelector("#imageSize")?.value || "auto",
	    quality:
	      quality || document.querySelector("#imageQuality")?.value || "auto",
	    aspectRatio:
	      document.querySelector("#videoAspectRatio")?.value ||
	      document.querySelector("#imageSize")?.value ||
	      "auto",
	    resolution: document.querySelector("#videoResolution")?.value || "720p",
		    duration: Math.max(
		      SEEDANCE_DURATION_MIN,
		      Math.min(
		        SEEDANCE_DURATION_MAX,
		        Number(document.querySelector("#videoDuration")?.value || 5),
		      ),
		    ),
	    count: Number(document.querySelector("#videoCount")?.value || 1),
	    generateAudio: Boolean(
	      document.querySelector("#videoGenerateAudio")?.checked,
	    ),
    watermark: Boolean(document.querySelector("#videoWatermark")?.checked),
    returnLastFrame: Boolean(
      document.querySelector("#videoReturnLastFrame")?.checked,
    ),
    cameraFixed: Boolean(document.querySelector("#videoCameraFixed")?.checked),
    draft: Boolean(document.querySelector("#videoDraft")?.checked),
    webSearch: Boolean(document.querySelector("#videoWebSearch")?.checked),
    seed: document.querySelector("#videoSeed")?.value || "",
    draftTaskId: document.querySelector("#videoDraftTaskId")?.value || "",
    serviceTier: document.querySelector("#videoServiceTier")?.value || "",
	  };
	}

function appendGenerationNode({ generation, mode, label, content }) {
  updateCanvasWorkflow((workflow) => {
    workflow.nodes.push({
      id: canvasNodeId(),
      type: mode === "text" ? "text" : "image",
      label:
        label ||
        (mode === "text"
          ? "生成文本"
          : mode === "image"
            ? "生成图片"
            : "生成结果"),
      title: generation.engine,
      image: generation.image,
      content: content || "",
    });
    state.selectedNodeId = workflow.nodes[workflow.nodes.length - 1].id;
  });
}

function appendGenerationResultNode({
  generation,
  mode,
  prompt,
  sourceNodeId = "",
}) {
  updateCanvasWorkflow((workflow) => {
    const sourceNode =
      workflow.nodes.find((item) => item.id === sourceNodeId) ||
      selectedCanvasNode(workflow);
    const sourceIndex = sourceNode ? workflow.nodes.indexOf(sourceNode) : -1;
    const sourcePosition = sourceNode
      ? ensureNodePosition(sourceNode, sourceIndex)
      : { x: 300, y: 280 };
    const sourceDimensions = sourceNode
      ? nodeDimensions(sourceNode)
      : { width: 380, height: 260 };
    const isVideo =
      mode === "video" ||
      mode === "video-face-restore" ||
      mode === "video-face-swap";
    const videoSource = generation.videoUrl || generation.image || "";
    const node = {
      id: canvasNodeId(),
      type: isVideo ? "video" : mode === "text" ? "text" : "image",
      label:
        mode === "video-face-restore"
          ? "修复结果"
          : mode === "video-face-swap"
            ? "换脸结果"
            : isVideo
              ? "生成视频"
              : mode === "text"
                ? "生成文本"
                : "生成图片",
      title: generation.engine || "生成结果",
      model: generation.modelName || generation.engine || "",
      content:
        mode === "text"
          ? generation.text || `根据提示生成的文本结果：\n${prompt}`
          : prompt || "",
      image: isVideo ? "" : generation.image || "",
      videoUrl: isVideo ? videoSource : "",
      source: isVideo ? videoSource : generation.image || "",
      mimeType: isVideo ? "video/mp4" : mode === "text" ? "" : "image/jpeg",
      aspectRatio: isVideo ? Number(sourceNode?.aspectRatio || 0) || "" : "",
      referenceInputs: Array.isArray(generation.referenceAssets)
        ? generation.referenceAssets
        : [],
      referenceStatus:
        Array.isArray(generation.referenceAssets) &&
        generation.referenceAssets.length
          ? generation.referenceInputSupported
            ? `已作为模型输入提交 ${generation.referenceAssets.length} 个参考素材`
            : `已提交 ${generation.referenceAssets.length} 个参考素材到后端，当前模型未消费图片输入`
          : "",
      x: sourcePosition.x + sourceDimensions.width + 140,
      y: sourcePosition.y,
    };
    workflow.nodes.push(node);
    if (sourceNode) {
      workflow.links ||= [];
      workflow.links.push({ from: sourceNode.id, to: node.id });
    }
    state.selectedNodeId = node.id;
  });
}

function updateNodeGenerationJob(nodeId, job) {
  if (!nodeId || !job) return;
  updateCanvasWorkflow(
    (workflow) => {
      const node = workflow.nodes.find((item) => item.id === nodeId);
      if (!node) return;
      node.activeGenerationJob = {
        id: job.id,
        status: job.status,
        mode: job.mode,
        promptId: job.promptId || "",
        message: job.message || "",
        progress: job.progress || null,
        error: job.error || "",
        elapsedMs: job.elapsedMs || 0,
        updatedAt: job.updatedAt || new Date().toISOString(),
      };
    },
    { history: false },
  );
}

function clearNodeGenerationJob(nodeId) {
  if (!nodeId) return;
  updateCanvasWorkflow(
    (workflow) => {
      const node = workflow.nodes.find((item) => item.id === nodeId);
      if (node) delete node.activeGenerationJob;
    },
    { history: false },
  );
}

function updateVisibleNodeGenerationJobStatus(nodeId, job) {
  if (!nodeId || !job) return;
  const status = document.querySelector(
    `[data-node-job-status="${CSS.escape(nodeId)}"]`,
  );
  if (status) status.textContent = generationJobProgressText(job);
  const bar = document.querySelector(
    `[data-node-job-progress="${CSS.escape(nodeId)}"]`,
  );
  if (bar) bar.style.width = `${generationJobPercent(job)}%`;
}

function generationJobPercent(job) {
  const percent = Number(job?.progress?.percent || 0);
  if (Number.isFinite(percent) && percent > 0)
    return Math.max(1, Math.min(100, percent));
  if (job?.status === "queued") return 2;
  if (job?.status === "running") return 12;
  if (job?.status === "completed") return 100;
  return 0;
}

function generationJobProgressText(job) {
  const elapsed = Math.max(0, Math.floor(Number(job?.elapsedMs || 0) / 1000));
  const minutes = Math.floor(elapsed / 60);
  const seconds = String(elapsed % 60).padStart(2, "0");
  const elapsedText = minutes ? `${minutes}:${seconds}` : `${elapsed}s`;
  const progress = job?.progress;
  const progressText = progress?.label || job?.message || "正在生成";
  const percent = progress?.percent ? ` ${progress.percent}%` : "";
  const prompt = job?.promptId ? ` · ${job.promptId.slice(0, 8)}` : "";
  return `${progressText}${percent} · ${elapsedText}${prompt}`;
}

function nodeGenerationJobStatusHtml(node) {
  if (!node?.activeGenerationJob) return "";
  const job = node.activeGenerationJob;
  return `
    <div class="node-reference-status generation-progress-card">
      <span data-node-job-status="${escapeHtml(node.id)}">${escapeHtml(generationJobProgressText(job))}</span>
      <i><b data-node-job-progress="${escapeHtml(node.id)}" style="width:${generationJobPercent(job)}%"></b></i>
    </div>
  `;
}

async function waitForGenerationJob(
  job,
  { nodeId = "" } = {},
) {
  let current = job;
  while (
    current &&
    !["completed", "failed", "cancelled"].includes(current.status)
  ) {
    updateNodeGenerationJob(nodeId, current);
    updateVisibleNodeGenerationJobStatus(nodeId, current);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const payload = await api(
      `/api/generation-jobs/${encodeURIComponent(current.id)}`,
    );
    current = payload.job;
    if (payload.user) state.user = payload.user;
  }
  if (!current) throw new Error("生成任务状态丢失");
  updateNodeGenerationJob(nodeId, current);
  if (current.status === "cancelled")
    throw new Error(current.message || "生成任务已取消");
  if (current.status === "failed")
    throw new Error(current.error || current.message || "生成失败");
  return { generation: current.generation, user: current.user };
}

function resumeNodeGenerationJob(node) {
  const job = node?.activeGenerationJob;
  if (
    !job ||
    !["queued", "running"].includes(job.status) ||
    state.generationJobPollers.has(job.id)
  )
    return;
  state.generationJobPollers.add(job.id);
  waitForGenerationJob(job, { nodeId: node.id })
    .then((payload) => {
      if (payload.user) state.user = payload.user;
	      renderAuthArea();
	      if (payload.generation) {
	        updateNodeFromGeneration({
	          nodeId: node.id,
	          generation: payload.generation,
	          mode: payload.generation.mode,
	          prompt: payload.generation.prompt || node.content || "",
	        });
	        clearNodeGenerationJob(node.id);
        refreshCanvasWorkflow();
        toast(`生成任务已完成：${payload.generation.engine}`);
      }
    })
    .catch((error) => {
      if (error.message.includes("生成任务不存在")) {
        clearNodeGenerationJob(node.id);
        refreshCanvasWorkflow();
        toast("后台任务已结束，已刷新生成历史");
        return;
      }
      updateNodeGenerationJob(node.id, {
        ...job,
        status: "failed",
        error: error.message,
        message: `生成失败：${error.message}`,
      });
      refreshCanvasWorkflow();
      toast(error.message);
    })
    .finally(() => {
      state.generationJobPollers.delete(job.id);
    });
}

function updateSelectedNodeFromGeneration({ generation, mode, prompt }) {
  updateCanvasWorkflow((workflow) => {
    const node = selectedCanvasNode(workflow);
    if (!node) return;
    applyGenerationToNode(node, generation, mode, prompt);
  });
}

function updateNodeFromGeneration({ nodeId, generation, mode, prompt }) {
  if (!nodeId) return;
  updateCanvasWorkflow((workflow) => {
    const node = workflow.nodes.find((item) => item.id === nodeId);
    if (!node) return;
    applyGenerationToNode(node, generation, mode, prompt);
    state.selectedNodeId = node.id;
  });
}

function applyGenerationToNode(node, generation, mode, prompt) {
    const references = Array.isArray(generation.referenceAssets)
      ? generation.referenceAssets
      : [];
    node.content =
      mode === "text"
        ? generation.text || `根据提示生成的文本结果：\n${prompt}`
        : prompt || node.content || "";
    node.title = generation.engine || node.title;
    node.model = generation.modelName || generation.engine || "";
    node.referenceInputs = references;
    node.referenceStatus = references.length
      ? generation.referenceInputSupported
        ? `已作为模型输入提交 ${references.length} 个参考素材`
        : `已提交 ${references.length} 个参考素材到后端，当前模型未消费图片输入`
      : "";
    if (mode === "image" || node.type === "image") {
      node.type = "image";
      node.image = generation.image;
      node.source = generation.image;
      node.mimeType = "image/jpeg";
      node.label = node.label || "图片";
    }
    if (mode === "video" || node.type === "video") {
      const videoSource = generation.videoUrl || generation.image || "";
      node.type = "video";
      node.image = "";
      node.videoUrl = videoSource;
      node.source = videoSource;
      node.mimeType = videoSource ? "video/mp4" : "video/mock-preview";
      node.label = node.label || "视频";
    }
}

async function submitBatchImageWorkflow({
  prompt,
  workflow,
  kind,
  mode,
  imageModelValue,
  button,
  config,
}) {
  const outputs = workflow.batchOutputs || [];

  if (!outputs.length) {
    toast("当前工作流没有配置 batchOutputs");
    return;
  }

  const restore = setButtonLoading(
    button,
    `${workflow.title} 生成中 0/${outputs.length}`,
  );

  toast(`${workflow.title} 已拆成 ${outputs.length} 个交付任务`);

  const generated = [];

  try {
    for (const [index, output] of outputs.entries()) {
      const outputTitle = output.title || output.label || `输出 ${index + 1}`;
      const outputSuffix = output.promptSuffix || "";
      const outputSize = output.size || "auto";

      button.textContent = `${outputTitle} 生成中 ${index + 1}/${outputs.length}`;

      const finalPrompt = `${prompt}\n\n${outputSuffix}`.trim();

      const payload = await api("/api/generations", {
        method: "POST",
        body: JSON.stringify(
          generationRequestBody({
            prompt: finalPrompt,
            workflow,
            kind,
            mode,
            imageModelValue,
            size: outputSize,
            quality: "medium",
          }),
        ),
      });

      if (payload.user) state.user = payload.user;

      generated.push({
        output: {
          ...output,
          title: outputTitle,
          promptSuffix: outputSuffix,
          size: outputSize,
        },
        generation: payload.generation,
      });

      appendGenerationNode({
        generation: payload.generation,
        mode,
        label: output.label || outputTitle,
        content: outputSuffix,
      });
    }

    renderAuthArea();

    await refreshGenerationHistoryCache();

    refreshCanvasWorkflow();
    toast(`批量生成完成：共 ${generated.length} 张`);
  } catch (error) {
    toast(`批量生成失败：${error.message}`);
  } finally {
    restore();
  }
}

async function submitGeneration(event) {
  event.preventDefault();
  const prompt = document.querySelector("#promptInput").value.trim();
  const button = document.querySelector("#submitGenerationBtn");
  const imageModelValue =
    document.querySelector("#imageModelSelect")?.value ||
    document.querySelector("#workflowEngine")?.value ||
    "";
  const imageModel = state.imageModels.find(
    (item) => item.id === imageModelValue,
  );
  const workflow = selectedCanvasWorkflow();
  const node = selectedCanvasNode(workflow);
  if (!node) {
    toast("请先选择一个节点");
    return;
  }
  const referenceAssets = nodeReferenceAssets(node, workflow);
  const kind =
    node.type === "text" || node.type === "script"
      ? "text"
      : node.type === "image"
        ? "image"
        : node.type === "video"
          ? "video"
          : "asset";
  if (kind === "asset") {
    toast("素材节点不直接生成；请把它连接到图片或视频节点");
    return;
  }
  if (kind === "text" && !supportsAnyTextGeneration()) {
    toast(state.apiCapabilities?.text?.reason || "当前未接入真实文本生成 API");
    return;
  }
  if (kind === "video" && !supportsAnyVideoGeneration()) {
    toast(state.apiCapabilities?.video?.reason || "当前未接入真实视频生成 API");
    return;
  }
  if (
    kind === "image" &&
    referenceAssets.some((asset) => asset.type === "image") &&
    !supportsImageReference(imageModelValue)
  ) {
    toast(
      `${imageModel?.label || "当前模型"} 不支持图片参考输入，已隐藏该功能。`,
    );
    return;
  }
  const videoConfig = currentVideoComposerConfig();
  const imageConfig = referenceAssets.length
    ? composerModeConfig["图片参考"]
    : composerModeConfig["文生图"];
  const config =
    kind === "text"
      ? {
          mode: "text",
          engine: node.type === "script" ? "脚本生成" : "文本生成",
          modelValue:
            node.type === "script"
              ? "seedance-prompt-zh"
              : "dreamehub-free-chat",
          mention: false,
          cost: 6,
        }
      : kind === "image"
        ? imageConfig
        : videoConfig;
  const mode = config.mode;
  if (
    (mode === "video-face-restore" || mode === "video-face-swap") &&
    !referenceAssets.some((asset) => asset.type === "video") &&
    !(node.type === "video" && nodeHasReferenceSource(node))
  ) {
    toast(
      mode === "video-face-swap"
        ? "请先上传或连接一个视频素材，再使用视频换脸"
        : "请先上传或连接一个视频素材，再使用面部高清修复",
    );
    return;
  }
  if (
    mode === "video-face-swap" &&
    !referenceAssets.some((asset) => asset.type === "image")
  ) {
    toast("请先连接或上传一张参考脸图，再使用视频换脸");
    return;
  }
  const referenceError = validateReferencePrompt(
    prompt,
    config,
    referenceAssets,
  );
  if (referenceError) {
    toast(referenceError);
    document.querySelector("#promptInput")?.focus();
    return;
  }
  state.mode = mode;
  const sourceNodeId = node.id;

  const restore = setButtonLoading(
    button,
    mode === "image" || mode === "text"
      ? `${imageModel?.label || config.engine || "生成模型"} 生成中...`
      : button?.textContent || "↑",
  );
  toast(`${node.label || node.title || "节点"}已提交`);
  let activeGenerationJobId = "";

  try {
    let payload = await api("/api/generations", {
      method: "POST",
      body: JSON.stringify(
        generationRequestBody({
          prompt,
          workflow,
          kind,
          mode,
          imageModelValue,
          workflowMode:
            kind === "text"
              ? "文生文"
              : kind === "image"
                ? referenceAssets.length
                  ? "参考生图"
                  : "文生图"
                : videoConfig.activeTab || state.activeComposerTab,
          referenceAssets,
        }),
      ),
    });
    if (payload.job) {
      updateNodeGenerationJob(sourceNodeId, payload.job);
      refreshCanvasWorkflow();
      toast("生成任务已开始，可在节点预览中查看进度");
      activeGenerationJobId = payload.job.id;
      state.generationJobPollers.add(activeGenerationJobId);
      payload = await waitForGenerationJob(payload.job, {
        nodeId: sourceNodeId,
      });
    }
    if (payload.user) state.user = payload.user;
    renderAuthArea();
    const preview = document.querySelector("#previewImage");
    if (
      preview &&
      mode !== "video" &&
      mode !== "video-face-restore" &&
      mode !== "video-face-swap"
    )
      preview.src = payload.generation.image;
    await refreshGenerationHistoryCache();
    if (selectedCanvasWorkflow()) {
	      if (
	        mode === "video" ||
	        mode === "video-face-restore" ||
	        mode === "video-face-swap"
	      ) {
	        updateNodeFromGeneration({
	          nodeId: sourceNodeId,
	          generation: payload.generation,
	          mode,
	          prompt,
	        });
	        clearNodeGenerationJob(sourceNodeId);
	      } else {
        updateSelectedNodeFromGeneration({
          generation: payload.generation,
          mode,
          prompt,
        });
      }
      refreshCanvasWorkflow();
    }
    toast(
      payload.generation.referenceWarning ||
        `生成任务已完成：${payload.generation.engine}`,
    );
  } catch (error) {
    toast(error.message);
  } finally {
    if (activeGenerationJobId)
      state.generationJobPollers.delete(activeGenerationJobId);
    restore();
  }
}

async function renderWorkflows() {
  const presetsById = new Map(
    canvasWorkflowPresets.map((preset) => [preset.id, preset]),
  );
  const workflowCards = [
    ...canvasWorkflowPresets,
    ...state.workflows.filter((workflow) => !presetsById.has(workflow.id)),
  ];
  appView.innerHTML = `
    <section class="section page-section">
      ${shellHeading("Workflow", "工作流模板", "选择模板查看节点结构，也可以一键带入画布工作台。")}
      <div class="workflow-card-grid">${workflowCards.map(workflowCard).join("")}</div>
    </section>
  `;
  document.querySelectorAll("[data-open-workflow]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedWorkflowId = button.dataset.openWorkflow;
      state.selectedNodeId = "";
      sessionStorage.setItem("DreameHub_workflow", state.selectedWorkflowId);
      setRoute("#/studio");
    });
  });
}

function workflowCard(workflow) {
  const preset = canvasWorkflowPresets.find((item) => item.id === workflow.id);
  const nodes =
    preset?.nodes?.map((node) => node.label) || workflow.nodes || [];
  return `
    <article class="workflow-card">
      <span>${workflow.index || preset?.icon || "WF"}</span>
      <h3>${workflow.title}</h3>
      <p>${workflow.description || workflow.subtitle}</p>
      <div class="workflow-mini-flow">${nodes
        .slice(0, 4)
        .map((node) => `<em>${node}</em>`)
        .join("<i></i>")}</div>
      <div class="meta"><span>${workflow.uses || `${workflow.cost || 6} 算力`}</span><span>${workflow.difficulty || "预设"}</span></div>
      <button class="primary-btn wide" type="button" data-open-workflow="${workflow.id}">打开画布</button>
    </article>
  `;
}

async function renderWorkflowDetail(id) {
  const { workflow } = await api(`/api/workflows/${id}`);
  appView.innerHTML = `
    <section class="section split-section page-section">
      <div>
        <p class="eyebrow">Workflow</p>
        <h1>${workflow.title}</h1>
        <p class="section-copy">${workflow.description}</p>
        <dl class="spec-list compact">
          <div><dt>使用量</dt><dd>${workflow.uses}</dd></div>
          <div><dt>难度</dt><dd>${workflow.difficulty}</dd></div>
        </dl>
        <a class="primary-link route-link" href="#/studio">使用该工作流</a>
      </div>
      <div class="workflow-board">${workflow.nodes.map((node) => `<div class="node ${node === workflow.activeNode ? "active" : ""}">${node}</div>`).join('<div class="connector"></div>')}</div>
    </section>
  `;
}

async function renderPricing() {
  const [{ plans }, ordersPayload] = await Promise.all([
    api("/api/plans"),
    state.user ? api("/api/orders") : Promise.resolve({ orders: [] }),
  ]);
  appView.innerHTML = `
    <section class="section page-section">
      ${shellHeading("Pricing", "价格与支付", "选择套餐后进入安全支付页，支付成功回调确认后自动入账。")}
      <div class="pricing-grid">${plans.map(planCard).join("")}</div>
      <div class="orders-panel">
        <h2>最近订单</h2>
        ${state.user ? ordersHtml(ordersPayload.orders) : '<p class="empty-state">登录后可查看订单记录。</p>'}
      </div>
    </section>
  `;
  document.querySelectorAll("[data-plan-id]").forEach((button) => {
    button.addEventListener("click", () => pay(button));
  });
}

function planCard(plan) {
  return `
    <article class="price-card">
      <p class="eyebrow">${plan.period}</p>
      <h3>${plan.name}</h3>
      <strong>${money(plan.price)}</strong>
      <p>${plan.credits} 算力点</p>
      ${plan.profitProtected ? `<p class="form-hint">已按真实成本保护价计费，单点约 ¥${plan.unitPrice}</p>` : ""}
      <ul>${plan.features.map((feature) => `<li>${feature}</li>`).join("")}</ul>
      <div class="pay-actions">
        <button class="primary-btn" type="button" data-plan-id="${plan.id}" data-method="alipay">支付宝</button>
        <button class="ghost-btn" type="button" data-plan-id="${plan.id}" data-method="wechat">微信</button>
      </div>
    </article>
  `;
}

function ordersHtml(orders) {
  if (!orders.length) return '<p class="empty-state">暂无订单。</p>';
  return `
    <div class="table-list">
      ${orders
        .map(
          (order) =>
            `<div><span>${order.orderNo}</span><strong>${order.planName}</strong><span>${money(order.amount)}</span><span>${order.status}</span></div>`,
        )
        .join("")}
    </div>
  `;
}

async function pay(button) {
  if (!state.user) {
    toast("请先登录后再支付");
    setRoute("#/login");
    return;
  }
  const restore = setButtonLoading(button, "支付中...");
  try {
    const payload = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        planId: button.dataset.planId,
        method: button.dataset.method || "alipay",
      }),
    });
    if (payload.qrImage) {
      showPaymentQr(payload.order, payload.qrImage);
      toast(`订单 ${payload.order.orderNo} 已创建，请扫码支付`);
      return;
    }
    if (payload.checkoutUrl) {
      toast(`订单 ${payload.order.orderNo} 已创建，正在进入支付页`);
      window.location.href = payload.checkoutUrl;
      return;
    }
    toast("支付订单已创建，请前往支付页完成付款");
    await renderPricing();
  } catch (error) {
    toast(error.message);
  } finally {
    restore();
  }
}

function showPaymentQr(order, qrImage) {
  const existing = document.querySelector("#paymentOverlay");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.className = "payment-overlay";
  overlay.id = "paymentOverlay";
  overlay.innerHTML = `
    <div class="payment-dialog">
      <button class="payment-close" type="button" title="关闭">×</button>
      <h2>微信扫码支付</h2>
      <p>${escapeHtml(order.planName)} · ${money(order.amount)} · ${order.credits} 算力点</p>
      <img src="${qrImage}" alt="微信支付二维码" />
      <span>支付完成后积分会自动入账，稍后刷新订单状态。</span>
      <button class="primary-btn" type="button" data-payment-refresh>查看订单</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (event) => {
    if (
      event.target === overlay ||
      event.target.closest(".payment-close")
    ) {
      overlay.remove();
    }
    if (event.target.closest("[data-payment-refresh]")) {
      overlay.remove();
      renderPricing().catch((error) => toast(error.message));
    }
  });
}

function renderLogin() {
  appView.innerHTML = `
    <section class="section auth-layout page-section">
      <div>
        // ${shellHeading("Account", "登录 DreameHub", "使用演示账号 demo@dreamehub.local / 123456，或注册新账号。")}
      </div>
      <form class="auth-card" id="loginForm">
        <label>邮箱<input name="email" type="email" value="" required /></label>
        <label>密码<input name="password" type="password" value="" required /></label>
        <button class="primary-btn wide" type="submit">登录</button>
        <button class="ghost-btn wide" id="registerToggle" type="button">注册新账号</button>
      </form>
    </section>
  `;
  document.querySelector("#loginForm").addEventListener("submit", login);
  document.querySelector("#registerToggle").addEventListener("click", () => {
    toast("正在打开注册表单");
    renderRegister();
  });
}

function renderRegister() {
  appView.innerHTML = `
    <section class="section auth-layout page-section">
      <div>
        ${shellHeading("Onboarding", "验证后创建账号", "流程会依次完成邮箱验证、账号创建、默认 workspace、钱包账户，并进入控制台创建 API Key。")}
        <ol class="flow-list">
          <li>邮箱验证</li>
          <li>创建用户账号</li>
          <li>创建默认项目 / workspace</li>
          <li>创建余额为 0 的钱包</li>
          <li>进入控制台创建 API Key</li>
        </ol>
      </div>
      <form class="auth-card" id="registerForm">
        <label>邮箱<input name="email" type="email" placeholder="name@example.com" required /></label>
        <button class="ghost-btn wide" id="sendCodeBtn" type="button">发送验证码</button>
        <label>验证码<input name="code" inputmode="numeric" placeholder="请输入收到的邮箱验证码" required /></label>
        <button class="ghost-btn wide" id="confirmCodeBtn" type="button">确认验证</button>
        <div class="verification-note" id="verificationNote">尚未验证</div>
        <label>昵称<input name="name" value="New Creator" required /></label>
        <label>密码<input name="password" type="password" minlength="6" required /></label>
        <button class="primary-btn wide" type="submit">创建账号并进入控制台</button>
        <a class="ghost-link route-link center" id="loginToggle" href="#/login">已有账号，去登录</a>
      </form>
    </section>
  `;
  pendingVerification = null;
  document
    .querySelector("#sendCodeBtn")
    .addEventListener("click", sendVerificationCode);
  document
    .querySelector("#confirmCodeBtn")
    .addEventListener("click", confirmVerificationCode);
  document.querySelector("#registerForm").addEventListener("submit", register);
  document.querySelector("#loginToggle").addEventListener("click", (event) => {
    event.preventDefault();
    pendingVerification = null;
    setRoute("#/login");
    renderLogin();
  });
}

async function sendVerificationCode() {
  const form = new FormData(document.querySelector("#registerForm"));
  const email = String(form.get("email") || "").trim();
  const button = document.querySelector("#sendCodeBtn");
  const note = document.querySelector("#verificationNote");
  if (!email) {
    note.textContent = "请先填写邮箱";
    toast("请先填写邮箱");
    return;
  }

  const restore = setButtonLoading(button, "发送中...");
  note.textContent = "正在发送邮箱验证码...";

  try {
    const payload = await api("/api/auth/verification/start", {
      method: "POST",
      body: JSON.stringify({
        channel: "email",
        email,
      }),
    });
    pendingVerification = {
      id: payload.verificationId,
      channel: "email",
      target: email,
    };
    note.textContent = payload.devCode
      ? `验证码已发送，开发验证码：${payload.devCode}`
      : `验证码已通过 ${payload.provider} 发送，请查收。`;
    toast("验证码已发送");
  } catch (error) {
    note.textContent = `发送失败：${error.message}`;
    toast(error.message);
  } finally {
    restore();
  }
}

async function confirmVerificationCode() {
  const note = document.querySelector("#verificationNote");
  if (!pendingVerification) {
    note.textContent = "请先发送验证码";
    toast("请先发送验证码");
    return;
  }
  const form = new FormData(document.querySelector("#registerForm"));
  const button = document.querySelector("#confirmCodeBtn");
  const code = String(form.get("code") || "").trim();
  if (!code) {
    note.textContent = "请输入验证码";
    toast("请输入验证码");
    return;
  }

  const restore = setButtonLoading(button, "验证中...");
  note.textContent = "正在确认验证码...";
  try {
    const payload = await api("/api/auth/verification/confirm", {
      method: "POST",
      body: JSON.stringify({
        verificationId: pendingVerification.id,
        code,
      }),
    });
    pendingVerification = {
      ...pendingVerification,
      token: payload.verificationToken,
    };
    note.textContent = `已验证：${payload.target}`;
    toast("验证完成，可以创建账号");
  } catch (error) {
    note.textContent = `验证失败：${error.message}`;
    toast(error.message);
  } finally {
    restore();
  }
}

async function login(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const restore = setButtonLoading(button, "登录中...");
  toast("正在登录...");
  try {
    const payload = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form.entries())),
    });
    state.token = payload.token;
    state.user = payload.user;
    localStorage.setItem("DreameHub_token", state.token);
    resetCanvasWorkflowCache();
    renderAuthArea();
    toast("登录成功");
    const nextRoute =
      sessionStorage.getItem("DreameHub_afterLogin") || "#/console";
    sessionStorage.removeItem("DreameHub_afterLogin");
    if (window.location.hash === nextRoute) {
      await router();
    } else {
      setRoute(nextRoute);
    }
  } catch (error) {
    toast(`登录失败：${error.message}`);
  } finally {
    restore();
  }
}

async function register(event) {
  event.preventDefault();
  const note = document.querySelector("#verificationNote");
  if (!pendingVerification?.token) {
    note.textContent = "请先完成邮箱验证";
    toast("请先完成邮箱验证");
    return;
  }
  const form = new FormData(event.currentTarget);
  const body = Object.fromEntries(form.entries());
  body.verificationToken = pendingVerification.token;
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const restore = setButtonLoading(button, "创建中...");
  note.textContent = "正在创建账号和默认 workspace...";
  try {
    const payload = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
    });
    state.token = payload.token;
    state.user = payload.user;
    localStorage.setItem("DreameHub_token", state.token);
    resetCanvasWorkflowCache();
    renderAuthArea();
    toast("账号、workspace 和钱包已创建");
    if (window.location.hash === "#/console") {
      await router();
    } else {
      setRoute("#/console");
    }
  } catch (error) {
    note.textContent = `注册失败：${error.message}`;
    toast(error.message);
  } finally {
    restore();
  }
}

async function logout() {
  const restore = setButtonLoading(
    document.querySelector("#logoutBtn"),
    "退出中...",
  );
  try {
    await api("/api/auth/logout", { method: "POST" });
    state.token = "";
    state.user = null;
    localStorage.removeItem("DreameHub_token");
    resetCanvasWorkflowCache({ clearSelection: true });
    renderAuthArea();
    toast("已退出登录");
    setRoute("#/");
  } catch (error) {
    toast(error.message);
  } finally {
    restore();
  }
}

async function renderConsole() {
  if (!state.user) {
    renderLogin();
    return;
  }
  appView.innerHTML = `
    <section class="section page-section">
      ${shellHeading("Console", "控制台", "正在加载 workspace、钱包、订单和 API Key。")}
      <div class="orders-panel"><p class="empty-state" id="consoleStatus">正在加载控制台数据...</p></div>
    </section>
  `;
  const status = document.querySelector("#consoleStatus");
  status.textContent = "正在加载订单记录...";
  const ordersResult = await loadPanel("订单记录", () => api("/api/orders"));
  status.textContent = "正在加载生成历史...";
  const generationsResult = await loadPanel("生成历史", () =>
    api("/api/generations"),
  );
  status.textContent = "正在加载 workspace...";
  const workspaceResult = await loadPanel("Workspace", () =>
    api("/api/workspaces"),
  );
  status.textContent = "正在加载钱包...";
  const walletResult = await loadPanel("钱包", () => api("/api/wallet"));
  status.textContent = "正在加载 API Key...";
  const apiKeysResult = await loadPanel("API Key", () => api("/api/api-keys"));

  const ordersPayload = ordersResult.ok ? ordersResult.payload : { orders: [] };
  const generationsPayload = generationsResult.ok
    ? generationsResult.payload
    : { generations: [] };
  const workspacePayload = workspaceResult.ok
    ? workspaceResult.payload
    : { current: null };
  const walletPayload = walletResult.ok
    ? walletResult.payload
    : { wallet: null };
  const apiKeysPayload = apiKeysResult.ok
    ? apiKeysResult.payload
    : { apiKeys: [] };
  const workspace = workspacePayload.current || {
    name: "未能加载 Workspace",
    projects: [],
  };
  const wallet = walletPayload.wallet || { currency: "CNY", balance: 0 };
  const failures = [
    ["订单记录", ordersResult],
    ["生成历史", generationsResult],
    ["Workspace", workspaceResult],
    ["钱包", walletResult],
    ["API Key", apiKeysResult],
  ].filter(([, result]) => !result.ok);
  appView.innerHTML = `
    <section class="section page-section">
      ${shellHeading("Console", "控制台", "管理 workspace、钱包、订单、生成资产和 API Key。")}
      ${failures.length ? `<div class="app-error-panel"><h1>部分模块加载失败</h1><p>${failures.map(([label, result]) => `${label}：${result.error.message}`).join("；")}</p></div>` : ""}
      <div class="account-grid">
        <div class="profile-card">
          <span class="avatar-large member-center-badge">会员中心</span>
          <h2>${state.user.name}</h2>
          <p>${state.user.email}</p>
          <div class="balance-row"><strong>${state.user.credits}</strong><span>算力点</span><strong>${state.user.plan}</strong><span>当前套餐</span></div>
          <div class="workspace-box">
            <span>默认 Workspace</span>
            <strong>${workspace.name}</strong>
            <small>${workspace.projects[0]?.name || "Default Project"}</small>
          </div>
          <div class="workspace-box">
            <span>钱包账户</span>
            <strong>${wallet.currency} ${wallet.balance.toFixed(2)}</strong>
            <small>注册默认余额为 0</small>
          </div>
          <a class="primary-link route-link" href="#/pricing">充值升级</a>
        </div>
        <div class="orders-panel">
          <h2>创建 API Key</h2>
          <form class="api-key-form" id="apiKeyForm">
            <label>名称<input name="name" value="Production Image API" required /></label>
            <label>额度<input name="quota" type="number" min="0" value="1000" required /></label>
            <fieldset>
              <legend>权限</legend>
              ${apiPermissionOptions.map(([value, label]) => `<label class="check-row"><input type="checkbox" name="permissions" value="${value}" ${["images:create", "chat:create", "models:read", "workflows:run", "billing:read"].includes(value) ? "checked" : ""} />${label}</label>`).join("")}
            </fieldset>
            <label>IP 白名单<textarea name="ipWhitelist" rows="3" placeholder="203.0.113.10&#10;198.51.100.0/24"></textarea></label>
            <button class="primary-btn wide" type="submit">创建 API Key</button>
          </form>
          <div class="secret-box" id="secretBox" hidden></div>
        </div>
      </div>
      <div class="orders-panel"><h2>API Keys</h2><div id="apiKeysList">${apiKeysHtml(apiKeysPayload.apiKeys)}</div></div>
      <div class="orders-panel"><h2>订单记录</h2>${ordersHtml(ordersPayload.orders)}</div>
      <div class="orders-panel"><h2>我的生成</h2><div class="history-list">${historyHtml(generationsPayload.generations)}</div></div>
    </section>
  `;
  document
    .querySelector("#apiKeyForm")
    .addEventListener("submit", createApiKey);
}

async function renderAccount() {
  return renderConsole();
}

function apiKeysHtml(apiKeys) {
  if (!apiKeys.length)
    return '<p class="empty-state">暂无 API Key。创建后密钥明文只展示一次。</p>';
  return `
    <div class="api-key-list">
      ${apiKeys
        .map(
          (key) => `
            <article class="api-key-card">
              <div>
                <h3>${key.name}</h3>
                <code>${key.maskedKey}</code>
              </div>
              <span class="status-pill ${key.status}">${key.status}</span>
              <p>权限：${key.permissions.join(", ")}</p>
              <p>额度：${key.used} / ${key.quota}</p>
              ${
                key.freeQuota
                  ? `<p>免费接口：${Object.entries(key.freeQuota)
                      .map(
                        ([endpoint, limit]) =>
                          `${endpoint} ${key.usage?.[endpoint] || 0}/${limit}`,
                      )
                      .join(" · ")}</p>`
                  : ""
              }
              <p>IP：${key.ipWhitelist.length ? key.ipWhitelist.join(", ") : "不限制"}</p>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

async function createApiKey(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const permissions = form.getAll("permissions");
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const restore = setButtonLoading(button, "创建中...");
  const secretBox = document.querySelector("#secretBox");
  secretBox.hidden = false;
  secretBox.textContent = "正在创建 API Key...";
  try {
    const payload = await api("/api/api-keys", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        quota: form.get("quota"),
        permissions,
        ipWhitelist: form.get("ipWhitelist"),
      }),
    });
    secretBox.innerHTML = `
      <strong>请立即保存 API Key，离开后不再展示明文</strong>
      <code>${payload.secret}</code>
    `;
    const apiKeysPayload = await api("/api/api-keys");
    document.querySelector("#apiKeysList").innerHTML = apiKeysHtml(
      apiKeysPayload.apiKeys,
    );
    toast("API Key 已创建");
  } catch (error) {
    secretBox.textContent = `创建失败：${error.message}`;
    toast(error.message);
  } finally {
    restore();
  }
}

async function router() {
  const parts = routeParts();
  document.body.classList.toggle("canvas-mode", parts[0] === "studio");
  document.body.classList.toggle("home-mode", !parts.length);
  appView.innerHTML =
    '<div class="section page-section"><p class="empty-state">加载中...</p></div>';
  try {
    await loadCommon();
    if (!parts.length) return renderHome();
    if (parts[0] === "models" && parts[1]) return renderModelDetail(parts[1]);
    if (parts[0] === "models") return renderModels();
    if (parts[0] === "studio") return renderStudio();
    if (parts[0] === "workflows" && parts[1])
      return renderWorkflowDetail(parts[1]);
    if (parts[0] === "workflows") return renderWorkflows();
    if (parts[0] === "pricing") return renderPricing();
    if (parts[0] === "login") return renderLogin();
    if (parts[0] === "console") return renderConsole();
    if (parts[0] === "account") return renderAccount();
    document.body.classList.add("home-mode");
    return renderHome();
  } catch (error) {
    appView.innerHTML = `<section class="section page-section"><div class="app-error-panel"><h1>页面加载失败</h1><p>${error.message}</p></div></section>`;
  }
}

window.addEventListener("hashchange", router);
router();
