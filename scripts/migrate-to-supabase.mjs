import { readFile, stat } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET ?? "uploads";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "data", "storage.json");
const UPLOADS_ROOT = path.join(ROOT, "public");

const guessMime = (filePath) => {
  const ext = filePath.toLowerCase();
  if (ext.endsWith(".png")) return "image/png";
  if (ext.endsWith(".jpg") || ext.endsWith(".jpeg")) return "image/jpeg";
  if (ext.endsWith(".mp4")) return "video/mp4";
  if (ext.endsWith(".mov")) return "video/quicktime";
  if (ext.endsWith(".webm")) return "video/webm";
  if (ext.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
};

async function uploadFile(publicPath) {
  if (!publicPath) return null;
  const relative = publicPath.startsWith("/") ? publicPath.slice(1) : publicPath;
  const absolute = path.join(UPLOADS_ROOT, relative);
  try {
    await stat(absolute);
  } catch {
    console.warn(`Skip missing file: ${relative}`);
    return null;
  }
  const buffer = await readFile(absolute);
  const mimeType = guessMime(relative);
  const key = relative; // keep same relative path inside bucket
  const { error } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .upload(key, buffer, {
      contentType: mimeType,
      upsert: true,
    });
  if (error) {
    console.warn(`Upload failed for ${relative}: ${error.message}`);
    return null;
  }
  return { storage_path: key, mimeType, size: buffer.length };
}

async function run() {
  const raw = await readFile(DATA_PATH, "utf-8");
  const data = JSON.parse(raw);

  const records = [];
  const files = [];
  const shiftReports = [];

  // Shift submissions
  for (const shift of data.shiftSubmissions ?? []) {
    records.push({
      id: shift.id,
      store_number: shift.storeNumber,
      employee_name: shift.employeeName,
      category: "shift",
      shift_notes: shift.shiftNotes ?? "",
      created_at: shift.createdAt,
    });
    const attachments = [
      { file: shift.scratcherVideo, label: "Scratcher Count Video" },
      { file: shift.cashPhoto, label: "Cash Count Photo" },
      { file: shift.salesPhoto, label: "Sales Report Photo" },
    ];
    for (const attachment of attachments) {
      if (!attachment.file?.path) continue;
      const uploaded = await uploadFile(attachment.file.path);
      if (!uploaded) continue;
      files.push({
        id: attachment.file.id ?? randomUUID(),
        record_id: shift.id,
        label: attachment.label,
        original_name: attachment.file.originalName,
        mime_type: uploaded.mimeType,
        size: uploaded.size ?? attachment.file.size ?? 0,
        storage_path: uploaded.storage_path,
      });
    }
  }

  // Reports
  for (const report of data.reports ?? []) {
    records.push({
      id: report.id,
      store_number: report.storeNumber,
      employee_name: report.employeeName,
      category: report.reportType,
      notes: report.notes ?? "",
      text_content: report.textContent ?? "",
      created_at: report.createdAt,
    });
    for (const attachment of report.attachments ?? []) {
      if (!attachment?.path) continue;
      const uploaded = await uploadFile(attachment.path);
      if (!uploaded) continue;
      files.push({
        id: attachment.id ?? randomUUID(),
        record_id: report.id,
        label: attachment.label,
        original_name: attachment.originalName,
        mime_type: uploaded.mimeType,
        size: uploaded.size ?? attachment.size ?? 0,
        storage_path: uploaded.storage_path,
      });
    }
  }

  // Surveillance
  for (const entry of data.surveillanceReports ?? []) {
    records.push({
      id: entry.id,
      store_number: entry.storeNumber,
      employee_name: entry.employeeName,
      category: "surveillance",
      surveillance_label: entry.label ?? "",
      surveillance_summary: entry.summary ?? "",
      notes: entry.notes ?? "",
      created_at: entry.createdAt,
    });
    for (const attachment of entry.attachments ?? []) {
      if (!attachment?.path) continue;
      const uploaded = await uploadFile(attachment.path);
      if (!uploaded) continue;
      files.push({
        id: attachment.id ?? randomUUID(),
        record_id: entry.id,
        label: attachment.label,
        original_name: attachment.originalName,
        mime_type: uploaded.mimeType,
        size: uploaded.size ?? attachment.size ?? 0,
        storage_path: uploaded.storage_path,
      });
    }
  }

  // Invoices (if present)
  for (const invoice of data.invoices ?? []) {
    records.push({
      id: invoice.id,
      store_number: invoice.storeNumber,
      employee_name: invoice.employeeName,
      category: "invoice",
      invoice_notes: invoice.notes ?? "",
      created_at: invoice.createdAt,
    });
    for (const attachment of invoice.attachments ?? []) {
      if (!attachment?.path) continue;
      const uploaded = await uploadFile(attachment.path);
      if (!uploaded) continue;
      files.push({
        id: attachment.id ?? randomUUID(),
        record_id: invoice.id,
        label: attachment.label,
        original_name: attachment.originalName,
        mime_type: uploaded.mimeType,
        size: uploaded.size ?? attachment.size ?? 0,
        storage_path: uploaded.storage_path,
      });
    }
  }

  // Shift reports (if present)
  for (const report of data.shiftReports ?? []) {
    shiftReports.push({
      id: report.id ?? randomUUID(),
      store_id: report.storeId ?? report.storeNumber,
      manager_id: report.managerId,
      manager_name: report.managerName,
      employee_id: report.employeeId ?? null,
      employee_name: report.employeeName ?? null,
      date: report.date,
      scr_amount: report.scrAmount ?? 0,
      cash_amount: report.cashAmount ?? 0,
      net_amount: report.netAmount ?? 0,
      investigation_flag: report.investigationFlag ?? false,
      investigation_reason: report.investigationReason ?? null,
      updated_at: report.updatedAt ?? new Date().toISOString(),
    });
  }

  console.log(`Prepared ${records.length} records and ${files.length} files.`);

  if (records.length) {
    const { error } = await supabase.from("records").upsert(records, {
      onConflict: "id",
    });
    if (error) {
      console.error("Insert records error:", error);
      process.exit(1);
    }
  }

  if (files.length) {
    const { error } = await supabase.from("record_files").upsert(files, {
      onConflict: "id",
    });
    if (error) {
      console.error("Insert files error:", error);
      process.exit(1);
    }
  }

  if (shiftReports.length) {
    const { error } = await supabase.from("shift_reports").upsert(shiftReports, {
      onConflict: "id",
    });
    if (error) {
      console.error("Insert shift reports error:", error);
      process.exit(1);
    }
  }

  console.log("Migration completed.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
