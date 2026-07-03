# DreameHub Full-Stack Prototype

一个类似 AI 模型/工作流创作社区的完整全栈项目，包含前端 SPA、后端 API、PostgreSQL 持久化、真实邮箱验证码、登录注册、真实支付、订单、用户中心和生成任务写入。

## 启动

首次启动建议先复制环境变量模板，并按需填写 OpenAI、Gmail、Seedance 等密钥：

```bash
cp .env.example .env
```

本地开发可直接复制下面的启动脚本执行：

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "已创建 .env，请先填写必要密钥后重新运行。"
  exit 0
fi

if docker info >/dev/null 2>&1; then
  docker compose up -d postgres
else
  echo "Docker 未启动，PostgreSQL 无法启动。请先启动 Docker。"
  exit 1
fi

npm ci
npm run migrate:postgres
npm start
```

打开：

```text
http://localhost:3000
```

## 本地 Skill Workflow Agent

商业视频 Skill Workflow 页面使用本地后端 Agent 控制器：

```text
/api/commercial-video-agent
```

Agent 可以连接 Ollama、LM Studio 或 vLLM 等 OpenAI-compatible 本地模型。示例配置：

```env
COMMERCIAL_AGENT_PROVIDER=local
LOCAL_LLM_BASE_URL=http://127.0.0.1:11434/v1
LOCAL_LLM_MODEL=qwen3:14b
LOCAL_LLM_API_KEY=local
```

如果使用 LM Studio，把 `LOCAL_LLM_BASE_URL` 改成：

```env
LOCAL_LLM_BASE_URL=http://127.0.0.1:1234/v1
```

`COMMERCIAL_AGENT_PROVIDER=auto` 会优先尝试本地模型，本地不可用时回退到云端或免费文本模型。

## 部署

本项目提供 Docker Compose 部署，包含 Web 服务和 PostgreSQL：

```bash
cp .env.example .env
docker compose up --build -d
```

也可以直接复制下面的 Docker 启动脚本执行：

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "已创建 .env，请先填写必要密钥后重新运行。"
  exit 0
fi

docker compose up --build -d
docker compose ps
docker compose logs -f web
npm run migrate:postgres
./scripts/start-comfyui.sh
npm start
```

手动部署到云服务器时：

```bash
npm ci --omit=dev
npm run migrate:postgres
npm start
```

生产环境必须配置：

```text
DATABASE_URL
SMTP_GMAIL_HOST / SMTP_GMAIL_PORT / SMTP_GMAIL_USER / SMTP_GMAIL_PASS / SMTP_GMAIL_FROM
```

`DATABASE_URL` 必须配置。运行期数据库只使用 PostgreSQL，不再回退到本地文件。首次初始化可执行 `npm run migrate:postgres`；如需把历史 JSON 中 PostgreSQL 缺少的记录补进去，执行 `npm run migrate:postgres -- --merge /path/to/db.json`；如需用历史 JSON 覆盖 PostgreSQL，执行 `npm run migrate:postgres -- --replace /path/to/db.json`。

## 项目结构

```text
.
├── server.js
├── package.json
└── public
    ├── index.html
    ├── styles.css
    ├── components.js
    └── app.js
```

## API

