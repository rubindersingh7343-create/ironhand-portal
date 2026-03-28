import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const ALLOWED_STATUSES = new Set([
  "idle",
  "preparing",
  "uploading",
  "uploaded",
  "processing",
  "needs_review",
  "complete",
  "error",
]);

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { error: "Storage not configured" },
      { status: 500 },
    );
  }

  const body = await request.json().catch(() => null);
  const storagePath =
    typeof body?.storagePath === "string" ? body.storagePath.trim() : "";
  const filename = typeof body?.filename === "string" ? body.filename.trim() : "";
  const category = typeof body?.category === "string" ? body.category.trim() : null;
  const mimeType = typeof body?.mimeType === "string" ? body.mimeType.trim() : null;
  const size =
    typeof body?.size === "number" && Number.isFinite(body.size)
      ? Math.max(0, Math.floor(body.size))
      : null;
  const statusRaw = typeof body?.status === "string" ? body.status.trim() : "uploaded";
  const status = ALLOWED_STATUSES.has(statusRaw) ? statusRaw : "uploaded";
  const errorMessage =
    typeof body?.errorMessage === "string" && body.errorMessage.trim().length
      ? body.errorMessage.trim()
      : null;
  const metadata =
    body?.metadata && typeof body.metadata === "object" ? body.metadata : null;

  if (!storagePath || !filename) {
    return NextResponse.json(
      { error: "storagePath and filename are required" },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("upload_items")
    .upsert(
      {
        storage_path: storagePath,
        filename,
        mime_type: mimeType,
        size,
        category,
        status,
        error_message: errorMessage,
        metadata,
        updated_at: now,
      },
      { onConflict: "storage_path" },
    )
    .select("id,status,error_message,created_at,updated_at")
    .maybeSingle();

  if (error || !data) {
    console.error("[uploads:finalize] failed:", error);
    return NextResponse.json(
      { error: "Unable to finalize upload." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    id: data.id,
    status: data.status,
    errorMessage: data.error_message,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  });
}

