import { randomUUID } from "crypto";
import { readFile, writeFile, mkdir, unlink } from "fs/promises";
import path from "path";
import type {
  CombinedRecord,
  InvoiceRecord,
  InvestigationRecord,
  InvestigationStatus,
  OrderMessage,
  OrderPeriod,
  OrderStatus,
  OrderVendor,
  OrderVendorDirectory,
  OrderVendorItem,
  OwnerSeenItem,
  OwnerSeenType,
  RecordFilters,
  Report,
  ReportItemConfig,
  ScratcherPack,
  ScratcherPackEvent,
  ScratcherProduct,
  ScratcherShiftCalculation,
  ScratcherShiftSnapshot,
  ScratcherShiftSnapshotItem,
  ScratcherSlot,
  StoreReportConfig,
  SurveillanceInvestigationRecord,
  ShiftReport,
  ShiftSubmission,
  WeeklyOrder,
  WeeklyOrderItem,
  StoredFile,
} from "./types";
import { mockUsers } from "./users";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET ?? "uploads";
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

const supabase =
  USE_SUPABASE && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

const DEFAULT_DATA_PATH = path.join(process.cwd(), "data", "storage.json");
const DATA_PATH =
  process.env.STORAGE_PATH ??
  (process.env.VERCEL ? "/tmp/storage.json" : DEFAULT_DATA_PATH);
const UPLOADS_ROOT =
  process.env.UPLOADS_ROOT ??
  (process.env.VERCEL ? "/tmp/uploads" : path.join(process.cwd(), "public", "uploads"));

async function insertRecordFiles(files: Array<Record<string, unknown>>) {
  if (!USE_SUPABASE || !supabase || files.length === 0) return;
  const { error } = await supabase.from("record_files").insert(files);
  if (!error) return;
  const legacyFiles = files.map(({ summary, ...rest }) => rest);
  const retry = await supabase.from("record_files").insert(legacyFiles);
  if (retry.error) {
    throw retry.error;
  }
}

interface SurveillanceRecord {
  id: string;
  employeeName: string;
  storeNumber: string;
  label: string;
  summary: string;
  grade?: string;
  gradeReason?: string;
  notes?: string;
  attachments: StoredFile[];
  createdAt: string;
}

interface StorageSchema {
  shiftSubmissions: ShiftSubmission[];
  shiftReports: ShiftReport[];
  investigations: InvestigationRecord[];
  surveillanceInvestigations: SurveillanceInvestigationRecord[];
  reports: Report[];
  surveillanceReports: SurveillanceRecord[];
  scratcherProducts?: Array<{
    id: string;
    name?: string | null;
    price: number;
    isActive: boolean;
    createdAt: string;
  }>;
  scratcherFiles?: StoredFile[];
  scratcherSlots?: Array<{
    id: string;
    storeId: string;
    slotNumber: number;
    label?: string | null;
    isActive: boolean;
    activePackId?: string | null;
    createdAt: string;
  }>;
  scratcherPacks?: Array<{
    id: string;
    storeId: string;
    slotId: string;
    productId: string;
    packCode?: string | null;
    startTicket: string;
    endTicket: string;
    status: "active" | "ended" | "returned";
    activatedAt: string;
    activatedByUserId: string;
    activationReceiptFileId: string;
    endedAt?: string | null;
    endedByUserId?: string | null;
  }>;
  scratcherShiftSnapshots?: Array<{
    id: string;
    shiftReportId: string;
    storeId: string;
    employeeUserId: string;
    snapshotType: "start" | "end";
    createdAt: string;
  }>;
  scratcherShiftSnapshotItems?: Array<{
    id: string;
    snapshotId: string;
    slotId: string;
    packId?: string | null;
    ticketValue: string;
    photoFileId?: string | null;
    createdAt: string;
  }>;
  scratcherPackEvents?: Array<{
    id: string;
    packId: string;
    eventType: "activated" | "ended" | "returned" | "return_receipt" | "correction" | "note";
    createdAt: string;
    createdByUserId: string;
    note?: string | null;
    fileId?: string | null;
  }>;
  scratcherShiftCalculations?: Array<{
    id: string;
    shiftReportId: string;
    storeId: string;
    employeeUserId: string;
    expectedTotalTickets: number;
    expectedTotalValue: number;
    reportedScrValue?: number | null;
    varianceValue: number;
    breakdown: Array<Record<string, unknown>>;
    flags: string[];
    createdAt: string;
    updatedAt: string;
  }>;
  orderVendors: OrderVendor[];
  orderVendorDirectory: OrderVendorDirectory[];
  orderVendorItems: OrderVendorItem[];
  weeklyOrders: WeeklyOrder[];
  orderMessages: OrderMessage[];
  invoices: InvoiceRecord[];
  ownerSeenItems: OwnerSeenItem[];
  storeReportConfigs?: StoreReportConfig[];
  storeChats?: Array<{ id: string; storeId: string; chatType: string; ownerId: string; participantId?: string | null }>;
  storeChatMessages?: Array<{ id: string; threadId: string; storeId: string; chatType: string; ownerId: string; senderRole: string }>;
}

async function ensureUploadsDir(subFolder: string) {
  await mkdir(path.join(UPLOADS_ROOT, subFolder), { recursive: true });
}

async function ensureStorageDir() {
  const dir = path.dirname(DATA_PATH);
  await mkdir(dir, { recursive: true });
}

async function readStorage(): Promise<StorageSchema> {
  try {
    await ensureStorageDir();
    const fileContents = await readFile(DATA_PATH, "utf-8").catch(async () => {
      // Fallback to bundled data file when running on a read-only FS (e.g., Vercel) or first run.
      return readFile(DEFAULT_DATA_PATH, "utf-8");
    });
    const parsed = JSON.parse(fileContents) as Partial<StorageSchema>;
    const base: StorageSchema = {
      shiftSubmissions: Array.isArray(parsed.shiftSubmissions)
        ? parsed.shiftSubmissions
        : [],
      shiftReports: Array.isArray((parsed as any)?.shiftReports)
        ? ((parsed as any).shiftReports as ShiftReport[])
        : [],
      investigations: Array.isArray((parsed as any)?.investigations)
        ? ((parsed as any).investigations as InvestigationRecord[])
        : [],
      surveillanceInvestigations: Array.isArray(
        (parsed as any)?.surveillanceInvestigations,
      )
        ? ((parsed as any).surveillanceInvestigations as SurveillanceInvestigationRecord[])
        : [],
      reports: Array.isArray(parsed.reports) ? parsed.reports : [],
      surveillanceReports: Array.isArray(parsed.surveillanceReports)
        ? parsed.surveillanceReports
        : [],
      scratcherProducts: Array.isArray((parsed as any)?.scratcherProducts)
        ? ((parsed as any).scratcherProducts as StorageSchema["scratcherProducts"])
        : [],
      scratcherFiles: Array.isArray((parsed as any)?.scratcherFiles)
        ? ((parsed as any).scratcherFiles as StorageSchema["scratcherFiles"])
        : [],
      scratcherSlots: Array.isArray((parsed as any)?.scratcherSlots)
        ? ((parsed as any).scratcherSlots as StorageSchema["scratcherSlots"])
        : [],
      scratcherPacks: Array.isArray((parsed as any)?.scratcherPacks)
        ? ((parsed as any).scratcherPacks as StorageSchema["scratcherPacks"])
        : [],
      scratcherShiftSnapshots: Array.isArray((parsed as any)?.scratcherShiftSnapshots)
        ? ((parsed as any).scratcherShiftSnapshots as StorageSchema["scratcherShiftSnapshots"])
        : [],
      scratcherShiftSnapshotItems: Array.isArray((parsed as any)?.scratcherShiftSnapshotItems)
        ? ((parsed as any).scratcherShiftSnapshotItems as StorageSchema["scratcherShiftSnapshotItems"])
        : [],
      scratcherPackEvents: Array.isArray((parsed as any)?.scratcherPackEvents)
        ? ((parsed as any).scratcherPackEvents as StorageSchema["scratcherPackEvents"])
        : [],
      scratcherShiftCalculations: Array.isArray((parsed as any)?.scratcherShiftCalculations)
        ? ((parsed as any).scratcherShiftCalculations as StorageSchema["scratcherShiftCalculations"])
        : [],
      orderVendors: Array.isArray((parsed as any)?.orderVendors)
        ? ((parsed as any).orderVendors as OrderVendor[])
        : [],
      orderVendorDirectory: Array.isArray((parsed as any)?.orderVendorDirectory)
        ? ((parsed as any).orderVendorDirectory as OrderVendorDirectory[])
        : [],
      orderVendorItems: Array.isArray((parsed as any)?.orderVendorItems)
        ? ((parsed as any).orderVendorItems as OrderVendorItem[])
        : [],
      weeklyOrders: Array.isArray((parsed as any)?.weeklyOrders)
        ? ((parsed as any).weeklyOrders as WeeklyOrder[])
        : [],
      orderMessages: Array.isArray((parsed as any)?.orderMessages)
        ? ((parsed as any).orderMessages as OrderMessage[])
        : [],
      invoices: Array.isArray((parsed as any)?.invoices)
        ? ((parsed as any).invoices as InvoiceRecord[])
        : [],
      ownerSeenItems: Array.isArray((parsed as any)?.ownerSeenItems)
        ? ((parsed as any).ownerSeenItems as OwnerSeenItem[])
        : [],
      storeReportConfigs: Array.isArray((parsed as any)?.storeReportConfigs)
        ? ((parsed as any).storeReportConfigs as StoreReportConfig[])
        : [],
      storeChats: Array.isArray((parsed as any)?.storeChats)
        ? ((parsed as any).storeChats as StorageSchema["storeChats"])
        : [],
      storeChatMessages: Array.isArray((parsed as any)?.storeChatMessages)
        ? ((parsed as any).storeChatMessages as StorageSchema["storeChatMessages"])
        : [],
    };

    // If running on Vercel and storage is empty, hydrate from bundled defaults.
    if (
      process.env.VERCEL &&
      base.shiftSubmissions.length === 0 &&
      base.shiftReports.length === 0 &&
      base.investigations.length === 0 &&
      base.surveillanceInvestigations.length === 0 &&
      base.reports.length === 0 &&
      base.surveillanceReports.length === 0 &&
      base.orderVendors.length === 0 &&
      base.orderVendorDirectory.length === 0 &&
      base.orderVendorItems.length === 0 &&
      base.weeklyOrders.length === 0 &&
      base.orderMessages.length === 0 &&
      base.invoices.length === 0 &&
      base.ownerSeenItems.length === 0
    ) {
      try {
        const bundled = await readFile(DEFAULT_DATA_PATH, "utf-8");
        const parsedBundled = JSON.parse(bundled) as Partial<StorageSchema>;
        base.shiftSubmissions = Array.isArray(parsedBundled.shiftSubmissions)
          ? parsedBundled.shiftSubmissions
          : [];
        base.shiftReports = Array.isArray((parsedBundled as any)?.shiftReports)
          ? ((parsedBundled as any).shiftReports as ShiftReport[])
          : [];
        base.investigations = Array.isArray(
          (parsedBundled as any)?.investigations,
        )
          ? ((parsedBundled as any).investigations as InvestigationRecord[])
          : [];
        base.surveillanceInvestigations = Array.isArray(
          (parsedBundled as any)?.surveillanceInvestigations,
        )
          ? ((parsedBundled as any).surveillanceInvestigations as SurveillanceInvestigationRecord[])
          : [];
        base.reports = Array.isArray(parsedBundled.reports)
          ? parsedBundled.reports
          : [];
        base.surveillanceReports = Array.isArray(
          parsedBundled.surveillanceReports,
        )
          ? parsedBundled.surveillanceReports
          : [];
        base.orderVendors = Array.isArray((parsedBundled as any)?.orderVendors)
          ? ((parsedBundled as any).orderVendors as OrderVendor[])
          : [];
        base.orderVendorDirectory = Array.isArray(
          (parsedBundled as any)?.orderVendorDirectory,
        )
          ? ((parsedBundled as any).orderVendorDirectory as OrderVendorDirectory[])
          : [];
        base.orderVendorItems = Array.isArray(
          (parsedBundled as any)?.orderVendorItems,
        )
          ? ((parsedBundled as any).orderVendorItems as OrderVendorItem[])
          : [];
        base.weeklyOrders = Array.isArray((parsedBundled as any)?.weeklyOrders)
          ? ((parsedBundled as any).weeklyOrders as WeeklyOrder[])
          : [];
        base.orderMessages = Array.isArray((parsedBundled as any)?.orderMessages)
          ? ((parsedBundled as any).orderMessages as OrderMessage[])
          : [];
        base.invoices = Array.isArray((parsedBundled as any)?.invoices)
          ? ((parsedBundled as any).invoices as InvoiceRecord[])
          : [];
      base.ownerSeenItems = Array.isArray((parsedBundled as any)?.ownerSeenItems)
        ? ((parsedBundled as any).ownerSeenItems as OwnerSeenItem[])
        : [];
      base.storeChats = Array.isArray((parsedBundled as any)?.storeChats)
        ? ((parsedBundled as any).storeChats as StorageSchema["storeChats"])
        : [];
      base.storeChatMessages = Array.isArray((parsedBundled as any)?.storeChatMessages)
        ? ((parsedBundled as any).storeChatMessages as StorageSchema["storeChatMessages"])
        : [];
      } catch {
        // ignore
      }
    }

    return base;
  } catch {
    const fallback: StorageSchema = {
      shiftSubmissions: [],
      shiftReports: [],
      investigations: [],
      surveillanceInvestigations: [],
      reports: [],
      surveillanceReports: [],
      orderVendors: [],
      orderVendorDirectory: [],
      orderVendorItems: [],
      weeklyOrders: [],
      orderMessages: [],
      invoices: [],
      ownerSeenItems: [],
    };
    await writeStorage(fallback);
    return fallback;
  }
}

export async function deleteOrderVendorDirectory(id: string): Promise<boolean> {
  if (!id) return false;
  if (USE_SUPABASE && supabase) {
    const { error } = await supabase.from("order_vendor_directory").delete().eq("id", id);
    if (error) {
      console.error("Supabase vendor directory delete error:", error);
      return false;
    }
    return true;
  }

  const storage = await readStorage();
  const next = storage.orderVendorDirectory.filter((vendor) => vendor.id !== id);
  await writeStorage({ ...storage, orderVendorDirectory: next });
  return true;
}

async function writeStorage(payload: StorageSchema) {
  await ensureStorageDir();
  await writeFile(DATA_PATH, JSON.stringify(payload, null, 2), "utf-8");
}

async function deleteStoredFile(publicPath: string | undefined) {
  if (!publicPath) return;
  if (publicPath.startsWith("data:")) return;
  const absolutePath = publicPath.startsWith("/uploads/")
    ? path.join(UPLOADS_ROOT, publicPath.replace("/uploads/", ""))
    : path.join(process.cwd(), "public", publicPath.startsWith("/") ? publicPath.slice(1) : publicPath);
  try {
    await unlink(absolutePath);
  } catch {
    // ignore missing files
  }
}

export interface SaveFileOptions {
  folder: "shift" | "reports" | "surveillance" | "invoices" | "scratchers";
  label?: string;
  summary?: string;
}

export async function saveUploadedFile(
  file: File,
  options: SaveFileOptions,
): Promise<StoredFile> {
  const { folder, label } = options;
  const buffer = Buffer.from(await file.arrayBuffer());
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9.\-]/g, "_");
  const id = randomUUID();
  const filename = `${id}-${sanitizedName}`;
  const mime = file.type || "application/octet-stream";
  const shouldWriteToDisk = !process.env.VERCEL;
  let publicPath = `/uploads/${folder}/${filename}`;
  let dataUrl: string | undefined;
  let signedUrl: string | undefined;

  if (USE_SUPABASE && supabase) {
    const key = `${folder}/${filename}`;
    const { error } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(key, buffer, { contentType: mime, upsert: true });
    if (error) {
      throw new Error(`Upload failed: ${error.message}`);
    }
    const { data: signed } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .createSignedUrl(key, 60 * 60 * 24 * 7);
    signedUrl = signed?.signedUrl;
    publicPath = key.startsWith("/") ? key : `/${key}`;
  } else {
    if (shouldWriteToDisk) {
      await ensureUploadsDir(folder);
      const filePath = path.join(UPLOADS_ROOT, folder, filename);
      await writeFile(filePath, buffer);
    } else {
      dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
      publicPath = dataUrl;
    }
  }

  return {
    id,
    path: signedUrl ?? publicPath,
    dataUrl,
    originalName: file.name,
    mimeType: mime,
    size: file.size,
    label,
    summary: options.summary,
    kind: deriveKind(file.type),
  };
}

function deriveKind(mime: string | undefined): StoredFile["kind"] {
  if (!mime) return "other";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (
    mime === "application/pdf" ||
    mime === "application/msword" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "document";
  }
  return "other";
}