- `GET /api/bootstrap`：初始化统计和当前登录用户
- `GET /healthz`：部署健康检查
- `POST /api/auth/login`：登录
- `POST /api/auth/verification/start`：发送邮箱验证码
- `POST /api/auth/verification/confirm`：确认验证码，返回注册用 verification token
- `POST /api/auth/register`：注册
- `GET /api/auth/me`：当前用户
- `POST /api/auth/logout`：退出登录
- `GET /api/workspaces`：当前用户 workspace
- `GET /api/wallet`：当前用户钱包
- `GET /api/api-keys`：当前 workspace 的 API Key 列表
- `POST /api/api-keys`：创建 API Key，返回一次性明文 secret
- `POST /api/api-keys/:id/revoke`：吊销 API Key
- `GET /api/models`：模型广场数据，支持 `?category=portrait`
- `GET /api/models/:id`：模型详情
- `GET /api/workflows`：工作流模板
- `GET /api/workflows/:id`：工作流详情
- `GET /api/community`：社区作品流
- `GET /api/generations`：生成历史
- `POST /api/generations`：创建生成任务
- `GET /api/plans`：套餐列表
- `GET /api/orders`：当前用户订单
- `POST /api/orders`：创建真实支付订单并返回支付跳转地址
- `POST /api/payments/stripe/webhook`：Stripe 支付成功回调，验签后入账积分
- `GET /api/stats`：平台统计
- `GET /v1/quota`：平台 API Key 免费额度查询
- `GET /v1/models`：免费模型列表接口
- `GET /v1/image-models`：可用生图模型列表
- `POST /v1/chat/completions`：真实免费文本生成接口，默认走 Pollinations
- `POST /v1/responses`：OpenAI Responses 兼容中转接口
- `POST /v1/embeddings`：OpenAI Embeddings 兼容中转接口
- `POST /v1/workflows/run`：免费工作流运行接口
- `POST /v1/images/generations`：文生图接口，走真实 OpenAI

数据存储到 PostgreSQL。账号、workspace、钱包、API Key、订单、生成记录和用户工作流都带有关联字段，便于按用户或 workspace 查询。运行期不会读写本地数据库文件。

## 页面

- `#/`：首页
- `#/models`：模型广场
- `#/models/:id`：模型详情
- `#/studio`：创作工作台
- `#/workflows`：工作流列表
- `#/workflows/:id`：工作流详情
- `#/api-relay`：独立 API 中转页，包含渠道、模型、接入示例和在线调试
- `#/pricing`：套餐与真实支付
- `#/login`：登录/注册
- `#/console`：控制台，包含 workspace、钱包和 API Key 管理
- `#/account`：兼容旧用户中心路径，会跳到控制台内容

## 演示账号

```text
邮箱：demo@dreamehub.local
密码：123456
```

支付模块默认接入 Stripe Checkout。点击套餐会创建 `pending` 订单并跳转到 Stripe 安全支付页；只有 `checkout.session.completed` Webhook 通过签名验证后，服务端才会将订单改为 `paid` 并给用户增加算力点。

真实支付配置示例：

