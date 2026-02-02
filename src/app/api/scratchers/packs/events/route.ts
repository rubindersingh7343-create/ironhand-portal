import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import {
  createScratcherPackEvent,
  getScratcherPackById,
  listScratcherPackEvents,
  saveScratcherFile,
} from "@/lib/dataStore";

const hasStoreAccess = (user: Awaited<ReturnType<typeof getSessionUser>>, storeId: string) => {
  if (!user) return false;
  if (user.role === "employee") return user.storeNumber === storeId;
  if (user.role === "client") return (user.storeIds ?? []).includes(storeId);
  if (user.role === "ironhand") {
    if (user.storeNumber === "HQ" || user.portal === "master") return true;
    const stores = user.storeIds ?? (user.storeNumber ? [user.storeNumber] : []);
    return stores.includes(storeId);
  }
  return false;
};

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("store_id") ?? user.storeNumber;
  if (!storeId || !hasStoreAccess(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const events = await listScratcherPackEvents(storeId);
  return NextResponse.json({ events });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const manager = requireRole(user, ["ironhand", "client"]);
  const isEmployee = user.role === "employee";
  if (!manager && !isEmployee) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  type PackEventType =
    | "correction"
    | "note"
    | "ended"
    | "activated"
    | "return_receipt";
  let packId = "";
  let eventType: PackEventType = "note";
  let note: string | null = null;
  let fileId: string | null = null;

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    packId = String(formData.get("packId") ?? "");
    eventType =
      (String(formData.get("eventType") ?? "note") as PackEventType) ?? "note";
    note = formData.get("note") ? String(formData.get("note")) : null;
    const file = formData.get("file");
    if (file instanceof File && file.size > 0) {
      const stored = await saveScratcherFile(file, "Scratcher Pack Event");
      fileId = stored.id;
    }
  } else {
    const body = await request.json().catch(() => null);
    packId = typeof body?.packId === "string" ? body.packId : "";
    eventType = (body?.eventType as PackEventType) ?? "note";
    note = typeof body?.note === "string" ? body.note : null;
    fileId = typeof body?.fileId === "string" ? body.fileId : null;
  }

  if (!packId) {
    return NextResponse.json({ error: "Missing pack ID." }, { status: 400 });
  }

  const pack = await getScratcherPackById(packId);
  if (!pack || !hasStoreAccess(user, pack.storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (isEmployee && eventType !== "return_receipt") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (eventType === "return_receipt" && !fileId) {
    return NextResponse.json({ error: "Pickup receipt is required." }, { status: 400 });
  }

  const event = await createScratcherPackEvent({
    packId,
    eventType,
    createdByUserId: user.id,
    note,
    fileId,
  });

  if (!event) {
    return NextResponse.json({ error: "Unable to create event." }, { status: 500 });
  }

  return NextResponse.json({ event });
}
