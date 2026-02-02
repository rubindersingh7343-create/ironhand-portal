import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getScratcherFileById } from "@/lib/dataStore";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get("id") ?? "";
  if (!fileId) {
    return NextResponse.json({ error: "Missing file ID." }, { status: 400 });
  }

  const file = await getScratcherFileById(fileId);
  if (!file) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  return NextResponse.json({ file });
}
