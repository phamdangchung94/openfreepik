# AI Integration Guide — Video AI API

Hướng dẫn tích hợp public API (`/api/v1/*`) với các AI tool như
ChatGPT, Claude, Cursor, Cline, Copilot và các framework agent
(LangChain, LlamaIndex, OpenAI Assistants).

API surface là REST + JSON, không phụ thuộc SDK riêng. Mọi tool có
khả năng gọi HTTP đều dùng được.

---

## 1. Đặc tả máy đọc được — OpenAPI

`GET /api/v1/openapi.json` trả về OpenAPI 3.1 cho 6 endpoint chính.
Dán URL này vào:

- **ChatGPT Custom GPT** → mục "Actions" → "Import from URL"
- **Cursor / Cline** (qua MCP) → cấu hình `openapi` connector
- **LangChain** → `OpenAPISpec.from_url()` + `OpenAPIToolkit`
- **LlamaIndex** → `OpenAPIToolSpec`

Spec đã brand-neutral — không có chuỗi `Freepik` / `Magnific` lộ ra
cho người dùng cuối.

---

## 2. Mẫu prompt giao cho LLM

Khi muốn LLM tự sinh code tích hợp, dán prompt sau (đã được test
trên GPT-4, Claude Sonnet, Gemini 2.5):

```
Tôi cần tích hợp với REST API sinh video AI.

Auth: header "Authorization: Bearer sk_..." (lấy key từ dashboard).
Base URL: https://your-domain.com/api/v1
OpenAPI spec: https://your-domain.com/api/v1/openapi.json

Endpoints chính:
- POST /video/kling-3        — text/image-to-video, body: {tier:"pro"|"std", params:{prompt, aspect_ratio, duration, image?}}
- POST /video/kling-3-4k-text — 4K text-to-video
- POST /video/kling-3-4k-image — 4K image-to-video
- POST /video/kling-motion/{tier} — character motion control, tier ∈ {v2-6-std, v2-6-pro, v3-std, v3-pro}
- POST /prompt/improve       — mở rộng prompt ngắn
- GET  /tasks/{task_id}      — universal poll, mọi job đều dùng endpoint này

Mọi POST trả về {ok, task_id, balance}. Poll GET /tasks/{id} mỗi 2 giây
cho đến khi status="COMPLETED" (có URL trong generated[0]) hoặc
status="FAILED" (đọc error_message).

Hãy viết: <YÊU CẦU CỦA BẠN — vd: "hàm Python sinh video từ prompt và lưu file MP4 local">
```

---

## 3. Mẫu Cursor / Claude Code MCP

Tạo MCP server đơn giản exposing OpenAPI spec, các AI agent có thể
gọi tool trực tiếp:

```json
{
  "mcpServers": {
    "video-ai": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-openapi"],
      "env": {
        "OPENAPI_URL": "https://your-domain.com/api/v1/openapi.json",
        "API_KEY": "sk_..."
      }
    }
  }
}
```

Sau đó Claude Code / Cursor sẽ thấy 7 tool (`getMe`, `createKling3Video`,
`createKling34kText`, `createKling34kImage`, `createKlingMotion`,
`improvePrompt`, `getTask`) và tự gọi khi user yêu cầu sinh video.

---

## 4. Mẫu LangChain (Python)

```python
from langchain_community.agent_toolkits.openapi.toolkit import OpenAPIToolkit
from langchain_community.utilities.openapi import OpenAPISpec
from langchain_community.tools import RequestsToolkit
from langchain_community.utilities.requests import TextRequestsWrapper

API_KEY = "sk_..."
spec = OpenAPISpec.from_url("https://your-domain.com/api/v1/openapi.json")
requests = TextRequestsWrapper(headers={"Authorization": f"Bearer {API_KEY}"})

toolkit = OpenAPIToolkit.from_llm(
    llm=llm,
    spec=spec,
    requests_wrapper=requests,
    allow_dangerous_requests=True,
)
agent = toolkit.create_agent()
agent.invoke("Sinh video con mèo lướt sóng, 5 giây, dạng 16:9 và trả về URL.")
```

---

## 5. Mẫu OpenAI Assistants (JS)

```javascript
import OpenAI from "openai";

const openai = new OpenAI();
const VIDEO_API_KEY = "sk_...";

const assistant = await openai.beta.assistants.create({
  name: "Video Generator",
  instructions:
    "Sinh video bằng cách gọi createVideo, sau đó pollTask đến khi xong.",
  model: "gpt-4o",
  tools: [
    {
      type: "function",
      function: {
        name: "createVideo",
        description: "Create a Kling 3 video, returns task_id",
        parameters: {
          type: "object",
          properties: {
            prompt: { type: "string" },
            tier: { type: "string", enum: ["pro", "std"] },
            duration: { type: "string", enum: ["5", "10"] },
          },
          required: ["prompt"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "pollTask",
        description: "Poll until COMPLETED or FAILED",
        parameters: {
          type: "object",
          properties: { task_id: { type: "string" } },
          required: ["task_id"],
        },
      },
    },
  ],
});

// Trong handler runStep — gọi lại API thật:
async function createVideo(args) {
  const r = await fetch("https://your-domain.com/api/v1/video/kling-3", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VIDEO_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tier: args.tier ?? "std",
      params: {
        prompt: args.prompt,
        duration: args.duration ?? "5",
        aspect_ratio: "16:9",
      },
    }),
  });
  return r.json();
}
```

---

## 6. Khuyến nghị triển khai

1. **Lưu API key trong server-side env**, không nhúng vào client.
   Nếu cần gọi từ browser, viết proxy route ở backend của bạn.
2. **Backoff khi gặp 429** — đọc header `retry-after`, đừng retry
   liên tục.
3. **Poll mỗi 2 giây** là cân bằng tốt giữa độ trễ phản hồi và rate
   limit (60 req/phút per (key, task_id)).
4. **Mirror URL trong 24 giờ** — server tự host URL trong 24h, sau
   đó hết hạn. Tải về và lưu trữ phía bạn nếu cần lâu hơn.
5. **Hoàn tiền tự động** khi upstream FAILED hoặc trả về rỗng — số
   dư không bị trừ oan, bạn chỉ trả tiền cho video đã sinh thành công.

---

## 7. Giới hạn & rate limit

| Loại | Mặc định | Phạm vi |
|---|---|---|
| Video endpoint | 3 req/phút | per API key |
| Improve prompt | 30 req/phút | per API key |
| Poll task | 60 req/phút | per (API key, task_id) |

Admin có thể nâng giới hạn theo từng key qua dashboard nếu use case
yêu cầu burst cao hơn.

---

## 8. Liên hệ hỗ trợ

- Báo lỗi tích hợp: liên hệ admin qua kênh nội bộ
- Yêu cầu nâng rate limit: kèm dự kiến QPS + use case
- Yêu cầu endpoint mới: kèm spec response mong muốn
