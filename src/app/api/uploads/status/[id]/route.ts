import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { error: "Storage not configured" },
      { status: 500 },
    );
  }

  const { id } = await context.params;
  const serverId = typeof id === "string" ? id.trim() : "";
  if (!serverId) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("upload_items")
    .select("id,status,error_message,created_at,updated_at,storage_path,filename")
    .eq("id", serverId)
    .maybeSingle();

  if (error) {
    console.error("[uploads:status] failed:", error);
    return NextResponse.json(
      { error: "Unable to load upload status." },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: data.id,
    status: data.status,
    errorMessage: data.error_message,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    storagePath: data.storage_path,
    filename: data.filename,
  });
}

