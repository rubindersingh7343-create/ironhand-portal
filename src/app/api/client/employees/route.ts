import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  deleteDynamicUser,
  getClientStoreIds,
  getDynamicUsers,
  listEmployeesForStoreIds,
} from "@/lib/userStore";

async function getClientStoreSet(userId: string, fallbackStore: string): Promise<string[]> {
  const extra = await getClientStoreIds(userId);
  const all = new Set(extra.length ? extra : [fallbackStore].filter(Boolean));
  return Array.from(all) as string[];
}

export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "client") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const storeIds = await getClientStoreSet(user.id, user.storeNumber);
  const employees = await listEmployeesForStoreIds(storeIds);
  return NextResponse.json({ employees });
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "client") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const employeeId = body?.id as string | undefined;
  if (!employeeId) {
    return NextResponse.json({ error: "Employee id required" }, { status: 400 });
  }

  const storeIds = await getClientStoreSet(user.id, user.storeNumber);
  const employees = await listEmployeesForStoreIds(storeIds);
  const target = employees.find((entry) => entry.id === employeeId);
  if (!target) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  await deleteDynamicUser(employeeId);
  return NextResponse.json({ success: true });
}
