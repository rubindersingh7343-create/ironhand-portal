import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { findLatestShiftReportDate, listShiftReports, upsertShiftReport } from "@/lib/dataStore";
import { listEmployeesForStoreIds } from "@/lib/userStore";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("storeId");
  const date = searchParams.get("date");
  const fallback = searchParams.get("fallback") === "1";
  if (!storeId || !date) {
    return NextResponse.json(
      { error: "Store and date are required." },
      { status: 400 },
    );
  }

  if (user.role === "client") {
    const allowedStores = user.storeIds ?? (user.storeNumber ? [user.storeNumber] : []);
    if (!allowedStores.includes(storeId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else if (!requireRole(user, ["ironhand", "surveillance"])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let reports = await listShiftReports({ storeId, date });
  if (fallback && reports.length === 0) {
    const latestDate = await findLatestShiftReportDate({ storeId, date });
    if (latestDate && latestDate !== date) {
      reports = await listShiftReports({ storeId, date: latestDate });
      return NextResponse.json({ reports, effectiveDate: latestDate });
    }
  }
  return NextResponse.json({ reports });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  const manager = requireRole(user, ["ironhand"]);
  if (!manager) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const date = typeof body.date === "string" ? body.date : "";
  const storeId =
    typeof body.storeId === "string" && body.storeId.length
      ? body.storeId
      : manager.storeNumber;
  const scrAmount = Number(body.scrAmount ?? body.scr ?? 0);
  const cashAmount = Number(body.cashAmount ?? body.cash ?? 0);
  const netAmount = Number(body.netAmount ?? body.net ?? 0);
  const employeeId = typeof body.employeeId === "string" ? body.employeeId : "";
  const lottoAmount = Number(body.lottoAmount ?? body.lotto ?? 0);
  const grossAmount = Number(body.grossAmount ?? body.gross ?? netAmount ?? 0);
  const computedCash =
    Number.isFinite(grossAmount) && Number.isFinite(lottoAmount) && Number.isFinite(scrAmount)
      ? grossAmount - lottoAmount + scrAmount
      : 0;
  const resolvedCashAmount =
    Number.isFinite(cashAmount) && cashAmount !== 0 ? cashAmount : computedCash;
  const resolvedStoreAmount =
    Number.isFinite(netAmount) && netAmount !== 0 ? netAmount : resolvedCashAmount;

  if (!date || !employeeId) {
    return NextResponse.json(
      { error: "Date and employee are required." },
      { status: 400 },
    );
  }

  const employees = await listEmployeesForStoreIds([storeId]);
  const employee = employees.find((entry) => entry.id === employeeId);
  if (!employee) {
    return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  }

  const report = await upsertShiftReport({
    storeId,
    managerId: manager.id,
    managerName: manager.name,
    employeeId: employee.id,
    employeeName: employee.name,
    date,
    grossAmount: Number.isFinite(grossAmount) ? grossAmount : 0,
    liquorAmount: Number(body.liquorAmount ?? body.liquor ?? 0) || 0,
    beerAmount: Number(body.beerAmount ?? body.beer ?? 0) || 0,
    cigAmount: Number(body.cigAmount ?? body.cig ?? 0) || 0,
    tobaccoAmount: Number(body.tobaccoAmount ?? body.tobacco ?? 0) || 0,
    gasAmount: Number(body.gasAmount ?? body.gas ?? 0) || 0,
    atmAmount: Number(body.atmAmount ?? body.atm ?? 0) || 0,
    lottoPoAmount: Number(body.lottoPoAmount ?? body.lottoPo ?? 0) || 0,
    depositAmount: Number(body.depositAmount ?? body.deposit ?? 0) || 0,
    scrAmount: Number.isFinite(scrAmount) ? scrAmount : 0,
    lottoAmount: Number.isFinite(lottoAmount) ? lottoAmount : 0,
    cashAmount: Number.isFinite(resolvedCashAmount) ? resolvedCashAmount : 0,
    storeAmount: Number.isFinite(resolvedStoreAmount) ? resolvedStoreAmount : 0,
    customFields: Array.isArray(body.customFields) ? body.customFields : [],
  });

  return NextResponse.json({ report });
}
