import { randomUUID } from "crypto";
import { readFile, writeFile, mkdir, unlink } from "fs/promises";
import path from "path";
import type {
  CombinedRecord,
  RecordFilters,
  Report,
  ShiftSubmission,
  StoredFile,
} from "./types";
import { mockUsers } from "./users";

const DATA_PATH = path.join(process.cwd(), "data", "storage.json");
const UPLOADS_ROOT = path.join(process.cwd(), "public", "uploads");

interface SurveillanceRecord {
  id: string;
  employeeName: string;
  storeNumber: string;
  label: string;
  summary: string;
  notes?: string;
  attachments: StoredFile[];
  createdAt: string;
}

interface StorageSchema {
  shiftSubmissions: ShiftSubmission[];
  reports: Report[];
  surveillanceReports: SurveillanceRecord[];
}

async function ensureUploadsDir(subFolder: string) {
  await mkdir(path.join(UPLOADS_ROOT, subFolder), { recursive: true });
}

async function readStorage(): Promise<StorageSchema> {
  try {
    const fileContents = await readFile(DATA_PATH, "utf-8");
    const parsed = JSON.parse(fileContents) as Partial<StorageSchema>;
    return {
      shiftSubmissions: Array.isArray(parsed.shiftSubmissions)
        ? parsed.shiftSubmissions
        : [],
      reports: Array.isArray(parsed.reports) ? parsed.reports : [],
      surveillanceReports: Array.isArray(parsed.surveillanceReports)
        ? parsed.surveillanceReports
        : [],
    };
  } catch {
    const fallback: StorageSchema = {
      shiftSubmissions: [],
      reports: [],
      surveillanceReports: [],
    };
    await writeStorage(fallback);
    return fallback;
  }
}

async function writeStorage(payload: StorageSchema) {
  await writeFile(DATA_PATH, JSON.stringify(payload, null, 2), "utf-8");
}

async function deleteStoredFile(publicPath: string | undefined) {
  if (!publicPath) return;
  const relative = publicPath.startsWith("/")
    ? publicPath.slice(1)
    : publicPath;
  const absolutePath = path.join(process.cwd(), "public", relative);
  try {
    await unlink(absolutePath);
  } catch {
    // ignore missing files
  }
}

export interface SaveFileOptions {
  folder: "shift" | "reports";
  label?: string;
}

export async function saveUploadedFile(
  file: File,
  options: SaveFileOptions,
): Promise<StoredFile> {
  const { folder, label } = options;
  await ensureUploadsDir(folder);
  const buffer = Buffer.from(await file.arrayBuffer());
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9.\-]/g, "_");
  const id = randomUUID();
  const filename = `${id}-${sanitizedName}`;
  const filePath = path.join(UPLOADS_ROOT, folder, filename);
  await writeFile(filePath, buffer);

  return {
    id,
    path: `/uploads/${folder}/${filename}`,
    originalName: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    label,
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

export async function addSurveillanceReport(
  payload: Omit<SurveillanceRecord, "id" | "createdAt">,
): Promise<SurveillanceRecord> {
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
  const storage = await readStorage();
  const { shiftSubmissions, reports, surveillanceReports } = storage;
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
      attachments: entry.attachments.map((file) => ({ ...file })),
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

export async function getRecentShiftSubmissions(options: {
  storeNumber: string;
  employeeName: string;
  days?: number;
}): Promise<ShiftSubmission[]> {
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

  if (changed) {
    await writeStorage({
      shiftSubmissions: remainingShifts,
      reports: remainingReports,
      surveillanceReports: remainingSurveillance,
    });
  }
}
