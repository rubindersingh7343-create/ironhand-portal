import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  getCombinedRecordById,
  listSurveillanceInvestigations,
  upsertSurveillanceInvestigation,
} from "@/lib/dataStore";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "surveillance") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const reportId =
    searchParams.get("report_id") ?? searchParams.get("reportId");

  const storeIds =
    user.storeIds ?? (user.storeNumber ? [user.storeNumber] : []);
  if (!storeIds.length) {
    return NextResponse.json({ investigations: [] });
  }

  const investigations = await listSurveillanceInvestigations({
    storeIds,
    reportId: reportId ?? undefined,
  });
  const enriched = await Promise.all(
    investigations.map(async (investigation) => ({
      ...investigation,
      record: await getCombinedRecordById(investigation.reportId),
    })),
  );
  return NextResponse.json({ investigations: enriched });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "surveillance") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const storeId = typeof body.store_id === "string" ? body.store_id : body.storeId;
  const reportId =
    typeof body.report_id === "string" ? body.report_id : body.reportId;
  const status =
    typeof body.status === "string" ? body.status : "sent";
  const notes = typeof body.notes === "string" ? body.notes : undefined;
  const thread =
    typeof body.thread === "string" ? body.thread : undefined;

  if (!storeId || !reportId) {
    return NextResponse.json(
      { error: "Store and report are required." },
      { status: 400 },
    );
  }

  const allowedStores =
    user.storeIds ?? (user.storeNumber ? [user.storeNumber] : []);
  if (!allowedStores.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const existing = await listSurveillanceInvestigations({
    storeIds: [storeId],
    reportId,
  });
  const current = existing[0];
  if (!current) {
    return NextResponse.json(
      { error: "Investigation not found." },
      { status: 404 },
    );
  }

  try {
    const investigation = await upsertSurveillanceInvestigation({
      storeId,
      reportId,
      status,
      assignedToUserId: user.id,
      createdByOwnerId: current.createdByOwnerId,
      notes: thread ?? notes ?? current.notes,
    });
    return NextResponse.json({ investigation });
  } catch (error) {
    console.error("Failed to update surveillance investigation", error);
    const message =
      error && typeof error === "object" && "message" in error
        ? String(error.message)
        : "Unable to update surveillance investigation.";
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
