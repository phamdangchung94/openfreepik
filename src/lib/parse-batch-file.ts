"use client";

/**
 * Parse a customer-uploaded .xlsx or .csv into batch prompts.
 *
 * Format (v1, simple):
 *   Header row: STT | Prompt   (case-insensitive, also accepts Vietnamese
 *                              "stt"/"thứ tự" + "prompt"/"câu lệnh")
 *   Data rows:  any number cell | prompt string
 *
 * Returns the parsed prompts plus per-row issues so the UI can show a
 * line-by-line "X rows OK · Y rows skipped" summary.
 */

import * as XLSX from "xlsx";

export interface ParsedBatchRow {
  /** 1-based row number from the file (= STT in spreadsheet semantics). */
  rowNumber: number;
  prompt: string;
}

export interface ParsedBatchIssue {
  rowNumber: number;
  reason: "missing_prompt" | "prompt_too_short" | "prompt_too_long";
  raw: string;
}

export interface ParsedBatchResult {
  prompts: ParsedBatchRow[];
  issues: ParsedBatchIssue[];
  /** Header column indices we resolved, for debugging. */
  columns: { stt: number | null; prompt: number };
}

const MAX_PROMPT_CHARS = 1_500;
const MIN_PROMPT_CHARS = 4;

const STT_HEADER_RE = /^(stt|thứ tự|thu tu|no\.?|number|#)$/i;
const PROMPT_HEADER_RE = /^(prompt|câu lệnh|cau lenh|nội dung|noi dung|description|text)$/i;

/**
 * Read an uploaded file (Excel or CSV) and return parsed prompts.
 * Throws an Error with a customer-friendly Vietnamese message when the
 * file shape is fundamentally wrong.
 */
export async function parseBatchFile(file: File): Promise<ParsedBatchResult> {
  const buffer = await file.arrayBuffer();
  // SheetJS can detect CSV vs XLSX from the buffer, no need to branch by ext.
  const wb = XLSX.read(buffer, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    throw new Error("File rỗng — không có sheet nào để đọc.");
  }
  const sheet = wb.Sheets[sheetName]!;
  // header:1 → return rows as arrays; defval:"" so empty cells become "".
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  });

  if (rows.length === 0) {
    throw new Error("Sheet rỗng.");
  }

  // Resolve the prompt column from the header row. STT column is optional;
  // we mostly use it for error messages.
  const header = rows[0]!.map((c) => String(c ?? "").trim());
  const columns = resolveColumns(header);
  if (columns.prompt === -1) {
    throw new Error(
      "Không tìm thấy cột 'Prompt'. Đảm bảo dòng đầu tiên có header 'STT | Prompt'.",
    );
  }

  const prompts: ParsedBatchRow[] = [];
  const issues: ParsedBatchIssue[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    const raw = String(row[columns.prompt] ?? "").trim();
    const sttCellNum =
      columns.stt !== null ? Number(row[columns.stt]) : NaN;
    // Display row number = STT cell if numeric, otherwise spreadsheet row.
    const rowNumber = Number.isFinite(sttCellNum) && sttCellNum > 0
      ? Math.floor(sttCellNum)
      : i + 1; // +1 because i=0 is header in the original sheet

    if (!raw) {
      issues.push({ rowNumber, reason: "missing_prompt", raw });
      continue;
    }
    if (raw.length < MIN_PROMPT_CHARS) {
      issues.push({ rowNumber, reason: "prompt_too_short", raw });
      continue;
    }
    if (raw.length > MAX_PROMPT_CHARS) {
      issues.push({ rowNumber, reason: "prompt_too_long", raw });
      continue;
    }

    prompts.push({ rowNumber, prompt: raw });
  }

  return {
    prompts,
    issues,
    columns: {
      stt: columns.stt,
      prompt: columns.prompt,
    },
  };
}

function resolveColumns(header: string[]): {
  stt: number | null;
  prompt: number;
} {
  let stt: number | null = null;
  let prompt = -1;
  for (let i = 0; i < header.length; i++) {
    const cell = header[i] ?? "";
    if (stt === null && STT_HEADER_RE.test(cell)) stt = i;
    if (prompt === -1 && PROMPT_HEADER_RE.test(cell)) prompt = i;
  }
  // Fallback: if header didn't match (user put data in row 1), treat
  // 1st column as STT and 2nd as Prompt.
  if (prompt === -1 && header.length >= 2) {
    return { stt: 0, prompt: 1 };
  }
  return { stt, prompt };
}

/** Customer-friendly Vietnamese label for an issue reason. */
export function issueLabel(reason: ParsedBatchIssue["reason"]): string {
  switch (reason) {
    case "missing_prompt":
      return "Prompt trống";
    case "prompt_too_short":
      return `Prompt quá ngắn (< ${MIN_PROMPT_CHARS} ký tự)`;
    case "prompt_too_long":
      return `Prompt quá dài (> ${MAX_PROMPT_CHARS} ký tự)`;
  }
}
