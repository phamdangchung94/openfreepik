"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Public API documentation. Standalone page — no /api/pricing/rates
 * fetch, no auth. Everything is static content + copy-to-clipboard
 * code blocks. The /api/v1/* endpoints use SHA-256 hashed API keys
 * (sk_*) provisioned via the admin dashboard.
 */
export default function ApiDocsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">API tài liệu</h1>
          <p className="text-sm text-muted-foreground">
            Tích hợp video AI vào ứng dụng của bạn qua API key. Hỗ trợ
            curl, JavaScript, Python — và tích hợp trực tiếp với
            ChatGPT, Claude, Cursor.
          </p>
        </div>
        <Link
          href="/"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          <ArrowLeft className="size-4" />
          <span className="hidden sm:inline">Quay lại</span>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Tổng quan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Mọi request đều cần header <Code>Authorization: Bearer sk_...</Code>.
            API key được cấp 1 lần — lưu lại ngay sau khi tạo, hệ thống chỉ
            giữ hash SHA-256.
          </p>
          <p>
            Base URL:{" "}
            <Code>{typeof window !== "undefined" ? window.location.origin : "https://video.chugax.io.vn"}/api/v1</Code>
          </p>
          <p className="text-muted-foreground">
            Rate limit mặc định: 3 req/phút cho video, 30 req/phút cho
            improve prompt. Admin có thể nâng giới hạn cho từng key.
          </p>
        </CardContent>
      </Card>

      <Section
        anchor="auth"
        title="1. Kiểm tra key & số dư"
        method="GET"
        path="/api/v1/me"
      >
        <p className="text-sm text-muted-foreground">
          Gọi đầu tiên trước khi sinh video — xác nhận key hợp lệ và đọc
          số dư hiện tại.
        </p>
        <CodeTabs
          samples={{
            curl: `curl https://video.chugax.io.vn/api/v1/me \\
  -H "Authorization: Bearer sk_your_key_here"`,
            javascript: `const res = await fetch("https://video.chugax.io.vn/api/v1/me", {
  headers: { Authorization: "Bearer sk_your_key_here" },
});
const { key, balance } = await res.json();
console.log("Số dư còn:", balance.remainingEur, "EUR");`,
            python: `import requests

r = requests.get(
    "https://video.chugax.io.vn/api/v1/me",
    headers={"Authorization": "Bearer sk_your_key_here"},
)
data = r.json()
print("Số dư còn:", data["balance"]["remainingEur"], "EUR")`,
          }}
        />
        <ResponseBlock
          json={`{
  "ok": true,
  "key": { "id": "...", "label": "Demo", "rateLimitPerMin": null },
  "balance": {
    "mode": "topup",
    "usedEur": 1.234,
    "quotaEur": 10.0,
    "remainingEur": 8.766
  }
}`}
        />
      </Section>

      <Section
        anchor="kling-3"
        title="2. Tạo video Kling 3 (text-to-video / image-to-video)"
        method="POST"
        path="/api/v1/video/kling-3"
      >
        <p className="text-sm text-muted-foreground">
          Sinh video từ prompt (T2V) hoặc prompt + ảnh (I2V). Trả về
          <Code>task_id</Code>; gọi <Code>GET /api/v1/tasks/{"{task_id}"}</Code> mỗi 2 giây để
          theo dõi trạng thái.
        </p>
        <CodeTabs
          samples={{
            curl: `curl -X POST https://video.chugax.io.vn/api/v1/video/kling-3 \\
  -H "Authorization: Bearer sk_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "tier": "pro",
    "params": {
      "prompt": "A cat surfing a wave at sunset, cinematic 4K",
      "aspect_ratio": "16:9",
      "duration": "5",
      "generate_audio": false
    }
  }'`,
            javascript: `const res = await fetch("https://video.chugax.io.vn/api/v1/video/kling-3", {
  method: "POST",
  headers: {
    Authorization: "Bearer sk_your_key_here",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    tier: "pro",
    params: {
      prompt: "A cat surfing a wave at sunset, cinematic 4K",
      aspect_ratio: "16:9",
      duration: "5",
      generate_audio: false,
    },
  }),
});
const { task_id } = await res.json();`,
            python: `import requests

r = requests.post(
    "https://video.chugax.io.vn/api/v1/video/kling-3",
    headers={
        "Authorization": "Bearer sk_your_key_here",
        "Content-Type": "application/json",
    },
    json={
        "tier": "pro",
        "params": {
            "prompt": "A cat surfing a wave at sunset, cinematic 4K",
            "aspect_ratio": "16:9",
            "duration": "5",
            "generate_audio": False,
        },
    },
)
task_id = r.json()["task_id"]`,
          }}
        />
        <p className="text-xs text-muted-foreground">
          Tham số <Code>tier</Code>: <Code>std</Code> hoặc <Code>pro</Code>.
          {" "}<Code>duration</Code>: 5 hoặc 10 giây.{" "}
          <Code>aspect_ratio</Code>: 16:9 / 9:16 / 1:1.
        </p>
      </Section>

      <Section
        anchor="kling-3-4k"
        title="3. Tạo video Kling 3 4K"
        method="POST"
        path="/api/v1/video/kling-3-4k-text · /api/v1/video/kling-3-4k-image"
      >
        <p className="text-sm text-muted-foreground">
          Phiên bản 4K, độ phân giải cao hơn. Hai endpoint riêng: text-to-video
          và image-to-video.
        </p>
        <CodeTabs
          samples={{
            curl: `# Text-to-Video 4K
curl -X POST https://video.chugax.io.vn/api/v1/video/kling-3-4k-text \\
  -H "Authorization: Bearer sk_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "params": {
      "prompt": "Aerial view of Hạ Long bay at golden hour",
      "duration": "5",
      "aspect_ratio": "16:9"
    }
  }'

# Image-to-Video 4K
curl -X POST https://video.chugax.io.vn/api/v1/video/kling-3-4k-image \\
  -H "Authorization: Bearer sk_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "params": {
      "image": "https://your-cdn.com/portrait.jpg",
      "prompt": "The character slowly smiles",
      "duration": "5"
    }
  }'`,
            javascript: `// Text-to-Video 4K
const t2v = await fetch("https://video.chugax.io.vn/api/v1/video/kling-3-4k-text", {
  method: "POST",
  headers: { Authorization: "Bearer sk_...", "Content-Type": "application/json" },
  body: JSON.stringify({
    params: { prompt: "...", duration: "5", aspect_ratio: "16:9" },
  }),
});

// Image-to-Video 4K
const i2v = await fetch("https://video.chugax.io.vn/api/v1/video/kling-3-4k-image", {
  method: "POST",
  headers: { Authorization: "Bearer sk_...", "Content-Type": "application/json" },
  body: JSON.stringify({
    params: { image: "https://your-cdn.com/portrait.jpg", prompt: "...", duration: "5" },
  }),
});`,
            python: `# Text-to-Video 4K
r = requests.post(
    "https://video.chugax.io.vn/api/v1/video/kling-3-4k-text",
    headers={"Authorization": "Bearer sk_...", "Content-Type": "application/json"},
    json={"params": {"prompt": "...", "duration": "5", "aspect_ratio": "16:9"}},
)

# Image-to-Video 4K
r = requests.post(
    "https://video.chugax.io.vn/api/v1/video/kling-3-4k-image",
    headers={"Authorization": "Bearer sk_...", "Content-Type": "application/json"},
    json={"params": {"image": "https://your-cdn.com/portrait.jpg", "prompt": "...", "duration": "5"}},
)`,
          }}
        />
      </Section>

      <Section
        anchor="motion"
        title="4. Tạo video Kling Motion Control"
        method="POST"
        path="/api/v1/video/kling-motion/{tier}"
      >
        <p className="text-sm text-muted-foreground">
          Cho nhân vật trong ảnh thực hiện chuyển động từ video tham
          chiếu. <Code>{"{tier}"}</Code> có 4 giá trị:{" "}
          <Code>v2-6-std</Code>, <Code>v2-6-pro</Code>,{" "}
          <Code>v3-std</Code>, <Code>v3-pro</Code>.
        </p>
        <CodeTabs
          samples={{
            curl: `curl -X POST https://video.chugax.io.vn/api/v1/video/kling-motion/v3-pro \\
  -H "Authorization: Bearer sk_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "params": {
      "image_url": "https://your-cdn.com/character.png",
      "video_url": "https://your-cdn.com/reference-motion.mp4",
      "prompt": "anime style, vibrant colors",
      "character_orientation": "video",
      "cfg_scale": 0.5
    },
    "output_duration": 5
  }'`,
            javascript: `const res = await fetch(
  "https://video.chugax.io.vn/api/v1/video/kling-motion/v3-pro",
  {
    method: "POST",
    headers: {
      Authorization: "Bearer sk_your_key_here",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      params: {
        image_url: "https://your-cdn.com/character.png",
        video_url: "https://your-cdn.com/reference-motion.mp4",
        prompt: "anime style, vibrant colors",
        character_orientation: "video",
        cfg_scale: 0.5,
      },
      output_duration: 5,
    }),
  },
);`,
            python: `r = requests.post(
    "https://video.chugax.io.vn/api/v1/video/kling-motion/v3-pro",
    headers={
        "Authorization": "Bearer sk_your_key_here",
        "Content-Type": "application/json",
    },
    json={
        "params": {
            "image_url": "https://your-cdn.com/character.png",
            "video_url": "https://your-cdn.com/reference-motion.mp4",
            "prompt": "anime style, vibrant colors",
            "character_orientation": "video",
            "cfg_scale": 0.5,
        },
        "output_duration": 5,
    },
)`,
          }}
        />
        <p className="text-xs text-muted-foreground">
          <Code>character_orientation</Code>: <Code>video</Code> (mặc định,
          max 30s) hoặc <Code>image</Code> (max 10s).
          <br />
          <Code>output_duration</Code>: 5/10/15/30 giây tuỳ orientation —
          giá tính theo giây delivered.
        </p>
      </Section>

      <Section
        anchor="omni"
        title="5. Tạo video Kling 3 Omni (T2V / I2V / V2V + multi-shot + audio)"
        method="POST"
        path="/api/v1/video/kling-omni/{tier}"
      >
        <p className="text-sm text-muted-foreground">
          Model đa năng — chọn 1 trong 3 chế độ qua URL slug. Hỗ trợ
          multi-shot tới 6 cảnh và audio tự nhiên. <Code>{"{tier}"}</Code>{" "}
          có 4 giá trị:
        </p>
        <ul className="ml-5 list-disc text-xs text-muted-foreground">
          <li>
            <Code>omni-std</Code> / <Code>omni-pro</Code> — Text/Image-to-Video
          </li>
          <li>
            <Code>omni-ref-std</Code> / <Code>omni-ref-pro</Code> —
            Reference-to-Video (cần <Code>video_url</Code>)
          </li>
        </ul>
        <CodeTabs
          samples={{
            curl: `# T2V đơn giản
curl -X POST https://video.chugax.io.vn/api/v1/video/kling-omni/omni-pro \\
  -H "Authorization: Bearer sk_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "params": {
      "prompt": "A cat surfing through neon Tokyo at night",
      "duration": "8",
      "aspect_ratio": "16:9",
      "generate_audio": true
    }
  }'

# Multi-shot 3 cảnh
curl -X POST https://video.chugax.io.vn/api/v1/video/kling-omni/omni-pro \\
  -H "Authorization: Bearer sk_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "params": {
      "multi_prompt": [
        "Wide shot of misty forest at dawn",
        "Close-up of a deer drinking from stream",
        "Pan up to mountains in the distance"
      ],
      "shot_type": "customize",
      "duration": "9",
      "aspect_ratio": "9:16"
    }
  }'

# V2V (reference-to-video)
curl -X POST https://video.chugax.io.vn/api/v1/video/kling-omni/omni-ref-pro \\
  -H "Authorization: Bearer sk_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "params": {
      "video_url": "https://your-cdn.com/reference.mp4",
      "prompt": "@Video1 reimagined as cyberpunk anime",
      "duration": "5",
      "aspect_ratio": "auto"
    }
  }'`,
            javascript: `// T2V
const res = await fetch(
  "https://video.chugax.io.vn/api/v1/video/kling-omni/omni-pro",
  {
    method: "POST",
    headers: {
      Authorization: "Bearer sk_your_key_here",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      params: {
        prompt: "A cat surfing through neon Tokyo at night",
        duration: "8",
        aspect_ratio: "16:9",
        generate_audio: true,
      },
    }),
  },
);

// V2V
const v2v = await fetch(
  "https://video.chugax.io.vn/api/v1/video/kling-omni/omni-ref-pro",
  {
    method: "POST",
    headers: { Authorization: "Bearer sk_...", "Content-Type": "application/json" },
    body: JSON.stringify({
      params: {
        video_url: "https://your-cdn.com/reference.mp4",
        prompt: "@Video1 reimagined as cyberpunk anime",
        duration: "5",
      },
    }),
  },
);`,
            python: `import requests

# T2V
r = requests.post(
    "https://video.chugax.io.vn/api/v1/video/kling-omni/omni-pro",
    headers={
        "Authorization": "Bearer sk_your_key_here",
        "Content-Type": "application/json",
    },
    json={
        "params": {
            "prompt": "A cat surfing through neon Tokyo at night",
            "duration": "8",
            "aspect_ratio": "16:9",
            "generate_audio": True,
        },
    },
)
task_id = r.json()["task_id"]

# V2V
r = requests.post(
    "https://video.chugax.io.vn/api/v1/video/kling-omni/omni-ref-pro",
    headers={
        "Authorization": "Bearer sk_...",
        "Content-Type": "application/json",
    },
    json={
        "params": {
            "video_url": "https://your-cdn.com/reference.mp4",
            "prompt": "@Video1 reimagined as cyberpunk anime",
            "duration": "5",
        },
    },
)`,
          }}
        />
        <p className="text-xs text-muted-foreground">
          <Code>aspect_ratio</Code>: <Code>auto</Code> / 16:9 / 9:16 / 1:1.
          <br />
          <Code>duration</Code>: string &quot;3&quot;..&quot;15&quot; (giây). Pricing
          per-second với ceiling.
          <br />
          <Code>generate_audio</Code>: bật → giá ~1.83× cao hơn.
        </p>
      </Section>

      <Section
        anchor="improve-prompt"
        title="6. Cải thiện prompt"
        method="POST"
        path="/api/v1/prompt/improve"
      >
        <p className="text-sm text-muted-foreground">
          Mở rộng prompt ngắn thành mô tả chi tiết. Miễn phí, vẫn cần API key.
          Trả về <Code>task_id</Code> — poll qua <Code>/api/v1/tasks/{"{task_id}"}</Code>,
          kết quả nằm trong <Code>generated[0]</Code>.
        </p>
        <CodeTabs
          samples={{
            curl: `curl -X POST https://video.chugax.io.vn/api/v1/prompt/improve \\
  -H "Authorization: Bearer sk_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "prompt": "con mèo lướt sóng",
    "type": "video",
    "language": "vi"
  }'`,
            javascript: `const res = await fetch("https://video.chugax.io.vn/api/v1/prompt/improve", {
  method: "POST",
  headers: {
    Authorization: "Bearer sk_your_key_here",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    prompt: "con mèo lướt sóng",
    type: "video",
    language: "vi",
  }),
});`,
            python: `r = requests.post(
    "https://video.chugax.io.vn/api/v1/prompt/improve",
    headers={
        "Authorization": "Bearer sk_your_key_here",
        "Content-Type": "application/json",
    },
    json={"prompt": "con mèo lướt sóng", "type": "video", "language": "vi"},
)`,
          }}
        />
      </Section>

      <Section
        anchor="poll"
        title="7. Theo dõi tác vụ"
        method="GET"
        path="/api/v1/tasks/{task_id}"
      >
        <p className="text-sm text-muted-foreground">
          Endpoint chung cho mọi model. Poll mỗi 2 giây cho đến khi
          <Code>status</Code> = <Code>COMPLETED</Code> hoặc <Code>FAILED</Code>.
        </p>
        <CodeTabs
          samples={{
            curl: `curl https://video.chugax.io.vn/api/v1/tasks/abc123 \\
  -H "Authorization: Bearer sk_your_key_here"`,
            javascript: `async function waitForTask(taskId, apiKey) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const r = await fetch(\`https://video.chugax.io.vn/api/v1/tasks/\${taskId}\`, {
      headers: { Authorization: \`Bearer \${apiKey}\` },
    });
    const data = await r.json();
    if (data.status === "COMPLETED") return data.generated[0];
    if (data.status === "FAILED") throw new Error(data.error_message ?? "FAILED");
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("timeout");
}`,
            python: `import time

def wait_for_task(task_id: str, api_key: str) -> str:
    headers = {"Authorization": f"Bearer {api_key}"}
    for _ in range(60):
        r = requests.get(
            f"https://video.chugax.io.vn/api/v1/tasks/{task_id}",
            headers=headers,
        )
        data = r.json()
        if data["status"] == "COMPLETED":
            return data["generated"][0]
        if data["status"] == "FAILED":
            raise RuntimeError(data.get("error_message") or "FAILED")
        time.sleep(2)
    raise TimeoutError("task did not finish in 2 minutes")`,
          }}
        />
        <ResponseBlock
          json={`{
  "ok": true,
  "task_id": "abc123",
  "status": "COMPLETED",
  "generated": ["https://cdn.../video.mp4"],
  "error_message": null
}`}
        />
      </Section>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Mã lỗi</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4">Mã</th>
                <th className="py-2 pr-4">HTTP</th>
                <th className="py-2">Ý nghĩa</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <ErrorRow code="AUTH" status="401" desc="API key thiếu hoặc không hợp lệ" />
              <ErrorRow code="BAD_REQUEST" status="400" desc="Body không hợp lệ (xem trường issues)" />
              <ErrorRow code="RATE_LIMIT" status="429" desc="Vượt rate limit — đọc header retry-after" />
              <ErrorRow code="INSUFFICIENT_FUNDS" status="402" desc="Số dư không đủ cho request này" />
              <ErrorRow code="PRICING_MISSING" status="503" desc="Hệ thống chưa cấu hình giá cho kiểu request" />
              <ErrorRow code="NO_KEYS_AVAILABLE" status="503" desc="Tạm hết slot — thử lại sau 1-2 phút" />
              <ErrorRow code="NOT_FOUND" status="404" desc="task_id không tồn tại" />
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Tích hợp với AI</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Có thể đưa toàn bộ tài liệu này cho ChatGPT, Claude, Cursor,
            Copilot để chúng tự sinh code tích hợp. Mẫu prompt gợi ý:
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted/60 p-3 text-xs">
{`Tôi cần một hàm Python sinh video qua API. Spec:
- Base URL: https://video.chugax.io.vn/api/v1
- Auth: header "Authorization: Bearer sk_..."
- POST /video/kling-3  body: {tier, params:{prompt, aspect_ratio, duration}}
  → trả {ok, task_id}
- GET /tasks/{id}  → trả {status, generated:[url], error_message}
  Poll 2s cho đến COMPLETED hoặc FAILED.
Viết hàm generate_video(prompt) trả về URL video, raise lỗi nếu FAILED.`}
          </pre>
          <p className="text-muted-foreground">
            Endpoint <Code>GET /api/v1/openapi.json</Code> cung cấp đặc
            tả OpenAPI 3.1 mà các MCP/AI tool có thể nạp trực tiếp.
          </p>
        </CardContent>
      </Card>

      <div className="rounded-md border bg-muted/30 p-4 text-xs text-muted-foreground">
        <Badge variant="secondary" className="mr-2">Lưu ý</Badge>
        Video URL hết hạn sau 24 giờ. Tải xuống và lưu trữ về phía bạn
        nếu cần lâu dài. Số dư dùng đến đâu trừ đến đó — request
        FAILED sẽ được hoàn lại tự động.
      </div>
    </div>
  );
}

