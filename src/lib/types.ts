export type UserRole = "employee" | "ironhand" | "client" | "surveillance";
export type PortalAccess = "manager" | "master";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  storeNumber: string;
  storeName?: string;
  storeAddress?: string;
  storeIds?: string[];
  portal?: PortalAccess;
}

export interface StoredFile {
  id: string;
  path: string;
  dataUrl?: string;
  originalName: string;
  mimeType: string;
  size: number;
  label?: string;
  summary?: string;
  kind: "image" | "video" | "document" | "other";
}

export interface ShiftSubmission {
  id: string;
  employeeName: string;
  storeNumber: string;
  createdAt: string;
  shiftNotes?: string;
  reportDetails?: Record<string, unknown>;
  // Legacy: older shift submissions used a single scratcher count video.
  scratcherVideo?: StoredFile;
  // New: one photo per scratcher row (8 total for 32 slots).
  scratcherPhotos?: StoredFile[];
  cashPhoto: StoredFile;
  salesPhoto: StoredFile;
}

export interface EmployeeHoursEntry {
  id: string;
  storeId: string;
  employeeId: string;
  employeeName: string;
  date: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  hours: number;
  notes?: string;
  createdAt: string;
}

export interface EmployeeHourlyRate {
  id: string;
  storeId: string;
  employeeId: string;
  hourlyRate: number;
  updatedAt: string;
}

export interface EmployeeHoursPayment {
  id: string;
  storeId: string;
  employeeId: string;
  month: string;
  totalHours: number;
  hourlyRate: number;
  totalPay: number;
  paidAt: string;
}

export type ReportType = "daily" | "weekly" | "monthly";
export type OrderPeriod = "weekly" | "monthly";
export type OrderStatus = "draft" | "submitted" | "approved";

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

export interface ShiftReport {
  id: string;
  storeId: string;
  managerId?: string;
  managerName?: string;
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
  netAmount: number;
  customFields?: { label: string; amount: number }[];
  investigationFlag: boolean;
  investigationReason?: string;
  hasScratcherDiscrepancy?: boolean;
  updatedAt: string;
}

export interface ScratcherProduct {
  id: string;
  name?: string | null;
  price: number;
  isActive: boolean;
  createdAt: string;
}

export interface ScratcherSlot {
  id: string;
  storeId: string;
  slotNumber: number;
  label?: string | null;
  isActive: boolean;
  defaultProductId?: string | null;
  activePackId?: string | null;
  createdAt: string;
}

export interface ScratcherPack {
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
}

export type ScratcherSnapshotType = "start" | "end";

export interface ScratcherShiftSnapshot {
  id: string;
  shiftReportId: string;
  storeId: string;
  employeeUserId: string;
  snapshotType: ScratcherSnapshotType;
  createdAt: string;
}

export interface ScratcherShiftSnapshotItem {
  id: string;
  snapshotId: string;
  slotId: string;
  packId?: string | null;
  ticketValue: string;
  photoFileId?: string | null;
  createdAt: string;
}

export interface ScratcherPackEvent {
  id: string;
  packId: string;
  eventType: "activated" | "ended" | "returned" | "return_receipt" | "correction" | "note";
  createdAt: string;
  createdByUserId: string;
  note?: string | null;
  fileId?: string | null;
}

export interface ScratcherShiftCalculation {
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
}

export type ReportItemKey =
  | "gross"
  | "scr"
  | "lotto"
  | "liquor"
  | "beer"
  | "cig"
  | "tobacco"
  | "gas"
  | "atm"
  | "lottoPo"
  | "deposit";

export interface ReportItemConfig {
  key: string;
  label: string;
  enabled: boolean;
  marginPercent?: number | null;
  isCustom?: boolean;
}

export interface StoreReportConfig {
  storeId: string;
  ownerId?: string;
  items: ReportItemConfig[];
  createdAt: string;
  updatedAt: string;
}

export type InvestigationStatus = "none" | "sent" | "in_progress" | "resolved";