```env
PUBLIC_BASE_URL=https://app.dreameac.org
PAYMENT_PROVIDER=stripe
PAYMENT_CURRENCY=cny
STRIPE_SECRET_KEY=sk_live_or_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

Stripe Webhook 地址：

```text
https://app.dreameac.org/api/payments/stripe/webhook
```

生成扣费由服务端按上游成本和目标毛利率计算，前端传入的 `cost` 不参与扣费。可按真实账单调整：

```env
CREDIT_MIN_CNY=0.12
CREDIT_MARGIN_RATE=0.35
UPSTREAM_COST_SEEDANCE_720P_5S_CNY=5.6
UPSTREAM_COST_OPENAI_IMAGE_LOW_CNY=0.25
UPSTREAM_COST_OPENAI_IMAGE_MEDIUM_CNY=0.45
UPSTREAM_COST_OPENAI_IMAGE_HIGH_CNY=0.9
UPSTREAM_COST_FREE_IMAGE_CNY=0.08
UPSTREAM_COST_FACE_RESTORE_CNY=0.6
UPSTREAM_COST_FACE_SWAP_CNY=0.8
UPSTREAM_COST_TRAIN_CNY=3
```

## 注册与 API Key 流程

当前已实现如下链路：

```text
用户注册
↓
邮箱验证
↓
创建用户账号
↓
创建默认项目 / workspace
↓
创建钱包账户，余额为 0
↓
用户进入控制台
↓
点击「创建 API Key」
↓
设置名称、权限、额度、IP 白名单
↓
系统实时生成 API Key
```

验证码发送现在支持真实服务：邮箱只使用 Gmail 个人邮箱 SMTP。只有显式设置 `VERIFICATION_DEV_MODE=true` 时才会返回 `devCode` 便于本地测试；生产环境不要开启。API Key 明文只在创建响应中返回一次，数据层保存 SHA-256 哈希和 masked key。

## 文生图真实接口

创作工作台的“图片”模式已接入 OpenAI 图片生成接口：

- 默认模型：`openai:gpt-image-2`
- 可通过 `OPENAI_IMAGE_MODEL` 覆盖，例如 `OPENAI_IMAGE_MODEL=gpt-image-2`
- 请求接口：`POST /api/generations`
- 生成图片会保存到 `public/generated/`，前端使用返回的本地 URL 展示

如果没有设置 `OPENAI_API_KEY`，图片模式会返回错误；视频和训练模式仍为本地模拟流程。

当前文生图支持多个模型选项：

```text
openai:gpt-image-2   OpenAI GPT Images 2.0，需要 OPENAI_API_KEY
pollinations:flux    Pollinations Flux，无需 OpenAI 额度
pollinations:turbo   Pollinations Turbo，无需 OpenAI 额度
```

前端创作工作台可以直接在“生图模型”下拉框切换。外部 API 调用时使用 `model` 指定：

```json
{
  "model": "pollinations:flux",
  "prompt": "minimal product photo of a glass perfume bottle"
}
```

## Seedance 2.0 视频生成

创作工作台的“视频”模式已接入真实 Seedance 2.0 视频生成。当前支持两种 provider：

```text
ark        火山方舟官方接口，适用于 ark- 开头的 Ark API Key
seedance2  第三方 seedance2.app 接口，适用于第三方平台自己的 API Key
```

火山方舟配置示例：

```env
SEEDANCE_PROVIDER=ark
SEEDANCE_API_KEY=你的火山方舟 Ark API Key
SEEDANCE_MODEL=doubao-seedance-2-0-260128
SEEDANCE_BASE_URL=
PUBLIC_BASE_URL=https://your-public-domain.example.com
```

第三方 seedance2.app 配置示例：

```env
SEEDANCE_PROVIDER=seedance2
SEEDANCE_API_KEY=你的第三方 Seedance API Key
SEEDANCE_MODEL=seedance-2.0
SEEDANCE_BASE_URL=https://seedance2.app/api/v1
```

如果 `SEEDANCE_API_KEY` 以 `ark-` 开头，服务端会默认走火山方舟官方接口：

```text
POST /api/v3/contents/generations/tasks
GET  /api/v3/contents/generations/tasks/{id}
```

旧变量名 `SEEDANCE_VEDIO_MODEL` 仍兼容，但建议改为正确拼写 `SEEDANCE_MODEL`。

图生视频注意事项：

- 如果参考图是公网 URL，服务端会直接传给 Ark。
- 如果参考图是浏览器上传的本地图片或本地生成的 `/generated/...` 图片，必须配置 `PUBLIC_BASE_URL`，否则 Ark 无法从外网拉取图片。
- 本地调试可以启动临时 Cloudflare Quick Tunnel：

```bash
./scripts/start-public-tunnel.sh
```

脚本拿到 `https://...trycloudflare.com` 后会写入 `.env` 的 `PUBLIC_BASE_URL`。写入后需要重启 `npm start`，让后端重新读取环境变量。

## 视频面部高清修复

创作工作台的视频节点支持“面部修复”模式。上传或连接一个视频素材，切到“面部修复”后提交，会将视频发给你配置的上游修复服务。

支持两种上游：

```text
custom   自定义 HTTP 修复接口
comfyui  本地或远程 ComfyUI API workflow
```

自定义接口配置：

```env
FACE_RESTORE_PROVIDER=custom
FACE_RESTORE_API_URL=https://your-face-restore-service.example.com/restore
FACE_RESTORE_API_KEY=your-service-token
```

服务端会向 `FACE_RESTORE_API_URL` 发送 JSON：

```json
{
  "video": "data:video/mp4;base64,... 或视频 URL",
  "videoName": "input.mp4",
  "mimeType": "video/mp4",
  "prompt": "对视频中的人脸进行高清修复...",
  "task": "video-face-restoration",
  "faceRestore": true,
  "quality": "high",
  "strength": 72
}
```

