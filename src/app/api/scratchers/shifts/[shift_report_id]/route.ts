import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  getScratcherShiftCalculation,
  getShiftReportById,
  listShiftSubmissionUploadsByDate,
  listScratcherSlotBundle,
  listScratcherSnapshots,
  recalculateScratcherShift,
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

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ shift_report_id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { shift_report_id } = await context.params;
  let calculation = await getScratcherShiftCalculation(shift_report_id);
  const report = await getShiftReportById(shift_report_id);
  if (!calculation && !report) {
    return NextResponse.json({ calculation: null, report: null });
  }

  const storeId = calculation?.storeId ?? report?.storeId ?? "";
  if (!storeId || !hasStoreAccess(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (
    user.role !== "employee" &&
    calculation?.flags?.some((flag) => flag.startsWith("missing_product_"))
  ) {
    const updated = await recalculateScratcherShift({
      shiftReportId: shift_report_id,
      storeId,
    });
    if (updated) {
      calculation = updated;
    }
  }

  let endSnapshotItems: Array<{ slotId: string; slotNumber: number; ticketValue: string }> = [];
  try {
    if (storeId) {
      const { snapshots, items } = await listScratcherSnapshots(shift_report_id);
      const endSnapshot = snapshots.find((snap) => snap.snapshotType === "end");
      if (endSnapshot) {
        const endItems = items.filter((item) => item.snapshotId === endSnapshot.id);
        const bundle = await listScratcherSlotBundle(storeId);
        const slotNumberMap = new Map(bundle.slots.map((slot) => [slot.id, slot.slotNumber]));
        endSnapshotItems = endItems
          .map((item) => ({
            slotId: item.slotId,
            slotNumber: slotNumberMap.get(item.slotId) ?? 0,
            ticketValue: item.ticketValue,
          }))
          .filter((entry) => entry.ticketValue?.trim()?.length)
          .sort((a, b) => (a.slotNumber || 0) - (b.slotNumber || 0));
      }
    }
  } catch (error) {
    console.error("Unable to load scratcher end snapshot items:", error);
    endSnapshotItems = [];
  }

  let scratcherPhotos: any[] | null = null;
  try {
    if (report?.date && report?.storeId) {
      const uploads = await listShiftSubmissionUploadsByDate({
        storeNumber: report.storeId,
        date: report.date,
        employeeName: report.employeeName ?? undefined,
      });
      const files = uploads?.[0]?.files ?? [];
      const images = files
        .filter((file) => file?.kind === "image")
        .filter((file) => (file.label ?? "").toLowerCase().includes("scratcher"));
      const getRow = (file: any) => {
        const match = String(file?.label ?? "").match(/row(?:s)?\\s*(\\d+)/i);
        if (!match) return Number.POSITIVE_INFINITY;
        const parsed = Number(match[1]);
        return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
      };
      scratcherPhotos = images.length ? [...images].sort((a, b) => getRow(a) - getRow(b)) : null;
    }
  } catch (error) {
    console.error("Unable to load scratcher photos for shift:", error);
    scratcherPhotos = null;
  }

  return NextResponse.json({
    calculation: calculation ?? null,
    report: report ?? null,
    scratcherPhotos,
    endSnapshotItems,
  });
}
