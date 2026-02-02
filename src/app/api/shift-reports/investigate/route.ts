import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { flagShiftReport } from "@/lib/dataStore";

export async function POST(request: Request) {
  const user = await getSessionUser();
  const owner = requireRole(user, ["client"]);
  if (!owner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const reportId = body?.reportId as string | undefined;
  const reason = body?.reason as string | undefined;
  if (!reportId) {
    return NextResponse.json({ error: "Report ID required." }, { status: 400 });
  }

  const updated = await flagShiftReport({
    id: reportId,
    investigationFlag: true,
    investigationReason: reason,
  });

  if (!updated) {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }

  return NextResponse.json({ report: updated });
}
