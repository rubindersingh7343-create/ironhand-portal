import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { flagShiftReport, listInvestigations, upsertInvestigation } from "@/lib/dataStore";
import { getStoreManagerId } from "@/lib/userStore";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "client") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("store_id") ?? searchParams.get("storeId");
  const date = searchParams.get("date") ?? "";
  const shiftReportId =
    searchParams.get("shift_report_id") ?? searchParams.get("shiftReportId");

  if (!storeId || !date || !shiftReportId) {
    return NextResponse.json(
      { error: "Store, date, and shift report are required." },
      { status: 400 },
    );
  }

  const allowedStores =
    user.storeIds ?? (user.storeNumber ? [user.storeNumber] : []);
  if (!allowedStores.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const investigations = await listInvestigations({
    storeId,
    date,
    shiftReportIds: [shiftReportId],
  });
  const investigation = investigations[0] ?? null;
  return NextResponse.json({ investigation });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "client") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const storeId = typeof body.store_id === "string" ? body.store_id : body.storeId;
  const date = typeof body.date === "string" ? body.date : "";
  const shiftReportId =
    typeof body.shift_report_id === "string"
      ? body.shift_report_id
      : body.shiftReportId;
  const status =
    typeof body.status === "string" ? body.status : "sent";
  const notes = typeof body.notes === "string" ? body.notes : undefined;
  const thread =
    typeof body.thread === "string" ? body.thread : undefined;

  if (!storeId || !date || !shiftReportId) {
    return NextResponse.json(
      { error: "Store, date, and shift report are required." },
      { status: 400 },
    );
  }

  const allowedStores =
    user.storeIds ?? (user.storeNumber ? [user.storeNumber] : []);
  if (!allowedStores.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const managerId = await getStoreManagerId(storeId);
  if (!managerId) {
    return NextResponse.json(
      { error: "Store manager not found." },
      { status: 404 },
    );
  }

  const investigation = await upsertInvestigation({
    storeId,
    date,
    shiftReportId,
    status,
    assignedToUserId: managerId,
    createdByOwnerId: user.id,
    notes: thread ?? notes,
  });

  if (status === "resolved") {
    await flagShiftReport({
      id: shiftReportId,
      investigationFlag: false,
      investigationReason: notes,
    });
  } else {
    await flagShiftReport({
      id: shiftReportId,
      investigationFlag: true,
      investigationReason: notes,
    });
  }

  return NextResponse.json({ investigation });
}
