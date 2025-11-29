import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getRecentShiftSubmissions } from "@/lib/dataStore";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "employee") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const daysParam = Number(searchParams.get("days"));
  const days =
    Number.isFinite(daysParam) && daysParam > 0
      ? Math.min(Math.floor(daysParam), 7)
      : 3;

  const submissions = await getRecentShiftSubmissions({
    storeNumber: user.storeNumber,
    employeeName: user.name,
    days,
  });

  return NextResponse.json({ submissions });
}