export async function addShiftSubmission(
  payload: Omit<ShiftSubmission, "id" | "createdAt">,
): Promise<ShiftSubmission> {
  if (USE_SUPABASE && supabase) {
    const recordId = randomUUID();
    const attachments = [
      payload.scratcherVideo,
      payload.cashPhoto,
      payload.salesPhoto,
    ];
    await supabase.from("records").insert({
      id: recordId,
      store_number: payload.storeNumber,
      employee_name: payload.employeeName,
      category: "shift",
      shift_notes: payload.shiftNotes ?? "",
      text_content: payload.reportDetails
        ? JSON.stringify(payload.reportDetails)
        : null,
    });
    const files = attachments.map((file) => ({
      id: randomUUID(),
      record_id: recordId,
      label: file.label,
      summary: file.summary ?? null,
      original_name: file.originalName,
      mime_type: file.mimeType,
      size: file.size,
      storage_path: file.path,
    }));
    await insertRecordFiles(files);
    return {
      ...payload,
      id: recordId,
      createdAt: new Date().toISOString(),
    };
  }

  const storage = await readStorage();
  const submission: ShiftSubmission = {
    ...payload,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  storage.shiftSubmissions.unshift(submission);
  await writeStorage(storage);
  return submission;
}

export async function addReport(
  payload: Omit<Report, "id" | "createdAt">,
): Promise<Report> {
  if (USE_SUPABASE && supabase) {
    const recordId = randomUUID();
    await supabase.from("records").insert({
      id: recordId,
      store_number: payload.storeNumber,
      employee_name: payload.employeeName,
      category: payload.reportType,
      notes: payload.notes ?? "",
      text_content: payload.textContent ?? "",
    });
    const files = payload.attachments.map((file) => ({
      id: randomUUID(),
      record_id: recordId,
      label: file.label,
      summary: file.summary ?? null,
      original_name: file.originalName,
      mime_type: file.mimeType,
      size: file.size,
      storage_path: file.path,
    }));
    if (files.length) {
      await insertRecordFiles(files);
    }
    return {
      ...payload,
      id: recordId,
      createdAt: new Date().toISOString(),
    };
  }

  const storage = await readStorage();
  const report: Report = {
    ...payload,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  storage.reports.unshift(report);
  await writeStorage(storage);
  return report;
}

export async function updateReportNotes(payload: {
  id: string;
  notes?: string;
}): Promise<Report | null> {
  const now = new Date().toISOString();
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("records")
      .update({ notes: payload.notes ?? "" })
      .eq("id", payload.id)
      .select("*")
      .maybeSingle();
    if (error || !data) {
      console.error("Supabase report update error:", error);
      return null;
    }
    return {
      id: data.id,
      employeeName: data.employee_name,
      storeNumber: data.store_number,
      reportType: data.category,
      createdAt: data.created_at ?? now,
      notes: data.notes ?? undefined,
      textContent: data.text_content ?? undefined,
      attachments: [],
    };
  }

  const storage = await readStorage();
  const index = storage.reports.findIndex((report) => report.id === payload.id);
  if (index < 0) return null;
  const updated = {
    ...storage.reports[index],
    notes: payload.notes,
  };
  storage.reports[index] = updated;
  await writeStorage(storage);
  return updated;
}

export async function addSurveillanceReport(
  payload: Omit<SurveillanceRecord, "id" | "createdAt">,
): Promise<SurveillanceRecord> {
  if (USE_SUPABASE && supabase) {
    const recordId = randomUUID();
    await supabase.from("records").insert({
      id: recordId,
      store_number: payload.storeNumber,
      employee_name: payload.employeeName,
      category: "surveillance",
      notes: payload.notes ?? "",
      surveillance_label: payload.label,
      surveillance_summary: payload.summary,
      surveillance_grade: payload.grade ?? null,
      surveillance_grade_reason: payload.gradeReason ?? null,
    });
    const files = payload.attachments.map((file) => ({
      id: randomUUID(),
      record_id: recordId,
      label: file.label,
      summary: file.summary ?? null,
      original_name: file.originalName,
      mime_type: file.mimeType,
      size: file.size,
      storage_path: file.path,
    }));
    if (files.length) {
      await insertRecordFiles(files);
    }
    const entry: SurveillanceRecord = {
      ...payload,
      id: recordId,
      createdAt: new Date().toISOString(),
    };
    return entry;
  }

  const storage = await readStorage();
  const entry: SurveillanceRecord = {
    ...payload,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  storage.surveillanceReports.unshift(entry);
  await writeStorage(storage);
  return entry;
}

export async function addInvoice(
  payload: Omit<InvoiceRecord, "id" | "createdAt">,
): Promise<InvoiceRecord> {
  if (USE_SUPABASE && supabase) {
    const recordId = randomUUID();
    await supabase.from("records").insert({
      id: recordId,
      store_number: payload.storeNumber,
      employee_name: payload.employeeName,
      category: "invoice",
      invoice_notes: payload.notes ?? "",
      invoice_company: payload.invoiceCompany ?? null,
      invoice_number: payload.invoiceNumber ?? null,
      invoice_amount_cents:
        typeof payload.invoiceAmountCents === "number"
          ? payload.invoiceAmountCents
          : null,
      invoice_due_date: payload.invoiceDueDate ?? null,
      invoice_paid: payload.invoicePaid ?? false,
      invoice_payment_method: payload.invoicePaymentMethod ?? null,
      invoice_payment_details: payload.invoicePaymentDetails ?? {},
      invoice_paid_amount_cents:
        typeof payload.invoicePaidAmountCents === "number"
          ? payload.invoicePaidAmountCents
          : null,
    });
    const files = payload.attachments.map((file) => ({
      id: randomUUID(),
      record_id: recordId,
      label: file.label,
      summary: file.summary ?? null,
      original_name: file.originalName,
      mime_type: file.mimeType,
      size: file.size,
      storage_path: file.path,
    }));
    if (files.length) {
      await insertRecordFiles(files);
    }
    return {
      ...payload,
      id: recordId,
      createdAt: new Date().toISOString(),
    };
  }

  const storage = await readStorage();
  const invoice: InvoiceRecord = {
    ...payload,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  storage.invoices.unshift(invoice);
  await writeStorage(storage);
  return invoice;
}

export async function getRecentSurveillanceReports(options: {
  employeeName: string;
  days?: number;
}): Promise<SurveillanceRecord[]> {
  const { employeeName, days = 3 } = options;
  const storage = await readStorage();
  const cutoff = Date.now() - Math.max(days, 1) * 24 * 60 * 60 * 1000;
  const normalized = employeeName.trim().toLowerCase();

  return storage.surveillanceReports
    .filter((entry) => {
      const created = new Date(entry.createdAt).getTime();
      if (!Number.isFinite(created) || created < cutoff) {
        return false;
      }
      return entry.employeeName.trim().toLowerCase() === normalized;
    })
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
}

export async function getCombinedRecords(
  filters: RecordFilters,
): Promise<CombinedRecord[]> {
  if (USE_SUPABASE && supabase) {
    const selectWithSummary = `
        id,
        store_number,
        employee_name,
        category,
        shift_notes,
        notes,
        text_content,
        surveillance_label,
        surveillance_summary,
        surveillance_grade,
        surveillance_grade_reason,
        invoice_notes,
        invoice_company,
        invoice_number,
        invoice_amount_cents,
        invoice_due_date,
        invoice_paid,
        invoice_payment_method,
        invoice_payment_details,
        invoice_paid_amount_cents,
        created_at,
        record_files (
          id,
          label,
          summary,
          original_name,
          mime_type,
          size,
          storage_path
        )
      `;
    const selectWithoutSummary = `
        id,
        store_number,
        employee_name,
        category,
        shift_notes,
        notes,
        text_content,
        surveillance_label,
        surveillance_summary,
        surveillance_grade,
        surveillance_grade_reason,
        invoice_notes,
        invoice_company,
        invoice_number,
        invoice_amount_cents,
        invoice_due_date,
        invoice_paid,
        invoice_payment_method,
        invoice_payment_details,
        invoice_paid_amount_cents,
        created_at,
        record_files (
          id,
          label,
          original_name,
          mime_type,
          size,
          storage_path
        )
      `;
    const applyFilters = (base: any) => {
      let query = base.order("created_at", { ascending: false });
      if (filters.storeNumber) {
        query = query.eq("store_number", filters.storeNumber);
      }
      if (filters.category && filters.category !== "all") {
        query = query.eq("category", filters.category);
      }
      if (filters.employee) {
        query = query.ilike("employee_name", `%${filters.employee}%`);
      }
      if (filters.startDate) {
        query = query.gte("created_at", filters.startDate);
      }
      if (filters.endDate) {
        query = query.lte("created_at", filters.endDate);
      }
      return query;
    };

    let { data, error } = await applyFilters(
      supabase.from("records").select(selectWithSummary),
    );
    if (error) {
      console.error("Supabase fetch error:", error);
      const retry = await applyFilters(
        supabase.from("records").select(selectWithoutSummary),
      );
      if (retry.error) {
        console.error("Supabase fetch retry error:", retry.error);
        return [];
      }
      data = retry.data;
    }

    const filesWithSignedUrls = await Promise.all(
      (data ?? []).flatMap((record: any) =>
        (record.record_files ?? []).map(async (file: any) => {
          const storagePath: string = file.storage_path ?? "";
          const objectPath = (() => {
            if (!storagePath) return null;
            // Handle full signed/public URLs and strip bucket prefix + query params.
            const withoutQuery = storagePath.split("?")[0];
            const prefixPattern =
              /https?:\/\/[^/]+\/storage\/v1\/object\/(?:sign|public)\/[^/]+\//;
            const stripped = withoutQuery.replace(prefixPattern, "");
            return stripped.replace(/^\/+/, "");
          })();
          const path = objectPath;
          if (!path) return null;
          const { data: signed } = await supabase.storage
            .from(SUPABASE_BUCKET)
            .createSignedUrl(path, 60 * 60 * 24 * 7);
          return {
            recordId: record.id,
            file: {
              id: file.id,
              path: signed?.signedUrl ?? file.storage_path,
              originalName: file.original_name,
              mimeType: file.mime_type,
              size: file.size,
              label: file.label,
              summary: file.summary ?? undefined,
              kind: deriveKind(file.mime_type),
            } as StoredFile,
          };
        }),
      ),
    );

    const fileMap = new Map<string, StoredFile[]>();
    filesWithSignedUrls
      .filter(Boolean)
      .forEach((entry) => {
        if (!entry) return;
        const list = fileMap.get(entry.recordId) ?? [];
        list.push(entry.file);
        fileMap.set(entry.recordId, list);
      });

    return (data ?? []).map((record: any) => ({
      id: record.id,
      category: record.category,
      employeeName: record.employee_name,
      storeNumber: record.store_number,
      createdAt: record.created_at,
      shiftNotes: record.shift_notes ?? undefined,
      notes: record.notes ?? undefined,
      textContent: record.text_content ?? undefined,
      surveillanceLabel: record.surveillance_label ?? undefined,
      surveillanceSummary: record.surveillance_summary ?? undefined,
      surveillanceGrade: record.surveillance_grade ?? undefined,
      surveillanceGradeReason: record.surveillance_grade_reason ?? undefined,
      invoiceNotes: record.invoice_notes ?? undefined,
      invoiceCompany: record.invoice_company ?? undefined,
      invoiceNumber: record.invoice_number ?? undefined,
      invoiceAmountCents:
        typeof record.invoice_amount_cents === "number"
          ? record.invoice_amount_cents
          : record.invoice_amount_cents
            ? Number(record.invoice_amount_cents)
            : undefined,
      invoiceDueDate: record.invoice_due_date ?? undefined,
      invoicePaid: typeof record.invoice_paid === "boolean" ? record.invoice_paid : undefined,
      invoicePaymentMethod: record.invoice_payment_method ?? undefined,
      invoicePaymentDetails: record.invoice_payment_details ?? undefined,
      invoicePaidAmountCents:
        typeof record.invoice_paid_amount_cents === "number"
          ? record.invoice_paid_amount_cents
          : record.invoice_paid_amount_cents
            ? Number(record.invoice_paid_amount_cents)
            : undefined,
      attachments: fileMap.get(record.id) ?? [],
    }));
  }

  const storage = await readStorage();
  const { shiftSubmissions, reports, surveillanceReports, invoices } = storage;
  const allRecords: CombinedRecord[] = [
    ...shiftSubmissions.map<CombinedRecord>((submission) => ({
      id: submission.id,
      category: "shift",
      employeeName: submission.employeeName,
      storeNumber: submission.storeNumber,
      createdAt: submission.createdAt,
      shiftNotes: submission.shiftNotes,
      attachments: [
        { ...submission.scratcherVideo },
        { ...submission.cashPhoto },
        { ...submission.salesPhoto },
      ],
    })),
    ...reports.map<CombinedRecord>((report) => ({
      id: report.id,
      category: report.reportType,
      employeeName: report.employeeName,
      storeNumber: report.storeNumber,
      createdAt: report.createdAt,
      notes: report.notes,
      textContent: report.textContent,
      attachments: report.attachments.map((file) => ({ ...file })),
    })),
    ...surveillanceReports.map<CombinedRecord>((entry) => ({
      id: entry.id,
      category: "surveillance",
      employeeName: entry.employeeName,
      storeNumber: entry.storeNumber,
      createdAt: entry.createdAt,
      notes: entry.notes,
      surveillanceLabel: entry.label,
      surveillanceSummary: entry.summary,
      surveillanceGrade: entry.grade,
      surveillanceGradeReason: entry.gradeReason,
      attachments: entry.attachments.map((file) => ({ ...file })),
    })),
    ...invoices.map<CombinedRecord>((invoice) => ({
      id: invoice.id,
      category: "invoice",
      employeeName: invoice.employeeName,
      storeNumber: invoice.storeNumber,
      createdAt: invoice.createdAt,
      invoiceNotes: invoice.notes,
      invoiceCompany: invoice.invoiceCompany,
      invoiceNumber: invoice.invoiceNumber,
      invoiceAmountCents: invoice.invoiceAmountCents,
      invoiceDueDate: invoice.invoiceDueDate,
      invoicePaid: invoice.invoicePaid,
      invoicePaymentMethod: invoice.invoicePaymentMethod,
      invoicePaymentDetails: invoice.invoicePaymentDetails,
      invoicePaidAmountCents: invoice.invoicePaidAmountCents,
      attachments: invoice.attachments.map((file) => ({ ...file })),
    })),
  ];

  const categoryFilter =
    filters.category && filters.category !== "all"
      ? filters.category
      : undefined;

  const filtered = allRecords
    .filter((record) =>
      filters.storeNumber ? record.storeNumber === filters.storeNumber : true,
    )
    .filter((record) =>
      categoryFilter ? record.category === categoryFilter : true,
    )
    .filter((record) =>
      filters.employee
        ? record.employeeName
            .toLowerCase()
            .includes(filters.employee.toLowerCase())
        : true,
    )
    .filter((record) => {
      if (!filters.startDate && !filters.endDate) return true;
      const createdAt = new Date(record.createdAt).getTime();
      if (filters.startDate) {
        const start = new Date(filters.startDate).getTime();
        if (Number.isFinite(start) && createdAt < start) {
          return false;
        }
      }
      if (filters.endDate) {
        const end = new Date(filters.endDate).getTime();
        if (Number.isFinite(end) && createdAt > end) {
          return false;
        }
      }
      return true;
    })
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

  return filtered;
}

export async function getCombinedRecordById(
  recordId: string,
): Promise<CombinedRecord | null> {
  if (USE_SUPABASE && supabase) {
    const selectWithSummary = `
        id,
        store_number,
        employee_name,
        category,
        shift_notes,
        notes,
        text_content,
        surveillance_label,
        surveillance_summary,
        surveillance_grade,
        surveillance_grade_reason,
        invoice_notes,
        invoice_company,
        invoice_number,
        invoice_amount_cents,
        invoice_due_date,
        invoice_paid,
        invoice_payment_method,
        invoice_payment_details,
        invoice_paid_amount_cents,
        created_at,
        record_files (
          id,
          label,
          summary,
          original_name,
          mime_type,
          size,
          storage_path
        )
      `;
    const selectWithoutSummary = `
        id,
        store_number,
        employee_name,
        category,
        shift_notes,
        notes,
        text_content,
        surveillance_label,
        surveillance_summary,
        surveillance_grade,
        surveillance_grade_reason,
        invoice_notes,
        invoice_company,
        invoice_number,
        invoice_amount_cents,
        invoice_due_date,
        invoice_paid,
        invoice_payment_method,
        invoice_payment_details,
        invoice_paid_amount_cents,
        created_at,
        record_files (
          id,
          label,
          original_name,
          mime_type,
          size,
          storage_path
        )
      `;
    let data: any = null;
    let error: any = null;
    ({ data, error } = await supabase
      .from("records")
      .select(selectWithSummary)
      .eq("id", recordId)
      .maybeSingle());

    if (error) {
      console.error("Supabase record lookup error:", error);
      const retry = await supabase
        .from("records")
        .select(selectWithoutSummary)
        .eq("id", recordId)
        .maybeSingle();
      if (retry.error) {
        console.error("Supabase record lookup retry error:", retry.error);
        return null;
      }
      data = retry.data;
    }

    if (!data) {
      return null;
    }

    const filesWithSignedUrls = await Promise.all(
      (data.record_files ?? []).map(async (file: any) => {
        const storagePath: string = file.storage_path ?? "";
        const objectPath = (() => {
          if (!storagePath) return null;
          const withoutQuery = storagePath.split("?")[0];
          const prefixPattern =
            /https?:\/\/[^/]+\/storage\/v1\/object\/(?:sign|public)\/[^/]+\//;
          const stripped = withoutQuery.replace(prefixPattern, "");
          return stripped.replace(/^\/+/, "");
        })();
        const path = objectPath;
        if (!path) return null;
        const { data: signed } = await supabase.storage
          .from(SUPABASE_BUCKET)
          .createSignedUrl(path, 60 * 60 * 24 * 7);
        return {
          id: file.id,
          path: signed?.signedUrl ?? file.storage_path,
          originalName: file.original_name,
          mimeType: file.mime_type,
          size: file.size,
          label: file.label,
          summary: file.summary ?? undefined,
          kind: deriveKind(file.mime_type),
        } as StoredFile;
      }),
    );

    return {
      id: data.id,
      category: data.category,
      employeeName: data.employee_name,
      storeNumber: data.store_number,
      createdAt: data.created_at,
      shiftNotes: data.shift_notes ?? undefined,
      notes: data.notes ?? undefined,
      textContent: data.text_content ?? undefined,
      surveillanceLabel: data.surveillance_label ?? undefined,
      surveillanceSummary: data.surveillance_summary ?? undefined,
      surveillanceGrade: data.surveillance_grade ?? undefined,
      surveillanceGradeReason: data.surveillance_grade_reason ?? undefined,
      invoiceNotes: data.invoice_notes ?? undefined,
      invoiceCompany: data.invoice_company ?? undefined,
      invoiceNumber: data.invoice_number ?? undefined,
      invoiceAmountCents:
        typeof data.invoice_amount_cents === "number"
          ? data.invoice_amount_cents
          : data.invoice_amount_cents
            ? Number(data.invoice_amount_cents)
            : undefined,
      invoiceDueDate: data.invoice_due_date ?? undefined,
      invoicePaid: typeof data.invoice_paid === "boolean" ? data.invoice_paid : undefined,
      invoicePaymentMethod: data.invoice_payment_method ?? undefined,
      invoicePaymentDetails: data.invoice_payment_details ?? undefined,
      invoicePaidAmountCents:
        typeof data.invoice_paid_amount_cents === "number"
          ? data.invoice_paid_amount_cents
          : data.invoice_paid_amount_cents
            ? Number(data.invoice_paid_amount_cents)
            : undefined,
      attachments: filesWithSignedUrls.filter(Boolean) as StoredFile[],
    };
  }

  const storage = await readStorage();
  const allRecords = await getCombinedRecords({ category: "all" });
  return allRecords.find((record) => record.id === recordId) ?? null;
}

export async function getRecentShiftSubmissions(options: {
  storeNumber: string;
  employeeName: string;
  days?: number;
}): Promise<ShiftSubmission[]> {
  if (USE_SUPABASE && supabase) {
    const { storeNumber, employeeName, days = 3 } = options;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Math.max(1, days));

    const selectWithSummary = `
        id,
        store_number,
        employee_name,
        created_at,
        shift_notes,
        record_files (
          id,
          label,
          summary,
          original_name,
          mime_type,
          size,
          storage_path
        )
      `;
    const selectWithoutSummary = `
        id,
        store_number,
        employee_name,
        created_at,
        shift_notes,
        record_files (
          id,
          label,
          original_name,
          mime_type,
          size,
          storage_path
        )
      `;
    let data: any = null;
    let error: any = null;
    ({ data, error } = await supabase
      .from("records")
      .select(selectWithSummary)
      .eq("category", "shift")
      .eq("store_number", storeNumber)
      .ilike("employee_name", employeeName)
      .gte("created_at", cutoff.toISOString())
      .order("created_at", { ascending: false }));

    if (error) {
      console.error("Supabase recent shifts error:", error);
      const retry = await supabase
        .from("records")
        .select(selectWithoutSummary)
        .eq("category", "shift")
        .eq("store_number", storeNumber)
        .ilike("employee_name", employeeName)
        .gte("created_at", cutoff.toISOString())
        .order("created_at", { ascending: false });
      if (retry.error) {
        console.error("Supabase recent shifts retry error:", retry.error);
        return [];
      }
      data = retry.data;
    }

    if (!data) {
      return [];
    }

    const filesWithSignedUrls = await Promise.all(
      data.flatMap((record: any) =>
        (record.record_files ?? []).map(async (file: any) => {
          const path = file.storage_path?.replace(/^\//, "");
          if (!path) return null;
          const { data: signed } = await supabase.storage
            .from(SUPABASE_BUCKET)
            .createSignedUrl(path, 60 * 60 * 24 * 7);
          return {
            recordId: record.id,
            file: {
              id: file.id,
              path: signed?.signedUrl ?? file.storage_path,
              originalName: file.original_name,
              mimeType: file.mime_type,
              size: file.size,
              label: file.label,
              summary: file.summary ?? undefined,
              kind: deriveKind(file.mime_type),
            } as StoredFile,
          };
        }),
      ),
    );

    const fileMap = new Map<string, StoredFile[]>();
    filesWithSignedUrls
      .filter(Boolean)
      .forEach((entry) => {
        if (!entry) return;
        const list = fileMap.get(entry.recordId) ?? [];
        list.push(entry.file);
        fileMap.set(entry.recordId, list);
      });

    const mapFile = (files: StoredFile[], labelMatch: string, fallbackKind: StoredFile["kind"]) => {
      const byLabel = files.find((f) =>
        (f.label ?? "").toLowerCase().includes(labelMatch.toLowerCase()),
      );
      if (byLabel) return byLabel;
      const byKind = files.find((f) => f.kind === fallbackKind);
      return byKind ?? files[0];
    };

    return data.map((record: any) => {
      const files = fileMap.get(record.id) ?? [];
      const scratcherVideo = mapFile(files, "Scratcher", "video");
      const cashPhoto = mapFile(files, "Cash", "image");
      const salesPhoto = mapFile(files, "Sales", "image");
      return {
        id: record.id,
        employeeName: record.employee_name,
        storeNumber: record.store_number,
        createdAt: record.created_at,
        shiftNotes: record.shift_notes ?? undefined,
        scratcherVideo,
        cashPhoto,
        salesPhoto,
      };
    });
  }

  const { storeNumber, employeeName, days = 3 } = options;
  const storage = await readStorage();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Math.max(1, days));
  const normalizedName = employeeName.trim().toLowerCase();

  return storage.shiftSubmissions
    .filter((submission) => {
      if (submission.storeNumber !== storeNumber) {
        return false;
      }
      if (
        normalizedName &&
        submission.employeeName.trim().toLowerCase() !== normalizedName
      ) {
        return false;
      }
      const created = new Date(submission.createdAt);
      return Number.isFinite(created.getTime()) && created >= cutoff;
    })
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
}

export async function listShiftSubmissionUploadsByDate(options: {
  storeNumber: string;
  date: string;
  employeeName?: string;
}): Promise<
  Array<{
    id: string;
    employeeName: string;
    createdAt: string;
    files: StoredFile[];
  }>
> {
  const { storeNumber, date, employeeName } = options;
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);

  if (USE_SUPABASE && supabase) {
    const select = `
        id,
        store_number,
        employee_name,
        created_at,
        record_files (
          id,
          label,
          summary,
          original_name,
          mime_type,
          size,
          storage_path
        )
      `;
    let query = supabase
      .from("records")
      .select(select)
      .eq("category", "shift")
      .eq("store_number", storeNumber)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString())
      .order("created_at", { ascending: false });
    if (employeeName) {
      query = query.ilike("employee_name", employeeName);
    }
    const { data, error } = await query;
    if (error) {
      console.error("Supabase shift uploads error:", error);
      return [];
    }
    if (!data) return [];
    return data
      .map((record: any) => {
        const files = (record.record_files ?? [])
          .map((file: any) => {
            if (!file?.storage_path) return null;
            return {
              id: file.id,
              path: file.storage_path,
              originalName: file.original_name,
              mimeType: file.mime_type,
              size: file.size,
              label: file.label,
              summary: file.summary ?? undefined,
              kind: deriveKind(file.mime_type),
            } as StoredFile;
          })
          .filter(Boolean) as StoredFile[];
        return {
          id: record.id,
          employeeName: record.employee_name,
          createdAt: record.created_at,
          files,
        };
      })
      .filter((entry: any) => entry.files.length);
  }

  const storage = await readStorage();
  const normalized = employeeName?.trim().toLowerCase() ?? "";
  return storage.shiftSubmissions
    .filter((submission) => {
      if (submission.storeNumber !== storeNumber) return false;
      if (normalized && submission.employeeName.trim().toLowerCase() !== normalized) {
        return false;
      }
      const created = submission.createdAt?.slice(0, 10);
      return created === date;
    })
    .map((submission) => ({
      id: submission.id,
      employeeName: submission.employeeName,
      createdAt: submission.createdAt,
      files: [submission.scratcherVideo, submission.cashPhoto, submission.salesPhoto].filter(
        Boolean,
      ) as StoredFile[],
    }));
}

