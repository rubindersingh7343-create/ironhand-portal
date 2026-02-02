import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getCombinedRecords } from "@/lib/dataStore";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "employee") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const daysParam = Number(searchParams.get("days"));
  const days =
    Number.isFinite(daysParam) && daysParam > 0
      ? Math.min(Math.floor(daysParam), 14)
      : 7;
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  if (!user.storeNumber || !user.name) {
    return NextResponse.json({ records: [] });
  }

  const records = await getCombinedRecords({
    category: "surveillance",
    storeNumber: user.storeNumber,
    employee: user.name,
    startDate,
  });

  return NextResponse.json({ records });
}
