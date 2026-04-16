"use client";

import { useState, useEffect } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useImprovePrompt } from "@/hooks/use-improve-prompt";

interface ImprovePromptDialogProps {
  currentPrompt: string;
  onAccept: (improvedPrompt: string) => void;
}

export function ImprovePromptDialog({
  currentPrompt,
  onAccept,
}: ImprovePromptDialogProps) {
  const [open, setOpen] = useState(false);
  const { improve, reset, status, result, isLoading } = useImprovePrompt();

  useEffect(() => {
    if (open && currentPrompt.trim()) {
      improve(currentPrompt);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleClose() {
    reset();
    setOpen(false);
  }

  function handleAccept() {
    if (result) {
      onAccept(result);
    }
    reset();
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="outline" size="sm" type="button" />}
      >
        <Sparkles className="size-3.5" />
        Improve
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Improve Prompt</DialogTitle>
          <DialogDescription>
            AI will enhance your prompt for better video generation
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[80px]">
          {isLoading && (
            <div className="flex flex-col items-center justify-center gap-3 py-6">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground animate-pulse">
                Improving your prompt...
              </p>
            </div>
          )}

          {status === "FAILED" && (
            <p className="text-sm text-destructive py-4">
              Failed to improve prompt. Please try again.
            </p>
          )}

          {status === "TIMEOUT" && (
            <p className="text-sm text-destructive py-4">
              Request timed out. Please try again.
            </p>
          )}

          {result && !isLoading && (
            <div className="rounded-lg border bg-muted/50 p-3 text-sm leading-relaxed">
              {result}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" type="button" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!result || isLoading}
            onClick={handleAccept}
          >
            Use This Prompt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