export async function getRecentInvoiceUploads(options: {
  storeNumber: string;
  employeeName: string;
  days?: number;
}): Promise<CombinedRecord[]> {
  if (USE_SUPABASE && supabase) {
    const { storeNumber, employeeName, days = 3 } = options;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Math.max(1, days));

    const selectWithSummary = `
        id,
        store_number,
        employee_name,
        created_at,
        notes,
        invoice_notes,
        invoice_company,
        invoice_number,
        invoice_amount_cents,
        invoice_due_date,
        invoice_paid,
        invoice_payment_method,
        invoice_payment_details,
        invoice_paid_amount_cents,
        record_files (
          id,
          label,
          summary,
          original_name,
          mime_type,
          size,
          storage_path
        )
      `;
    const selectWithoutSummary = `
        id,
        store_number,
        employee_name,
        created_at,
        notes,
        invoice_notes,
        invoice_company,
        invoice_number,
        invoice_amount_cents,
        invoice_due_date,
        invoice_paid,
        invoice_payment_method,
        invoice_payment_details,
        invoice_paid_amount_cents,
        record_files (
          id,
          label,
          original_name,
          mime_type,
          size,
          storage_path
        )
      `;

    const fetchInvoices = async (
      builder: "withSummary" | "withoutSummary",
      includeEmployee: boolean,
    ) => {
      const select = builder === "withSummary" ? selectWithSummary : selectWithoutSummary;
      let query = supabase
        .from("records")
        .select(select)
        .eq("category", "invoice")
        .eq("store_number", storeNumber)
        .gte("created_at", cutoff.toISOString())
        .order("created_at", { ascending: false });
      if (includeEmployee) {
        query = query.ilike("employee_name", employeeName);
      }
      return query;
    };

    let data: any = null;
    let error: any = null;
    ({ data, error } = await fetchInvoices("withSummary", true));

    if (error) {
      console.error("Supabase recent invoices error:", error);
      const retry = await fetchInvoices("withoutSummary", true);
      if (retry.error) {
        console.error("Supabase recent invoices retry error:", retry.error);
        return [];
      }
      data = retry.data;
    }

    if (!data || !data.length) {
      const fallback = await fetchInvoices("withSummary", false);
      if (fallback.error) {
        console.error("Supabase recent invoices fallback error:", fallback.error);
        return [];
      }
      data = fallback.data ?? [];
    }

    const filesWithSignedUrls = await Promise.all(
      data.flatMap((record: any) =>
        (record.record_files ?? []).map(async (file: any) => {
          const path = file.storage_path?.replace(/^\//, "");
          if (!path) return null;
          const { data: signed } = await supabase.storage
            .from(SUPABASE_BUCKET)
            .createSignedUrl(path, 60 * 60 * 24 * 7);
          return {
            recordId: record.id,
            file: {
              id: file.id,
              path: signed?.signedUrl ?? file.storage_path,
              originalName: file.original_name,
              mimeType: file.mime_type,
              size: file.size,
              label: file.label,
              summary: file.summary ?? undefined,
              kind: deriveKind(file.mime_type),
            } as StoredFile,
          };
        }),
      ),
    );

    const fileMap = new Map<string, StoredFile[]>();
    filesWithSignedUrls
      .filter(Boolean)
      .forEach((entry) => {
        if (!entry) return;
        const list = fileMap.get(entry.recordId) ?? [];
        list.push(entry.file);
        fileMap.set(entry.recordId, list);
      });

    return data.map((record: any) => ({
      id: record.id,
      category: "invoice",
      employeeName: record.employee_name,
      storeNumber: record.store_number,
      createdAt: record.created_at,
      notes: record.notes ?? undefined,
      invoiceNotes: record.invoice_notes ?? undefined,
      invoiceCompany: record.invoice_company ?? undefined,
      invoiceNumber: record.invoice_number ?? undefined,
      invoiceAmountCents:
        typeof record.invoice_amount_cents === "number"
          ? record.invoice_amount_cents
          : record.invoice_amount_cents
            ? Number(record.invoice_amount_cents)
            : undefined,
      invoiceDueDate: record.invoice_due_date ?? undefined,
      invoicePaid: typeof record.invoice_paid === "boolean" ? record.invoice_paid : undefined,
      invoicePaymentMethod: record.invoice_payment_method ?? undefined,
      invoicePaymentDetails: record.invoice_payment_details ?? undefined,
      invoicePaidAmountCents:
        typeof record.invoice_paid_amount_cents === "number"
          ? record.invoice_paid_amount_cents
          : record.invoice_paid_amount_cents
            ? Number(record.invoice_paid_amount_cents)
            : undefined,
      attachments: fileMap.get(record.id) ?? [],
    }));
  }

  const allRecords = await getCombinedRecords({ category: "invoice" });
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Math.max(1, options.days ?? 3));
  const matched = allRecords.filter(
    (record) =>
      record.category === "invoice" &&
      record.storeNumber === options.storeNumber &&
      record.employeeName.toLowerCase() === options.employeeName.toLowerCase() &&
      new Date(record.createdAt) >= cutoff,
  );
  if (matched.length) return matched;
  return allRecords.filter(
    (record) =>
      record.category === "invoice" &&
      record.storeNumber === options.storeNumber &&
      new Date(record.createdAt) >= cutoff,
  );
}

export async function listShiftReports(params: {
  storeId: string;
  date: string;
}): Promise<ShiftReport[]> {
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("shift_reports")
      .select("*")
      .eq("store_id", params.storeId)
      .eq("date", params.date)
      .order("updated_at", { ascending: false });
    if (error) {
      console.error("Supabase shift reports error:", error);
      return [];
    }
    return (data ?? []).map((row: any) => ({
      id: row.id,
      storeId: row.store_id,
      managerId: row.manager_id ?? undefined,
      managerName: row.manager_name ?? undefined,
      employeeId: row.employee_id ?? undefined,
      employeeName: row.employee_name ?? undefined,
      date: row.date,
      grossAmount: Number(row.gross_amount ?? 0),
      liquorAmount: Number(row.liquor_amount ?? 0),
      beerAmount: Number(row.beer_amount ?? 0),
      cigAmount: Number(row.cig_amount ?? 0),
      tobaccoAmount: Number(row.tobacco_amount ?? 0),
      gasAmount: Number(row.gas_amount ?? 0),
      atmAmount: Number(row.atm_amount ?? 0),
      lottoPoAmount: Number(row.lotto_po_amount ?? 0),
      depositAmount: Number(row.deposit_amount ?? 0),
      scrAmount: Number(row.scr_amount ?? 0),
      lottoAmount: Number(row.lotto_amount ?? 0),
      cashAmount: Number(row.cash_amount ?? 0),
      storeAmount: Number(row.store_amount ?? row.net_amount ?? 0),
      netAmount: Number(row.net_amount ?? row.store_amount ?? 0),
      customFields: Array.isArray(row.custom_fields)
        ? row.custom_fields.map((item: any) => ({
            label: item?.label ?? "",
            amount: Number(item?.amount ?? 0),
          }))
        : [],
      investigationFlag: Boolean(row.investigation_flag),
      investigationReason: row.investigation_reason ?? undefined,
      hasScratcherDiscrepancy: Boolean(row.has_scratcher_discrepancy),
      updatedAt: row.updated_at ?? row.created_at ?? new Date().toISOString(),
    }));
  }

  const storage = await readStorage();
  return storage.shiftReports.filter(
    (report) =>
      report.storeId === params.storeId && report.date === params.date,
  );
}

export async function getShiftReportById(
  reportId: string,
): Promise<ShiftReport | null> {
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("shift_reports")
      .select("*")
      .eq("id", reportId)
      .maybeSingle();
    if (error || !data) {
      if (error) console.error("Supabase shift report lookup error:", error);
      return null;
    }
    return {
      id: data.id,
      storeId: data.store_id,
      managerId: data.manager_id ?? undefined,
      managerName: data.manager_name ?? undefined,
      employeeId: data.employee_id ?? undefined,
      employeeName: data.employee_name ?? undefined,
      date: data.date,
      grossAmount: Number(data.gross_amount ?? 0),
      liquorAmount: Number(data.liquor_amount ?? 0),
      beerAmount: Number(data.beer_amount ?? 0),
      cigAmount: Number(data.cig_amount ?? 0),
      tobaccoAmount: Number(data.tobacco_amount ?? 0),
      gasAmount: Number(data.gas_amount ?? 0),
      atmAmount: Number(data.atm_amount ?? 0),
      lottoPoAmount: Number(data.lotto_po_amount ?? 0),
      depositAmount: Number(data.deposit_amount ?? 0),
      scrAmount: Number(data.scr_amount ?? 0),
      lottoAmount: Number(data.lotto_amount ?? 0),
      cashAmount: Number(data.cash_amount ?? 0),
      storeAmount: Number(data.store_amount ?? data.net_amount ?? 0),
      netAmount: Number(data.net_amount ?? data.store_amount ?? 0),
      customFields: Array.isArray(data.custom_fields)
        ? data.custom_fields.map((item: any) => ({
            label: item?.label ?? "",
            amount: Number(item?.amount ?? 0),
          }))
        : [],
      investigationFlag: Boolean(data.investigation_flag),
      investigationReason: data.investigation_reason ?? undefined,
      hasScratcherDiscrepancy: Boolean(data.has_scratcher_discrepancy),
      updatedAt: data.updated_at ?? data.created_at ?? new Date().toISOString(),
    };
  }

  const storage = await readStorage();
  return storage.shiftReports.find((report) => report.id === reportId) ?? null;
}

export async function listShiftReportsRange(params: {
  storeId: string;
  startDate: string;
  endDate: string;
}): Promise<ShiftReport[]> {
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("shift_reports")
      .select("*")
      .eq("store_id", params.storeId)
      .gte("date", params.startDate)
      .lte("date", params.endDate)
      .order("updated_at", { ascending: false });
    if (error) {
      console.error("Supabase shift reports range error:", error);
      return [];
    }
    return (data ?? []).map((row: any) => ({
      id: row.id,
      storeId: row.store_id,
      managerId: row.manager_id ?? undefined,
      managerName: row.manager_name ?? undefined,
      employeeId: row.employee_id ?? undefined,
      employeeName: row.employee_name ?? undefined,
      date: row.date,
      grossAmount: Number(row.gross_amount ?? 0),
      liquorAmount: Number(row.liquor_amount ?? 0),
      beerAmount: Number(row.beer_amount ?? 0),
      cigAmount: Number(row.cig_amount ?? 0),
      tobaccoAmount: Number(row.tobacco_amount ?? 0),
      gasAmount: Number(row.gas_amount ?? 0),
      atmAmount: Number(row.atm_amount ?? 0),
      lottoPoAmount: Number(row.lotto_po_amount ?? 0),
      depositAmount: Number(row.deposit_amount ?? 0),
      scrAmount: Number(row.scr_amount ?? 0),
      lottoAmount: Number(row.lotto_amount ?? 0),
      cashAmount: Number(row.cash_amount ?? 0),
      storeAmount: Number(row.store_amount ?? row.net_amount ?? 0),
      netAmount: Number(row.net_amount ?? row.store_amount ?? 0),
      customFields: Array.isArray(row.custom_fields)
        ? row.custom_fields.map((item: any) => ({
            label: item?.label ?? "",
            amount: Number(item?.amount ?? 0),
          }))
        : [],
      investigationFlag: Boolean(row.investigation_flag),
      investigationReason: row.investigation_reason ?? undefined,
      updatedAt: row.updated_at ?? row.created_at ?? new Date().toISOString(),
    }));
  }

  const storage = await readStorage();
  return storage.shiftReports.filter(
    (report) =>
      report.storeId === params.storeId &&
      report.date >= params.startDate &&
      report.date <= params.endDate,
  );
}

export async function findLatestShiftReportDate(params: {
  storeId: string;
  date: string;
}): Promise<string | null> {
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("shift_reports")
      .select("date")
      .eq("store_id", params.storeId)
      .lte("date", params.date)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("Supabase shift report latest date error:", error);
      return null;
    }
    return data?.date ?? null;
  }

  const storage = await readStorage();
  const latest = storage.shiftReports
    .filter(
      (report) =>
        report.storeId === params.storeId && report.date <= params.date,
    )
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  return latest?.date ?? null;
}

export async function upsertShiftReport(payload: {
  storeId: string;
  employeeId?: string;
  employeeName?: string;
  date: string;
  grossAmount: number;
  liquorAmount: number;
  beerAmount: number;
  cigAmount: number;
  tobaccoAmount: number;
  gasAmount: number;
  atmAmount: number;
  lottoPoAmount: number;
  depositAmount: number;
  scrAmount: number;
  lottoAmount: number;
  cashAmount: number;
  storeAmount: number;
  customFields?: { label: string; amount: number }[];
  managerId?: string;
  managerName?: string;
}): Promise<ShiftReport> {
  const now = new Date().toISOString();
  if (USE_SUPABASE && supabase) {
    const existing = await supabase
      .from("shift_reports")
      .select("id")
      .eq("store_id", payload.storeId)
      .eq("employee_id", payload.employeeId ?? "")
      .eq("date", payload.date)
      .maybeSingle();
    if (existing.error) {
      console.error("Supabase shift report lookup error:", existing.error);
    }
    const recordId = existing.data?.id ?? randomUUID();
    const { error } = await supabase.from("shift_reports").upsert(
      {
        id: recordId,
        store_id: payload.storeId,
        manager_id: payload.managerId ?? null,
        manager_name: payload.managerName ?? null,
        employee_id: payload.employeeId ?? null,
        employee_name: payload.employeeName ?? null,
        date: payload.date,
        scr_amount: payload.scrAmount,
        lotto_amount: payload.lottoAmount,
        gross_amount: payload.grossAmount,
        liquor_amount: payload.liquorAmount,
        beer_amount: payload.beerAmount,
        cig_amount: payload.cigAmount,
        tobacco_amount: payload.tobaccoAmount,
        gas_amount: payload.gasAmount,
        atm_amount: payload.atmAmount,
        lotto_po_amount: payload.lottoPoAmount,
        deposit_amount: payload.depositAmount,
        cash_amount: payload.cashAmount,
        store_amount: payload.storeAmount,
        net_amount: payload.storeAmount,
        custom_fields: payload.customFields ?? [],
        investigation_flag: false,
        updated_at: now,
      },
      { onConflict: "id" },
    );
    if (error) {
      console.error("Supabase shift report upsert error:", error);
    }
    return {
      id: recordId,
      storeId: payload.storeId,
      managerId: payload.managerId,
      managerName: payload.managerName,
      employeeId: payload.employeeId,
      employeeName: payload.employeeName,
      date: payload.date,
      grossAmount: payload.grossAmount,
      liquorAmount: payload.liquorAmount,
      beerAmount: payload.beerAmount,
      cigAmount: payload.cigAmount,
      tobaccoAmount: payload.tobaccoAmount,
      gasAmount: payload.gasAmount,
      atmAmount: payload.atmAmount,
      lottoPoAmount: payload.lottoPoAmount,
      depositAmount: payload.depositAmount,
      scrAmount: payload.scrAmount,
      lottoAmount: payload.lottoAmount,
      cashAmount: payload.cashAmount,
      storeAmount: payload.storeAmount,
      netAmount: payload.storeAmount,
      customFields: payload.customFields,
      investigationFlag: false,
      updatedAt: now,
    };
  }

  const storage = await readStorage();
  const existingIndex = storage.shiftReports.findIndex(
    (report) =>
      report.storeId === payload.storeId &&
      report.employeeId === payload.employeeId &&
      report.date === payload.date,
  );
  const report: ShiftReport = {
    id:
      existingIndex >= 0
        ? storage.shiftReports[existingIndex].id
        : randomUUID(),
    storeId: payload.storeId,
    managerId: payload.managerId,
    managerName: payload.managerName,
    employeeId: payload.employeeId,
    employeeName: payload.employeeName,
    date: payload.date,
    grossAmount: payload.grossAmount,
    liquorAmount: payload.liquorAmount,
    beerAmount: payload.beerAmount,
    cigAmount: payload.cigAmount,
    tobaccoAmount: payload.tobaccoAmount,
    gasAmount: payload.gasAmount,
    atmAmount: payload.atmAmount,
    lottoPoAmount: payload.lottoPoAmount,
    depositAmount: payload.depositAmount,
    scrAmount: payload.scrAmount,
    lottoAmount: payload.lottoAmount,
    cashAmount: payload.cashAmount,
    storeAmount: payload.storeAmount,
    netAmount: payload.storeAmount,
    customFields: payload.customFields,
    investigationFlag: false,
    updatedAt: now,
    hasScratcherDiscrepancy:
      existingIndex >= 0
        ? storage.shiftReports[existingIndex]?.hasScratcherDiscrepancy
        : undefined,
  };
  if (existingIndex >= 0) {
    storage.shiftReports[existingIndex] = report;
  } else {
    storage.shiftReports.unshift(report);
  }
  await writeStorage(storage);
  return report;
}

export async function flagShiftReport(payload: {
  id: string;
  investigationFlag: boolean;
  investigationReason?: string;
}): Promise<ShiftReport | null> {
  const now = new Date().toISOString();
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("shift_reports")
      .update({
        investigation_flag: payload.investigationFlag,
        investigation_reason: payload.investigationReason ?? null,
        updated_at: now,
      })
      .eq("id", payload.id)
      .select("*")
      .maybeSingle();
    if (error || !data) {
      console.error("Supabase shift report flag error:", error);
      return null;
    }
    return {
      id: data.id,
      storeId: data.store_id,
      managerId: data.manager_id,
      managerName: data.manager_name,
      employeeId: data.employee_id ?? undefined,
      employeeName: data.employee_name ?? undefined,
      date: data.date,
      grossAmount: Number(data.gross_amount ?? 0),
      liquorAmount: Number(data.liquor_amount ?? 0),
      beerAmount: Number(data.beer_amount ?? 0),
      cigAmount: Number(data.cig_amount ?? 0),
      tobaccoAmount: Number(data.tobacco_amount ?? 0),
      gasAmount: Number(data.gas_amount ?? 0),
      atmAmount: Number(data.atm_amount ?? 0),
      lottoPoAmount: Number(data.lotto_po_amount ?? 0),
      depositAmount: Number(data.deposit_amount ?? 0),
      scrAmount: Number(data.scr_amount ?? 0),
      lottoAmount: Number(data.lotto_amount ?? 0),
      cashAmount: Number(data.cash_amount ?? 0),
      storeAmount: Number(data.store_amount ?? data.net_amount ?? 0),
      netAmount: Number(data.net_amount ?? data.store_amount ?? 0),
      customFields: Array.isArray(data.custom_fields)
        ? data.custom_fields.map((item: any) => ({
            label: item?.label ?? "",
            amount: Number(item?.amount ?? 0),
          }))
        : [],
      investigationFlag: Boolean(data.investigation_flag),
      investigationReason: data.investigation_reason ?? undefined,
      updatedAt: data.updated_at ?? now,
    };
  }

  const storage = await readStorage();
  const index = storage.shiftReports.findIndex(
    (report) => report.id === payload.id,
  );
  if (index < 0) return null;
  const updated = {
    ...storage.shiftReports[index],
    investigationFlag: payload.investigationFlag,
    investigationReason: payload.investigationReason,
    updatedAt: now,
  };
  storage.shiftReports[index] = updated;
  await writeStorage(storage);
  return updated;
}

