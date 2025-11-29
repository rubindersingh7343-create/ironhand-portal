import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { addReport, saveUploadedFile } from "@/lib/dataStore";
import type { ReportType, StoredFile } from "@/lib/types";

const VALID_TYPES: ReportType[] = ["daily", "weekly", "monthly"];

export async function POST(request: Request) {
  const sessionUser = await getSessionUser();
  const user = requireRole(sessionUser, ["ironhand"]);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const formData = await request.formData();
  const reportType = formData.get("reportType")?.toString() as ReportType;
  const notes = formData.get("notes")?.toString() ?? "";
  const targetStore =
    formData.get("storeNumber")?.toString()?.trim() || user.storeNumber;

  if (!reportType || !VALID_TYPES.includes(reportType)) {
    return NextResponse.json(
      { error: "A valid report type is required." },
      { status: 400 },
    );
  }

  const attachments: StoredFile[] = [];
  let textContent = "";

  if (reportType === "daily") {
    const summary = formData.get("dailySummary")?.toString().trim();
    if (!summary) {
      return NextResponse.json(
        { error: "Daily report summary is required." },
        { status: 400 },
      );
    }
    textContent = summary;
    const media = formData.get("dailyMedia");
    if (media instanceof File && media.size > 0) {
      attachments.push(
        await saveUploadedFile(media, {
          folder: "reports",
          label: "Daily Report Media",
        }),
      );
    }
  }

  if (reportType === "weekly") {
    const ordersList = formData.get("weeklyList")?.toString().trim() ?? "";
    const weeklyFile = formData.get("weeklyFile");
    if (
      (!ordersList || ordersList.length === 0) &&
      (!(weeklyFile instanceof File) || weeklyFile.size === 0)
    ) {
      return NextResponse.json(
        { error: "Weekly orders require a text list or file upload." },
        { status: 400 },
      );
    }
    textContent = ordersList;
    if (weeklyFile instanceof File && weeklyFile.size > 0) {
      attachments.push(
        await saveUploadedFile(weeklyFile, {
          folder: "reports",
          label: "Weekly Orders Attachment",
        }),
      );
    }
  }

  if (reportType === "monthly") {
    const monthlyFile = formData.get("monthlyFile");
    if (!(monthlyFile instanceof File) || monthlyFile.size === 0) {
      return NextResponse.json(
        { error: "Monthly reports require an uploaded document." },
        { status: 400 },
      );
    }
    attachments.push(
      await saveUploadedFile(monthlyFile, {
        folder: "reports",
        label: "Monthly Report File",
      }),
    );
  }

  const report = await addReport({
    employeeName: user.name,
    storeNumber: targetStore,
    reportType,
    notes,
    textContent,
    attachments,
  });

  return NextResponse.json({ report });
}
