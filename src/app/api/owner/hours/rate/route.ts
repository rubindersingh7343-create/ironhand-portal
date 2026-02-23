import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { upsertEmployeeHourlyRate } from "@/lib/dataStore";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "client") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const payload = (await request.json().catch(() => null)) as
    | { storeId?: string; employeeId?: string; hourlyRate?: number }
    | null;
  const storeId = payload?.storeId ?? "";
  const employeeId = payload?.employeeId ?? "";
  const hourlyRate = Number(payload?.hourlyRate ?? NaN);
  if (!storeId || !employeeId || !Number.isFinite(hourlyRate)) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }
  const allowedStores =
    user.storeIds ?? (user.storeNumber ? [user.storeNumber] : []);
  if (!allowedStores.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await upsertEmployeeHourlyRate({
    storeId,
    employeeId,
    hourlyRate: Number(hourlyRate.toFixed(2)),
  });
  return NextResponse.json({ success: true });
}