export async function listInvestigations(params: {
  storeId: string;
  date: string;
  shiftReportIds?: string[];
}): Promise<InvestigationRecord[]> {
  const { storeId, date, shiftReportIds } = params;
  if (USE_SUPABASE && supabase) {
    let query = supabase
      .from("investigations")
      .select("*")
      .eq("store_id", storeId)
      .eq("date", date);
    if (shiftReportIds && shiftReportIds.length) {
      query = query.in("shift_report_id", shiftReportIds);
    }
    const { data, error } = await query.order("updated_at", {
      ascending: false,
    });
    if (error) {
      console.error("Supabase investigations error:", error);
      return [];
    }
    return (data ?? []).map((row: any) => ({
      id: row.id,
      storeId: row.store_id,
      date: row.date,
      shiftReportId: row.shift_report_id,
      status: (row.status as InvestigationStatus) ?? "none",
      assignedToUserId: row.assigned_to_user_id,
      createdByOwnerId: row.created_by_owner_id,
      createdAt: row.created_at ?? row.updated_at ?? new Date().toISOString(),
      updatedAt: row.updated_at ?? row.created_at ?? new Date().toISOString(),
      notes: row.notes ?? undefined,
    }));
  }

  const storage = await readStorage();
  const filtered = storage.investigations.filter(
    (investigation) =>
      investigation.storeId === storeId && investigation.date === date,
  );
  if (shiftReportIds && shiftReportIds.length) {
    return filtered.filter((investigation) =>
      shiftReportIds.includes(investigation.shiftReportId),
    );
  }
  return filtered;
}

export async function listOpenInvestigations(params: {
  storeIds: string[];
}): Promise<InvestigationRecord[]> {
  const { storeIds } = params;
  if (!storeIds.length) return [];
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("investigations")
      .select("*")
      .in("store_id", storeIds)
      .neq("status", "resolved")
      .order("updated_at", { ascending: false });
    if (error) {
      console.error("Supabase investigations error:", error);
      return [];
    }
    return (data ?? []).map((row: any) => ({
      id: row.id,
      storeId: row.store_id,
      date: row.date,
      shiftReportId: row.shift_report_id,
      status: (row.status as InvestigationStatus) ?? "none",
      assignedToUserId: row.assigned_to_user_id,
      createdByOwnerId: row.created_by_owner_id,
      createdAt: row.created_at ?? row.updated_at ?? new Date().toISOString(),
      updatedAt: row.updated_at ?? row.created_at ?? new Date().toISOString(),
      notes: row.notes ?? undefined,
    }));
  }

  const storage = await readStorage();
  return storage.investigations.filter(
    (record) =>
      storeIds.includes(record.storeId) && record.status !== "resolved",
  );
}

export async function upsertInvestigation(payload: {
  storeId: string;
  date: string;
  shiftReportId: string;
  status: InvestigationStatus;
  assignedToUserId: string;
  createdByOwnerId: string;
  notes?: string;
}): Promise<InvestigationRecord> {
  const now = new Date().toISOString();
  if (USE_SUPABASE && supabase) {
    const existing = await supabase
      .from("investigations")
      .select("id,created_at")
      .eq("shift_report_id", payload.shiftReportId)
      .eq("date", payload.date)
      .maybeSingle();
    if (existing.error) {
      console.error("Supabase investigation lookup error:", existing.error);
    }
    const recordId = existing.data?.id ?? randomUUID();
    const createdAt = existing.data?.created_at ?? now;
    const { error } = await supabase.from("investigations").upsert(
      {
        id: recordId,
        store_id: payload.storeId,
        date: payload.date,
        shift_report_id: payload.shiftReportId,
        status: payload.status,
        assigned_to_user_id: payload.assignedToUserId,
        created_by_owner_id: payload.createdByOwnerId,
        created_at: createdAt,
        updated_at: now,
        notes: payload.notes ?? null,
      },
      { onConflict: "id" },
    );
    if (error) {
      console.error("Supabase investigation upsert error:", error);
    }
    return {
      id: recordId,
      storeId: payload.storeId,
      date: payload.date,
      shiftReportId: payload.shiftReportId,
      status: payload.status,
      assignedToUserId: payload.assignedToUserId,
      createdByOwnerId: payload.createdByOwnerId,
      createdAt,
      updatedAt: now,
      notes: payload.notes,
    };
  }

  const storage = await readStorage();
  const existingIndex = storage.investigations.findIndex(
    (record) =>
      record.shiftReportId === payload.shiftReportId &&
      record.date === payload.date,
  );
  if (existingIndex >= 0) {
    const existing = storage.investigations[existingIndex];
    const updated: InvestigationRecord = {
      ...existing,
      status: payload.status,
      notes: payload.notes ?? existing.notes,
      updatedAt: now,
      assignedToUserId: payload.assignedToUserId,
    };
    storage.investigations[existingIndex] = updated;
    await writeStorage(storage);
    return updated;
  }

  const record: InvestigationRecord = {
    id: randomUUID(),
    storeId: payload.storeId,
    date: payload.date,
    shiftReportId: payload.shiftReportId,
    status: payload.status,
    assignedToUserId: payload.assignedToUserId,
    createdByOwnerId: payload.createdByOwnerId,
    createdAt: now,
    updatedAt: now,
    notes: payload.notes,
  };
  storage.investigations.unshift(record);
  await writeStorage(storage);
  return record;
}

export async function listSurveillanceInvestigations(params: {
  storeIds?: string[];
  reportId?: string;
}): Promise<SurveillanceInvestigationRecord[]> {
  const { storeIds, reportId } = params;
  if (USE_SUPABASE && supabase) {
    let query = supabase.from("surveillance_investigations").select("*");
    if (storeIds && storeIds.length) {
      query = query.in("store_id", storeIds);
    }
    if (reportId) {
      query = query.eq("report_id", reportId);
    }
    const { data, error } = await query.order("updated_at", {
      ascending: false,
    });
    if (error) {
      console.error("Supabase surveillance investigations error:", error);
      return [];
    }
    return (data ?? []).map((row: any) => ({
      id: row.id,
      storeId: row.store_id,
      reportId: row.report_id,
      status: (row.status as InvestigationStatus) ?? "none",
      assignedToUserId: row.assigned_to_user_id,
      createdByOwnerId: row.created_by_owner_id,
      createdAt: row.created_at ?? row.updated_at ?? new Date().toISOString(),
      updatedAt: row.updated_at ?? row.created_at ?? new Date().toISOString(),
      notes: row.notes ?? undefined,
    }));
  }

  const storage = await readStorage();
  let filtered = storage.surveillanceInvestigations;
  if (storeIds && storeIds.length) {
    filtered = filtered.filter((record) => storeIds.includes(record.storeId));
  }
  if (reportId) {
    filtered = filtered.filter((record) => record.reportId === reportId);
  }
  return filtered;
}

export async function listOpenSurveillanceInvestigations(params: {
  storeIds: string[];
}): Promise<SurveillanceInvestigationRecord[]> {
  const { storeIds } = params;
  if (!storeIds.length) return [];
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("surveillance_investigations")
      .select("*")
      .in("store_id", storeIds)
      .neq("status", "resolved")
      .order("updated_at", { ascending: false });
    if (error) {
      console.error("Supabase surveillance investigations error:", error);
      return [];
    }
    return (data ?? []).map((row: any) => ({
      id: row.id,
      storeId: row.store_id,
      reportId: row.report_id,
      status: (row.status as InvestigationStatus) ?? "none",
      assignedToUserId: row.assigned_to_user_id,
      createdByOwnerId: row.created_by_owner_id,
      createdAt: row.created_at ?? row.updated_at ?? new Date().toISOString(),
      updatedAt: row.updated_at ?? row.created_at ?? new Date().toISOString(),
      notes: row.notes ?? undefined,
    }));
  }

  const storage = await readStorage();
  return storage.surveillanceInvestigations.filter(
    (record) =>
      storeIds.includes(record.storeId) && record.status !== "resolved",
  );
}

export async function upsertSurveillanceInvestigation(payload: {
  storeId: string;
  reportId: string;
  status: InvestigationStatus;
  assignedToUserId: string;
  createdByOwnerId: string;
  notes?: string;
}): Promise<SurveillanceInvestigationRecord> {
  const now = new Date().toISOString();
  if (USE_SUPABASE && supabase) {
    const existing = await supabase
      .from("surveillance_investigations")
      .select("id,created_at")
      .eq("report_id", payload.reportId)
      .maybeSingle();
    if (existing.error) {
      console.error(
        "Supabase surveillance investigation lookup error:",
        existing.error,
      );
    }
    const recordId = existing.data?.id ?? randomUUID();
    const createdAt = existing.data?.created_at ?? now;
    const { error } = await supabase.from("surveillance_investigations").upsert(
      {
        id: recordId,
        store_id: payload.storeId,
        report_id: payload.reportId,
        status: payload.status,
        assigned_to_user_id: payload.assignedToUserId,
        created_by_owner_id: payload.createdByOwnerId,
        created_at: createdAt,
        updated_at: now,
        notes: payload.notes ?? null,
      },
      { onConflict: "report_id" },
    );
    if (error) {
      console.error("Supabase surveillance investigation upsert error:", error);
      throw error;
    }
    return {
      id: recordId,
      storeId: payload.storeId,
      reportId: payload.reportId,
      status: payload.status,
      assignedToUserId: payload.assignedToUserId,
      createdByOwnerId: payload.createdByOwnerId,
      createdAt,
      updatedAt: now,
      notes: payload.notes,
    };
  }

  const storage = await readStorage();
  const existingIndex = storage.surveillanceInvestigations.findIndex(
    (record) => record.reportId === payload.reportId,
  );
  if (existingIndex >= 0) {
    const existing = storage.surveillanceInvestigations[existingIndex];
    const updated: SurveillanceInvestigationRecord = {
      ...existing,
      status: payload.status,
      notes: payload.notes ?? existing.notes,
      updatedAt: now,
      assignedToUserId: payload.assignedToUserId,
    };
    storage.surveillanceInvestigations[existingIndex] = updated;
    await writeStorage(storage);
    return updated;
  }

  const record: SurveillanceInvestigationRecord = {
    id: randomUUID(),
    storeId: payload.storeId,
    reportId: payload.reportId,
    status: payload.status,
    assignedToUserId: payload.assignedToUserId,
    createdByOwnerId: payload.createdByOwnerId,
    createdAt: now,
    updatedAt: now,
    notes: payload.notes,
  };
  storage.surveillanceInvestigations.unshift(record);
  await writeStorage(storage);
  return record;
}

export async function listOrderVendors(params: {
  storeIds: string[];
}): Promise<OrderVendor[]> {
  const { storeIds } = params;
  if (!storeIds.length) return [];
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("order_vendors")
      .select("*")
      .in("store_id", storeIds)
      .order("updated_at", { ascending: false });
    if (error) {
      console.error("Supabase order vendors error:", error);
      return [];
    }
    return (data ?? []).map((row: any) => ({
      id: row.id,
      storeId: row.store_id,
      directoryVendorId: row.directory_vendor_id ?? undefined,
      name: row.name,
      repName: row.rep_name ?? undefined,
      contact: row.contact ?? undefined,
      email: row.email ?? undefined,
      createdAt: row.created_at ?? new Date().toISOString(),
      updatedAt: row.updated_at ?? row.created_at ?? new Date().toISOString(),
    }));
  }

  const storage = await readStorage();
  return storage.orderVendors.filter((vendor) =>
    storeIds.includes(vendor.storeId),
  );
}

export async function createOrderVendor(payload: {
  storeId: string;
  directoryVendorId?: string;
  name: string;
  repName?: string;
  contact?: string;
  email?: string;
}): Promise<OrderVendor | null> {
  const now = new Date().toISOString();
  const record: OrderVendor = {
    id: randomUUID(),
    storeId: payload.storeId,
    directoryVendorId: payload.directoryVendorId,
    name: payload.name.trim(),
    repName: payload.repName?.trim() || undefined,
    contact: payload.contact?.trim() || undefined,
    email: payload.email?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  if (USE_SUPABASE && supabase) {
    const { error } = await supabase.from("order_vendors").insert({
      id: record.id,
      store_id: record.storeId,
      directory_vendor_id: record.directoryVendorId ?? null,
      name: record.name,
      rep_name: record.repName ?? null,
      contact: record.contact ?? null,
      email: record.email ?? null,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    });
    if (error) {
      const fallbackPayload: Record<string, unknown> = {
        id: record.id,
        store_id: record.storeId,
        name: record.name,
        rep_name: record.repName ?? null,
        contact: record.contact ?? null,
        email: record.email ?? null,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      };
      const retry = await supabase.from("order_vendors").insert(fallbackPayload);
      if (retry.error) {
        console.error("Supabase order vendor insert error:", retry.error);
        return null;
      }
    }
    return record;
  }

  const storage = await readStorage();
  storage.orderVendors.unshift(record);
  await writeStorage(storage);
  return record;
}

export async function updateOrderVendor(payload: {
  id: string;
  name: string;
  directoryVendorId?: string;
  repName?: string;
  contact?: string;
  email?: string;
}): Promise<OrderVendor | null> {
  const now = new Date().toISOString();
  if (USE_SUPABASE && supabase) {
    const updatePayload: Record<string, unknown> = {
      name: payload.name.trim(),
      rep_name: payload.repName?.trim() || null,
      contact: payload.contact?.trim() || null,
      email: payload.email?.trim() || null,
      updated_at: now,
    };
    if (payload.directoryVendorId !== undefined) {
      updatePayload.directory_vendor_id = payload.directoryVendorId || null;
    }
    const { data, error } = await supabase
      .from("order_vendors")
      .update(updatePayload)
      .eq("id", payload.id)
      .select("*")
      .maybeSingle();
    if (error || !data) {
      console.error("Supabase order vendor update error:", error);
      return null;
    }
    return {
      id: data.id,
      storeId: data.store_id,
      directoryVendorId: data.directory_vendor_id ?? undefined,
      name: data.name,
      repName: data.rep_name ?? undefined,
      contact: data.contact ?? undefined,
      email: data.email ?? undefined,
      createdAt: data.created_at ?? now,
      updatedAt: data.updated_at ?? now,
    };
  }

  const storage = await readStorage();
  const index = storage.orderVendors.findIndex((vendor) => vendor.id === payload.id);
  if (index < 0) return null;
  const current = storage.orderVendors[index];
  const updated: OrderVendor = {
    ...current,
    name: payload.name.trim(),
    directoryVendorId: payload.directoryVendorId ?? current.directoryVendorId,
    repName: payload.repName?.trim() || undefined,
    contact: payload.contact?.trim() || undefined,
    email: payload.email?.trim() || undefined,
    updatedAt: now,
  };
  storage.orderVendors[index] = updated;
  await writeStorage(storage);
  return updated;
}

export async function deleteOrderVendor(id: string): Promise<boolean> {
  if (USE_SUPABASE && supabase) {
    const { error } = await supabase.from("order_vendors").delete().eq("id", id);
    if (error) {
      console.error("Supabase order vendor delete error:", error);
      return false;
    }
    return true;
  }

  const storage = await readStorage();
  const next = storage.orderVendors.filter((vendor) => vendor.id !== id);
  if (next.length === storage.orderVendors.length) return false;
  storage.orderVendors = next;
  await writeStorage(storage);
  return true;
}

function normalizeVendorItemName(value: string) {
  return value.trim().toLowerCase();
}

export async function getOrderVendor(id: string): Promise<OrderVendor | null> {
  if (!id) return null;
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("order_vendors")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) {
      if (error) console.error("Supabase order vendor fetch error:", error);
      return null;
    }
    return {
      id: data.id,
      storeId: data.store_id,
      directoryVendorId: data.directory_vendor_id ?? undefined,
      name: data.name,
      repName: data.rep_name ?? undefined,
      contact: data.contact ?? undefined,
      email: data.email ?? undefined,
      createdAt: data.created_at ?? new Date().toISOString(),
      updatedAt: data.updated_at ?? data.created_at ?? new Date().toISOString(),
    };
  }

  const storage = await readStorage();
  return storage.orderVendors.find((vendor) => vendor.id === id) ?? null;
}

export async function listOrderVendorDirectory(): Promise<OrderVendorDirectory[]> {
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("order_vendor_directory")
      .select("*")
      .order("name", { ascending: true });
    if (!error && (data ?? []).length) {
      return (data ?? []).map((row: any) => ({
        id: row.id,
        name: row.name,
        repName: row.rep_name ?? undefined,
        contact: row.contact ?? undefined,
        email: row.email ?? undefined,
        createdAt: row.created_at ?? new Date().toISOString(),
        updatedAt: row.updated_at ?? row.created_at ?? new Date().toISOString(),
      }));
    }
    if (error) {
      console.error("Supabase vendor directory error:", error);
    }

    const { data: vendors, error: vendorError } = await supabase
      .from("order_vendors")
      .select("*")
      .order("updated_at", { ascending: false });
    if (vendorError) {
      console.error("Supabase vendor directory fallback error:", vendorError);
      return [];
    }
    const seen = new Set<string>();
    const fallback: OrderVendorDirectory[] = [];
    (vendors ?? []).forEach((row: any) => {
      const name = String(row.name ?? "").trim();
      if (!name) return;
      const key = name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      fallback.push({
        id: row.id,
        name,
        repName: row.rep_name ?? undefined,
        contact: row.contact ?? undefined,
        email: row.email ?? undefined,
        createdAt: row.created_at ?? new Date().toISOString(),
        updatedAt: row.updated_at ?? row.created_at ?? new Date().toISOString(),
      });
    });
    return fallback;
  }

  const storage = await readStorage();
  if (storage.orderVendorDirectory.length) {
    return [...storage.orderVendorDirectory].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }
  const seen = new Set<string>();
  const fallback: OrderVendorDirectory[] = [];
  storage.orderVendors.forEach((vendor) => {
    const name = vendor.name.trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    fallback.push({
      id: vendor.id,
      name,
      repName: vendor.repName,
      contact: vendor.contact,
      email: vendor.email,
      createdAt: vendor.createdAt,
      updatedAt: vendor.updatedAt,
    });
  });
  return fallback.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getOrderVendorDirectory(
  id: string,
): Promise<OrderVendorDirectory | null> {
  if (!id) return null;
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("order_vendor_directory")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) {
      if (error) console.error("Supabase vendor directory fetch error:", error);
      return null;
    }
    return {
      id: data.id,
      name: data.name,
      repName: data.rep_name ?? undefined,
      contact: data.contact ?? undefined,
      email: data.email ?? undefined,
      createdAt: data.created_at ?? new Date().toISOString(),
      updatedAt: data.updated_at ?? data.created_at ?? new Date().toISOString(),
    };
  }

  const storage = await readStorage();
  return storage.orderVendorDirectory.find((vendor) => vendor.id === id) ?? null;
}

