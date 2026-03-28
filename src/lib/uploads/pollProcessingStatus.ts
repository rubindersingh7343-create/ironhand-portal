import type { UploadStatusResponse } from "@/lib/uploads/types";

export async function fetchUploadStatus(serverId: string): Promise<UploadStatusResponse> {
  const response = await fetch(`/api/uploads/status/${encodeURIComponent(serverId)}`, {
    cache: "no-store",
  });
  const raw: unknown = await response.json().catch(() => ({}));
  const data =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (!response.ok) {
    const message =
      typeof data.error === "string" && data.error.trim().length
        ? data.error
        : "Unable to load upload status.";
    throw new Error(message);
  }
  return data as unknown as UploadStatusResponse;
}
