import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET ?? "uploads";

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

export async function POST(request: Request) {
  if (!supabase) {
    return NextResponse.json(
      { error: "Storage not configured" },
      { status: 500 },
    );
  }

  const body = await request.json().catch(() => null);
  const files = Array.isArray(body?.files) ? body.files : [];
  if (!files.length) {
    return NextResponse.json(
      { error: "No files requested" },
      { status: 400 },
    );
  }

  const results: Array<{ path: string; token: string }> = [];
  for (const file of files) {
    const rawName =
      typeof file?.name === "string" && file.name.length
        ? file.name
        : "upload";
    const sanitized = rawName.replace(/[^a-zA-Z0-9.\-]/g, "_");
    const path =
      typeof file?.path === "string" && file.path.length
        ? file.path
        : `${file?.folder ?? "uploads"}/${randomUUID()}-${sanitized}`;
    const { data, error } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data) {
      return NextResponse.json(
        { error: `Failed to sign upload: ${error?.message ?? "unknown"}` },
        { status: 500 },
      );
    }
    results.push({ path, token: data.token });
  }

  return NextResponse.json({ uploads: results });
}