export async function createOrderVendorDirectory(payload: {
  name: string;
  repName?: string;
  contact?: string;
  email?: string;
}): Promise<OrderVendorDirectory | null> {
  const now = new Date().toISOString();
  const record: OrderVendorDirectory = {
    id: randomUUID(),
    name: payload.name.trim(),
    repName: payload.repName?.trim() || undefined,
    contact: payload.contact?.trim() || undefined,
    email: payload.email?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  if (USE_SUPABASE && supabase) {
    const { error } = await supabase.from("order_vendor_directory").insert({
      id: record.id,
      name: record.name,
      rep_name: record.repName ?? null,
      contact: record.contact ?? null,
      email: record.email ?? null,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    });
    if (error) {
      console.error("Supabase vendor directory insert error:", error);
      return null;
    }
    return record;
  }

  const storage = await readStorage();
  storage.orderVendorDirectory.unshift(record);
  await writeStorage(storage);
  return record;
}

export async function updateOrderVendorDirectory(payload: {
  id: string;
  name: string;
  repName?: string;
  contact?: string;
  email?: string;
}): Promise<OrderVendorDirectory | null> {
  const now = new Date().toISOString();
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("order_vendor_directory")
      .update({
        name: payload.name.trim(),
        rep_name: payload.repName?.trim() || null,
        contact: payload.contact?.trim() || null,
        email: payload.email?.trim() || null,
        updated_at: now,
      })
      .eq("id", payload.id)
      .select("*")
      .maybeSingle();
    if (error || !data) {
      if (error) console.error("Supabase vendor directory update error:", error);
      return null;
    }
    return {
      id: data.id,
      name: data.name,
      repName: data.rep_name ?? undefined,
      contact: data.contact ?? undefined,
      email: data.email ?? undefined,
      createdAt: data.created_at ?? now,
      updatedAt: data.updated_at ?? now,
    };
  }

  const storage = await readStorage();
  const index = storage.orderVendorDirectory.findIndex(
    (vendor) => vendor.id === payload.id,
  );
  if (index < 0) return null;
  const current = storage.orderVendorDirectory[index];
  const updated: OrderVendorDirectory = {
    ...current,
    name: payload.name.trim(),
    repName: payload.repName?.trim() || undefined,
    contact: payload.contact?.trim() || undefined,
    email: payload.email?.trim() || undefined,
    updatedAt: now,
  };
  storage.orderVendorDirectory[index] = updated;
  await writeStorage(storage);
  return updated;
}

export async function listOrderVendorItems(
  directoryVendorId: string,
): Promise<OrderVendorItem[]> {
  if (!directoryVendorId) return [];
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("order_vendor_items")
      .select("*")
      .eq("directory_vendor_id", directoryVendorId)
      .order("product_name", { ascending: true });
    if (error) {
      console.error("Supabase vendor items error:", error);
      return [];
    }
    return (data ?? []).map((row: any) => ({
      id: row.id,
      directoryVendorId: row.directory_vendor_id,
      productName: row.product_name,
      createdAt: row.created_at ?? new Date().toISOString(),
    }));
  }

  const storage = await readStorage();
  return storage.orderVendorItems.filter(
    (item) => item.directoryVendorId === directoryVendorId,
  );
}

export async function listOrderVendorItemSuggestions(params: {
  directoryVendorId?: string;
  vendorId?: string;
}): Promise<string[]> {
  const { directoryVendorId, vendorId } = params;
  if (directoryVendorId) {
    const items = await listOrderVendorItems(directoryVendorId);
    if (items.length) {
      return items.map((item) => item.productName);
    }
  }

  if (!vendorId) return [];

  if (USE_SUPABASE && supabase) {
    const { data: orders, error: ordersError } = await supabase
      .from("weekly_orders")
      .select("id")
      .eq("vendor_id", vendorId);
    if (ordersError) {
      console.error("Supabase vendor order lookup error:", ordersError);
      return [];
    }
    const orderIds = (orders ?? []).map((order: any) => order.id);
    if (!orderIds.length) return [];
    const { data: items, error: itemsError } = await supabase
      .from("weekly_order_items")
      .select("product_name")
      .in("order_id", orderIds);
    if (itemsError) {
      console.error("Supabase vendor item fallback error:", itemsError);
      return [];
    }
    const names = new Set(
      (items ?? []).map((row: any) => String(row.product_name ?? "").trim()),
    );
    return Array.from(names).filter(Boolean).sort();
  }

  const storage = await readStorage();
  const names = new Set<string>();
  storage.weeklyOrders
    .filter((order) => order.vendorId === vendorId)
    .forEach((order) => {
      order.items.forEach((item) => {
        if (item.productName) names.add(item.productName);
      });
    });
  return Array.from(names).sort();
}

export async function addOrderVendorItems(payload: {
  directoryVendorId: string;
  productNames: string[];
}): Promise<void> {
  const { directoryVendorId, productNames } = payload;
  if (!directoryVendorId || productNames.length === 0) return;
  const cleaned = Array.from(
    new Set(
      productNames.map((name) => normalizeVendorItemName(name)).filter(Boolean),
    ),
  );
  if (cleaned.length === 0) return;

  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("order_vendor_items")
      .select("product_name")
      .eq("directory_vendor_id", directoryVendorId);
    if (error) {
      console.error("Supabase vendor items lookup error:", error);
      return;
    }
    const existing = new Set(
      (data ?? []).map((row: any) =>
        normalizeVendorItemName(String(row.product_name ?? "")),
      ),
    );
    const rows = cleaned
      .filter((name) => !existing.has(name))
      .map((name) => ({
        id: randomUUID(),
        directory_vendor_id: directoryVendorId,
        product_name: name,
        created_at: new Date().toISOString(),
      }));
    if (rows.length === 0) return;
    const { error: insertError } = await supabase
      .from("order_vendor_items")
      .insert(rows);
    if (insertError) {
      console.error("Supabase vendor items insert error:", insertError);
    }
    return;
  }

  const storage = await readStorage();
  const existing = new Set(
    storage.orderVendorItems
      .filter((item) => item.directoryVendorId === directoryVendorId)
      .map((item) => normalizeVendorItemName(item.productName)),
  );
  const now = new Date().toISOString();
  cleaned.forEach((name) => {
    if (existing.has(name)) return;
    storage.orderVendorItems.unshift({
      id: randomUUID(),
      directoryVendorId,
      productName: name,
      createdAt: now,
    });
  });
  await writeStorage(storage);
}

export async function listWeeklyOrders(params: {
  storeIds: string[];
  periodType: OrderPeriod;
  periodStart: string;
}): Promise<WeeklyOrder[]> {
  const { storeIds, periodType, periodStart } = params;
  if (!storeIds.length || !periodStart) return [];
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("weekly_orders")
      .select("*")
      .in("store_id", storeIds)
      .eq("period_type", periodType)
      .eq("period_start", periodStart)
      .order("updated_at", { ascending: false });
    if (error) {
      console.error("Supabase weekly orders error:", error);
      return [];
    }
    const orders = (data ?? []).map((row: any) => ({
      id: row.id,
      storeId: row.store_id,
      vendorId: row.vendor_id,
      periodType: row.period_type as OrderPeriod,
      periodStart: row.period_start,
      status: row.status as OrderStatus,
      createdById: row.created_by_id,
      createdByName: row.created_by_name,
      approvedById: row.approved_by_id ?? undefined,
      approvedAt: row.approved_at ?? undefined,
      createdAt: row.created_at ?? new Date().toISOString(),
      updatedAt: row.updated_at ?? row.created_at ?? new Date().toISOString(),
      items: [],
    }));
    const orderIds = orders.map((order) => order.id);
    if (!orderIds.length) return orders;
    const { data: itemsData, error: itemsError } = await supabase
      .from("weekly_order_items")
      .select("*")
      .in("order_id", orderIds);
    if (itemsError) {
      console.error("Supabase weekly order items error:", itemsError);
      return orders;
    }
    const itemsByOrder = new Map<string, WeeklyOrderItem[]>();
    (itemsData ?? []).forEach((row: any) => {
      const entry: WeeklyOrderItem = {
        id: row.id,
        orderId: row.order_id,
        productName: row.product_name,
        unitsOnHand: Number(row.units_on_hand ?? 0),
        unitsToOrder: Number(row.units_to_order ?? 0),
      };
      const existing = itemsByOrder.get(entry.orderId) ?? [];
      existing.push(entry);
      itemsByOrder.set(entry.orderId, existing);
    });
    return orders.map((order) => ({
      ...order,
      items: itemsByOrder.get(order.id) ?? [],
    }));
  }

  const storage = await readStorage();
  return storage.weeklyOrders.filter(
    (order) =>
      storeIds.includes(order.storeId) &&
      order.periodType === periodType &&
      order.periodStart === periodStart,
  );
}

export async function getWeeklyOrder(orderId: string): Promise<WeeklyOrder | null> {
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("weekly_orders")
      .select("*")
      .eq("id", orderId)
      .maybeSingle();
    if (error || !data) {
      if (error) console.error("Supabase weekly order lookup error:", error);
      return null;
    }
    const { data: itemsData, error: itemsError } = await supabase
      .from("weekly_order_items")
      .select("*")
      .eq("order_id", orderId);
    if (itemsError) {
      console.error("Supabase weekly order items error:", itemsError);
    }
    return {
      id: data.id,
      storeId: data.store_id,
      vendorId: data.vendor_id,
      periodType: data.period_type as OrderPeriod,
      periodStart: data.period_start,
      status: data.status as OrderStatus,
      createdById: data.created_by_id,
      createdByName: data.created_by_name,
      approvedById: data.approved_by_id ?? undefined,
      approvedAt: data.approved_at ?? undefined,
      createdAt: data.created_at ?? new Date().toISOString(),
      updatedAt: data.updated_at ?? data.created_at ?? new Date().toISOString(),
      items: (itemsData ?? []).map((row: any) => ({
        id: row.id,
        orderId: row.order_id,
        productName: row.product_name,
        unitsOnHand: Number(row.units_on_hand ?? 0),
        unitsToOrder: Number(row.units_to_order ?? 0),
      })),
    };
  }

  const storage = await readStorage();
  return storage.weeklyOrders.find((order) => order.id === orderId) ?? null;
}

export async function upsertWeeklyOrder(payload: {
  storeId: string;
  vendorId: string;
  periodType: OrderPeriod;
  periodStart: string;
  status: OrderStatus;
  createdById: string;
  createdByName: string;
  approvedById?: string;
  approvedAt?: string;
  items: Array<Pick<WeeklyOrderItem, "productName" | "unitsOnHand" | "unitsToOrder">>;
}): Promise<WeeklyOrder> {
  const now = new Date().toISOString();
  if (USE_SUPABASE && supabase) {
    const existing = await supabase
      .from("weekly_orders")
      .select("id,created_at")
      .eq("store_id", payload.storeId)
      .eq("vendor_id", payload.vendorId)
      .eq("period_type", payload.periodType)
      .eq("period_start", payload.periodStart)
      .maybeSingle();
    if (existing.error) {
      console.error("Supabase weekly order lookup error:", existing.error);
    }
    const recordId = existing.data?.id ?? randomUUID();
    const createdAt = existing.data?.created_at ?? now;
    const { error } = await supabase.from("weekly_orders").upsert(
      {
        id: recordId,
        store_id: payload.storeId,
        vendor_id: payload.vendorId,
        period_type: payload.periodType,
        period_start: payload.periodStart,
        status: payload.status,
        created_by_id: payload.createdById,
        created_by_name: payload.createdByName,
        approved_by_id: payload.approvedById ?? null,
        approved_at: payload.approvedAt ?? null,
        created_at: createdAt,
        updated_at: now,
      },
      { onConflict: "id" },
    );
    if (error) {
      console.error("Supabase weekly order upsert error:", error);
    }
    await supabase.from("weekly_order_items").delete().eq("order_id", recordId);
    if (payload.items.length) {
      const itemRecords = payload.items.map((item) => ({
        id: randomUUID(),
        order_id: recordId,
        product_name: item.productName,
        units_on_hand: item.unitsOnHand,
        units_to_order: item.unitsToOrder,
      }));
      const { error: itemsError } = await supabase
        .from("weekly_order_items")
        .insert(itemRecords);
      if (itemsError) {
        console.error("Supabase weekly order items insert error:", itemsError);
      }
    }
    return {
      id: recordId,
      storeId: payload.storeId,
      vendorId: payload.vendorId,
      periodType: payload.periodType,
      periodStart: payload.periodStart,
      status: payload.status,
      createdById: payload.createdById,
      createdByName: payload.createdByName,
      approvedById: payload.approvedById,
      approvedAt: payload.approvedAt,
      createdAt,
      updatedAt: now,
      items: payload.items.map((item) => ({
        id: randomUUID(),
        orderId: recordId,
        productName: item.productName,
        unitsOnHand: item.unitsOnHand,
        unitsToOrder: item.unitsToOrder,
      })),
    };
  }

  const storage = await readStorage();
  const existingIndex = storage.weeklyOrders.findIndex(
    (order) =>
      order.storeId === payload.storeId &&
      order.vendorId === payload.vendorId &&
      order.periodType === payload.periodType &&
      order.periodStart === payload.periodStart,
  );
  const recordId =
    existingIndex >= 0 ? storage.weeklyOrders[existingIndex].id : randomUUID();
  const createdAt =
    existingIndex >= 0 ? storage.weeklyOrders[existingIndex].createdAt : now;
  const items: WeeklyOrderItem[] = payload.items.map((item) => ({
    id: randomUUID(),
    orderId: recordId,
    productName: item.productName,
    unitsOnHand: item.unitsOnHand,
    unitsToOrder: item.unitsToOrder,
  }));
  const order: WeeklyOrder = {
    id: recordId,
    storeId: payload.storeId,
    vendorId: payload.vendorId,
    periodType: payload.periodType,
    periodStart: payload.periodStart,
    status: payload.status,
    createdById: payload.createdById,
    createdByName: payload.createdByName,
    approvedById: payload.approvedById,
    approvedAt: payload.approvedAt,
    createdAt,
    updatedAt: now,
    items,
  };
  if (existingIndex >= 0) {
    storage.weeklyOrders[existingIndex] = order;
  } else {
    storage.weeklyOrders.unshift(order);
  }
  await writeStorage(storage);
  return order;
}

export async function updateWeeklyOrder(payload: {
  id: string;
  status?: OrderStatus;
  approvedById?: string | null;
  approvedAt?: string | null;
  items?: Array<Pick<WeeklyOrderItem, "productName" | "unitsOnHand" | "unitsToOrder">>;
}): Promise<WeeklyOrder | null> {
  const now = new Date().toISOString();
  if (USE_SUPABASE && supabase) {
    const updatePayload: Record<string, any> = { updated_at: now };
    if (payload.status !== undefined) {
      updatePayload.status = payload.status;
    }
    if (payload.approvedById !== undefined) {
      updatePayload.approved_by_id = payload.approvedById;
    }
    if (payload.approvedAt !== undefined) {
      updatePayload.approved_at = payload.approvedAt;
    }
    const { data, error } = await supabase
      .from("weekly_orders")
      .update(updatePayload)
      .eq("id", payload.id)
      .select("*")
      .maybeSingle();
    if (error || !data) {
      console.error("Supabase weekly order update error:", error);
      return null;
    }
    if (payload.items) {
      await supabase
        .from("weekly_order_items")
        .delete()
        .eq("order_id", payload.id);
      if (payload.items.length) {
        const itemRecords = payload.items.map((item) => ({
          id: randomUUID(),
          order_id: payload.id,
          product_name: item.productName,
          units_on_hand: item.unitsOnHand,
          units_to_order: item.unitsToOrder,
        }));
        const { error: itemsError } = await supabase
          .from("weekly_order_items")
          .insert(itemRecords);
        if (itemsError) {
          console.error("Supabase weekly order items update error:", itemsError);
        }
      }
    }
    const { data: itemsData } = await supabase
      .from("weekly_order_items")
      .select("*")
      .eq("order_id", payload.id);
    return {
      id: data.id,
      storeId: data.store_id,
      vendorId: data.vendor_id,
      periodType: data.period_type as OrderPeriod,
      periodStart: data.period_start,
      status: data.status as OrderStatus,
      createdById: data.created_by_id,
      createdByName: data.created_by_name,
      approvedById: data.approved_by_id ?? undefined,
      approvedAt: data.approved_at ?? undefined,
      createdAt: data.created_at ?? now,
      updatedAt: data.updated_at ?? now,
      items: (itemsData ?? []).map((row: any) => ({
        id: row.id,
        orderId: row.order_id,
        productName: row.product_name,
        unitsOnHand: Number(row.units_on_hand ?? 0),
        unitsToOrder: Number(row.units_to_order ?? 0),
      })),
    };
  }

  const storage = await readStorage();
  const index = storage.weeklyOrders.findIndex((order) => order.id === payload.id);
  if (index < 0) return null;
  const current = storage.weeklyOrders[index];
  const items =
    payload.items?.map((item) => ({
      id: randomUUID(),
      orderId: current.id,
      productName: item.productName,
      unitsOnHand: item.unitsOnHand,
      unitsToOrder: item.unitsToOrder,
    })) ?? current.items;
  const updated: WeeklyOrder = {
    ...current,
    status: payload.status ?? current.status,
    approvedById:
      payload.approvedById === undefined ? current.approvedById : payload.approvedById ?? undefined,
    approvedAt:
      payload.approvedAt === undefined ? current.approvedAt : payload.approvedAt ?? undefined,
    updatedAt: now,
    items,
  };
  storage.weeklyOrders[index] = updated;
  await writeStorage(storage);
  return updated;
}

