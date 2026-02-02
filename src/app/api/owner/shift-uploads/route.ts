import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { listShiftSubmissionUploadsByDate } from "@/lib/dataStore";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "client") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("store_id") ?? searchParams.get("storeId");
  const date = searchParams.get("date") ?? "";
  const employeeName =
    searchParams.get("employee_name") ?? searchParams.get("employeeName") ?? "";

  if (!storeId || !date) {
    return NextResponse.json(
      { error: "Store and date are required." },
      { status: 400 },
    );
  }

  const allowedStores =
    user.storeIds ?? (user.storeNumber ? [user.storeNumber] : []);
  if (!allowedStores.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const uploads = await listShiftSubmissionUploadsByDate({
    storeNumber: storeId,
    date,
    employeeName: employeeName || undefined,
  });

  if (employeeName) {
    const files = uploads.flatMap((entry) => entry.files);
    return NextResponse.json({ files });
  }

  return NextResponse.json({ uploads });
}
