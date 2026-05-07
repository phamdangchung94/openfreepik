"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Sparkles,
  ImageIcon,
  Volume2,
  VolumeX,
  Coins,
  ArrowLeft,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PricingRule {
  endpoint: string;
  tier: "pro" | "std" | null;
  durationSeconds: number | null;
  withAudio: boolean;
  costEur: number;
}

/**
 * Customer-facing pricing page. Mirrors the data the cost preview already
 * uses (GET /api/pricing/rates) but laid out by model + tier so customers
 * can browse before activating a code instead of poking at the form.
 *
 * Two model sections:
 *   - Kling 3 — split into Pro / Standard, each with audio/no-audio columns
 *   - WAN 2.7 — split into 1080P / 720P, single audio-off column
 *
 * No auth required — rates are public; admin pricing dashboard owns edits.
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

  const klingRules = rules.filter((r) => r.endpoint === "kling-v3");
  const wanRules = rules.filter((r) => r.endpoint === "wan-v27");

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Bảng giá</h1>
          <p className="text-sm text-muted-foreground">
            Giá tính theo EUR mỗi video. Số dư trong mã kích hoạt sẽ trừ đúng
            con số bên dưới khi bạn tạo video.
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
          <KlingSection rules={klingRules} />
          <WanSection rules={wanRules} />

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
  const durations = uniqueDurations(rules);

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-primary" />
          Kling 3 — Text/Image → Video
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Hỗ trợ tạo video từ text hoặc ảnh. Có 2 chế độ chất lượng + tuỳ
          chọn âm thanh. Thời lượng 3–15 giây.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <TierCard
            label="Pro"
            sublabel="Chất lượng cao nhất"
            highlight
            durations={durations}
            getCost={(d, audio) => findCost(rules, "pro", d, audio)}
          />
          <TierCard
            label="Standard"
            sublabel="Tốc độ nhanh, giá tiết kiệm"
            durations={durations}
            getCost={(d, audio) => findCost(rules, "std", d, audio)}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function WanSection({ rules }: { rules: PricingRule[] }) {
  const durations = uniqueDurations(rules);

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
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <TierCard
            label="1080P"
            sublabel="Full HD 1920×1080"
            highlight
            durations={durations}
            getCost={(d) => findCost(rules, "pro", d, false)}
            hideAudioColumn
          />
          <TierCard
            label="720P"
            sublabel="HD 1280×720, rẻ hơn ~33%"
            durations={durations}
            getCost={(d) => findCost(rules, "std", d, false)}
            hideAudioColumn
          />
        </div>
      </CardContent>
    </Card>
  );
}

function TierCard({
  label,
  sublabel,
  highlight,
  durations,
  getCost,
  hideAudioColumn,
}: {
  label: string;
  sublabel: string;
  highlight?: boolean;
  durations: number[];
  getCost: (duration: number, audio: boolean) => number | null;
  hideAudioColumn?: boolean;
}) {
  return (
    <div
      className={
        "rounded-md border p-3 " +
        (highlight ? "border-primary/40 bg-primary/5" : "")
      }
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{label}</span>
        {highlight && (
          <Badge variant="default" className="text-[10px]">
            Khuyên dùng
          </Badge>
        )}
      </div>
      <p className="mb-3 text-[11px] text-muted-foreground">{sublabel}</p>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="py-1.5 pr-2 text-left font-medium">Thời lượng</th>
            {!hideAudioColumn && (
              <th className="py-1.5 px-1 text-right font-medium">
                <span className="inline-flex items-center gap-1">
                  <VolumeX className="size-3" />
                  Không audio
                </span>
              </th>
            )}
            <th className="py-1.5 pl-1 text-right font-medium">
              {hideAudioColumn ? (
                <span className="inline-flex items-center gap-1">
                  <Coins className="size-3" />
                  Giá
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Volume2 className="size-3" />
                  Có audio
                </span>
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {durations.map((d) => {
            const noAudio = getCost(d, false);
            const withAudio = getCost(d, true);
            return (
              <tr
                key={d}
                className="border-b border-border/40 last:border-0"
              >
                <td className="py-1.5 pr-2 font-mono">{d}s</td>
                {!hideAudioColumn && (
                  <td className="py-1.5 px-1 text-right font-mono">
                    {noAudio !== null ? `${noAudio.toFixed(2)} €` : "—"}
                  </td>
                )}
                <td className="py-1.5 pl-1 text-right font-mono font-medium">
                  {hideAudioColumn
                    ? noAudio !== null
                      ? `${noAudio.toFixed(2)} €`
                      : "—"
                    : withAudio !== null
                      ? `${withAudio.toFixed(2)} €`
                      : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function findCost(
  rules: PricingRule[],
  tier: "pro" | "std",
  duration: number,
  audio: boolean,
): number | null {
  const r = rules.find(
    (x) =>
      x.tier === tier && x.durationSeconds === duration && x.withAudio === audio,
  );
  return r ? r.costEur : null;
}

function uniqueDurations(rules: PricingRule[]): number[] {
  const set = new Set<number>();
  for (const r of rules) {
    if (r.durationSeconds !== null) set.add(r.durationSeconds);
  }
  return [...set].sort((a, b) => a - b);
}