export async function listWeeklyOrderMessages(params: {
  orderId: string;
}): Promise<OrderMessage[]> {
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("weekly_order_messages")
      .select("*")
      .eq("order_id", params.orderId)
      .order("created_at", { ascending: true });
    if (error) {
      console.error("Supabase weekly order messages error:", error);
      return [];
    }
    return (data ?? []).map((row: any) => ({
      id: row.id,
      orderId: row.order_id,
      senderRole: row.sender_role,
      senderName: row.sender_name,
      message: row.message,
      createdAt: row.created_at ?? new Date().toISOString(),
    }));
  }

  const storage = await readStorage();
  return storage.orderMessages
    .filter((message) => message.orderId === params.orderId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export async function addWeeklyOrderMessage(payload: {
  orderId: string;
  senderRole: OrderMessage["senderRole"];
  senderName: string;
  message: string;
}): Promise<OrderMessage> {
  const record: OrderMessage = {
    id: randomUUID(),
    orderId: payload.orderId,
    senderRole: payload.senderRole,
    senderName: payload.senderName,
    message: payload.message,
    createdAt: new Date().toISOString(),
  };
  if (USE_SUPABASE && supabase) {
    const { error } = await supabase.from("weekly_order_messages").insert({
      id: record.id,
      order_id: record.orderId,
      sender_role: record.senderRole,
      sender_name: record.senderName,
      message: record.message,
      created_at: record.createdAt,
    });
    if (error) {
      console.error("Supabase weekly order message insert error:", error);
    }
    return record;
  }

  const storage = await readStorage();
  storage.orderMessages.push(record);
  await writeStorage(storage);
  return record;
}

export async function listStoreNumbers(): Promise<string[]> {
  const storage = await readStorage();
  const stores = new Set<string>();
  storage.shiftSubmissions.forEach((submission) =>
    stores.add(submission.storeNumber),
  );
  storage.reports.forEach((report) => stores.add(report.storeNumber));
  storage.surveillanceReports.forEach((entry) =>
    stores.add(entry.storeNumber),
  );
  storage.invoices.forEach((invoice) => stores.add(invoice.storeNumber));
  mockUsers
    .filter((user) => user.role !== "ironhand")
    .forEach((user) => stores.add(user.storeNumber));
  return Array.from(stores).sort();
}

export async function deleteRecordById(id: string) {
  const storage = await readStorage();
  const shiftIndex = storage.shiftSubmissions.findIndex(
    (submission) => submission.id === id,
  );

  if (shiftIndex >= 0) {
    const [removed] = storage.shiftSubmissions.splice(shiftIndex, 1);
    await writeStorage(storage);
    await Promise.all([
      deleteStoredFile(removed.scratcherVideo.path),
      deleteStoredFile(removed.cashPhoto.path),
      deleteStoredFile(removed.salesPhoto.path),
    ]);
    return {
      success: true,
      storeNumber: removed.storeNumber,
      category: "shift" as const,
    };
  }

  const reportIndex = storage.reports.findIndex((report) => report.id === id);
  if (reportIndex >= 0) {
    const [removed] = storage.reports.splice(reportIndex, 1);
    await writeStorage(storage);
    await Promise.all(
      removed.attachments.map((file) => deleteStoredFile(file.path)),
    );
    return {
      success: true,
      storeNumber: removed.storeNumber,
      category: removed.reportType,
    };
  }

  const invoiceIndex = storage.invoices.findIndex(
    (invoice) => invoice.id === id,
  );
  if (invoiceIndex >= 0) {
    const [removed] = storage.invoices.splice(invoiceIndex, 1);
    await writeStorage(storage);
    await Promise.all(
      removed.attachments.map((file) => deleteStoredFile(file.path)),
    );
    return {
      success: true,
      storeNumber: removed.storeNumber,
      category: "invoice" as const,
    };
  }

  return { success: false as const };
}

export async function deleteRecordsForStore(storeNumber: string) {
  const storage = await readStorage();
  let changed = false;

  const remainingShifts = [];
  for (const submission of storage.shiftSubmissions) {
    if (submission.storeNumber === storeNumber) {
      changed = true;
      await Promise.all([
        deleteStoredFile(submission.scratcherVideo.path),
        deleteStoredFile(submission.cashPhoto.path),
        deleteStoredFile(submission.salesPhoto.path),
      ]);
    } else {
      remainingShifts.push(submission);
    }
  }

  const remainingReports = [];
  for (const report of storage.reports) {
    if (report.storeNumber === storeNumber) {
      changed = true;
      await Promise.all(
        report.attachments.map((file) => deleteStoredFile(file.path)),
      );
    } else {
      remainingReports.push(report);
    }
  }

  const remainingShiftReports = storage.shiftReports.filter(
    (report) => report.storeId !== storeNumber,
  );
  if (remainingShiftReports.length !== storage.shiftReports.length) {
    changed = true;
  }

  const remainingInvestigations = storage.investigations.filter(
    (record) => record.storeId !== storeNumber,
  );
  if (remainingInvestigations.length !== storage.investigations.length) {
    changed = true;
  }

  const remainingSurveillanceInvestigations =
    storage.surveillanceInvestigations.filter(
      (record) => record.storeId !== storeNumber,
    );
  if (
    remainingSurveillanceInvestigations.length !==
    storage.surveillanceInvestigations.length
  ) {
    changed = true;
  }

  const remainingSurveillance = [];
  for (const entry of storage.surveillanceReports) {
    if (entry.storeNumber === storeNumber) {
      changed = true;
      await Promise.all(
        entry.attachments.map((file) => deleteStoredFile(file.path)),
      );
    } else {
      remainingSurveillance.push(entry);
    }
  }

  const remainingOrderVendors = storage.orderVendors.filter(
    (vendor) => vendor.storeId !== storeNumber,
  );
  if (remainingOrderVendors.length !== storage.orderVendors.length) {
    changed = true;
  }

  const remainingWeeklyOrders = storage.weeklyOrders.filter(
    (order) => order.storeId !== storeNumber,
  );
  if (remainingWeeklyOrders.length !== storage.weeklyOrders.length) {
    changed = true;
  }

  const remainingOrderMessages = storage.orderMessages.filter((message) =>
    remainingWeeklyOrders.some((order) => order.id === message.orderId),
  );
  if (remainingOrderMessages.length !== storage.orderMessages.length) {
    changed = true;
  }

  const remainingInvoices = [];
  for (const invoice of storage.invoices) {
    if (invoice.storeNumber === storeNumber) {
      changed = true;
      await Promise.all(
        invoice.attachments.map((file) => deleteStoredFile(file.path)),
      );
    } else {
      remainingInvoices.push(invoice);
    }
  }

  if (changed) {
    await writeStorage({
      shiftSubmissions: remainingShifts,
      shiftReports: remainingShiftReports,
      investigations: remainingInvestigations,
      surveillanceInvestigations: remainingSurveillanceInvestigations,
      reports: remainingReports,
      surveillanceReports: remainingSurveillance,
      orderVendors: remainingOrderVendors,
      orderVendorDirectory: storage.orderVendorDirectory,
      orderVendorItems: storage.orderVendorItems,
      weeklyOrders: remainingWeeklyOrders,
      orderMessages: remainingOrderMessages,
      invoices: remainingInvoices,
      ownerSeenItems: storage.ownerSeenItems.filter(
        (item) => item.storeId !== storeNumber,
      ),
    });
  }
}

type OwnerSeenItemInput = {
  ownerId: string;
  storeId: string;
  itemType: OwnerSeenType;
  itemId: string;
};

async function listOwnerSeenItems(params: {
  ownerId: string;
  itemTypes: OwnerSeenType[];
  storeIds?: string[];
}): Promise<OwnerSeenItem[]> {
  const { ownerId, itemTypes, storeIds } = params;
  if (!ownerId || itemTypes.length === 0) return [];
  if (USE_SUPABASE && supabase) {
    let query = supabase
      .from("owner_seen_items")
      .select("id, owner_id, store_id, item_type, item_id, seen_at")
      .eq("owner_id", ownerId)
      .in("item_type", itemTypes);
    if (storeIds && storeIds.length) {
      query = query.in("store_id", storeIds);
    }
    const { data, error } = await query;
    if (error) {
      console.error("Supabase owner seen items error:", error);
      return [];
    }
    return (data ?? []).map((row: any) => ({
      id: row.id,
      ownerId: row.owner_id,
      storeId: row.store_id,
      itemType: row.item_type,
      itemId: row.item_id,
      seenAt: row.seen_at,
    }));
  }
  const storage = await readStorage();
  return storage.ownerSeenItems.filter((item) => {
    if (item.ownerId !== ownerId) return false;
    if (!itemTypes.includes(item.itemType)) return false;
    if (storeIds && storeIds.length && !storeIds.includes(item.storeId)) return false;
    return true;
  });
}

export async function markOwnerSeenItems(
  items: OwnerSeenItemInput[],
): Promise<void> {
  if (!items.length) return;
  if (USE_SUPABASE && supabase) {
    const payload = items.map((item) => ({
      owner_id: item.ownerId,
      store_id: item.storeId,
      item_type: item.itemType,
      item_id: item.itemId,
      seen_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from("owner_seen_items")
      .upsert(payload, { onConflict: "owner_id,item_type,item_id" });
    if (error) {
      console.error("Supabase owner seen upsert error:", error);
      throw error;
    }
    return;
  }

  const storage = await readStorage();
  const map = new Map(
    storage.ownerSeenItems.map((item) => [
      `${item.ownerId}:${item.itemType}:${item.itemId}`,
      item,
    ]),
  );
  items.forEach((item) => {
    const key = `${item.ownerId}:${item.itemType}:${item.itemId}`;
    map.set(key, {
      id: map.get(key)?.id ?? randomUUID(),
      ownerId: item.ownerId,
      storeId: item.storeId,
      itemType: item.itemType,
      itemId: item.itemId,
      seenAt: new Date().toISOString(),
    });
  });
  storage.ownerSeenItems = Array.from(map.values());
  await writeStorage(storage);
}

async function listItemsForType(params: {
  type: OwnerSeenType;
  storeIds?: string[];
  ownerId?: string;
}): Promise<Array<{ id: string; storeId: string }>> {
  const { type, storeIds, ownerId } = params;
  if (USE_SUPABASE && supabase) {
    if (type === "shift") {
      let query = supabase.from("shift_reports").select("id, store_id");
      if (storeIds && storeIds.length) query = query.in("store_id", storeIds);
      const { data, error } = await query;
      if (error) {
        console.error("Supabase shift reports query error:", error);
        return [];
      }
      return (data ?? []).map((row: any) => ({
        id: row.id,
        storeId: row.store_id,
      }));
    }
    if (type === "full-day") {
      let query = supabase
        .from("records")
        .select("id, store_number")
        .eq("category", "daily");
      if (storeIds && storeIds.length) {
        query = query.in("store_number", storeIds);
      }
      const { data, error } = await query;
      if (error) {
        console.error("Supabase daily records query error:", error);
        return [];
      }
      return (data ?? []).map((row: any) => ({
        id: row.id,
        storeId: row.store_number,
      }));
    }
    if (type === "surveillance" || type === "invoice") {
      let query = supabase
        .from("records")
        .select("id, store_number")
        .eq("category", type === "surveillance" ? "surveillance" : "invoice");
      if (storeIds && storeIds.length) {
        query = query.in("store_number", storeIds);
      }
      const { data, error } = await query;
      if (error) {
        console.error("Supabase records query error:", error);
        return [];
      }
      return (data ?? []).map((row: any) => ({
        id: row.id,
        storeId: row.store_number,
      }));
    }
    if (type === "order") {
      let query = supabase.from("weekly_orders").select("id, store_id");
      if (storeIds && storeIds.length) query = query.in("store_id", storeIds);
      const { data, error } = await query;
      if (error) {
        console.error("Supabase weekly orders query error:", error);
        return [];
      }
      return (data ?? []).map((row: any) => ({
        id: row.id,
        storeId: row.store_id,
      }));
    }
    if (type === "chat-manager" || type === "chat-surveillance" || type === "chat-owner") {
      if (!ownerId) return [];
      const chatType =
        type === "chat-manager"
          ? "manager"
          : type === "chat-surveillance"
            ? "surveillance"
            : "owner";
      let query = supabase
        .from("store_chat_messages")
        .select("id, store_id, sender_role")
        .eq("chat_type", chatType)
        .eq("owner_id", ownerId)
        .neq("sender_role", "owner");
      if (storeIds && storeIds.length) {
        query = query.in("store_id", storeIds);
      }
      const { data, error } = await query;
      if (error) {
        console.error("Supabase chat messages query error:", error);
        return [];
      }
      return (data ?? []).map((row: any) => ({
        id: row.id,
        storeId: row.store_id,
      }));
    }
    return [];
  }

  const storage = await readStorage();
  const filterStore = (storeId: string) =>
    !storeIds || !storeIds.length || storeIds.includes(storeId);
  if (type === "shift") {
    return storage.shiftReports
      .filter((report) => filterStore(report.storeId))
      .map((report) => ({ id: report.id, storeId: report.storeId }));
  }
  if (type === "full-day") {
    return storage.reports
      .filter((report) => report.reportType === "daily")
      .filter((report) => filterStore(report.storeNumber))
      .map((report) => ({ id: report.id, storeId: report.storeNumber }));
  }
  if (type === "surveillance") {
    return storage.surveillanceReports
      .filter((report) => filterStore(report.storeNumber))
      .map((report) => ({ id: report.id, storeId: report.storeNumber }));
  }
  if (type === "invoice") {
    return storage.invoices
      .filter((report) => filterStore(report.storeNumber))
      .map((report) => ({ id: report.id, storeId: report.storeNumber }));
  }
  if (type === "order") {
    return storage.weeklyOrders
      .filter((order) => filterStore(order.storeId))
      .map((order) => ({ id: order.id, storeId: order.storeId }));
  }
  if (type === "chat-manager" || type === "chat-surveillance" || type === "chat-owner") {
    return [];
  }
  return [];
}

export async function listOwnerUnseenCounts(params: {
  ownerId: string;
  type: "reports" | OwnerSeenType;
  storeIds?: string[];
  storeId?: string;
}): Promise<{ counts: Record<string, number>; unseenIds: string[] }> {
  const { ownerId, type, storeIds, storeId } = params;
  const scopeStores = storeId ? [storeId] : storeIds;
  const counts: Record<string, number> = {};
  const unseenIds: string[] = [];

  if (type === "reports") {
    const items = [
      ...(await listItemsForType({ type: "shift", storeIds: scopeStores, ownerId })),
      ...(await listItemsForType({ type: "full-day", storeIds: scopeStores, ownerId })),
    ];
    const seen = await listOwnerSeenItems({
      ownerId,
      itemTypes: ["shift", "full-day"],
      storeIds: scopeStores,
    });
    const seenSet = new Set(seen.map((item) => `${item.itemType}:${item.itemId}`));
    items.forEach((item) => {
      const seenKeyShift = `shift:${item.id}`;
      const seenKeyDaily = `full-day:${item.id}`;
      const isSeen = seenSet.has(seenKeyShift) || seenSet.has(seenKeyDaily);
      if (!isSeen) {
        counts[item.storeId] = (counts[item.storeId] ?? 0) + 1;
        if (storeId && item.storeId === storeId) {
          unseenIds.push(item.id);
        }
      }
    });
    return { counts, unseenIds };
  }

  const items = await listItemsForType({ type, storeIds: scopeStores, ownerId });
  const seen = await listOwnerSeenItems({
    ownerId,
    itemTypes: [type],
    storeIds: scopeStores,
  });
  const seenSet = new Set(seen.map((item) => item.itemId));
  items.forEach((item) => {
    if (!seenSet.has(item.id)) {
      counts[item.storeId] = (counts[item.storeId] ?? 0) + 1;
      if (storeId && item.storeId === storeId) {
        unseenIds.push(item.id);
      }
    }
  });
  return { counts, unseenIds };
}

type DbReportConfig = {
  store_id: string;
  owner_id?: string | null;
  items: ReportItemConfig[];
  created_at?: string;
  updated_at?: string;
};

function toReportConfig(row: DbReportConfig): StoreReportConfig {
  return {
    storeId: row.store_id,
    ownerId: row.owner_id ?? undefined,
    items: Array.isArray(row.items) ? row.items : [],
    createdAt: row.created_at ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? row.created_at ?? new Date().toISOString(),
  };
}

export async function getStoreReportConfig(
  storeId: string,
): Promise<StoreReportConfig | null> {
  if (!storeId) return null;
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("store_report_configs")
      .select("store_id, owner_id, items, created_at, updated_at")
      .eq("store_id", storeId)
      .maybeSingle();
    if (error) {
      console.error("Supabase report config error:", error);
    }
    return data ? toReportConfig(data as DbReportConfig) : null;
  }

  const storage = await readStorage();
  return (
    storage.storeReportConfigs?.find((config) => config.storeId === storeId) ??
    null
  );
}

export async function listStoreReportConfigs(
  storeIds: string[],
): Promise<StoreReportConfig[]> {
  const filteredIds = (storeIds ?? []).filter(Boolean);
  if (!filteredIds.length) return [];
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("store_report_configs")
      .select("store_id, owner_id, items, created_at, updated_at")
      .in("store_id", filteredIds);
    if (error) {
      console.error("Supabase report config list error:", error);
      return [];
    }
    return (data ?? []).map((row) => toReportConfig(row as DbReportConfig));
  }

  const storage = await readStorage();
  return (storage.storeReportConfigs ?? []).filter((config) =>
    filteredIds.includes(config.storeId),
  );
}

export async function upsertStoreReportConfig(payload: {
  storeId: string;
  ownerId?: string;
  items: ReportItemConfig[];
}): Promise<StoreReportConfig> {
  const timestamp = new Date().toISOString();
  const record: StoreReportConfig = {
    storeId: payload.storeId,
    ownerId: payload.ownerId,
    items: payload.items,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("store_report_configs")
      .upsert(
        {
          store_id: payload.storeId,
          owner_id: payload.ownerId ?? null,
          items: payload.items,
          updated_at: timestamp,
        },
        { onConflict: "store_id" },
      )
      .select("store_id, owner_id, items, created_at, updated_at")
      .maybeSingle();
    if (error) {
      console.error("Supabase report config upsert error:", error);
    }
    if (data) {
      return toReportConfig(data as DbReportConfig);
    }
  }

  const storage = await readStorage();
  const list = storage.storeReportConfigs ?? [];
  const existingIndex = list.findIndex((config) => config.storeId === payload.storeId);
  if (existingIndex >= 0) {
    list[existingIndex] = {
      ...list[existingIndex],
      items: payload.items,
      ownerId: payload.ownerId ?? list[existingIndex].ownerId,
      updatedAt: timestamp,
    };
  } else {
    list.push(record);
  }
  storage.storeReportConfigs = list;
  await writeStorage(storage);
  return existingIndex >= 0 ? list[existingIndex] : record;
}

const SCRATCHER_JUMP_THRESHOLD = 100;

const parseTicketNumber = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

export async function ensureShiftReportDraft(params: {
  storeId: string;
  employeeId: string;
  employeeName?: string;
  date: string;
}): Promise<ShiftReport> {
  const existing = await listShiftReports({
    storeId: params.storeId,
    date: params.date,
  });
  const match = existing.find((report) => report.employeeId === params.employeeId);
  if (match) return match;

  return upsertShiftReport({
    storeId: params.storeId,
    employeeId: params.employeeId,
    employeeName: params.employeeName,
    date: params.date,
    grossAmount: 0,
    liquorAmount: 0,
    beerAmount: 0,
    cigAmount: 0,
    tobaccoAmount: 0,
    gasAmount: 0,
    atmAmount: 0,
    lottoPoAmount: 0,
    depositAmount: 0,
    scrAmount: 0,
    lottoAmount: 0,
    cashAmount: 0,
    storeAmount: 0,
    customFields: [],
  });
}

export async function createBaselineShiftReport(params: {
  storeId: string;
  createdById: string;
  createdByName?: string;
}): Promise<ShiftReport> {
  const date = `baseline-${new Date().toISOString()}`;
  return upsertShiftReport({
    storeId: params.storeId,
    employeeId: params.createdById,
    employeeName: params.createdByName,
    date,
    grossAmount: 0,
    liquorAmount: 0,
    beerAmount: 0,
    cigAmount: 0,
    tobaccoAmount: 0,
    gasAmount: 0,
    atmAmount: 0,
    lottoPoAmount: 0,
    depositAmount: 0,
    scrAmount: 0,
    lottoAmount: 0,
    cashAmount: 0,
    storeAmount: 0,
    customFields: [],
  });
}

export async function upsertScratcherProduct(payload: {
  id?: string;
  name?: string | null;
  price: number;
  isActive?: boolean;
}): Promise<ScratcherProduct | null> {
  const now = new Date().toISOString();
  const recordId = payload.id ?? randomUUID();
  const isActive = payload.isActive ?? true;

  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("scratcher_products")
      .upsert(
        {
          id: recordId,
          name: payload.name ?? null,
          price: payload.price,
          is_active: isActive,
        },
        { onConflict: "id" },
      )
      .select("*")
      .maybeSingle();
    if (error || !data) {
      console.error("Supabase scratcher product upsert error:", error);
      return null;
    }
    return {
      id: data.id,
      name: data.name ?? undefined,
      price: Number(data.price ?? 0),
      isActive: Boolean(data.is_active),
      createdAt: data.created_at ?? now,
    };
  }

  const storage = await readStorage();
  const list = storage.scratcherProducts ?? [];
  const existingIndex = list.findIndex((item) => item.id === recordId);
  const record: ScratcherProduct = {
    id: recordId,
    name: payload.name ?? undefined,
    price: payload.price,
    isActive,
    createdAt: now,
  };
  if (existingIndex >= 0) {
    list[existingIndex] = { ...list[existingIndex], ...record };
  } else {
    list.push(record);
  }
  storage.scratcherProducts = list;
  await writeStorage(storage);
  return record;
}

const STANDARD_SCRATCHER_PRICES = [1, 2, 3, 5, 10, 20, 25, 30, 40];

const normalizeScratcherProducts = (products: ScratcherProduct[]) => {
  const priceToActive = new Map<number, ScratcherProduct>();
  const toDeactivateIds = new Set<string>();
  const seenPrices = new Set<number>();

  for (const product of products) {
    const price = Number(product.price);
    if (!Number.isFinite(price) || price <= 0) {
      if (product.isActive) {
        toDeactivateIds.add(product.id);
      }
      continue;
    }
    seenPrices.add(price);
    if (product.isActive) {
      if (!priceToActive.has(price)) {
        priceToActive.set(price, product);
      } else {
        toDeactivateIds.add(product.id);
      }
    }
  }

  const missingPrices = STANDARD_SCRATCHER_PRICES.filter((price) => !seenPrices.has(price));

  return { missingPrices, toDeactivateIds };
};

export async function listScratcherProducts(): Promise<ScratcherProduct[]> {
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("scratcher_products")
      .select("*")
      .order("price", { ascending: true });
    if (error || !data) {
      console.error("Supabase scratcher products error:", error);
      return [];
    }
    const mapped = data.map((item) => ({
      id: item.id,
      name: item.name ?? undefined,
      price: Number(item.price ?? 0),
      isActive: Boolean(item.is_active),
      createdAt: item.created_at ?? new Date().toISOString(),
    }));
    const { missingPrices, toDeactivateIds } = normalizeScratcherProducts(mapped);
    const updatesNeeded = missingPrices.length > 0 || toDeactivateIds.size > 0;

    if (updatesNeeded) {
      if (missingPrices.length > 0) {
        const inserts = missingPrices.map((price) => ({
          id: randomUUID(),
          name: null,
          price,
          is_active: true,
        }));
        const insertResult = await supabase.from("scratcher_products").insert(inserts);
        if (insertResult.error) {
          console.error("Supabase scratcher products insert error:", insertResult.error);
        }
      }
      if (toDeactivateIds.size > 0) {
        const deactivateResult = await supabase
          .from("scratcher_products")
          .update({ is_active: false })
          .in("id", Array.from(toDeactivateIds));
        if (deactivateResult.error) {
          console.error("Supabase scratcher products deactivate error:", deactivateResult.error);
        }
      }
      const { data: refreshed, error: refreshError } = await supabase
        .from("scratcher_products")
        .select("*")
        .order("price", { ascending: true });
      if (!refreshError && refreshed) {
        return refreshed.map((item) => ({
          id: item.id,
          name: item.name ?? undefined,
          price: Number(item.price ?? 0),
          isActive: Boolean(item.is_active),
          createdAt: item.created_at ?? new Date().toISOString(),
        }));
      }
    }

    return mapped;
  }

  const storage = await readStorage();
  const list = (storage.scratcherProducts ?? []).slice();
  const { missingPrices, toDeactivateIds } = normalizeScratcherProducts(list);
  if (missingPrices.length > 0) {
    const now = new Date().toISOString();
    missingPrices.forEach((price) => {
      list.push({
        id: randomUUID(),
        name: undefined,
        price,
        isActive: true,
        createdAt: now,
      });
    });
  }
  if (toDeactivateIds.size > 0) {
    list.forEach((item, index) => {
      if (toDeactivateIds.has(item.id)) {
        list[index] = { ...item, isActive: false };
      }
    });
  }
  list.sort((a, b) => a.price - b.price);
  storage.scratcherProducts = list;
  await writeStorage(storage);
  return list;
}

