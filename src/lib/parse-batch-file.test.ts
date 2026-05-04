import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseBatchFile, issueLabel } from "./parse-batch-file";

/**
 * Audit P2-2: parseBatchFile is the entry point for any customer who
 * uploads an Excel file with 100+ prompts. Each new format quirk
 * (Vietnamese headers, missing STT column, blank rows) needs a
 * regression pin.
 *
 * We craft xlsx buffers via SheetJS's `aoa_to_sheet` so we don't have
 * to ship binary fixtures.
 */

function makeXlsxFile(rows: unknown[][], filename = "test.xlsx"): File {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Sheet1");
  const buf: ArrayBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new File([buf], filename, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("parseBatchFile", () => {
  it("parses the canonical 'STT | Prompt' header", async () => {
    const file = makeXlsxFile([
      ["STT", "Prompt"],
      [1, "a cat walking through neon alley"],
      [2, "a drone view of Hanoi at dawn"],
    ]);
    const result = await parseBatchFile(file);
    expect(result.prompts).toHaveLength(2);
    expect(result.prompts[0]).toEqual({
      rowNumber: 1,
      prompt: "a cat walking through neon alley",
    });
    expect(result.issues).toHaveLength(0);
  });

  it("accepts Vietnamese header aliases", async () => {
    const file = makeXlsxFile([
      ["Thứ tự", "Câu lệnh"],
      [1, "mô tả 1"],
      [2, "mô tả 2"],
    ]);
    const result = await parseBatchFile(file);
    // "mô tả 1" is 7 chars, below the 4-char minimum? Let's check —
    // it's 7 chars including space. Above minimum.
    expect(result.prompts).toHaveLength(2);
  });

  it("flags rows with empty prompt as missing_prompt", async () => {
    const file = makeXlsxFile([
      ["STT", "Prompt"],
      [1, "a long enough prompt"],
      [2, ""],
      [3, "another long prompt"],
    ]);
    const result = await parseBatchFile(file);
    expect(result.prompts).toHaveLength(2);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      reason: "missing_prompt",
      rowNumber: 2,
    });
  });

  it("flags rows shorter than minimum length", async () => {
    const file = makeXlsxFile([
      ["STT", "Prompt"],
      [1, "abc"], // 3 chars, below 4
    ]);
    const result = await parseBatchFile(file);
    expect(result.issues[0]?.reason).toBe("prompt_too_short");
  });

  it("flags rows longer than 1500 chars", async () => {
    const file = makeXlsxFile([
      ["STT", "Prompt"],
      [1, "x".repeat(1501)],
    ]);
    const result = await parseBatchFile(file);
    expect(result.issues[0]?.reason).toBe("prompt_too_long");
  });

  it("falls back to columns 0+1 when headers don't match", async () => {
    const file = makeXlsxFile([
      ["foo", "bar"], // no recognisable header
      [1, "a long enough prompt"],
    ]);
    const result = await parseBatchFile(file);
    // Falls back to 1st col = STT, 2nd = prompt
    expect(result.prompts).toHaveLength(1);
    expect(result.prompts[0]?.prompt).toBe("a long enough prompt");
  });

  it("uses the STT cell value as the displayed row number when numeric", async () => {
    const file = makeXlsxFile([
      ["STT", "Prompt"],
      [42, "this is row forty two"],
    ]);
    const result = await parseBatchFile(file);
    expect(result.prompts[0]?.rowNumber).toBe(42);
  });

  it("falls back to spreadsheet row when STT cell isn't numeric", async () => {
    const file = makeXlsxFile([
      ["STT", "Prompt"],
      ["abc", "this prompt has a non-numeric STT"],
    ]);
    const result = await parseBatchFile(file);
    // Spreadsheet row 2 (header is row 1)
    expect(result.prompts[0]?.rowNumber).toBe(2);
  });

  it("throws a friendly error when the sheet has no Prompt column", async () => {
    const file = makeXlsxFile([
      ["only-one-column"],
      ["just text"],
    ]);
    await expect(parseBatchFile(file)).rejects.toThrow(/cột 'Prompt'|prompt/i);
  });

  it("issueLabel returns Vietnamese strings for each reason", () => {
    expect(issueLabel("missing_prompt")).toContain("trống");
    expect(issueLabel("prompt_too_short")).toContain("ngắn");
    expect(issueLabel("prompt_too_long")).toContain("dài");
  });
});
