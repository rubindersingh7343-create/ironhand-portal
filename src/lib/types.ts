export type UserRole = "employee" | "ironhand" | "client" | "surveillance";
export type PortalAccess = "manager" | "master";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  storeNumber: string;
  storeIds?: string[];
  portal?: PortalAccess;
}

export interface StoredFile {
  id: string;
  path: string;
  originalName: string;
  mimeType: string;
  size: number;
  label?: string;
  kind: "image" | "video" | "document" | "other";
}

export interface ShiftSubmission {
  id: string;
  employeeName: string;
  storeNumber: string;
  createdAt: string;
  shiftNotes?: string;
  scratcherVideo: StoredFile;
  cashPhoto: StoredFile;
  salesPhoto: StoredFile;
}

export type ReportType = "daily" | "weekly" | "monthly";

export interface Report {
  id: string;
  employeeName: string;
  storeNumber: string;
  reportType: ReportType;
  createdAt: string;
  notes?: string;
  textContent?: string;
  attachments: StoredFile[];
}

export interface CombinedRecord {
  id: string;
  category: "shift" | ReportType | "surveillance";
  employeeName: string;
  storeNumber: string;
  createdAt: string;
  shiftNotes?: string;
  notes?: string;
  textContent?: string;
  attachments: StoredFile[];
  surveillanceLabel?: string;
  surveillanceSummary?: string;
}

export interface RecordFilters {
  storeNumber?: string;
  category?: "shift" | ReportType | "all";
  employee?: string;
  startDate?: string;
  endDate?: string;
}
