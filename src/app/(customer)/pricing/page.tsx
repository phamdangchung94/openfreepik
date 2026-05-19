"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Sparkles,
  ImageIcon,
  Volume2,
  VolumeX,
  ArrowLeft,
  Gem,
  Move3d,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatVnd } from "@/lib/format-currency";

interface PricingRule {
  endpoint: string;
  tier: "pro" | "std" | "4k" | null;
  durationSeconds: number | null;
  withAudio: boolean;
  costEur: number;
}

/**
 * Customer-facing pricing page. Reads the same /api/pricing/rates feed
 * the cost preview uses and lays it out as one table per upstream model:
 *
 *   Kling 3 — rows = duration, columns = 720p / 1080p / 4K, audio
 *             dimension flipped via a pill toggle at the top of the
 *             card. 4K's column shows the same number for both audio
 *             states because Magnific's Kling-4K endpoints don't
 *             accept generate_audio today (see audio caveat in the
 *             footer notes).
 *   WAN 2.7 — rows = duration, columns = 720P / 1080P. No audio
 *             dimension (WAN doesn't price it separately).
 *
 * No auth — rates are public; admin pricing dashboard owns edits.
 */
export default function CustomerPricingPage() {
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/pricing/rates")
      .then((r) => r.json())
      .then((j) => setRules(j.rules ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Bảng giá</h1>
          <p className="text-sm text-muted-foreground">
            Giá tính theo VND mỗi video. Số dư trong mã kích hoạt sẽ trừ
            đúng con số bên dưới khi bạn tạo video.
          </p>
        </div>
        <Link
          href="/"
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "gap-1.5",
          )}
        >
          <ArrowLeft className="size-3.5" />
          Về trang tạo video
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Đang tải bảng giá...</p>
      ) : (
        <div className="space-y-6">
          <KlingSection rules={rules} />
          <KlingMotionSection rules={rules} />
          {/* WAN 2.7 tạm ẩn UI (per anh 2026-05-19). Pricing rows vẫn
              trong DB cho revert; uncomment dưới để hiện lại bảng giá. */}
          {/* <WanSection rules={rules} /> */}

          <Card className="bg-muted/30">
            <CardContent className="space-y-2 p-4 text-xs text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">Lưu ý:</span>{" "}
                Giá có thể thay đổi theo cập nhật từ nhà cung cấp. Hệ thống sẽ
                trừ đúng giá trị hiển thị tại thời điểm bạn bấm Tạo Video.
              </p>
              <p>
                Mọi video tạo thất bại đều được hoàn 100% số dư về mã kích
                hoạt — bạn chỉ trả tiền cho video chạy thành công.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function KlingSection({ rules }: { rules: PricingRule[] }) {
  // Audio toggle drives the table values. 4K stays the same in both
  // states because Magnific doesn't support audio for 4K yet (and we
  // priced both audio variants identically anyway).
  const [withAudio, setWithAudio] = useState(true);

  // Pro/Std rows live in pricing_rules under endpoint='kling-v3'. The
  // 4K rows live under endpoint='kling-4k-t2v' (and i2v at identical
  // rates — we read t2v for the table, they match).
  const k3 = rules.filter((r) => r.endpoint === "kling-v3");
  const k4 = rules.filter((r) => r.endpoint === "kling-4k-t2v");
  // Use Kling 3 durations as the canonical row set (3–15s). Kling 4K
  // durations match; if admin ever introduces an asymmetric set the
  // missing-cell renderer below handles it gracefully.
  const durations = uniqueDurations(k3);

  function costFor(
    tier: "std" | "pro" | "4k",
    duration: number,
    audio: boolean,
  ): number | null {
    if (tier === "4k") {
      const row = k4.find(
        (r) => r.durationSeconds === duration && r.withAudio === audio,
      );
      return row ? row.costEur : null;
    }
    const row = k3.find(
      (r) =>
        r.tier === tier && r.durationSeconds === duration && r.withAudio === audio,
    );
    return row ? row.costEur : null;
  }

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-primary" />
            Kling 3 — Text/Image → Video
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Hỗ trợ tạo video từ text hoặc ảnh. Ba mức chất lượng + tuỳ
            chọn âm thanh. Thời lượng 3–15 giây.
          </p>
        </div>
        <AudioToggle value={withAudio} onChange={setWithAudio} />
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 text-left font-medium">
                  Thời lượng
                </th>
                <ColHeader label="720p" sub="Tiết kiệm" />
                <ColHeader label="1080p" sub="Khuyên dùng" highlight />
                <ColHeader
                  label="4K"
                  sub="Native 4K"
                  icon={<Gem className="size-3 text-foreground/70" />}
                />
              </tr>
            </thead>
            <tbody>
              {durations.map((d) => (
                <tr
                  key={d}
                  className="border-b border-border/40 last:border-0 hover:bg-muted/20"
                >
                  <td className="py-2 pr-3 font-mono text-sm font-medium">
                    {d}s
                  </td>
                  <Cell value={costFor("std", d, withAudio)} />
                  <Cell value={costFor("pro", d, withAudio)} highlight />
                  <Cell value={costFor("4k", d, withAudio)} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="mt-4 space-y-1 text-[11px] text-muted-foreground">
          <li>
            💡 4K: API hiện <span className="font-medium text-foreground/80">chưa hỗ trợ kèm audio</span> — video 4K
            sẽ luôn im lặng dù bật hay tắt nút âm thanh. Giá không đổi.
          </li>
          {withAudio && (
            <li>
              🔇 Tắt audio để tiết kiệm: 720p giảm ~45%, 1080p giảm ~43%,
              4K giữ nguyên giá.
            </li>
          )}
          {!withAudio && (
            <li>
              🔊 Bật audio: 720p +83%, 1080p +75%, 4K không đổi giá.
            </li>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}

function WanSection({ rules }: { rules: PricingRule[] }) {
  const wan = rules.filter((r) => r.endpoint === "wan-v27");
  const durations = uniqueDurations(wan);

  function costFor(tier: "std" | "pro", duration: number): number | null {
    const row = wan.find(
      (r) =>
        r.tier === tier && r.durationSeconds === duration && r.withAudio === false,
    );
    return row ? row.costEur : null;
  }

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2 text-base">
          <ImageIcon className="size-4 text-primary" />
          WAN 2.7 — Image → Video
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Animate ảnh tĩnh thành video, ưu tiên giữ nét nhân vật. Thời lượng
          2–15 giây. Chưa hỗ trợ audio ở phiên bản hiện tại.
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 text-left font-medium">
                  Thời lượng
                </th>
                <ColHeader label="720P" sub="HD 1280×720" />
                <ColHeader
                  label="1080P"
                  sub="Full HD 1920×1080"
                  highlight
                />
              </tr>
            </thead>
            <tbody>
              {durations.map((d) => (
                <tr
                  key={d}
                  className="border-b border-border/40 last:border-0 hover:bg-muted/20"
                >
                  <td className="py-2 pr-3 font-mono text-sm font-medium">
                    {d}s
                  </td>
                  <Cell value={costFor("std", d)} />
                  <Cell value={costFor("pro", d)} highlight />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Kling Motion Control pricing — 4 tier columns × 4 duration rows.
 * No audio dimension (motion control doesn't generate audio); no
 * resolution split (handled by the tier choice). 15s/30s rows show
 * "—" if not seeded (admin can enable later); current seed covers
 * all 4 durations.
 */
function KlingMotionSection({ rules }: { rules: PricingRule[] }) {
  const motionRules = rules.filter((r) =>
    r.endpoint.startsWith("kling-motion-"),
  );

  function costFor(tier: string, duration: number): number | null {
    const row = motionRules.find(
      (r) => r.endpoint === `kling-motion-${tier}` && r.durationSeconds === duration,
    );
    return row ? row.costEur : null;
  }

  // Hardcoded durations + columns — these match the seed SQL. Pulling
  // from `rules` would risk admin reordering display when a future row
  // changes order in the DB.
  const durations = [5, 10, 15, 30];
  const columns = [
    { id: "v2-6-std", label: "2.6 Std" },
    { id: "v2-6-pro", label: "2.6 Pro" },
    { id: "v3-std", label: "3.0 Std" },
    { id: "v3-pro", label: "3.0 Pro", highlight: true },
  ];

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2 text-base">
          <Move3d className="size-4 text-primary" />
          Kling Motion Control — Animate ảnh theo motion mẫu
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Upload ảnh nhân vật + video tham chiếu motion → AI tạo video
          nhân vật làm theo motion đó. 4 phiên bản: 2.6 (cũ, rẻ) và
          3.0 (mới, chi tiết hơn) — mỗi phiên bản có Std (chuẩn) +
          Pro (chất lượng cao).
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 text-left font-medium">
                  Thời lượng
                </th>
                {columns.map((c) => (
                  <ColHeader
                    key={c.id}
                    label={c.label}
                    sub=""
                    highlight={c.highlight}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {durations.map((d) => (
                <tr
                  key={d}
                  className="border-b border-border/40 last:border-0 hover:bg-muted/20"
                >
                  <td className="py-2 pr-3 font-mono text-sm font-medium">
                    {d}s
                  </td>
                  {columns.map((c) => (
                    <Cell
                      key={c.id}
                      value={costFor(c.id, d)}
                      highlight={c.highlight}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="mt-4 space-y-1 text-[11px] text-muted-foreground">
          <li>
            🎬 Output 15s/30s chỉ khả dụng khi chọn{" "}
            <span className="font-medium text-foreground/80">
              Khung hình theo Video
            </span>{" "}
            (mặc định). Chế độ &ldquo;Theo Ảnh&rdquo; giới hạn 10s.
          </li>
          <li>
            🎯 Pro chi tiết hơn Std nhưng đắt gấp đôi (2.6) hoặc gấp
            ~1.33× (3.0). 3.0 chậm hơn 2.6 ~30s nhưng motion mượt hơn.
          </li>
          <li>
            📹 Video tham chiếu: 3-30 giây, MP4/MOV/WEBM, tối đa 50MB.
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}

function AudioToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="inline-flex w-fit items-center gap-1 rounded-lg bg-muted p-1">
      <button
        type="button"
        onClick={() => onChange(false)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
          !value
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
        aria-pressed={!value}
      >
        <VolumeX className="size-3.5" />
        Không audio
      </button>
      <button
        type="button"
        onClick={() => onChange(true)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
          value
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
        aria-pressed={value}
      >
        <Volume2 className="size-3.5" />
        Có audio
      </button>
    </div>
  );
}

function ColHeader({
  label,
  sub,
  highlight,
  icon,
}: {
  label: string;
  sub: string;
  highlight?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <th
      className={cn(
        "py-2 px-3 text-right font-medium",
        highlight && "bg-primary/5",
      )}
    >
      <div className="flex flex-col items-end gap-0.5">
        <span
          className={cn(
            "inline-flex items-center gap-1 text-sm font-semibold normal-case tracking-normal text-foreground",
            highlight && "text-primary",
          )}
        >
          {icon}
          {label}
          {highlight && (
            <Badge variant="default" className="ml-1 text-[9px]">
              Hot
            </Badge>
          )}
        </span>
        <span className="text-[10px] text-muted-foreground">{sub}</span>
      </div>
    </th>
  );
}

function Cell({ value, highlight }: { value: number | null; highlight?: boolean }) {
  return (
    <td
      className={cn(
        "py-2 px-3 text-right font-mono tabular-nums",
        highlight && "bg-primary/5 font-semibold",
      )}
    >
      {value !== null ? formatVnd(value) : "—"}
    </td>
  );
}

function uniqueDurations(rules: PricingRule[]): number[] {
  const set = new Set<number>();
  for (const r of rules) {
    if (r.durationSeconds !== null) set.add(r.durationSeconds);
  }
  return [...set].sort((a, b) => a - b);
}
