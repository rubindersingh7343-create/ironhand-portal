import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  getScratcherShiftCalculation,
  getShiftReportById,
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

  return NextResponse.json({ calculation: calculation ?? null, report: report ?? null });
}
