import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import {
  createBaselineShiftReport,
  createScratcherSnapshot,
  getLatestScratcherStartSnapshotByStore,
} from "@/lib/dataStore";

const hasStoreAccess = (user: Awaited<ReturnType<typeof getSessionUser>>, storeId: string) => {
  if (!user) return false;
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
  const manager = requireRole(user, ["client", "ironhand"]);
  if (!manager) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("store_id") ?? manager.storeNumber;
  if (!storeId || !hasStoreAccess(manager, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const latest = await getLatestScratcherStartSnapshotByStore(storeId);
  if (!latest) {
    return NextResponse.json({ snapshot: null, items: [] });
  }

  return NextResponse.json({ snapshot: latest.snapshot, items: latest.items });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  const manager = requireRole(user, ["client", "ironhand"]);
  if (!manager) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const storeId = typeof body?.storeId === "string" ? body.storeId : manager.storeNumber;
  if (!storeId || !hasStoreAccess(manager, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) {
    return NextResponse.json({ error: "No snapshot items provided." }, { status: 400 });
  }

  const report = await createBaselineShiftReport({
    storeId,
    createdById: manager.id,
    createdByName: manager.name,
  });

  const result = await createScratcherSnapshot({
    shiftReportId: report.id,
    storeId,
    employeeUserId: manager.id,
    snapshotType: "start",
    items: items.map((item: any) => ({
      slotId: String(item.slotId ?? ""),
      ticketValue: String(item.ticketValue ?? "").trim(),
    })),
  });

  if (!result) {
    return NextResponse.json(
      { error: "Unable to save baseline start snapshot." },
      { status: 409 },
    );
  }

  return NextResponse.json({ snapshot: result.snapshot, items: result.items });
}
