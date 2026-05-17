"use client";

import { Key, Sparkles, Play, ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useAuthStore } from "@/store/auth-store";
import { useTaskStore } from "@/store/task-store";

/**
 * First-visit hint card. Shows only when the customer has neither
 * activated a code nor produced any history. Sits in the preview
 * column so the empty state doesn't feel inert. Auto-hides as soon
 * as either condition flips.
 */
export function CustomerOnboarding() {
  const activationCode = useAuthStore((s) => s.activationCode);
  const tasks = useTaskStore((s) => s.tasks);
  const hasHistory = Object.keys(tasks).length > 0;

  if (activationCode && hasHistory) return null;

  const steps = [
    {
      icon: Key,
      title: "Nhập mã kích hoạt",
      desc: "Click vào ô nhập ở góc phải header. Số dư VND sẽ hiển thị ngay bên cạnh sau khi kích hoạt.",
      done: !!activationCode,
    },
    {
      icon: Sparkles,
      title: "Viết prompt hoặc upload ảnh",
      desc: "Dùng Text-to-Video để mô tả cảnh bằng chữ, hoặc Image-to-Video để biến ảnh tĩnh thành video. Chỉnh tier, thời lượng và âm thanh ở card cài đặt.",
      done: false,
    },
    {
      icon: Play,
      title: "Bấm Tạo Video",
      desc: "Chi phí dự kiến hiển thị ngay trên nút. Mỗi video mất khoảng 20–60 giây. Bật auto-download để tự động lưu về máy.",
      done: false,
    },
  ];

  return (
    <Card className="sticky top-4">
      <CardContent className="space-y-5 p-6">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs text-accent">
            <Sparkles className="size-3.5" />
            Bắt đầu
          </div>
          <h2 className="text-xl font-semibold">
            Tạo video AI đầu tiên của bạn
          </h2>
          <p className="text-sm text-muted-foreground">
            Ba bước. Khoảng 30 giây.
          </p>
        </div>

        <ol className="space-y-3">
          {steps.map((step, i) => (
            <li
              key={step.title}
              className={`flex gap-3 rounded-2xl border p-3 transition-colors ${
                step.done
                  ? "border-primary/40 bg-primary/5"
                  : "border-border bg-muted/20"
              }`}
            >
              <div
                className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  step.done
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {step.done ? "✓" : i + 1}
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <step.icon className="size-3.5 text-muted-foreground" />
                  {step.title}
                </div>
                <p className="text-xs text-muted-foreground">{step.desc}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="space-y-1.5 text-xs text-muted-foreground">
          <p>Chưa có mã kích hoạt? Liên hệ với chúng tôi:</p>
          <div className="flex flex-wrap gap-3">
            <a
              href="https://t.me/chugaxai"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-full bg-[#229ED9]/10 px-3 py-1 font-medium text-[#229ED9] hover:bg-[#229ED9]/15"
            >
              Telegram <ArrowUpRight className="size-3" />
            </a>
            <a
              href="https://zalo.me/0336788856"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-full bg-[#0068FF]/10 px-3 py-1 font-medium text-[#0068FF] hover:bg-[#0068FF]/15"
            >
              Zalo <ArrowUpRight className="size-3" />
            </a>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
