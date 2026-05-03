"use client";

import { useEffect, useState } from "react";
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
import { isMobileDevice } from "@/lib/is-mobile";

export function AutoDownloadToggle() {
  const enabled = usePreferencesStore((s) => s.autoDownload);
  const warningSeen = usePreferencesStore((s) => s.warningSeen);
  const setAutoDownload = usePreferencesStore((s) => s.setAutoDownload);
  const markWarningSeen = usePreferencesStore((s) => s.markWarningSeen);

  const [warningOpen, setWarningOpen] = useState(false);
  // Detect mobile after mount — `isMobileDevice` reads window APIs that
  // SSR doesn't have. The toggle pops in on hydration; minor layout shift
  // is acceptable for a header preference control.
  const [mobile, setMobile] = useState(false);
  useEffect(() => setMobile(isMobileDevice()), []);

  if (mobile) return null; // see auto-download hook for mobile rationale

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
            ? "Tự động tải đang BẬT — video đơn tải ngay; batch hiện toast hỏi"
            : "Bấm để bật tự động tải video về máy khi xong"
        }
      >
        <Download
          className={`size-3.5 ${enabled ? "text-green-500" : "text-muted-foreground"}`}
        />
        <span className="hidden lg:inline">Tự động tải</span>
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
              Bật tự động tải?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Khi bạn tạo 1 video, file sẽ tự động tải về thư mục Downloads
              ngay khi xong. Với batch nhiều video, tool sẽ hiện thông báo
              hỏi bạn muốn tải tất cả hay không (tránh trình duyệt block).
            </AlertDialogDescription>
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              <li>Mỗi video khoảng 5–30 MB.</li>
              <li>
                Link video tạo ra hết hạn sau 24 giờ — tải sớm để giữ kết
                quả, hoặc dùng nút "Tải" trong lịch sử bất cứ lúc nào.
              </li>
              <li>
                Bạn có thể tắt bất kỳ lúc nào từ nút này trên thanh đầu
                trang.
              </li>
            </ul>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>
              Đã hiểu, bật
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
