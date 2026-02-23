import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createEmployeeHoursEntry, listEmployeeHoursEntries } from "@/lib/dataStore";

const parseMonth = (value?: string | null) => {
  if (value && /^\d{4}-\d{2}$/.test(value)) return value;
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}`;
};

const toMinutes = (value: string) => {
  const [h, m] = value.split(":").map((part) => Number(part));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
};

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "employee") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { searchParams } = new URL(request.url);
  const month = parseMonth(searchParams.get("month"));
  const entries = await listEmployeeHoursEntries({
    storeId: user.storeNumber,
    employeeId: user.id,
    month,
  });
  return NextResponse.json({ entries, month });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "employee") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const payload = (await request.json().catch(() => null)) as
    | {
        date?: string;
        startTime?: string;
        endTime?: string;
        breakMinutes?: number;
        notes?: string;
      }
    | null;
  if (!payload?.date || !payload?.startTime || !payload?.endTime) {
    return NextResponse.json({ error: "Missing fields." }, { status: 400 });
  }
  const startMinutes = toMinutes(payload.startTime);
  const endMinutes = toMinutes(payload.endTime);
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return NextResponse.json({ error: "Invalid time range." }, { status: 400 });
  }
  const breakMinutes = Math.max(0, Number(payload.breakMinutes ?? 0));
  const rawMinutes = Math.max(0, endMinutes - startMinutes - breakMinutes);
  const hours = Number((rawMinutes / 60).toFixed(2));

  await createEmployeeHoursEntry({
    storeId: user.storeNumber,
    employeeId: user.id,
    employeeName: user.name,
    date: payload.date,
    startTime: payload.startTime,
    endTime: payload.endTime,
    breakMinutes,
    hours,
    notes: payload.notes?.trim() || undefined,
  });

  return NextResponse.json({ success: true });
}