export interface InvestigationRecord {
  id: string;
  storeId: string;
  date: string;
  shiftReportId: string;
  status: InvestigationStatus;
  assignedToUserId: string;
  createdByOwnerId: string;
  createdAt: string;
  updatedAt: string;
  notes?: string;
}

export interface SurveillanceInvestigationRecord {
  id: string;
  storeId: string;
  reportId: string;
  status: InvestigationStatus;
  assignedToUserId: string;
  createdByOwnerId: string;
  createdAt: string;
  updatedAt: string;
  notes?: string;
}

export interface InvoiceRecord {
  id: string;
  employeeName: string;
  storeNumber: string;
  createdAt: string;
  invoiceCompany?: string;
  invoiceNumber?: string;
  invoiceAmountCents?: number;
  invoiceDueDate?: string;
  invoicePaid?: boolean;
  invoicePaymentMethod?: string;
  invoicePaymentDetails?: Record<string, unknown>;
  invoicePaidAmountCents?: number;
  notes?: string;
  attachments: StoredFile[];
}

export interface OrderVendor {
  id: string;
  storeId: string;
  directoryVendorId?: string;
  name: string;
  repName?: string;
  contact?: string;
  email?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderVendorDirectory {
  id: string;
  name: string;
  repName?: string;
  contact?: string;
  email?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderVendorItem {
  id: string;
  directoryVendorId: string;
  productName: string;
  createdAt: string;
}

export interface OrderVendorLink {
  id: string;
  vendorId: string;
  storeId: string;
  createdAt: string;
}

export interface WeeklyOrderItem {
  id: string;
  orderId: string;
  productName: string;
  unitsOnHand: number;
  unitsToOrder: number;
}

export interface WeeklyOrder {
  id: string;
  storeId: string;
  vendorId: string;
  periodType: OrderPeriod;
  periodStart: string;
  status: OrderStatus;
  createdById: string;
  createdByName: string;
  approvedById?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
  items: WeeklyOrderItem[];
}

export interface OrderMessage {
  id: string;
  orderId: string;
  senderRole: "owner" | "manager" | "system";
  senderName: string;
  message: string;
  createdAt: string;
}

export type OwnerSeenType =
  | "shift"
  | "full-day"
  | "surveillance"
  | "invoice"
  | "order"
  | "chat-manager"
  | "chat-surveillance"
  | "chat-owner";

export type ChatType = "manager" | "surveillance" | "owner";

export interface StoreChatThread {
  id: string;
  storeId: string;
  chatType: ChatType;
  ownerId: string;
  participantId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoreChatMessage {
  id: string;
  threadId: string;
  storeId: string;
  chatType: ChatType;
  ownerId: string;
  senderId: string;
  senderRole: "owner" | "manager" | "surveillance" | "employee" | "system";
  senderName: string;
  message: string;
  createdAt: string;
}

export interface OwnerSeenItem {
  id: string;
  ownerId: string;
  storeId: string;
  itemType: OwnerSeenType;
  itemId: string;
  seenAt: string;
}

export interface CombinedRecord {
  id: string;
  category: "shift" | ReportType | "surveillance" | "invoice";
  employeeName: string;
  storeNumber: string;
  createdAt: string;
  shiftNotes?: string;
  notes?: string;
  textContent?: string;
  attachments: StoredFile[];
  surveillanceLabel?: string;
  surveillanceSummary?: string;
  surveillanceGrade?: string;
  surveillanceGradeReason?: string;
  invoiceNotes?: string;
  invoiceCompany?: string;
  invoiceNumber?: string;
  invoiceAmountCents?: number;
  invoiceDueDate?: string;
  invoicePaid?: boolean;
  invoicePaymentMethod?: string;
  invoicePaymentDetails?: Record<string, unknown>;
  invoicePaidAmountCents?: number;
}

export interface RecordFilters {
  storeNumber?: string;
  category?: "shift" | ReportType | "surveillance" | "invoice" | "all";
  employee?: string;
  startDate?: string;
  endDate?: string;
}
