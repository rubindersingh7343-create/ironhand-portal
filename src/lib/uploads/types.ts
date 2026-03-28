export type UploadStatus =
  | "idle"
  | "preparing"
  | "uploading"
  | "uploaded"
  | "processing"
  | "needs_review"
  | "complete"
  | "error";

export const TERMINAL_UPLOAD_STATUSES: ReadonlySet<UploadStatus> = new Set([
  "complete",
  "needs_review",
  "error",
]);

export type UploadItem = {
  localId: string;
  serverId?: string;
  filename: string;
  previewUrl?: string | null;
  progress: number;
  uploadedBytes: number;
  totalBytes: number;
  status: UploadStatus;
  errorMessage?: string | null;
  createdAt: string;

  mimeType?: string;
  storagePath?: string;
};

export type SignedUploadTarget = {
  path: string;
  token: string;
  signedUrl?: string;
};

export type FinalizeUploadPayload = {
  storagePath: string;
  filename: string;
  mimeType?: string | null;
  size?: number | null;
  category?: string | null;
  status?: UploadStatus;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type FinalizeUploadResponse = {
  id: string;
  status: UploadStatus;
  errorMessage?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type UploadStatusResponse = {
  id: string;
  status: UploadStatus;
  errorMessage?: string | null;
  createdAt?: string;
  updatedAt?: string;
  storagePath?: string;
  filename?: string;
};

