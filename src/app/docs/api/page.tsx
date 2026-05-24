"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TryIt } from "./try-it";
import { SidebarNav, MobileSectionMenu, type NavItem } from "./sidebar-nav";
import { CopyForAiButton } from "./copy-for-ai-button";
import { ParameterMatrix } from "./parameter-matrix";
import { PricingTable } from "./pricing-table";

const NAV_ITEMS: readonly NavItem[] = [
  { anchor: "auth", label: "Kiểm tra key", method: "GET", group: "Bắt đầu" },
  { anchor: "security", label: "Bảo mật & best-practices", group: "Bắt đầu" },
  { anchor: "lifecycle", label: "Task lifecycle & polling", group: "Bắt đầu" },
  { anchor: "retention", label: "Lưu trữ dữ liệu", group: "Bắt đầu" },
  { anchor: "models", label: "Danh sách model", method: "GET", group: "Khám phá" },
  { anchor: "usage", label: "Lịch sử dùng", method: "GET", group: "Khám phá" },
  { anchor: "upload", label: "Tải file", method: "POST", group: "Khám phá" },
  { anchor: "kling-3", label: "Kling 3 video", method: "POST", group: "Video" },
  { anchor: "kling-3-4k", label: "Kling 3 4K", method: "POST", group: "Video" },
  { anchor: "motion", label: "Motion Control", method: "POST", group: "Video" },
  // Omni nav entry hidden (2026-05-23) — Std SKU unstable on upstream.
  // Backend route + OpenAPI spec vẫn còn để customer biết qua AI tool
  // tự discover, chỉ ẩn navigation chính.
  // { anchor: "omni", label: "Omni (multi-shot)", method: "POST", group: "Video" },
  { anchor: "improve-prompt", label: "Mở rộng prompt", method: "POST", group: "Tools" },
  { anchor: "poll", label: "Theo dõi tác vụ", method: "GET", group: "Tools" },
  { anchor: "advanced", label: "Headers nâng cao", group: "Tham khảo" },
  { anchor: "errors", label: "Mã lỗi", group: "Tham khảo" },
] as const;

/**
 * Public API documentation. Standalone page — no auth required.
 * Customer-facing: keep wording free of admin-internal jargon
 * ("Magnific", "pool keys", "orphan sweeper", etc.) per content audit.
 */