export async function initScratcherSlots(storeId: string): Promise<ScratcherSlot[]> {
  if (USE_SUPABASE && supabase) {
    const { data: existing, error } = await supabase
      .from("scratcher_slots")
      .select("*")
      .eq("store_id", storeId);
    if (error) {
      console.error("Supabase scratcher slots load error:", error);
      return [];
    }
    const existingNumbers = new Set((existing ?? []).map((slot) => slot.slot_number));
    const missing = Array.from({ length: 32 }, (_, i) => i + 1).filter(
      (slotNumber) => !existingNumbers.has(slotNumber),
    );
    if (missing.length) {
      const inserts = missing.map((slotNumber) => ({
        store_id: storeId,
        slot_number: slotNumber,
      }));
      const insertResult = await supabase.from("scratcher_slots").insert(inserts);
      if (insertResult.error) {
        console.error("Supabase scratcher slots insert error:", insertResult.error);
      }
    }
    const { data: updated } = await supabase
      .from("scratcher_slots")
      .select("*")
      .eq("store_id", storeId)
      .order("slot_number", { ascending: true });
    return (updated ?? []).map((slot) => ({
      id: slot.id,
      storeId: slot.store_id,
      slotNumber: slot.slot_number,
      label: slot.label ?? undefined,
      isActive: Boolean(slot.is_active),
      defaultProductId: slot.default_product_id ?? undefined,
      activePackId: slot.active_pack_id ?? undefined,
      createdAt: slot.created_at ?? new Date().toISOString(),
    }));
  }

  const storage = await readStorage();
  const list = storage.scratcherSlots ?? [];
  for (let slotNumber = 1; slotNumber <= 32; slotNumber += 1) {
    if (!list.some((slot) => slot.storeId === storeId && slot.slotNumber === slotNumber)) {
      list.push({
        id: randomUUID(),
        storeId,
        slotNumber,
        label: null,
        isActive: true,
        defaultProductId: null,
        activePackId: null,
        createdAt: new Date().toISOString(),
      });
    }
  }
  storage.scratcherSlots = list;
  await writeStorage(storage);
  return list
    .filter((slot) => slot.storeId === storeId)
    .sort((a, b) => a.slotNumber - b.slotNumber);
}

export async function listScratcherSlotBundle(storeId: string): Promise<{
  slots: ScratcherSlot[];
  packs: ScratcherPack[];
  products: ScratcherProduct[];
}> {
  if (USE_SUPABASE && supabase) {
    const [slotsRes, packsRes, products] = await Promise.all([
      supabase
        .from("scratcher_slots")
        .select("*")
        .eq("store_id", storeId)
        .order("slot_number", { ascending: true }),
      supabase
        .from("scratcher_packs")
        .select("*")
        .eq("store_id", storeId),
      listScratcherProducts(),
    ]);
    if (slotsRes.error) {
      console.error("Supabase scratcher slots load error:", slotsRes.error);
    }
    if (packsRes.error) {
      console.error("Supabase scratcher packs load error:", packsRes.error);
    }
    const slots = (slotsRes.data ?? []).map((slot) => ({
      id: slot.id,
      storeId: slot.store_id,
      slotNumber: slot.slot_number,
      label: slot.label ?? undefined,
      isActive: Boolean(slot.is_active),
      defaultProductId: slot.default_product_id ?? undefined,
      activePackId: slot.active_pack_id ?? undefined,
      createdAt: slot.created_at ?? new Date().toISOString(),
    }));
    const packs = (packsRes.data ?? []).map((pack) => ({
      id: pack.id,
      storeId: pack.store_id,
      slotId: pack.slot_id,
      productId: pack.product_id,
      packCode: pack.pack_code ?? undefined,
      startTicket: pack.start_ticket,
      endTicket: pack.end_ticket,
      status: (pack.status === "ended" ? "ended" : "active") as "active" | "ended",
      activatedAt: pack.activated_at ?? new Date().toISOString(),
      activatedByUserId: pack.activated_by_user_id,
      activationReceiptFileId: pack.activation_receipt_file_id,
      endedAt: pack.ended_at ?? undefined,
      endedByUserId: pack.ended_by_user_id ?? undefined,
    }));
    return { slots, packs, products };
  }

  const storage = await readStorage();
  return {
    slots: (storage.scratcherSlots ?? []).filter((slot) => slot.storeId === storeId),
    packs: (storage.scratcherPacks ?? []).filter((pack) => pack.storeId === storeId),
    products: storage.scratcherProducts ?? [],
  };
}

export async function createScratcherSlot(payload: {
  storeId: string;
  slotNumber: number;
  label?: string | null;
  defaultProductId?: string | null;
}): Promise<ScratcherSlot | null> {
  const recordId = randomUUID();
  const createdAt = new Date().toISOString();

  if (USE_SUPABASE && supabase) {
    const { error } = await supabase.from("scratcher_slots").insert({
      id: recordId,
      store_id: payload.storeId,
      slot_number: payload.slotNumber,
      label: payload.label ?? null,
      is_active: true,
      default_product_id: payload.defaultProductId ?? null,
    });
    if (error) {
      console.error("Supabase scratcher slot insert error:", error);
      return null;
    }
  } else {
    const storage = await readStorage();
    const slots = storage.scratcherSlots ?? [];
    slots.push({
      id: recordId,
      storeId: payload.storeId,
      slotNumber: payload.slotNumber,
      label: payload.label ?? undefined,
      isActive: true,
      defaultProductId: payload.defaultProductId ?? null,
      activePackId: null,
      createdAt,
    });
    storage.scratcherSlots = slots;
    await writeStorage(storage);
  }

  return {
    id: recordId,
    storeId: payload.storeId,
    slotNumber: payload.slotNumber,
    label: payload.label ?? undefined,
    isActive: true,
    defaultProductId: payload.defaultProductId ?? null,
    activePackId: null,
    createdAt,
  };
}

export async function updateScratcherSlot(payload: {
  slotId: string;
  label?: string | null;
  isActive?: boolean;
  defaultProductId?: string | null;
}): Promise<ScratcherSlot | null> {
  if (USE_SUPABASE && supabase) {
    const updates: Record<string, unknown> = {};
    if (payload.label !== undefined) updates.label = payload.label;
    if (payload.isActive !== undefined) updates.is_active = payload.isActive;
    if (payload.defaultProductId !== undefined) {
      updates.default_product_id = payload.defaultProductId;
    }
    const { data, error } = await supabase
      .from("scratcher_slots")
      .update(updates)
      .eq("id", payload.slotId)
      .select("*")
      .maybeSingle();
    if (error || !data) {
      console.error("Supabase scratcher slot update error:", error);
      return null;
    }
    return {
      id: data.id,
      storeId: data.store_id,
      slotNumber: data.slot_number,
      label: data.label ?? undefined,
      isActive: Boolean(data.is_active),
      defaultProductId: data.default_product_id ?? undefined,
      activePackId: data.active_pack_id ?? null,
      createdAt: data.created_at ?? new Date().toISOString(),
    };
  }

  const storage = await readStorage();
  const slots = storage.scratcherSlots ?? [];
  const slot = slots.find((entry) => entry.id === payload.slotId);
  if (!slot) return null;
  if (payload.label !== undefined) {
    slot.label = payload.label ?? undefined;
  }
  if (payload.isActive !== undefined) {
    slot.isActive = payload.isActive;
  }
  if (payload.defaultProductId !== undefined) {
    slot.defaultProductId = payload.defaultProductId ?? null;
  }
  storage.scratcherSlots = slots;
  await writeStorage(storage);
  return slot;
}

export async function saveScratcherFile(
  file: File,
  label: string,
): Promise<StoredFile> {
  const stored = await saveUploadedFile(file, {
    folder: "scratchers",
    label,
  });

  if (USE_SUPABASE && supabase) {
    const { error } = await supabase.from("scratcher_files").insert({
      id: stored.id,
      storage_path: stored.path,
      original_name: stored.originalName,
      mime_type: stored.mimeType,
      size: stored.size,
    });
    if (error) {
      console.error("Supabase scratcher file insert error:", error);
    }
  } else {
    const storage = await readStorage();
    const list = storage.scratcherFiles ?? [];
    list.push(stored);
    storage.scratcherFiles = list;
    await writeStorage(storage);
  }
  return stored;
}

export async function getScratcherFileById(
  fileId: string,
): Promise<StoredFile | null> {
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("scratcher_files")
      .select("*")
      .eq("id", fileId)
      .maybeSingle();
    if (error || !data) {
      if (error) console.error("Supabase scratcher file lookup error:", error);
      return null;
    }
    return {
      id: data.id,
      label: "Scratcher File",
      originalName: data.original_name ?? undefined,
      path: data.storage_path ?? "",
      mimeType: data.mime_type ?? "application/octet-stream",
      size: Number(data.size ?? 0),
      kind: data.mime_type?.startsWith("video")
        ? "video"
        : data.mime_type?.startsWith("image")
          ? "image"
          : "document",
    };
  }

  const storage = await readStorage();
  return (storage.scratcherFiles ?? []).find((file) => file.id === fileId) ?? null;
}

export async function activateScratcherPack(payload: {
  storeId: string;
  slotId: string;
  productId: string;
  packCode?: string | null;
  startTicket: string;
  endTicket: string;
  activatedByUserId: string;
  receiptFile: StoredFile;
}): Promise<ScratcherPack | null> {
  const recordId = randomUUID();
  const activatedAt = new Date().toISOString();

  if (USE_SUPABASE && supabase) {
    const { data: slotData, error: slotError } = await supabase
      .from("scratcher_slots")
      .select("active_pack_id")
      .eq("id", payload.slotId)
      .maybeSingle();
    if (slotError) {
      console.error("Supabase scratcher slot lookup error:", slotError);
    }
    const activePackId = slotData?.active_pack_id ?? null;
    if (activePackId) {
      const endUpdate = await supabase
        .from("scratcher_packs")
        .update({
          status: "ended",
          ended_at: activatedAt,
          ended_by_user_id: payload.activatedByUserId,
        })
        .eq("id", activePackId);
      if (endUpdate.error) {
        console.error("Supabase scratcher pack end error:", endUpdate.error);
      }
      await supabase.from("scratcher_pack_events").insert({
        pack_id: activePackId,
        event_type: "ended",
        created_by_user_id: payload.activatedByUserId,
        note: "Pack ended on activation of a new pack.",
      });
    }

    const insert = await supabase.from("scratcher_packs").insert({
      id: recordId,
      store_id: payload.storeId,
      slot_id: payload.slotId,
      product_id: payload.productId,
      pack_code: payload.packCode ?? null,
      start_ticket: payload.startTicket,
      end_ticket: payload.endTicket,
      status: "active",
      activated_at: activatedAt,
      activated_by_user_id: payload.activatedByUserId,
      activation_receipt_file_id: payload.receiptFile.id,
    });
    if (insert.error) {
      console.error("Supabase scratcher pack insert error:", insert.error);
      return null;
    }
    const updateSlot = await supabase
      .from("scratcher_slots")
      .update({ active_pack_id: recordId })
      .eq("id", payload.slotId);
    if (updateSlot.error) {
      console.error("Supabase scratcher slot update error:", updateSlot.error);
    }
    await supabase.from("scratcher_pack_events").insert({
      pack_id: recordId,
      event_type: "activated",
      created_by_user_id: payload.activatedByUserId,
      file_id: payload.receiptFile.id,
    });
  } else {
    const storage = await readStorage();
    const packs = storage.scratcherPacks ?? [];
    const slots = storage.scratcherSlots ?? [];
    const slot = slots.find((entry) => entry.id === payload.slotId);
    if (slot?.activePackId) {
      const activePack = packs.find((pack) => pack.id === slot.activePackId);
      if (activePack) {
        activePack.status = "ended";
        activePack.endedAt = activatedAt;
        activePack.endedByUserId = payload.activatedByUserId;
      }
      const events = storage.scratcherPackEvents ?? [];
      events.push({
        id: randomUUID(),
        packId: slot.activePackId,
        eventType: "ended",
        createdAt: activatedAt,
        createdByUserId: payload.activatedByUserId,
        note: "Pack ended on activation of a new pack.",
      });
      storage.scratcherPackEvents = events;
    }
    const record: ScratcherPack = {
      id: recordId,
      storeId: payload.storeId,
      slotId: payload.slotId,
      productId: payload.productId,
      packCode: payload.packCode ?? null,
      startTicket: payload.startTicket,
      endTicket: payload.endTicket,
      status: "active",
      activatedAt,
      activatedByUserId: payload.activatedByUserId,
      activationReceiptFileId: payload.receiptFile.id,
      endedAt: null,
      endedByUserId: null,
    };
    packs.push(record);
    storage.scratcherPacks = packs;
    if (slot) {
      slot.activePackId = recordId;
    }
    const events = storage.scratcherPackEvents ?? [];
    events.push({
      id: randomUUID(),
      packId: recordId,
      eventType: "activated",
      createdAt: activatedAt,
      createdByUserId: payload.activatedByUserId,
      fileId: payload.receiptFile.id,
    });
    storage.scratcherPackEvents = events;
    await writeStorage(storage);
  }

  return {
    id: recordId,
    storeId: payload.storeId,
    slotId: payload.slotId,
    productId: payload.productId,
    packCode: payload.packCode ?? null,
    startTicket: payload.startTicket,
    endTicket: payload.endTicket,
    status: "active",
    activatedAt,
    activatedByUserId: payload.activatedByUserId,
    activationReceiptFileId: payload.receiptFile.id,
    endedAt: null,
    endedByUserId: null,
  };
}

export async function getScratcherPackById(packId: string): Promise<ScratcherPack | null> {
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("scratcher_packs")
      .select("*")
      .eq("id", packId)
      .maybeSingle();
    if (error || !data) {
      if (error) console.error("Supabase scratcher pack lookup error:", error);
      return null;
    }
    return {
      id: data.id,
      storeId: data.store_id,
      slotId: data.slot_id,
      productId: data.product_id,
      packCode: data.pack_code ?? null,
      startTicket: data.start_ticket,
      endTicket: data.end_ticket,
      status: data.status,
      activatedAt: data.activated_at ?? new Date().toISOString(),
      activatedByUserId: data.activated_by_user_id,
      activationReceiptFileId: data.activation_receipt_file_id,
      endedAt: data.ended_at ?? null,
      endedByUserId: data.ended_by_user_id ?? null,
    };
  }

  const storage = await readStorage();
  return (storage.scratcherPacks ?? []).find((pack) => pack.id === packId) ?? null;
}

export async function returnScratcherPack(payload: {
  storeId: string;
  packId: string;
  returnedByUserId: string;
  receiptFile: StoredFile;
  note?: string | null;
}): Promise<ScratcherPack | null> {
  const returnedAt = new Date().toISOString();
  if (USE_SUPABASE && supabase) {
    const { data: packRow, error: packError } = await supabase
      .from("scratcher_packs")
      .select("id, slot_id")
      .eq("id", payload.packId)
      .maybeSingle();
    if (packError || !packRow) {
      console.error("Supabase scratcher pack lookup error:", packError);
      return null;
    }

    const update = await supabase
      .from("scratcher_packs")
      .update({
        status: "returned",
        ended_at: returnedAt,
        ended_by_user_id: payload.returnedByUserId,
      })
      .eq("id", payload.packId);
    if (update.error) {
      console.error("Supabase scratcher pack return error:", update.error);
      return null;
    }

    const slotUpdate = await supabase
      .from("scratcher_slots")
      .update({ active_pack_id: null })
      .eq("id", packRow.slot_id);
    if (slotUpdate.error) {
      console.error("Supabase scratcher slot return update error:", slotUpdate.error);
    }

    await supabase.from("scratcher_pack_events").insert({
      pack_id: payload.packId,
      event_type: "returned",
      created_by_user_id: payload.returnedByUserId,
      note: payload.note ?? null,
      file_id: payload.receiptFile.id,
    });

    const { data: updatedPack } = await supabase
      .from("scratcher_packs")
      .select("*")
      .eq("id", payload.packId)
      .maybeSingle();
    if (!updatedPack) return null;
    return {
      id: updatedPack.id,
      storeId: updatedPack.store_id,
      slotId: updatedPack.slot_id,
      productId: updatedPack.product_id,
      packCode: updatedPack.pack_code ?? null,
      startTicket: updatedPack.start_ticket,
      endTicket: updatedPack.end_ticket,
      status: updatedPack.status,
      activatedAt: updatedPack.activated_at ?? returnedAt,
      activatedByUserId: updatedPack.activated_by_user_id,
      activationReceiptFileId: updatedPack.activation_receipt_file_id,
      endedAt: updatedPack.ended_at ?? null,
      endedByUserId: updatedPack.ended_by_user_id ?? null,
    };
  }

  const storage = await readStorage();
  const packs = storage.scratcherPacks ?? [];
  const pack = packs.find((item) => item.id === payload.packId);
  if (!pack) return null;
  pack.status = "returned";
  pack.endedAt = returnedAt;
  pack.endedByUserId = payload.returnedByUserId;
  const slots = storage.scratcherSlots ?? [];
  const slot = slots.find((entry) => entry.id === pack.slotId);
  if (slot) slot.activePackId = null;
  const events = storage.scratcherPackEvents ?? [];
  events.push({
    id: randomUUID(),
    packId: payload.packId,
    eventType: "returned",
    createdAt: returnedAt,
    createdByUserId: payload.returnedByUserId,
    note: payload.note ?? undefined,
    fileId: payload.receiptFile.id,
  });
  storage.scratcherPackEvents = events;
  await writeStorage(storage);
  return pack;
}

