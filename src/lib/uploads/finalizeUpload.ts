import type { FinalizeUploadPayload, FinalizeUploadResponse } from "@/lib/uploads/types";

export async function finalizeUpload(
  payload: FinalizeUploadPayload,
  init?: RequestInit,
): Promise<FinalizeUploadResponse> {
  const response = await fetch("/api/uploads/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    body: JSON.stringify(payload),
    ...init,
  });
  const raw: unknown = await response.json().catch(() => ({}));
  const data =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (!response.ok) {
    const message =
      typeof data.error === "string" && data.error.trim().length
        ? data.error
        : "Unable to finalize upload.";
    throw new Error(message);
  }
  return data as unknown as FinalizeUploadResponse;
}
