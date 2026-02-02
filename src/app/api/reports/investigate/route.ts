import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { addReport, updateReportNotes } from "@/lib/dataStore";

export async function POST(request: Request) {
  const user = await getSessionUser();
  const owner = requireRole(user, ["client"]);
  if (!owner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const reportId = body?.reportId as string | undefined;
  const reason = body?.reason as string | undefined;
  const storeNumber = body?.storeNumber as string | undefined;
  const storeName = body?.storeName as string | undefined;
  const textContent = body?.textContent as string | undefined;
  const reportDate = body?.reportDate as string | undefined;
  const thread = body?.thread as string | undefined;

  const notes = thread ?? (reason?.trim()
    ? `Investigation requested: ${reason.trim()}`
    : "Investigation requested.");

  if (reportId) {
    const updated = await updateReportNotes({ id: reportId, notes });
    if (updated) {
      return NextResponse.json({ report: updated, reportId: updated.id });
    }
  }

  if (!storeNumber) {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }

  const fallbackText = textContent?.trim()
    ? textContent
    : JSON.stringify({ date: reportDate ?? new Date().toISOString().slice(0, 10) });
  const created = await addReport({
    employeeName: storeName ?? `Store ${storeNumber}`,
    storeNumber,
    reportType: "daily",
    notes,
    textContent: fallbackText,
    attachments: [],
  });

  return NextResponse.json({ report: created, reportId: created.id });
}
