import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET ?? "uploads";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Storage not configured" },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);
  const path = searchParams.get("path");
  const name = searchParams.get("name") ?? "file";

  if (!path) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const cleanedPaths = (() => {
    const paths = new Set<string>();
    const push = (p?: string | null) => {
      if (!p) return;
      const trimmed = p.replace(/^\/+/, "");
      if (trimmed) paths.add(trimmed);
    };

    const trimmedPath = path.replace(/^\/+/, "");
    push(trimmedPath);

    // If the path includes a full public URL, strip the prefix.
    const publicPrefix = /https?:\/\/[^/]+\/storage\/v1\/object\/public\/[^/]+\//;
    const signPrefix = /https?:\/\/[^/]+\/storage\/v1\/object\/sign\/[^/]+\//;
    if (publicPrefix.test(trimmedPath)) {
      push(trimmedPath.replace(publicPrefix, ""));
    }
    if (signPrefix.test(trimmedPath)) {
      push(trimmedPath.replace(signPrefix, ""));
    }
    // If the path starts with the bucket name, strip it.
    if (trimmedPath.startsWith(`${SUPABASE_BUCKET}/`)) {
      push(trimmedPath.replace(`${SUPABASE_BUCKET}/`, ""));
    }

    // Also try using the file id if callers sent that instead of path.
    const idParam = searchParams.get("id");
    push(idParam);
    if (idParam && idParam.startsWith(`${SUPABASE_BUCKET}/`)) {
      push(idParam.replace(`${SUPABASE_BUCKET}/`, ""));
    }

    return Array.from(paths);
  })();

  let signedUrl: string | null = null;
  for (const candidate of cleanedPaths) {
    const { data, error } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .createSignedUrl(candidate, 60);
    if (!error && data?.signedUrl) {
      signedUrl = data.signedUrl;
      break;
    }
  }

  if (!signedUrl) {
    return NextResponse.json({ error: "Object not found" }, { status: 404 });
  }

  const rangeHeader = request.headers.get("range") ?? undefined;
  const upstream = await fetch(signedUrl, {
    headers: rangeHeader ? { range: rangeHeader } : undefined,
  });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: "Unable to fetch file" },
      { status: 404 },
    );
  }

  const headers = new Headers();
  const copy = [
    "content-type",
    "content-length",
    "accept-ranges",
    "content-range",
    "cache-control",
  ];
  copy.forEach((key) => {
    const val = upstream.headers.get(key);
    if (val) headers.set(key, val);
  });
  headers.set("Content-Disposition", `inline; filename="${name}"`);
  // Fallback cache-control
  if (!headers.has("cache-control"))
    headers.set("cache-control", "private, max-age=300");

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers,
  });
}
