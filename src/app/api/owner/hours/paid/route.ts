import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { upsertEmployeeHoursPayment } from "@/lib/dataStore";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "client") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const payload = (await request.json().catch(() => null)) as
    | {
        storeId?: string;
        employeeId?: string;
        month?: string;
        totalHours?: number;
        hourlyRate?: number;
        totalPay?: number;
      }
    | null;

  const storeId = payload?.storeId ?? "";
  const employeeId = payload?.employeeId ?? "";
  const month = payload?.month ?? "";
  const totalHours = Number(payload?.totalHours ?? NaN);
  const hourlyRate = Number(payload?.hourlyRate ?? NaN);
  const totalPay = Number(payload?.totalPay ?? NaN);

  if (
    !storeId ||
    !employeeId ||
    !/^\d{4}-\d{2}$/.test(month) ||
    !Number.isFinite(totalHours) ||
    !Number.isFinite(hourlyRate) ||
    !Number.isFinite(totalPay)
  ) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const allowedStores =
    user.storeIds ?? (user.storeNumber ? [user.storeNumber] : []);
  if (!allowedStores.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await upsertEmployeeHoursPayment({
    storeId,
    employeeId,
    month,
    totalHours: Number(totalHours.toFixed(2)),
    hourlyRate: Number(hourlyRate.toFixed(2)),
    totalPay: Number(totalPay.toFixed(2)),
  });

  return NextResponse.json({ success: true });
}