上游返回 JSON 中需要包含 `video_url`、`url` 或 `output_url`，前端会把它作为修复后的视频结果展示。

ComfyUI GFPGAN 工作流配置：

```env
FACE_RESTORE_PROVIDER=comfyui
COMFYUI_BASE_URL=http://127.0.0.1:8188
COMFYUI_FACE_RESTORE_WORKFLOW=workflows/comfyui-face-restore-light.json
COMFYUI_FACE_RESTORE_OUTPUT_NODE=
COMFYUI_FACE_SWAP_WORKFLOW=workflows/comfyui-face-swap-light.json
COMFYUI_FACE_SWAP_OUTPUT_NODE=
COMFYUI_TIMEOUT_MS=3600000
DREAMEHUB_FACE_RESTORE_DEVICE=auto
DREAMEHUB_GFPGAN_MODEL=
DREAMEHUB_INSWAPPER_MODEL=
DREAMEHUB_INSIGHTFACE_MODEL=buffalo_l
DREAMEHUB_FACE_SWAP_PROVIDER=CPUExecutionProvider
```

本机 ComfyUI 已按如下目录约定安装时，可用脚本启动：

```bash
./scripts/start-comfyui.sh
```

默认会启动：

```text
http://127.0.0.1:8188
```

如需使用 Apple Silicon MPS 而不是 CPU，可以覆盖参数：

```bash
COMFYUI_ARGS="" ./scripts/start-comfyui.sh
```

使用步骤：

1. 启动 ComfyUI。
2. 启动本项目 `npm start`。
3. 在工作台上传视频，选中视频节点，切到“面部修复”后提交。
4. 如需“视频换脸”，再连接或上传一张图片素材作为参考脸图，切到“视频换脸”后提交。

当前本机工作流使用自定义 ComfyUI 节点 `DreameHubVideoFaceRestore`，优先加载真实人脸修复模型 `GFPGANv1.4`：

```text
ComfyUI/models/facerestore/GFPGANv1.4.pth
```

节点会逐帧调用 GFPGAN 修复人脸，再按前端设置的“修复强度”与原视频混合，以降低身份漂移和过度锐化风险；如果 GFPGAN 依赖或模型不可用，会自动回退到保守 OpenCV 增强。

面部修复参数由前端提交：

```text
修复强度     控制 GFPGAN 结果与原视频的混合比例
模型保真     传给 GFPGAN 的 weight 参数
细节放大     回退增强时的人脸局部放大比例
边缘范围     回退增强时的人脸区域 padding
```

可选占位符有 `{{VIDEO_NAME}}`、`{{PROMPT}}`、`{{STRENGTH}}`、`{{FIDELITY}}`、`{{SCALE}}`、`{{PADDING}}`、`{{QUALITY}}`。

视频换脸工作流使用自定义节点 `DreameHubVideoFaceSwap`，优先加载真实换脸模型 `InsightFace + inswapper_128.onnx`。输入一个目标视频和一张参考脸图，输出新视频：

```text
workflows/comfyui-face-swap-light.json
```

本机模型路径约定：

```text
ComfyUI/models/faceswap/inswapper_128.onnx
```

也可以通过环境变量显式指定：

```env
DREAMEHUB_INSWAPPER_MODEL=/path/to/inswapper_128.onnx
DREAMEHUB_INSIGHTFACE_MODEL=buffalo_l
DREAMEHUB_FACE_SWAP_PROVIDER=CPUExecutionProvider
DREAMEHUB_FACE_SWAP_DET_SIZE=320
```

节点会对参考脸图提取身份特征，再逐帧检测目标视频中的人脸并执行模型换脸。只有设置 `DREAMEHUB_FACE_SWAP_FALLBACK=1` 时，模型不可用才会回退到旧的 OpenCV 融合方案；默认会直接报错，避免悄悄生成低质量贴脸结果。

换脸参数由前端提交：

```text
换脸强度     控制真实模型换脸结果与原视频的混合比例
边缘羽化     仅在 OpenCV fallback 模式下控制人脸边缘过渡范围
色彩匹配     仅在 OpenCV fallback 模式下控制参考脸图向目标视频光照/肤色靠拢的程度
```

