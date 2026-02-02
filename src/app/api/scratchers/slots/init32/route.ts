import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { initScratcherSlots } from "@/lib/dataStore";

export async function POST(request: Request) {
  const user = await getSessionUser();
  const manager = requireRole(user, ["ironhand", "client"]);
  if (!manager) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const storeId = typeof body?.storeId === "string" ? body.storeId : manager.storeNumber;
  if (!storeId) {
    return NextResponse.json({ error: "Store is required." }, { status: 400 });
  }

  const slots = await initScratcherSlots(storeId);
  return NextResponse.json({ slots });
}
