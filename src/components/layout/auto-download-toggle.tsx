"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { usePreferencesStore } from "@/store/preferences-store";

export function AutoDownloadToggle() {
  const enabled = usePreferencesStore((s) => s.autoDownload);
  const warningSeen = usePreferencesStore((s) => s.warningSeen);
  const setAutoDownload = usePreferencesStore((s) => s.setAutoDownload);
  const markWarningSeen = usePreferencesStore((s) => s.markWarningSeen);

  const [warningOpen, setWarningOpen] = useState(false);

  function handleToggle(next: boolean) {
    if (next && !warningSeen) {
      // First time enabling — show the explainer first; only flip the
      // switch after the customer confirms.
      setWarningOpen(true);
      return;
    }
    setAutoDownload(next);
  }

  function handleConfirm() {
    markWarningSeen();
    setAutoDownload(true);
    setWarningOpen(false);
  }

  return (
    <>
      <label
        className="flex items-center gap-1.5 text-xs cursor-pointer"
        title={
          enabled
            ? "Auto-download is ON — videos save to your Downloads folder when ready"
            : "Click to enable auto-download"
        }
      >
        <Download
          className={`size-3.5 ${enabled ? "text-green-500" : "text-muted-foreground"}`}
        />
        <span className="hidden lg:inline">Auto-download</span>
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          className="ml-1"
        />
      </label>

      <AlertDialog open={warningOpen} onOpenChange={setWarningOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Download className="size-4" />
              Enable auto-download?
            </AlertDialogTitle>
            <AlertDialogDescription>
              When a video finishes generating, it will be downloaded
              automatically to your browser&apos;s default Downloads folder.
            </AlertDialogDescription>
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              <li>Each video is roughly 5–30 MB.</li>
              <li>A batch of 100 videos can use 1–3 GB of disk space.</li>
              <li>
                Files won&apos;t be organized — consider creating a folder in
                Downloads for each project.
              </li>
              <li>
                Generated video URLs expire in ~24–72 hours, so auto-download
                is the safest way to keep your results.
              </li>
              <li>
                You can turn auto-download off any time from the toggle in
                the header.
              </li>
            </ul>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>
              Got it, enable
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