换脸可选占位符有 `{{VIDEO_NAME}}`、`{{FACE_IMAGE_NAME}}`、`{{PROMPT}}`、`{{STRENGTH}}`、`{{FEATHER}}`、`{{COLOR_MATCH}}`、`{{QUALITY}}`。

`DREAMEHUB_FACE_RESTORE_DEVICE=auto` 时会优先使用 Apple Silicon MPS，失败后回退 CPU；也可以显式设置为 `cpu`。如需自定义权重路径，设置 `DREAMEHUB_GFPGAN_MODEL=/path/to/GFPGANv1.4.pth`。

仓库里提供了示例模板：[workflows/comfyui-face-restore-light.example.json](workflows/comfyui-face-restore-light.example.json) 和 [workflows/comfyui-face-swap-light.example.json](workflows/comfyui-face-swap-light.example.json)。不同 ComfyUI 插件的节点名和输入字段可能不同，实际使用时以你本机导出的 API workflow 为准。

## 使用平台 API Key 调用外部 API

独立中转页面：

```text
http://localhost:3000/#/api-relay
```

页面使用统一的 OpenAI-compatible Base URL：

```text
http://localhost:3000/v1
```

可通过 `.env` 配置多个 OpenAI-compatible 上游渠道。公开模型名由
`modelMap` 的键决定，同一个公开模型可以配置到多个渠道；服务端按
`priority` 从小到大尝试，并在失败时自动切换：

```env
SILICONFLOW_API_KEY=your-key
API_RELAY_TIMEOUT_MS=120000
API_RELAY_MAX_RETRIES=2
API_RELAY_CHANNELS_JSON=[{"id":"siliconflow","name":"SiliconFlow","baseUrl":"https://api.siliconflow.cn/v1","apiKeyEnv":"SILICONFLOW_API_KEY","priority":10,"capabilities":["chat","embeddings"],"modelMap":{"deepseek-chat":"deepseek-ai/DeepSeek-V3","bge-m3":"BAAI/bge-m3"}}]
```

项目内置了国内模型目录与对应的 OpenAI-compatible 渠道适配：

```env
API_KEY_ENCRYPTION_SECRET=请替换为至少32位随机字符串
DEEPSEEK_API_KEY=
DASHSCOPE_API_KEY=
ARK_API_KEY=
ARK_TEXT_MODEL=火山方舟推理接入点ID
MOONSHOT_API_KEY=
ZHIPU_API_KEY=
```

包括 DeepSeek Chat/Reasoner、通义千问 Plus/Max/Coder、通义文本向量、
豆包 Seed、Kimi 和 GLM。未配置厂商密钥的模型会在模型广场显示为
“待配置”，不会被错误标记为在线。

新创建的平台 API Key 会使用 AES-256-GCM 加密保存，因此登录控制台后
可以通过眼睛按钮显示或隐藏全文。历史 Key 过去只保存 SHA-256 哈希，
无法反向恢复，需要重新创建。

渠道配置只在服务端读取；浏览器和终端用户只接触平台生成的
`dh_live_...`，不会获取上游 API Key。当前中转请求为非流式模式，
客户端需要设置 `stream=false`。

控制台创建的 `dh_live_...` 可以调用平台对外 API。平台会先校验 API Key 的权限、额度和 IP 白名单，再由服务端请求对应上游模型。

文本生成提供免费和 OpenAI 两套接口：

```text
dreamehub-free-chat          普通文本生成，走 Pollinations 免费真实模型
openai-chat                  普通文本生成，走 OPENAI_API_KEY
seedance-prompt-zh           Seedance 2.0 提示词改写，走 Pollinations 免费真实模型
seedance-prompt-zh-openai    Seedance 2.0 提示词改写，走 OPENAI_API_KEY
```