export default function ApiDocsPage() {
  return (
    <div className="mx-auto flex max-w-7xl gap-6 px-4 py-8">
      <SidebarNav items={NAV_ITEMS} />
      <div className="min-w-0 flex-1 space-y-8">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold">API tài liệu</h1>
            <p className="text-sm text-muted-foreground">
              Tích hợp video AI vào ứng dụng của bạn qua API key. Mỗi
              endpoint có nút <span className="font-medium text-foreground">Test trực tiếp</span> để
              thử ngay không cần copy-paste — hoặc bấm{" "}
              <span className="font-medium text-foreground">Copy cho AI</span>{" "}
              để dán toàn bộ spec vào ChatGPT/Claude/Cursor.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <CopyForAiButton />
            <Link
              href="/"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              <ArrowLeft className="size-4" />
              <span className="hidden sm:inline">Quay lại</span>
            </Link>
          </div>
        </div>

        <MobileSectionMenu items={NAV_ITEMS} />

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
            Rate limit mặc định: 30 req/phút cho video + improve prompt.
            Liên hệ qua Zalo nếu cần nâng giới hạn cho dự án lớn.
          </p>
        </CardContent>
      </Card>

      <ParameterMatrix />

      <PricingTable />

      <Section
        anchor="security"
        title="Bảo mật & best-practices"
        method="GET"
        path="Headers / tokens / rate limits — đọc trước khi tích hợp prod"
      >
        <div className="space-y-3 text-sm">
          <div>
            <h4 className="mb-1 font-semibold text-foreground">
              ⚠️ KHÔNG embed token trong frontend public
            </h4>
            <p className="text-muted-foreground">
              <Code>sk_*</Code> là bearer có FULL ACCESS đến account. Ai có
              key đều gọi được API và bị trừ tiền của bạn. Dùng backend
              proxy hoặc env var server-side. Frontend chỉ nên gọi endpoint
              proxy bên bạn tự host.
            </p>
            <pre className="mt-2 rounded-md bg-destructive/5 border border-destructive/20 p-2 text-[11px]">
{`// ❌ DON'T do this in production frontend
const res = await fetch("https://video.chugax.io.vn/api/v1/video/kling-3", {
  headers: { Authorization: "Bearer sk_LIVE_KEY_HERE" }, // exposed to anyone
});

// ✅ DO route through your backend
const res = await fetch("/my-api/generate-video", { method: "POST", ... });
// → your server proxies + adds sk_ from env var`}
            </pre>
          </div>

          <div>
            <h4 className="mb-1 font-semibold text-foreground">
              Token capabilities (hiện tại)
            </h4>
            <ul className="ml-5 list-disc text-muted-foreground">
              <li>Per-key rate limit override (mặc định 30/phút)</li>
              <li>Optional expiration date</li>
              <li>Revoke ngay qua admin (mất key → liên hệ Zalo + mint mới)</li>
            </ul>
            <p className="mt-1 text-muted-foreground">
              <strong className="text-foreground">Chưa hỗ trợ</strong>:
              giới hạn theo model, IP allowlist, domain referer allowlist,
              scope read-only. Nếu cần các tính năng này (dự án enterprise),
              liên hệ trước.
            </p>
          </div>

          <div>
            <h4 className="mb-1 font-semibold text-foreground">
              Rate limit + Idempotency
            </h4>
            <p className="text-muted-foreground">
              30 req/phút/key mặc định. Vượt → 429 với header{" "}
              <Code>Retry-After</Code>. Production code phải honor header
              này (xem section 8 Headers nâng cao).
            </p>
            <p className="mt-1 text-muted-foreground">
              POST endpoints accept optional <Code>Idempotency-Key</Code> header
              (UUID) — retry cùng key + cùng body trả response cũ, tránh
              double-charge khi network flake.
            </p>
          </div>
        </div>
      </Section>

      <Section
        anchor="lifecycle"
        title="Task lifecycle & polling"
        method="GET"
        path="Cách track task từ POST → COMPLETED → download"
      >
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Mọi POST <Code>/v1/video/*</Code> trả về <Code>task_id</Code>{" "}
            trong &lt;2s. Sau đó poll <Code>GET /v1/tasks/{"{task_id}"}</Code>{" "}
            cho đến khi status terminal.
          </p>

          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <p className="mb-2 font-medium text-foreground">Status enum:</p>
            <ul className="ml-5 list-disc text-muted-foreground">
              <li><Code>CREATED</Code> — vừa POST, chưa bắt đầu render</li>
              <li><Code>IN_PROGRESS</Code> — đang render</li>
              <li><Code>COMPLETED</Code> — xong, <Code>generated[0]</Code> chứa URL video (hoặc text với /prompt/improve)</li>
              <li><Code>FAILED</Code> — thất bại, <Code>error_message</Code> có lý do, balance được refund tự động</li>
            </ul>
          </div>

          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <p className="mb-2 font-medium text-foreground">Khuyến nghị polling:</p>
            <ul className="ml-5 list-disc text-muted-foreground">
              <li>Interval: <strong className="text-foreground">8 giây</strong> (không cần nhanh hơn vì generation 30-300s)</li>
              <li>Max polling time: <strong className="text-foreground">15 phút</strong> (cushion cho upstream queue)</li>
              <li>Sau 15 phút → coi như TIMEOUT, server cron tự refund</li>
              <li>Optional backoff: 8s → 12s → 16s, cap 20s</li>
              <li><strong className="text-foreground">Tốt hơn polling</strong>: dùng <Code>webhook_url</Code> nhận completion tức thì, 0 polling cost</li>
            </ul>
          </div>

          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <p className="mb-2 font-medium text-foreground">Generation time điển hình:</p>
            <ul className="ml-5 list-disc text-muted-foreground">
              <li>Kling 3 std: 30-60s</li>
              <li>Kling 3 pro: 60-120s</li>
              <li>Kling 3 4K: 90-180s</li>
              <li>Motion: 180-300s</li>
              <li>Prompt enhance: 5-10s</li>
            </ul>
          </div>

          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <p className="mb-2 font-medium text-foreground">
              <Code>generated[0]</Code> semantics (quan trọng):
            </p>
            <ul className="ml-5 list-disc text-muted-foreground">
              <li><Code>/v1/video/*</Code> endpoints → <Code>generated[0]</Code> = <strong className="text-foreground">URL video MP4</strong> (hết hạn sau 24h)</li>
              <li><Code>/v1/prompt/improve</Code> → <Code>generated[0]</Code> = <strong className="text-foreground">text prompt mở rộng</strong> (string, không phải URL)</li>
              <li>Discriminate bằng endpoint bạn đã gọi — không có field type trong response</li>
            </ul>
          </div>
        </div>
      </Section>

      <Section
        anchor="retention"
        title="Lưu trữ dữ liệu & quyền riêng tư"
        method="GET"
        path="TTL của từng loại data — quan trọng cho compliance"
      >
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Em không train model trên dữ liệu của bạn. Mỗi loại data có TTL riêng:
          </p>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2">Loại data</th>
                  <th className="px-3 py-2">TTL</th>
                  <th className="px-3 py-2">Cách xoá</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr>
                  <td className="px-3 py-2">File upload qua <Code>/v1/upload</Code></td>
                  <td className="px-3 py-2">120 phút</td>
                  <td className="px-3 py-2">Cron sweep mỗi 15min, file biến mất trong 2-3 giờ</td>
                </tr>
                <tr>
                  <td className="px-3 py-2">Video output (URL trong <Code>generated[0]</Code>)</td>
                  <td className="px-3 py-2">24 giờ</td>
                  <td className="px-3 py-2">Cloudflare R2 lifecycle auto-delete. Download trước 24h nếu cần lâu dài</td>
                </tr>
                <tr>
                  <td className="px-3 py-2">Prompt text (<Code>params.prompt</Code>)</td>
                  <td className="px-3 py-2">Vô thời hạn</td>
                  <td className="px-3 py-2">Persist trong DB cho admin debug. Liên hệ Zalo nếu cần xoá cụ thể</td>
                </tr>
                <tr>
                  <td className="px-3 py-2">Webhook delivery logs</td>
                  <td className="px-3 py-2">30 ngày</td>
                  <td className="px-3 py-2">Auto-purge daily cron</td>
                </tr>
                <tr>
                  <td className="px-3 py-2">Vùng lưu trữ</td>
                  <td className="px-3 py-2" colSpan={2}>Cloudflare R2 (auto eu/asia), Neon PostgreSQL (US East). KHÔNG cross-region</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">
            ⚠️ <strong className="text-foreground">No antivirus/NSFW scanning</strong> trên file upload — bạn chịu trách nhiệm về source content.{" "}
            <strong className="text-foreground">Public URL</strong> sau upload là public-read trong window 120 min — tránh upload data nhạy cảm.
          </p>
        </div>
      </Section>

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
        <TryIt method="GET" path="/api/v1/me" />
      </Section>

      <Section
        anchor="models"
        title="2. Danh sách model + giá"
        method="GET"
        path="/api/v1/models"
      >
        <p className="text-sm text-muted-foreground">
          Trả về catalog model đang khả dụng + giá theo giây. Public endpoint
          (không cần API key) — AI tool tự discover.
        </p>
        <CodeTabs
          samples={{
            curl: `curl https://video.chugax.io.vn/api/v1/models`,
            javascript: `const res = await fetch("https://video.chugax.io.vn/api/v1/models");
const { models, meta } = await res.json();
console.log(\`\${models.length} models available\`);`,
            python: `import requests
data = requests.get("https://video.chugax.io.vn/api/v1/models").json()
print(f"{len(data['models'])} models available")`,
          }}
        />
        <ResponseBlock
          json={`{
  "ok": true,
  "version": "1",
  "models": [
    {
      "id": "kling-3",
      "endpoint": "POST /v1/video/kling-3",
      "capabilities": ["text-to-video", "image-to-video"],
      "tiers": [
        { "id": "std", "label": "Kling 3 Std", "eur_per_second": 0.168, "vnd_per_second": 168 },
        { "id": "pro", "label": "Kling 3 Pro", "eur_per_second": 0.224, "vnd_per_second": 224 }
      ]
    }
    // ...
  ]
}`}
        />
        <TryIt method="GET" path="/api/v1/models" />
      </Section>

      <Section
        anchor="usage"
        title="3. Lịch sử sử dụng + spend summary"
        method="GET"
        path="/api/v1/usage"
      >
        <p className="text-sm text-muted-foreground">
          Self-serve audit cho activation code của bạn. Mặc định 30 ngày gần
          nhất; query string <Code>?limit=N&offset=M&since=ISO</Code> để
          phân trang/lọc theo thời gian.
        </p>
        <CodeTabs
          samples={{
            curl: `curl "https://video.chugax.io.vn/api/v1/usage?limit=10" \\
  -H "Authorization: Bearer sk_your_key_here"`,
            javascript: `const res = await fetch("https://video.chugax.io.vn/api/v1/usage?limit=10", {
  headers: { Authorization: "Bearer sk_your_key_here" },
});
const { usage, summary } = await res.json();
console.log(\`\${summary.total_count} requests, \${summary.total_cost_eur} EUR\`);`,
            python: `import requests
r = requests.get(
    "https://video.chugax.io.vn/api/v1/usage?limit=10",
    headers={"Authorization": "Bearer sk_your_key_here"},
)
data = r.json()
print(f"{data['summary']['total_count']} reqs, {data['summary']['total_cost_eur']} EUR")`,
          }}
        />
        <TryIt method="GET" path="/api/v1/usage?limit=10" />
      </Section>

      <Section
        anchor="upload"
        title="4. Tải file (presigned R2 PUT)"
        method="POST"
        path="/api/v1/upload"
      >
        <p className="text-sm text-muted-foreground">
          Cấp URL upload tạm cho ảnh/video. Bạn PUT trực tiếp file lên
          storage CDN, lấy <Code>public_url</Code> rồi pass cho Motion
          endpoint ở field <Code>image_url</Code> / <Code>video_url</Code>.
        </p>
        <p className="text-xs text-muted-foreground">
          Caps: image ≤ 15MB, video ≤ 60MB. File tự xoá sau 2 giờ — đủ
          để gọi endpoint generate ngay sau đó.
        </p>
        <CodeTabs
          samples={{
            curl: `# Step 1: presign
curl -X POST https://video.chugax.io.vn/api/v1/upload \\
  -H "Authorization: Bearer sk_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "filename": "character.jpg",
    "contentType": "image/jpeg",
    "size": 524288,
    "kind": "image"
  }'

# Step 2: PUT file lên upload_url (URL hết hạn ~10 phút)
curl -X PUT "$UPLOAD_URL" -H "Content-Type: image/jpeg" --data-binary @character.jpg

# Step 3: dùng public_url làm image_url cho Motion/Omni`,
            javascript: `// Step 1: presign
const presign = await fetch("https://video.chugax.io.vn/api/v1/upload", {
  method: "POST",
  headers: { Authorization: "Bearer sk_...", "Content-Type": "application/json" },
  body: JSON.stringify({
    filename: file.name,
    contentType: file.type,
    size: file.size,
    kind: "image",
  }),
}).then((r) => r.json());

// Step 2: upload trực tiếp lên R2
await fetch(presign.upload_url, {
  method: "PUT",
  headers: { "Content-Type": file.type },
  body: file,
});

// Step 3: presign.public_url đã sẵn sàng dùng
const imageUrl = presign.public_url;`,
            python: `# Step 1: presign
import requests
presign = requests.post(
    "https://video.chugax.io.vn/api/v1/upload",
    headers={"Authorization": "Bearer sk_..."},
    json={"filename": "x.jpg", "contentType": "image/jpeg", "size": len(data), "kind": "image"},
).json()

# Step 2: PUT
requests.put(presign["upload_url"], data=data, headers={"Content-Type": "image/jpeg"})

# Step 3: public_url ready
image_url = presign["public_url"]`,
          }}
        />
        <TryIt
          method="POST"
          path="/api/v1/upload"
          defaultBody={`{
  "filename": "test.jpg",
  "contentType": "image/jpeg",
  "size": 524288,
  "kind": "image"
}`}
        />
      </Section>

      <Section
        anchor="kling-3"
        title="2. Tạo video Kling 3 (T2V / I2V / multi-shot / start-end frame)"
        method="POST"
        path="/api/v1/video/kling-3"
      >
        <p className="text-sm text-muted-foreground">
          Endpoint mạnh nhất — hỗ trợ 5 mode trong cùng 1 body shape:
          T2V, I2V first-frame, I2V first+last-frame, multi-shot (tới 6
          cảnh), và identity-locked elements. Trả về <Code>task_id</Code>;
          poll <Code>GET /api/v1/tasks/{"{task_id}"}</Code> mỗi 2 giây.
        </p>

        <div className="rounded-md border bg-muted/30 p-3 text-xs">
          <p className="mb-2 font-medium text-foreground">Tham số đầy đủ trong <Code>params</Code>:</p>
          <ul className="space-y-1 text-muted-foreground">
            <li><Code>prompt</Code>: text mô tả, ≤2500 chars (bỏ nếu dùng <Code>multi_prompt</Code>)</li>
            <li><Code>negative_prompt</Code>: text mô tả thứ KHÔNG muốn, ≤2500 chars</li>
            <li><Code>start_image_url</Code>: URL ảnh frame đầu (I2V). Bỏ = T2V</li>
            <li><Code>end_image_url</Code>: URL ảnh frame cuối — model interpolate giữa start và end</li>
            <li><Code>multi_shot</Code>: <Code>true</Code> để bật multi-shot mode</li>
            <li><Code>shot_type</Code>: <Code>customize</Code> (tự kiểm soát mỗi shot) hoặc <Code>intelligent</Code> (AI tự cắt cảnh)</li>
            <li><Code>multi_prompt</Code>: mảng tới 6 cảnh, mỗi cảnh <Code>{`{prompt, duration}`}</Code></li>
            <li><Code>elements</Code>: mảng tới N identity refs <Code>{`{frontal_image_url, reference_image_urls[]}`}</Code></li>
            <li><Code>aspect_ratio</Code>: <Code>16:9</Code> / <Code>9:16</Code> / <Code>1:1</Code></li>
            <li><Code>duration</Code>: <Code>"3"</Code> đến <Code>"15"</Code> giây (string)</li>
            <li><Code>cfg_scale</Code>: 0.0 - 1.0 (mặc định ~0.5, càng cao bám prompt càng chặt)</li>
            <li><Code>generate_audio</Code>: bật audio (+1.5× giá)</li>
          </ul>
        </div>

        <p className="text-sm font-medium text-foreground">Mẫu A: T2V đơn giản</p>
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
            javascript: `await fetch("https://video.chugax.io.vn/api/v1/video/kling-3", {
  method: "POST",
  headers: { Authorization: "Bearer sk_...", "Content-Type": "application/json" },
  body: JSON.stringify({
    tier: "pro",
    params: {
      prompt: "A cat surfing a wave at sunset, cinematic 4K",
      aspect_ratio: "16:9",
      duration: "5",
    },
  }),
});`,
            python: `import requests
r = requests.post(
    "https://video.chugax.io.vn/api/v1/video/kling-3",
    headers={"Authorization": "Bearer sk_..."},
    json={"tier": "pro", "params": {"prompt": "Cat surfing...", "duration": "5"}},
)`,
          }}
        />

        <p className="text-sm font-medium text-foreground">Mẫu B: I2V start + end frame (model interpolate giữa 2 ảnh)</p>
        <CodeTabs
          samples={{
            curl: `curl -X POST https://video.chugax.io.vn/api/v1/video/kling-3 \\
  -H "Authorization: Bearer sk_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "tier": "pro",
    "params": {
      "prompt": "Smooth zoom-in transition",
      "start_image_url": "https://your-cdn.com/wide-shot.jpg",
      "end_image_url": "https://your-cdn.com/closeup.jpg",
      "duration": "8",
      "aspect_ratio": "16:9"
    }
  }'`,
            javascript: `body: JSON.stringify({
  tier: "pro",
  params: {
    prompt: "Smooth zoom-in transition",
    start_image_url: "https://your-cdn.com/wide-shot.jpg",
    end_image_url: "https://your-cdn.com/closeup.jpg",
    duration: "8",
  },
});`,
            python: `json={
    "tier": "pro",
    "params": {
        "prompt": "Smooth zoom-in transition",
        "start_image_url": "https://your-cdn.com/wide-shot.jpg",
        "end_image_url": "https://your-cdn.com/closeup.jpg",
        "duration": "8",
    },
}`,
          }}
        />

        <p className="text-sm font-medium text-foreground">Mẫu C: Multi-shot (3 cảnh, mỗi cảnh riêng prompt + duration)</p>
        <CodeTabs
          samples={{
            curl: `curl -X POST https://video.chugax.io.vn/api/v1/video/kling-3 \\
  -H "Authorization: Bearer sk_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "tier": "pro",
    "params": {
      "multi_shot": true,
      "shot_type": "customize",
      "multi_prompt": [
        { "prompt": "Wide shot of a city at dawn", "duration": "5" },
        { "prompt": "Camera zooms in on a coffee shop", "duration": "5" },
        { "prompt": "Close-up of barista pouring latte art", "duration": "5" }
      ],
      "aspect_ratio": "16:9"
    }
  }'`,
            javascript: `body: JSON.stringify({
  tier: "pro",
  params: {
    multi_shot: true,
    shot_type: "customize",
    multi_prompt: [
      { prompt: "Wide shot of a city at dawn", duration: "5" },
      { prompt: "Camera zooms in on a coffee shop", duration: "5" },
      { prompt: "Close-up of barista pouring latte art", duration: "5" },
    ],
    aspect_ratio: "16:9",
  },
});`,
            python: `json={
    "tier": "pro",
    "params": {
        "multi_shot": True,
        "shot_type": "customize",
        "multi_prompt": [
            {"prompt": "Wide shot of a city at dawn", "duration": "5"},
            {"prompt": "Camera zooms in on a coffee shop", "duration": "5"},
            {"prompt": "Close-up of barista pouring latte art", "duration": "5"},
        ],
    },
}`,
          }}
        />

        <p className="text-sm font-medium text-foreground">Mẫu D: Elements (giữ nhân vật/đối tượng nhất quán across frames)</p>
        <CodeTabs
          samples={{
            curl: `curl -X POST https://video.chugax.io.vn/api/v1/video/kling-3 \\
  -H "Authorization: Bearer sk_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "tier": "pro",
    "params": {
      "prompt": "@Element1 walking through a Tokyo street at night",
      "elements": [
        {
          "frontal_image_url": "https://your-cdn.com/character-front.jpg",
          "reference_image_urls": [
            "https://your-cdn.com/character-side.jpg",
            "https://your-cdn.com/character-back.jpg"
          ]
        }
      ],
      "duration": "5"
    }
  }'`,
            javascript: `body: JSON.stringify({
  tier: "pro",
  params: {
    prompt: "@Element1 walking through a Tokyo street at night",
    elements: [
      {
        frontal_image_url: "https://your-cdn.com/character-front.jpg",
        reference_image_urls: [
          "https://your-cdn.com/character-side.jpg",
          "https://your-cdn.com/character-back.jpg",
        ],
      },
    ],
    duration: "5",
  },
});`,
            python: `json={
    "tier": "pro",
    "params": {
        "prompt": "@Element1 walking through a Tokyo street at night",
        "elements": [{
            "frontal_image_url": "https://your-cdn.com/character-front.jpg",
            "reference_image_urls": [
                "https://your-cdn.com/character-side.jpg",
                "https://your-cdn.com/character-back.jpg",
            ],
        }],
        "duration": "5",
    },
}`,
          }}
        />

        <p className="text-xs text-muted-foreground">
          <strong className="text-foreground">Pricing</strong>:{" "}
          <Code>std</Code> 0.168 €/giây (≈168đ) ·{" "}
          <Code>pro</Code> 0.224 €/giây (≈224đ).{" "}
          <Code>generate_audio: true</Code> ~1.83× base rate (std 0.308 / pro 0.392 €/giây).
          Multi-shot tính theo tổng duration các cảnh cộng lại.
          Vd 5s std no-audio = 0.84 € (~840đ).
        </p>

        <TryIt
          method="POST"
          path="/api/v1/video/kling-3"
          optionalHeaders={["Idempotency-Key"]}
          defaultBody={`{
  "tier": "std",
  "params": {
    "prompt": "A cat surfing a wave at sunset, cinematic 4K",
    "aspect_ratio": "16:9",
    "duration": "5",
    "generate_audio": false
  }
}`}
        />
      </Section>

      <Section
        anchor="kling-3-4k"
        title="3. Tạo video Kling 3 4K (T2V / I2V)"
        method="POST"
        path="/api/v1/video/kling-3-4k-text  |  /api/v1/video/kling-3-4k-image"
      >
        <p className="text-sm text-muted-foreground">
          Phiên bản 4K độ phân giải cao. Hai endpoint riêng cho T2V và I2V.
          Không hỗ trợ multi-shot — nếu cần nhiều cảnh dùng Kling 3 thường
          ở section trên.
        </p>

        <div className="rounded-md border bg-muted/30 p-3 text-xs">
          <p className="mb-2 font-medium text-foreground">Tham số <Code>params</Code>:</p>
          <ul className="space-y-1 text-muted-foreground">
            <li><Code>prompt</Code>: bắt buộc cho T2V endpoint, optional cho I2V</li>
            <li><Code>negative_prompt</Code>: text mô tả thứ KHÔNG muốn</li>
            <li><Code>image</Code>: bắt buộc cho I2V endpoint (URL hoặc base64 data URI)</li>
            <li><Code>aspect_ratio</Code>: <Code>16:9</Code> / <Code>9:16</Code> / <Code>1:1</Code></li>
            <li><Code>duration</Code>: <Code>"3"</Code> đến <Code>"15"</Code> giây (string)</li>
            <li><Code>cfg_scale</Code>: 0.0 - 1.0 (mặc định ~0.5)</li>
            <li><Code>generate_audio</Code>: bật audio (+1.5× giá)</li>
          </ul>
        </div>

        <p className="text-sm font-medium text-foreground">Mẫu T2V 4K</p>
        <CodeTabs
          samples={{
            curl: `curl -X POST https://video.chugax.io.vn/api/v1/video/kling-3-4k-text \\
  -H "Authorization: Bearer sk_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "params": {
      "prompt": "Aerial view of Hạ Long bay at golden hour, cinematic",
      "negative_prompt": "blurry, watermark, low quality",
      "duration": "8",
      "aspect_ratio": "16:9",
      "cfg_scale": 0.6,
      "generate_audio": false
    }
  }'`,
            javascript: `await fetch("https://video.chugax.io.vn/api/v1/video/kling-3-4k-text", {
  method: "POST",
  headers: { Authorization: "Bearer sk_...", "Content-Type": "application/json" },
  body: JSON.stringify({
    params: {
      prompt: "Aerial view of Hạ Long bay at golden hour",
      negative_prompt: "blurry, watermark",
      duration: "8",
      aspect_ratio: "16:9",
      cfg_scale: 0.6,
    },
  }),
});`,
            python: `requests.post(
    "https://video.chugax.io.vn/api/v1/video/kling-3-4k-text",
    headers={"Authorization": "Bearer sk_..."},
    json={"params": {
        "prompt": "Aerial view of Hạ Long bay at golden hour",
        "duration": "8",
        "aspect_ratio": "16:9",
        "cfg_scale": 0.6,
    }},
)`,
          }}
        />

        <p className="text-sm font-medium text-foreground">Mẫu I2V 4K</p>
        <CodeTabs
          samples={{
            curl: `curl -X POST https://video.chugax.io.vn/api/v1/video/kling-3-4k-image \\
  -H "Authorization: Bearer sk_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "params": {
      "image": "https://your-cdn.com/portrait.jpg",
      "prompt": "The character slowly smiles and looks to the side",
      "duration": "5",
      "cfg_scale": 0.5
    }
  }'`,
            javascript: `body: JSON.stringify({
  params: {
    image: "https://your-cdn.com/portrait.jpg",
    prompt: "The character slowly smiles",
    duration: "5",
  },
});`,
            python: `json={"params": {
    "image": "https://your-cdn.com/portrait.jpg",
    "prompt": "The character slowly smiles",
    "duration": "5",
}}`,
          }}
        />

        <p className="text-xs text-muted-foreground">
          <strong className="text-foreground">Pricing</strong>: 1.12 €/giây
          cho cả T2V và I2V (audio không đổi giá). Vd 5s = 5.60 € (~5,600đ),
          10s = 11.20 € (~11,200đ).
        </p>

        <TryIt
          method="POST"
          path="/api/v1/video/kling-3-4k-text"
          optionalHeaders={["Idempotency-Key"]}
          defaultBody={`{
  "params": {
    "prompt": "Aerial shot of Hanoi old quarter at dusk, neon signs reflecting in puddles",
    "aspect_ratio": "16:9",
    "duration": "5",
    "cfg_scale": 0.6
  }
}`}
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
        <p className="text-xs text-muted-foreground">
          <strong className="text-foreground">Pricing</strong> (€/giây, không có audio variant):{" "}
          <Code>v2-6-std</Code> 0.138 (~138đ) ·{" "}
          <Code>v2-6-pro</Code> 0.276 (~276đ) ·{" "}
          <Code>v3-std</Code> 0.294 (~294đ) ·{" "}
          <Code>v3-pro</Code> 0.394 (~394đ).
          Vd 5s v3-pro = 1.97 € (~1,970đ), 30s v3-pro = 11.81 € (~11,800đ).
        </p>
        <TryIt
          method="POST"
          path="/api/v1/video/kling-motion/v3-pro"
          optionalHeaders={["Idempotency-Key"]}
          defaultBody={`{
  "params": {
    "image_url": "https://picsum.photos/seed/character/720/1280",
    "video_url": "https://your-cdn.com/reference-motion.mp4",
    "prompt": "anime style, vibrant colors",
    "character_orientation": "video",
    "cfg_scale": 0.5
  },
  "output_duration": 5
}`}
        />
      </Section>

      {/* Kling Omni section hidden 2026-05-23 — backend route + OpenAPI
          still callable; commented out here per stability concern. */}

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
        <TryIt
          method="POST"
          path="/api/v1/prompt/improve"
          defaultBody={`{
  "prompt": "con mèo lướt sóng",
  "type": "video",
  "language": "vi"
}`}
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
            javascript: `// Poll every 8s for up to 15 minutes
async function waitForTask(taskId, apiKey, { maxMs = 900_000, intervalMs = 8000 } = {}) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10_000); // 10s per-poll timeout
    try {
      const r = await fetch(
        \`https://video.chugax.io.vn/api/v1/tasks/\${taskId}\`,
        { headers: { Authorization: \`Bearer \${apiKey}\` }, signal: ac.signal },
      );
      if (r.status === 429) {
        // Respect Retry-After header on rate limit
        const wait = Number(r.headers.get("Retry-After") ?? 5) * 1000;
        await new Promise((res) => setTimeout(res, wait));
        continue;
      }
      const data = await r.json();
      if (data.status === "COMPLETED") return data.generated[0];
      if (data.status === "FAILED") throw new Error(data.error_message ?? "FAILED");
    } finally {
      clearTimeout(timer);
    }
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  throw new Error(\`Task \${taskId} timed out after 15 minutes\`);
}`,
            python: `import time, requests

def wait_for_task(task_id: str, api_key: str, max_seconds: int = 900, interval: int = 8) -> str:
    """Poll every 8s for up to 15 minutes. Respects Retry-After on 429."""
    headers = {"Authorization": f"Bearer {api_key}"}
    deadline = time.time() + max_seconds
    while time.time() < deadline:
        r = requests.get(
            f"https://video.chugax.io.vn/api/v1/tasks/{task_id}",
            headers=headers,
            timeout=10,
        )
        if r.status_code == 429:
            wait = int(r.headers.get("Retry-After", "5"))
            time.sleep(wait)
            continue
        data = r.json()
        if data["status"] == "COMPLETED":
            return data["generated"][0]
        if data["status"] == "FAILED":
            raise RuntimeError(data.get("error_message") or "FAILED")
        time.sleep(interval)
    raise TimeoutError(f"Task {task_id} did not finish within 15 minutes")`,
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
        <TryIt
          method="GET"
          path="/api/v1/tasks/REPLACE-WITH-TASK-ID"
        />
      </Section>

      <Section
        anchor="advanced"
        title="8. Tính năng nâng cao (mới)"
        method="POST"
        path="Headers + tham số chung — áp dụng mọi POST endpoint"
      >
        <div className="space-y-4 text-sm">
          <div>
            <h4 className="mb-2 font-semibold text-foreground">
              <Code>Idempotency-Key</Code> header
            </h4>
            <p className="text-muted-foreground">
              Gửi 1 chuỗi duy nhất (UUID) ở header này để retry an toàn:
              cùng key + cùng body = trả lại response cũ (không charge 2 lần).
              Khác body = HTTP 409 <Code>IDEMPOTENCY_CONFLICT</Code>.
              TTL 24 giờ. Áp dụng cho mọi POST <Code>/v1/video/*</Code>.
            </p>
            <CodeTabs
              samples={{
                curl: `curl -X POST https://video.chugax.io.vn/api/v1/video/kling-3 \\
  -H "Authorization: Bearer sk_your_key_here" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{"tier":"std","params":{"prompt":"con mèo"}}'`,
                javascript: `import { randomUUID } from "node:crypto";
const idemKey = randomUUID();
// Retry up to 3 times — same key returns cached response if first succeeded
const res = await fetch("https://video.chugax.io.vn/api/v1/video/kling-3", {
  method: "POST",
  headers: {
    "Authorization": "Bearer sk_your_key_here",
    "Idempotency-Key": idemKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ tier: "std", params: { prompt: "con mèo" } }),
});`,
                python: `import uuid
idem_key = str(uuid.uuid4())
res = requests.post(
    "https://video.chugax.io.vn/api/v1/video/kling-3",
    headers={
        "Authorization": "Bearer sk_your_key_here",
        "Idempotency-Key": idem_key,
        "Content-Type": "application/json",
    },
    json={"tier": "std", "params": {"prompt": "con mèo"}},
)`,
              }}
            />
          </div>

          <div>
            <h4 className="mb-2 font-semibold text-foreground">
              <Code>webhook_url</Code> top-level field
            </h4>
            <p className="text-muted-foreground">
              Thêm <Code>webhook_url</Code> ở TOP LEVEL của body (không phải
              trong <Code>params</Code>) — sau khi task xong, server POST
              event <Code>task.succeeded</Code> hoặc <Code>task.failed</Code>
              về URL này. Khỏi phải poll. Best-effort fire-and-forget; vẫn
              có thể poll backup.
            </p>
            <CodeTabs
              samples={{
                curl: `curl -X POST https://video.chugax.io.vn/api/v1/video/kling-3 \\
  -H "Authorization: Bearer sk_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "tier": "std",
    "params": {"prompt": "con mèo"},
    "webhook_url": "https://your-server.com/webhook?token=xyz"
  }'`,
                javascript: `// Payload server sẽ POST về webhook_url:
// Headers: x-webhook-event: task.succeeded | task.failed
// Body:
// {
//   "task_id": "abc-...",
//   "status": "COMPLETED" | "FAILED",
//   "endpoint": "kling-v3",
//   "video_url": "https://...",
//   "video_url_expires_at": "2026-05-24T...",
//   "error_message": null,
//   "finalized_at": "2026-05-23T..."
// }`,
                python: `# Cùng webhook payload shape — verify từ source IP hoặc query token
# trên webhook_url (vd ?token=xxx) để chống spoof.`,
              }}
            />
          </div>

          <div>
            <h4 className="mb-2 font-semibold text-foreground">
              Rate-limit headers + request_id
            </h4>
            <p className="text-muted-foreground">
              Mỗi response trả về:
              <br />
              <Code>X-RateLimit-Limit</Code>,{" "}
              <Code>X-RateLimit-Remaining</Code>,{" "}
              <Code>X-RateLimit-Reset</Code> — để tự throttle.
              <br />
              <Code>X-Request-Id</Code> + field <Code>request_id</Code>{" "}
              trong error body — paste vào support ticket để admin grep
              được log.
            </p>
          </div>
        </div>
      </Section>

      <Card id="errors" className="scroll-mt-20">
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
              <ErrorRow code="INSUFFICIENT_BALANCE" status="402" desc="Số dư không đủ cho request này" />
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
