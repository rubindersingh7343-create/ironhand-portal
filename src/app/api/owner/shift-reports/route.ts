import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import {
  findLatestShiftReportDate,
  listInvestigations,
  listShiftReports,
  listShiftReportsRange,
} from "@/lib/dataStore";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.role !== "client" && !requireRole(user, ["ironhand", "surveillance"])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("store_id") ?? searchParams.get("storeId");
  const date = searchParams.get("date");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const fallback = searchParams.get("fallback") === "1";

  if (!storeId || (!date && (!startDate || !endDate))) {
    return NextResponse.json(
      { error: "Store and date are required." },
      { status: 400 },
    );
  }

  if (user.role === "client") {
    const allowedStores =
      user.storeIds ?? (user.storeNumber ? [user.storeNumber] : []);
    if (!allowedStores.includes(storeId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  let effectiveDate = date ?? "";
  let reports = [] as Awaited<ReturnType<typeof listShiftReports>>;
  const isRange = Boolean(startDate && endDate && startDate !== endDate);
  if (startDate && endDate && (isRange || !date)) {
    reports = await listShiftReportsRange({
      storeId,
      startDate,
      endDate,
    });
  } else if (date) {
    reports = await listShiftReports({ storeId, date });
    if (fallback && reports.length === 0) {
      const latestDate = await findLatestShiftReportDate({ storeId, date });
      if (latestDate && latestDate !== date) {
        effectiveDate = latestDate;
        reports = await listShiftReports({ storeId, date: latestDate });
      }
    }
  }

  const investigations =
    reports.length && effectiveDate
      ? await listInvestigations({
          storeId,
          date: effectiveDate,
          shiftReportIds: reports.map((report) => report.id),
        })
      : [];
  const investigationMap = new Map(
    investigations.map((record) => [record.shiftReportId, record]),
  );

  const rows = reports.map((report) => {
    const investigation = investigationMap.get(report.id);
    const scr = Number(report.scrAmount ?? 0);
    const cash = Number(report.cashAmount ?? 0);
    const net = Number(report.netAmount ?? 0);
    const hasDiscrepancy =
      Math.abs(scr) > 0.009 || Math.abs(cash) > 0.009 || Math.abs(net) > 0.009;
    return {
      ...report,
      hasDiscrepancy,
      investigationStatus: investigation?.status ?? (report.investigationFlag ? "sent" : "none"),
      investigationId: investigation?.id ?? null,
      lastUpdated: report.updatedAt,
    };
  });

  return NextResponse.json({ reports: rows, effectiveDate });
}
