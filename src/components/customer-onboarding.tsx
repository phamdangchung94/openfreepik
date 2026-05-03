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
      title: "Paste your activation code",
      desc: "Tap the input in the top-right of the header. Your remaining EUR appears next to it once activated.",
      done: !!activationCode,
    },
    {
      icon: Sparkles,
      title: "Pick a prompt or upload an image",
      desc: "Use Text-to-Video for a written scene, or Image-to-Video to animate a still. Adjust tier, duration, and audio in the settings card.",
      done: false,
    },
    {
      icon: Play,
      title: "Hit Generate",
      desc: "Estimated cost shows above the button. Each video takes ~20–60 seconds. Auto-download saves them to your Downloads folder.",
      done: false,
    },
  ];

  return (
    <Card className="sticky top-4">
      <CardContent className="space-y-5 p-6">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs text-accent">
            <Sparkles className="size-3.5" />
            Get started
          </div>
          <h2 className="text-xl font-semibold">
            Generate your first AI video
          </h2>
          <p className="text-sm text-muted-foreground">
            Three steps. ~30 seconds.
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

        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          Don&apos;t have an activation code?{" "}
          <a
            href="mailto:tproxy.team@gmail.com"
            className="inline-flex items-center gap-0.5 text-accent hover:underline"
          >
            Contact us <ArrowUpRight className="size-3" />
          </a>
        </p>
      </CardContent>
    </Card>
  );
}
