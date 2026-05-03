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
            ? "Tự động tải đang BẬT — video sẽ lưu vào thư mục Downloads khi hoàn tất"
            : "Bấm để bật tự động tải"
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
              Khi video tạo xong, file sẽ được tự động tải về thư mục Downloads
              mặc định của trình duyệt.
            </AlertDialogDescription>
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              <li>Mỗi video khoảng 5–30 MB.</li>
              <li>Batch 100 video có thể chiếm 1–3 GB dung lượng ổ đĩa.</li>
              <li>
                File sẽ không được sắp xếp — bạn nên tạo thư mục riêng trong
                Downloads cho từng dự án.
              </li>
              <li>
                Link video tạo ra sẽ hết hạn sau ~24–72 giờ, nên tự động tải là
                cách an toàn nhất để giữ kết quả.
              </li>
              <li>
                Bạn có thể tắt tự động tải bất kỳ lúc nào từ nút bật/tắt trên
                thanh đầu trang.
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