免费文本模型不需要额外配置第三方 Key。可通过 `POLLINATIONS_TEXT_MODEL` 覆盖默认上游模型，例如 `openai`、`openai-fast`：

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer dh_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "dreamehub-free-chat",
    "messages": [
      {
        "role": "user",
        "content": "帮我写一个15秒咖啡品牌短视频脚本"
      }
    ]
  }'
```

工作台里的“文本”节点只做普通文本生成，不接入 Seedance skill；“脚本”节点会接入 Seedance 2.0 中文视频提示词规范，把普通创意改写为可直接用于视频生成的结构化脚本、分镜和提示词。外部 API 可使用 `seedance-prompt-zh`：

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer dh_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "seedance-prompt-zh",
    "messages": [
      {
        "role": "user",
        "content": "做一个15秒香水电商广告，玻璃瓶，雨后花园，想要高级电影感"
      }
    ]
}'
```

如果要使用 OpenAI 版本，将 `model` 改成 `seedance-prompt-zh-openai`；普通文本生成的 OpenAI 版本使用 `openai-chat`。

```bash
curl -X POST http://localhost:3000/v1/images/generations \
  -H "Authorization: Bearer dh_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "一只玻璃香水瓶，极简商业广告，柔光",
    "size": "1024x1024",
    "quality": "medium"
  }'
```

返回值会包含生成图片的本地 URL、模型名、usage 和当前 API Key 的额度消耗情况。不要把 OpenAI 官方 Key 发给终端用户；终端用户只使用你平台生成的 `dh_live_...`。

如果浏览器能通过 VPN 打开 OpenAI，但 Node 仍然超时，请在 `.env` 里设置 VPN 客户端提供的 HTTP 代理地址：

```env
OPENAI_PROXY=http://127.0.0.1:7890
```

不同客户端端口不同，Clash 常见 `7890`，Surge 常见 `6152`，V2RayN 常见 `10809`。这里需要 HTTP 代理端口，不是 SOCKS 端口。

## 测试用例

启动服务后运行端到端测试：

```bash
npm run test:openai-proxy
```

测试会自动完成：邮箱验证、注册、创建默认 workspace、创建余额为 0 的钱包、创建平台 API Key，并通过 `/v1/images/generations` 真实调用 OpenAI。

新增的免费额度接口可以不依赖 OpenAI 计费直接测试：

```bash
npm run test:free-apis
npm run test:image-models
```

默认每个 API Key 会带这些免费额度：

```text
models:list        1000 次
images:generations 5 次
chat:completions   50 次
workflows:run      30 次
```

每个接口会独立扣减额度，`/v1/quota` 可查询剩余额度。

## Cloudflare R2 对象存储

生产环境建议让浏览器直接上传图片、视频和音频到 R2，避免大文件经过
Cloudflare Tunnel 和本机 Node 服务。

在 `.env` 中配置：

```env
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_BASE_URL=https://media.example.com
R2_ALLOWED_ORIGINS=https://app.dreameac.org,http://localhost:3000
R2_PRESIGN_TTL_SECONDS=900
```

`R2_PUBLIC_BASE_URL` 必须填写 R2 bucket 的 `r2.dev` 公共开发 URL 或已绑定的
自定义公开域名。不要填写 `https://<account-id>.r2.cloudflarestorage.com`，
该地址是 S3 API endpoint，不能直接作为素材公开 URL。

配置 bucket CORS：

```powershell
npm run configure:r2-cors
```

首次迁移现有 `public/generated`、`public/assets`，并改写 PostgreSQL 中旧的
`/generated/...` 与内嵌 data URL：

```powershell
npm run migrate:r2-objects -- --dry-run
npm run migrate:r2-objects
```

检查全库孤儿对象（默认只预演，并跳过 24 小时内的新对象）：

```powershell
npm run gc:r2-objects
npm run gc:r2-objects -- --apply
```

节点或工作流删除时，服务端会统计全部 PostgreSQL 数据中的 R2 引用。对象仅在
引用数变为 0 时删除；`assets/` 静态资源不会被自动回收。

重启服务后检查：

```text
GET /healthz
mediaStorage: "r2"
```

未配置 R2 时，前端会自动回退到 `/api/canvas-media` 本地上传。
