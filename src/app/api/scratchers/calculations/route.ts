import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  getShiftReportById,
  listScratcherCalculations,
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

  let calculations = await listScratcherCalculations(storeId);
  if (user.role !== "employee") {
    const needsRecalc = calculations.filter((calc) =>
      calc.flags.some((flag: string) => flag.startsWith("missing_product_")),
    );
    if (needsRecalc.length) {
      const recalculated = await Promise.all(
        needsRecalc.map((calc) =>
          recalculateScratcherShift({
            shiftReportId: calc.shiftReportId,
            storeId,
          }),
        ),
      );
      const updatedByShift = new Map(
        recalculated
          .filter((calc): calc is NonNullable<typeof calc> => Boolean(calc))
          .map((calc) => [calc.shiftReportId, calc]),
      );
      if (updatedByShift.size) {
        calculations = calculations.map(
          (calc) => updatedByShift.get(calc.shiftReportId) ?? calc,
        );
      }
    }
  }
  const reports = await Promise.all(
    calculations.map((calc) => getShiftReportById(calc.shiftReportId)),
  );
  const reportByShift = new Map(
    reports
      .filter((report) => report)
      .map((report) => [report!.id, report!]),
  );
  const hydrated = calculations.map((calc) => ({
    ...calc,
    report: reportByShift.get(calc.shiftReportId) ?? null,
  }));
  return NextResponse.json({ calculations: hydrated });
}