function Section({
  anchor,
  title,
  method,
  path,
  children,
}: {
  anchor: string;
  title: string;
  method: "GET" | "POST";
  path: string;
  children: React.ReactNode;
}) {
  return (
    <Card id={anchor} className="scroll-mt-20">
      <CardHeader className="space-y-2">
        <CardTitle className="text-lg">{title}</CardTitle>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge
            variant="secondary"
            className={cn(
              "font-mono",
              method === "POST" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
              method === "GET" && "bg-blue-500/10 text-blue-700 dark:text-blue-300",
            )}
          >
            {method}
          </Badge>
          <Code>{path}</Code>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

type Lang = "curl" | "javascript" | "python";

function CodeTabs({ samples }: { samples: Record<Lang, string> }) {
  const [active, setActive] = useState<Lang>("curl");
  return (
    <div className="space-y-2">
      <div className="flex gap-1 border-b">
        {(["curl", "javascript", "python"] as const).map((lang) => (
          <button
            key={lang}
            type="button"
            onClick={() => setActive(lang)}
            className={cn(
              "border-b-2 px-3 py-1.5 text-xs font-medium transition-colors",
              active === lang
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {lang === "curl" ? "cURL" : lang === "javascript" ? "JavaScript" : "Python"}
          </button>
        ))}
      </div>
      <CopyableCode code={samples[active]} />
    </div>
  );
}

function CopyableCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md bg-muted/60 p-3 text-xs">
        <code>{code}</code>
      </pre>
      <Button
        size="sm"
        variant="ghost"
        className="absolute right-2 top-2 h-7 px-2"
        onClick={async () => {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
    </div>
  );
}

function ResponseBlock({ json }: { json: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">Phản hồi:</p>
      <CopyableCode code={json} />
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
      {children}
    </code>
  );
}

function ErrorRow({
  code,
  status,
  desc,
}: {
  code: string;
  status: string;
  desc: string;
}) {
  return (
    <tr>
      <td className="py-2 pr-4 font-mono text-xs">{code}</td>
      <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{status}</td>
      <td className="py-2">{desc}</td>
    </tr>
  );
}