export async function createScratcherSnapshot(payload: {
  shiftReportId: string;
  storeId: string;
  employeeUserId: string;
  snapshotType: "start" | "end";
  items: Array<{ slotId: string; ticketValue: string; photoFileId?: string | null }>;
}): Promise<{
  snapshot: ScratcherShiftSnapshot;
  items: ScratcherShiftSnapshotItem[];
} | null> {
  const snapshotId = randomUUID();
  const createdAt = new Date().toISOString();
  const { slots } = await listScratcherSlotBundle(payload.storeId);
  const slotPackMap = new Map(slots.map((slot) => [slot.id, slot.activePackId ?? null]));

  if (USE_SUPABASE && supabase) {
    const existing = await supabase
      .from("scratcher_shift_snapshots")
      .select("id")
      .eq("shift_report_id", payload.shiftReportId)
      .eq("snapshot_type", payload.snapshotType)
      .maybeSingle();
    if (existing.data?.id) {
      return null;
    }

    const insertSnapshot = await supabase.from("scratcher_shift_snapshots").insert({
      id: snapshotId,
      shift_report_id: payload.shiftReportId,
      store_id: payload.storeId,
      employee_user_id: payload.employeeUserId,
      snapshot_type: payload.snapshotType,
    });
    if (insertSnapshot.error) {
      console.error("Supabase scratcher snapshot insert error:", insertSnapshot.error);
      return null;
    }

    const rows = payload.items.map((item) => ({
      id: randomUUID(),
      snapshot_id: snapshotId,
      slot_id: item.slotId,
      pack_id: slotPackMap.get(item.slotId) ?? null,
      ticket_value: item.ticketValue,
      photo_file_id: item.photoFileId ?? null,
    }));
    if (rows.length) {
      const insertItems = await supabase
        .from("scratcher_shift_snapshot_items")
        .insert(rows);
      if (insertItems.error) {
        console.error("Supabase scratcher snapshot items error:", insertItems.error);
      }
    }
  } else {
    const storage = await readStorage();
    const snapshots = storage.scratcherShiftSnapshots ?? [];
    if (
      snapshots.some(
        (snap) =>
          snap.shiftReportId === payload.shiftReportId &&
          snap.snapshotType === payload.snapshotType,
      )
    ) {
      return null;
    }
    const snapshot: ScratcherShiftSnapshot = {
      id: snapshotId,
      shiftReportId: payload.shiftReportId,
      storeId: payload.storeId,
      employeeUserId: payload.employeeUserId,
      snapshotType: payload.snapshotType,
      createdAt,
    };
    snapshots.push(snapshot);
    storage.scratcherShiftSnapshots = snapshots;
    const items = storage.scratcherShiftSnapshotItems ?? [];
    payload.items.forEach((item) => {
      items.push({
        id: randomUUID(),
        snapshotId,
        slotId: item.slotId,
        packId: slotPackMap.get(item.slotId) ?? null,
        ticketValue: item.ticketValue,
        photoFileId: item.photoFileId ?? null,
        createdAt,
      });
    });
    storage.scratcherShiftSnapshotItems = items;
    await writeStorage(storage);
  }

  const snapshot: ScratcherShiftSnapshot = {
    id: snapshotId,
    shiftReportId: payload.shiftReportId,
    storeId: payload.storeId,
    employeeUserId: payload.employeeUserId,
    snapshotType: payload.snapshotType,
    createdAt,
  };
  const items: ScratcherShiftSnapshotItem[] = payload.items.map((item) => ({
    id: randomUUID(),
    snapshotId,
    slotId: item.slotId,
    packId: slotPackMap.get(item.slotId) ?? null,
    ticketValue: item.ticketValue,
    photoFileId: item.photoFileId ?? null,
    createdAt,
  }));
  return { snapshot, items };
}

export async function getLatestScratcherStartSnapshotByStore(
  storeId: string,
): Promise<{
  snapshot: ScratcherShiftSnapshot;
  items: ScratcherShiftSnapshotItem[];
} | null> {
  if (USE_SUPABASE && supabase) {
    const { data: snapshotData, error } = await supabase
      .from("scratcher_shift_snapshots")
      .select("*")
      .eq("store_id", storeId)
      .eq("snapshot_type", "start")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !snapshotData) {
      if (error) {
        console.error("Supabase scratcher latest start snapshot error:", error);
      }
      return null;
    }
    const { data: itemData, error: itemError } = await supabase
      .from("scratcher_shift_snapshot_items")
      .select("*")
      .eq("snapshot_id", snapshotData.id);
    if (itemError) {
      console.error("Supabase scratcher start snapshot items error:", itemError);
    }
    const snapshot: ScratcherShiftSnapshot = {
      id: snapshotData.id,
      shiftReportId: snapshotData.shift_report_id,
      storeId: snapshotData.store_id,
      employeeUserId: snapshotData.employee_user_id,
      snapshotType: "start",
      createdAt: snapshotData.created_at ?? new Date().toISOString(),
    };
    const items: ScratcherShiftSnapshotItem[] = (itemData ?? []).map((item) => ({
      id: item.id,
      snapshotId: item.snapshot_id,
      slotId: item.slot_id,
      packId: item.pack_id ?? null,
      ticketValue: item.ticket_value,
      photoFileId: item.photo_file_id ?? null,
      createdAt: item.created_at ?? new Date().toISOString(),
    }));
    return { snapshot, items };
  }

  const storage = await readStorage();
  const snapshots = (storage.scratcherShiftSnapshots ?? [])
    .filter((snap) => snap.storeId === storeId && snap.snapshotType === "start")
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const snapshot = snapshots[0];
  if (!snapshot) return null;
  const items = (storage.scratcherShiftSnapshotItems ?? []).filter(
    (item) => item.snapshotId === snapshot.id,
  );
  return { snapshot, items };
}

export async function listScratcherSnapshots(shiftReportId: string): Promise<{
  snapshots: ScratcherShiftSnapshot[];
  items: ScratcherShiftSnapshotItem[];
}> {
  if (USE_SUPABASE && supabase) {
    const { data: snapshotData, error } = await supabase
      .from("scratcher_shift_snapshots")
      .select("*")
      .eq("shift_report_id", shiftReportId);
    if (error) {
      console.error("Supabase scratcher snapshot load error:", error);
      return { snapshots: [], items: [] };
    }
    const snapshotIds = (snapshotData ?? []).map((snap) => snap.id);
    const { data: itemData, error: itemError } = snapshotIds.length
      ? await supabase
          .from("scratcher_shift_snapshot_items")
          .select("*")
          .in("snapshot_id", snapshotIds)
      : { data: [], error: null };
    if (itemError) {
      console.error("Supabase scratcher snapshot items load error:", itemError);
    }
    const snapshots = (snapshotData ?? []).map((snap) => ({
      id: snap.id,
      shiftReportId: snap.shift_report_id,
      storeId: snap.store_id,
      employeeUserId: snap.employee_user_id,
      snapshotType: (snap.snapshot_type === "end" ? "end" : "start") as "start" | "end",
      createdAt: snap.created_at ?? new Date().toISOString(),
    }));
    const items = (itemData ?? []).map((item) => ({
      id: item.id,
      snapshotId: item.snapshot_id,
      slotId: item.slot_id,
      packId: item.pack_id ?? null,
      ticketValue: item.ticket_value,
      photoFileId: item.photo_file_id ?? null,
      createdAt: item.created_at ?? new Date().toISOString(),
    }));
    return { snapshots, items };
  }

  const storage = await readStorage();
  return {
    snapshots: (storage.scratcherShiftSnapshots ?? []).filter(
      (snap) => snap.shiftReportId === shiftReportId,
    ),
    items: (storage.scratcherShiftSnapshotItems ?? []).filter(
      (item) =>
        storage.scratcherShiftSnapshots?.some(
          (snap) => snap.id === item.snapshotId && snap.shiftReportId === shiftReportId,
        ) ?? false,
    ),
  };
}

export async function upsertScratcherShiftCalculation(payload: {
  shiftReportId: string;
  storeId: string;
  employeeUserId: string;
  expectedTotalTickets: number;
  expectedTotalValue: number;
  reportedScrValue: number | null;
  varianceValue: number;
  breakdown: Array<Record<string, unknown>>;
  flags: string[];
}): Promise<ScratcherShiftCalculation | null> {
  const timestamp = new Date().toISOString();
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("scratcher_shift_calculations")
      .upsert(
        {
          shift_report_id: payload.shiftReportId,
          store_id: payload.storeId,
          employee_user_id: payload.employeeUserId,
          expected_total_tickets: payload.expectedTotalTickets,
          expected_total_value: payload.expectedTotalValue,
          reported_scr_value: payload.reportedScrValue,
          variance_value: payload.varianceValue,
          breakdown_json: payload.breakdown,
          flags_json: payload.flags,
          updated_at: timestamp,
        },
        { onConflict: "shift_report_id" },
      )
      .select("*")
      .maybeSingle();
    if (error || !data) {
      console.error("Supabase scratcher calc upsert error:", error);
      return null;
    }
    return {
      id: data.id,
      shiftReportId: data.shift_report_id,
      storeId: data.store_id,
      employeeUserId: data.employee_user_id,
      expectedTotalTickets: Number(data.expected_total_tickets ?? 0),
      expectedTotalValue: Number(data.expected_total_value ?? 0),
      reportedScrValue: data.reported_scr_value ?? null,
      varianceValue: Number(data.variance_value ?? 0),
      breakdown: Array.isArray(data.breakdown_json) ? data.breakdown_json : [],
      flags: Array.isArray(data.flags_json) ? data.flags_json : [],
      createdAt: data.created_at ?? timestamp,
      updatedAt: data.updated_at ?? timestamp,
    };
  }

  const storage = await readStorage();
  const list = storage.scratcherShiftCalculations ?? [];
  const existingIndex = list.findIndex(
    (calc) => calc.shiftReportId === payload.shiftReportId,
  );
  const record: ScratcherShiftCalculation = {
    id:
      existingIndex >= 0
        ? list[existingIndex].id
        : randomUUID(),
    shiftReportId: payload.shiftReportId,
    storeId: payload.storeId,
    employeeUserId: payload.employeeUserId,
    expectedTotalTickets: payload.expectedTotalTickets,
    expectedTotalValue: payload.expectedTotalValue,
    reportedScrValue: payload.reportedScrValue ?? null,
    varianceValue: payload.varianceValue,
    breakdown: payload.breakdown,
    flags: payload.flags,
    createdAt:
      existingIndex >= 0 ? list[existingIndex].createdAt : timestamp,
    updatedAt: timestamp,
  };
  if (existingIndex >= 0) {
    list[existingIndex] = record;
  } else {
    list.unshift(record);
  }
  storage.scratcherShiftCalculations = list;
  await writeStorage(storage);
  return record;
}

export async function getScratcherShiftCalculation(
  shiftReportId: string,
): Promise<ScratcherShiftCalculation | null> {
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("scratcher_shift_calculations")
      .select("*")
      .eq("shift_report_id", shiftReportId)
      .maybeSingle();
    if (error || !data) {
      if (error) console.error("Supabase scratcher calc lookup error:", error);
      return null;
    }
    return {
      id: data.id,
      shiftReportId: data.shift_report_id,
      storeId: data.store_id,
      employeeUserId: data.employee_user_id,
      expectedTotalTickets: Number(data.expected_total_tickets ?? 0),
      expectedTotalValue: Number(data.expected_total_value ?? 0),
      reportedScrValue: data.reported_scr_value ?? null,
      varianceValue: Number(data.variance_value ?? 0),
      breakdown: Array.isArray(data.breakdown_json) ? data.breakdown_json : [],
      flags: Array.isArray(data.flags_json) ? data.flags_json : [],
      createdAt: data.created_at ?? new Date().toISOString(),
      updatedAt: data.updated_at ?? new Date().toISOString(),
    };
  }

  const storage = await readStorage();
  return (
    storage.scratcherShiftCalculations ?? []
  ).find((calc) => calc.shiftReportId === shiftReportId) ?? null;
}

export async function listScratcherDiscrepancies(storeId: string) {
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("scratcher_shift_calculations")
      .select("*")
      .eq("store_id", storeId);
    if (error || !data) {
      console.error("Supabase scratcher discrepancies error:", error);
      return [];
    }
    return data
      .map((calc) => ({
        id: calc.id,
        shiftReportId: calc.shift_report_id,
        storeId: calc.store_id,
        employeeUserId: calc.employee_user_id,
        expectedTotalTickets: Number(calc.expected_total_tickets ?? 0),
        expectedTotalValue: Number(calc.expected_total_value ?? 0),
        reportedScrValue: calc.reported_scr_value ?? null,
        varianceValue: Number(calc.variance_value ?? 0),
        breakdown: Array.isArray(calc.breakdown_json) ? calc.breakdown_json : [],
        flags: Array.isArray(calc.flags_json) ? calc.flags_json : [],
        createdAt: calc.created_at ?? new Date().toISOString(),
        updatedAt: calc.updated_at ?? new Date().toISOString(),
      }))
      .filter(
        (calc) => calc.varianceValue !== 0 || (calc.flags ?? []).length > 0,
      );
  }

  const storage = await readStorage();
  return (storage.scratcherShiftCalculations ?? []).filter(
    (calc) => calc.storeId === storeId && (calc.varianceValue !== 0 || calc.flags.length > 0),
  );
}

export async function listScratcherPackEvents(storeId: string): Promise<ScratcherPackEvent[]> {
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("scratcher_pack_events")
      .select("*");
    if (error || !data) {
      console.error("Supabase scratcher pack events error:", error);
      return [];
    }
    const packs = await listScratcherSlotBundle(storeId);
    const packIds = new Set(packs.packs.map((pack) => pack.id));
    return data
      .filter((event) => packIds.has(event.pack_id))
      .map((event) => ({
        id: event.id,
        packId: event.pack_id,
        eventType:
          event.event_type === "ended"
            ? "ended"
            : event.event_type === "returned"
              ? "returned"
              : event.event_type === "return_receipt"
                ? "return_receipt"
                : event.event_type === "correction"
                  ? "correction"
                  : event.event_type === "note"
                    ? "note"
                    : "activated",
        createdAt: event.created_at ?? new Date().toISOString(),
        createdByUserId: event.created_by_user_id,
        note: event.note ?? undefined,
        fileId: event.file_id ?? undefined,
      }));
  }

  const storage = await readStorage();
  const packIds = new Set(
    (storage.scratcherPacks ?? [])
      .filter((pack) => pack.storeId === storeId)
      .map((pack) => pack.id),
  );
  return (storage.scratcherPackEvents ?? []).filter((event) =>
    packIds.has(event.packId),
  );
}

export async function createScratcherPackEvent(payload: {
  packId: string;
  eventType: "activated" | "ended" | "returned" | "return_receipt" | "correction" | "note";
  createdByUserId: string;
  note?: string | null;
  fileId?: string | null;
}): Promise<ScratcherPackEvent | null> {
  const recordId = randomUUID();
  const createdAt = new Date().toISOString();

  if (USE_SUPABASE && supabase) {
    const { error } = await supabase.from("scratcher_pack_events").insert({
      id: recordId,
      pack_id: payload.packId,
      event_type: payload.eventType,
      created_by_user_id: payload.createdByUserId,
      note: payload.note ?? null,
      file_id: payload.fileId ?? null,
    });
    if (error) {
      console.error("Supabase scratcher pack event insert error:", error);
      return null;
    }
  } else {
    const storage = await readStorage();
    const events = storage.scratcherPackEvents ?? [];
    events.push({
      id: recordId,
      packId: payload.packId,
      eventType: payload.eventType,
      createdAt,
      createdByUserId: payload.createdByUserId,
      note: payload.note ?? undefined,
      fileId: payload.fileId ?? undefined,
    });
    storage.scratcherPackEvents = events;
    await writeStorage(storage);
  }

  return {
    id: recordId,
    packId: payload.packId,
    eventType: payload.eventType,
    createdAt,
    createdByUserId: payload.createdByUserId,
    note: payload.note ?? undefined,
    fileId: payload.fileId ?? undefined,
  };
}

export async function listScratcherCalculations(storeId: string) {
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("scratcher_shift_calculations")
      .select("*")
      .eq("store_id", storeId);
    if (error || !data) {
      console.error("Supabase scratcher calculations error:", error);
      return [];
    }
    return data.map((calc) => ({
      id: calc.id,
      shiftReportId: calc.shift_report_id,
      storeId: calc.store_id,
      employeeUserId: calc.employee_user_id,
      expectedTotalTickets: Number(calc.expected_total_tickets ?? 0),
      expectedTotalValue: Number(calc.expected_total_value ?? 0),
      reportedScrValue: calc.reported_scr_value ?? null,
      varianceValue: Number(calc.variance_value ?? 0),
      breakdown: Array.isArray(calc.breakdown_json) ? calc.breakdown_json : [],
      flags: Array.isArray(calc.flags_json) ? calc.flags_json : [],
      createdAt: calc.created_at ?? new Date().toISOString(),
      updatedAt: calc.updated_at ?? new Date().toISOString(),
    }));
  }

  const storage = await readStorage();
  return (storage.scratcherShiftCalculations ?? []).filter(
    (calc) => calc.storeId === storeId,
  );
}

export async function recalculateScratcherShift(payload: {
  shiftReportId: string;
  storeId: string;
}): Promise<ScratcherShiftCalculation | null> {
  const report = await getShiftReportById(payload.shiftReportId);
  if (!report) return null;
  const { slots, packs, products } = await listScratcherSlotBundle(payload.storeId);
  const { snapshots, items } = await listScratcherSnapshots(payload.shiftReportId);
  const startSnapshot = snapshots.find((snap) => snap.snapshotType === "start");
  const endSnapshot = snapshots.find((snap) => snap.snapshotType === "end");
  const flags: string[] = [];
  if (!startSnapshot) flags.push("missing_start_snapshot");
  if (!endSnapshot) flags.push("missing_end_snapshot");

  const startItems = items.filter((item) => item.snapshotId === startSnapshot?.id);
  const endItems = items.filter((item) => item.snapshotId === endSnapshot?.id);
  const startMap = new Map(startItems.map((item) => [item.slotId, item]));
  const endMap = new Map(endItems.map((item) => [item.slotId, item]));
  const packMap = new Map(packs.map((pack) => [pack.id, pack]));
  const productMap = new Map(products.map((product) => [product.id, product]));

  let expectedTickets = 0;
  let expectedValue = 0;
  const breakdown: Array<Record<string, unknown>> = [];

  const slotIds = Array.from(
    new Set([...startMap.keys(), ...endMap.keys()]),
  );

  slotIds.forEach((slotId) => {
    const slot = slots.find((entry) => entry.id === slotId);
    const startItem = startMap.get(slotId);
    const endItem = endMap.get(slotId);
    const startTicketRaw = startItem?.ticketValue ?? "";
    const endTicketRaw = endItem?.ticketValue ?? "";
    const startTicket = parseTicketNumber(startTicketRaw);
    const endTicket = parseTicketNumber(endTicketRaw);
    const startPack = startItem?.packId ? packMap.get(startItem.packId) : undefined;
    const endPack = endItem?.packId ? packMap.get(endItem.packId) : undefined;
    const product = (endPack ?? startPack) ? productMap.get((endPack ?? startPack)?.productId ?? "") : undefined;
    let sold = 0;
    let soldOld = 0;
    let soldNew = 0;
    let value = 0;

    if (startTicket === null || endTicket === null) {
      flags.push(`invalid_ticket_${slot?.slotNumber ?? slotId}`);
    } else if (endTicket >= startTicket) {
      sold = endTicket - startTicket;
      if (sold > SCRATCHER_JUMP_THRESHOLD) {
        flags.push(`large_jump_${slot?.slotNumber ?? slotId}`);
      }
    } else {
      if (!startPack || !endPack || startPack.id === endPack.id) {
        flags.push(`rollover_missing_pack_${slot?.slotNumber ?? slotId}`);
      } else {
        const oldEnd = parseTicketNumber(startPack.endTicket);
        const newStart = parseTicketNumber(endPack.startTicket);
        if (oldEnd === null || newStart === null) {
          flags.push(`rollover_invalid_pack_${slot?.slotNumber ?? slotId}`);
        } else {
          soldOld = oldEnd - startTicket;
          soldNew = endTicket - newStart;
          sold = soldOld + soldNew;
        }
      }
    }

    if (product) {
      value = sold * Number(product.price ?? 0);
    } else {
      flags.push(`missing_product_${slot?.slotNumber ?? slotId}`);
    }

    expectedTickets += sold;
    expectedValue += value;
    breakdown.push({
      slotId,
      slotNumber: slot?.slotNumber ?? null,
      startTicket: startTicketRaw,
      endTicket: endTicketRaw,
      sold,
      soldOld,
      soldNew,
      value,
      productId: product?.id ?? null,
      packId: endPack?.id ?? startPack?.id ?? null,
    });
  });

  const reportedScrValue = Number.isFinite(report.scrAmount)
    ? report.scrAmount
    : null;
  const varianceValue = expectedValue - (reportedScrValue ?? 0);
  const saved = await upsertScratcherShiftCalculation({
    shiftReportId: report.id,
    storeId: report.storeId,
    employeeUserId: report.employeeId ?? "",
    expectedTotalTickets: expectedTickets,
    expectedTotalValue: Number(expectedValue.toFixed(2)),
    reportedScrValue,
    varianceValue: Number(varianceValue.toFixed(2)),
    breakdown,
    flags,
  });

  if (USE_SUPABASE && supabase) {
    const hasDiscrepancy = varianceValue !== 0 || flags.length > 0;
    const update = await supabase
      .from("shift_reports")
      .update({ has_scratcher_discrepancy: hasDiscrepancy })
      .eq("id", report.id);
    if (update.error) {
      console.error("Supabase shift report discrepancy update error:", update.error);
    }
  } else {
    const storage = await readStorage();
    const index = storage.shiftReports.findIndex((item) => item.id === report.id);
    if (index >= 0) {
      storage.shiftReports[index].hasScratcherDiscrepancy =
        varianceValue !== 0 || flags.length > 0;
      await writeStorage(storage);
    }
  }

  return saved;
}
