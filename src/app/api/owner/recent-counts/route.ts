import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { listRecentUploadCounts } from "@/lib/dataStore";

const shiftDateString = (value: string, delta: number) => {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  date.setDate(date.getDate() + delta);
  return date.toISOString().slice(0, 10);
};

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "client") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("storeId") ?? searchParams.get("store_id");
  const todayParam = searchParams.get("today") ?? "";
  const yesterdayParam = searchParams.get("yesterday") ?? "";
  const timeZone = searchParams.get("tz") ?? undefined;

  if (!storeId) {
    return NextResponse.json(
      { error: "Store is required." },
      { status: 400 },
    );
  }

  const allowedStores =
    user.storeIds ?? (user.storeNumber ? [user.storeNumber] : []);
  if (!allowedStores.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const today =
    todayParam || new Date().toLocaleDateString("en-CA");
  const yesterday = yesterdayParam || shiftDateString(today, -1);

  const counts = await listRecentUploadCounts({
    ownerId: user.id,
    storeId,
    today,
    yesterday,
    timeZone,
  });

  return NextResponse.json({ today, yesterday, counts });
}
