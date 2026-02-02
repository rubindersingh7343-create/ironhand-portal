import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  getCombinedRecordById,
  getCombinedRecords,
  getShiftReportById,
  listOpenInvestigations,
  listOpenSurveillanceInvestigations,
} from "@/lib/dataStore";

export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "client") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allowedStores =
    user.storeIds ?? (user.storeNumber ? [user.storeNumber] : []);
  const storeIds = [...new Set(allowedStores.filter(Boolean))];
  if (!storeIds.length) {
    return NextResponse.json({ shift: [], fullDay: [], surveillance: [] });
  }

  const [shiftInvestigations, surveillanceInvestigations] = await Promise.all([
    listOpenInvestigations({ storeIds }),
    listOpenSurveillanceInvestigations({ storeIds }),
  ]);

  const shiftItems = (
    await Promise.all(
      shiftInvestigations.map(async (investigation) => {
        const report = await getShiftReportById(investigation.shiftReportId);
        if (!report) return null;
        return { investigation, report };
      }),
    )
  ).filter(Boolean);

  const fullDayRecords = (
    await Promise.all(
      storeIds.map((storeId) =>
        getCombinedRecords({ category: "daily", storeNumber: storeId }),
      ),
    )
  ).flat();
  const fullDayItems = fullDayRecords.filter((record) =>
    (record.notes ?? "").toLowerCase().includes("investigation requested"),
  );

  const surveillanceItems = (
    await Promise.all(
      surveillanceInvestigations.map(async (investigation) => {
        const record = await getCombinedRecordById(investigation.reportId);
        if (!record) return null;
        return { investigation, record };
      }),
    )
  ).filter(Boolean);

  return NextResponse.json({
    shift: shiftItems,
    fullDay: fullDayItems,
    surveillance: surveillanceItems,
  });
}
