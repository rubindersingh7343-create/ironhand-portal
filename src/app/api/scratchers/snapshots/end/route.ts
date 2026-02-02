import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import {
  createScratcherSnapshot,
  ensureShiftReportDraft,
  getLatestScratcherStartSnapshotByStore,
  listScratcherSlotBundle,
  listScratcherSnapshots,
} from "@/lib/dataStore";

const parseTicketNumber = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

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

export async function POST(request: Request) {
  const user = await getSessionUser();
  const actor = requireRole(user, ["employee", "client"]);
  if (!actor) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const storeId = typeof body?.storeId === "string" ? body.storeId : actor.storeNumber;
  const date = typeof body?.date === "string" ? body.date : new Date().toISOString().slice(0, 10);
  if (!storeId || !hasStoreAccess(actor, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) {
    return NextResponse.json({ error: "No snapshot items provided." }, { status: 400 });
  }

  const report = await ensureShiftReportDraft({
    storeId,
    employeeId: actor.id,
    employeeName: actor.name,
    date,
  });

  const { snapshots, items: existingItems } = await listScratcherSnapshots(report.id);
  let startSnapshot = snapshots.find((snap) => snap.snapshotType === "start");
  let startItems = startSnapshot
    ? existingItems.filter((item) => item.snapshotId === startSnapshot?.id)
    : [];

  if (!startSnapshot) {
    const latestBaseline = await getLatestScratcherStartSnapshotByStore(storeId);
    if (!latestBaseline) {
      return NextResponse.json(
        { error: "Baseline start snapshot is required before ending." },
        { status: 409 },
      );
    }
    const cloneResult = await createScratcherSnapshot({
      shiftReportId: report.id,
      storeId,
      employeeUserId: actor.id,
      snapshotType: "start",
      items: latestBaseline.items.map((item) => ({
        slotId: item.slotId,
        ticketValue: item.ticketValue,
      })),
    });
    if (cloneResult) {
      startSnapshot = cloneResult.snapshot;
      startItems = cloneResult.items;
    }
  }

  if (!startSnapshot) {
    return NextResponse.json(
      { error: "Baseline start snapshot is required before ending." },
      { status: 409 },
    );
  }

  if (startItems.length === 0) {
    const latestBaseline = await getLatestScratcherStartSnapshotByStore(storeId);
    startItems = latestBaseline?.items ?? [];
  }
  const startMap = new Map(startItems.map((item) => [item.slotId, item]));
  const { slots } = await listScratcherSlotBundle(storeId);
  const slotMap = new Map(slots.map((slot) => [slot.id, slot]));

  const rolloverSlots: Array<{ slotId: string; slotNumber: number }> = [];
  items.forEach((item: any) => {
    const slotId = String(item.slotId ?? "");
    const startItem = startMap.get(slotId);
    const slot = slotMap.get(slotId);
    const startValue = parseTicketNumber(startItem?.ticketValue ?? "");
    const endValue = parseTicketNumber(String(item.ticketValue ?? ""));
    if (startValue === null || endValue === null || !startItem) return;
    if (endValue < startValue) {
      const activePackId = slot?.activePackId ?? null;
      const samePack = activePackId && activePackId === (startItem.packId ?? null);
      if (samePack) {
        rolloverSlots.push({ slotId, slotNumber: slot?.slotNumber ?? 0 });
      }
    }
  });

  if (rolloverSlots.length) {
    return NextResponse.json(
      {
        error: "Pack rollover detected. Activate a new pack before submitting end snapshot.",
        rolloverSlots,
      },
      { status: 409 },
    );
  }

  const result = await createScratcherSnapshot({
    shiftReportId: report.id,
    storeId,
    employeeUserId: actor.id,
    snapshotType: "end",
    items: items.map((item: any) => ({
      slotId: String(item.slotId ?? ""),
      ticketValue: String(item.ticketValue ?? "").trim(),
    })),
  });

  if (!result) {
    return NextResponse.json(
      { error: "End snapshot already exists." },
      { status: 409 },
    );
  }

  return NextResponse.json({
    shiftReportId: report.id,
    snapshot: result.snapshot,
    items: result.items,
  });
}
