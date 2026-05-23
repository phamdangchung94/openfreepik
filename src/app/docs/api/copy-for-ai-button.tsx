"use client";

import { useState } from "react";
import { Check, Copy, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { buildAiPrompt } from "./ai-prompt";

/**
 * "Copy nội dung cho AI" button — generates a complete markdown brief
 * covering every endpoint + conventions + sample code, copies to
 * clipboard. Developer pastes into ChatGPT / Claude / Cursor and the
 * AI has enough context to write working integration code without
 * follow-up roundtrips.
 *
 * Why a fat blob over /llms.txt: zero-friction discovery. Customer
 * doesn't need to know the magic URL convention; they see a button and
 * click it. /llms.txt also exists at /api/v1/llms.txt for AI tools
 * that auto-discover (Anthropic, etc.).
 */

export function CopyForAiButton() {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const text = buildAiPrompt();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(
        `Đã copy ${(text.length / 1024).toFixed(1)}KB cho AI — paste vào ChatGPT/Claude/Cursor để có code mẫu`,
      );
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error(
        "Trình duyệt từ chối clipboard — copy thủ công từ /api/v1/llms.txt",
      );
    }
  }

  return (
    <Button
      variant="default"
      size="sm"
      onClick={handleCopy}
      className="gap-1.5"
      title="Copy spec đầy đủ — paste vào AI để sinh code tích hợp"
    >
      {copied ? (
        <Check className="size-3.5" />
      ) : (
        <Sparkles className="size-3.5" />
      )}
      <span className="hidden sm:inline">
        {copied ? "Đã copy" : "Copy cho AI"}
      </span>
      <span className="sm:hidden">
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </span>
    </Button>
  );
}
