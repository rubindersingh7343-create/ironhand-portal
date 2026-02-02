import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  listSurveillanceInvestigations,
  upsertSurveillanceInvestigation,
} from "@/lib/dataStore";
import { getSurveillanceManagerId } from "@/lib/userStore";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "client") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("store_id") ?? searchParams.get("storeId");
  const reportId =
    searchParams.get("report_id") ?? searchParams.get("reportId");

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

  const investigations = await listSurveillanceInvestigations({
    storeIds: [storeId],
    reportId,
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

  const surveillanceId = await getSurveillanceManagerId(storeId);
  const assignedToUserId = surveillanceId ?? user.id;

  try {
    const investigation = await upsertSurveillanceInvestigation({
      storeId,
      reportId,
      status,
      assignedToUserId,
      createdByOwnerId: user.id,
      notes: thread ?? notes,
    });
    return NextResponse.json({ investigation });
  } catch (error) {
    console.error("Failed to save surveillance investigation", error);
    const message =
      error && typeof error === "object" && "message" in error
        ? String(error.message)
        : "Unable to save surveillance investigation.";
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
