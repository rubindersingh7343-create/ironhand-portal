import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import {
  deleteEmployeeAccount,
  listEmployeesForStoreIds,
  listStoresForManager,
} from "@/lib/userStore";

export async function GET(request: Request) {
  const user = await getSessionUser();
  const manager = requireRole(user, ["ironhand"]);
  if (!manager) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { searchParams } = new URL(request.url);
  const requestedStore = searchParams.get("storeId") ?? manager.storeNumber;
  const stores = await listStoresForManager(manager.id, manager.storeNumber);
  const resolvedStore =
    stores.find((store) => store.storeId === requestedStore) ??
    stores.find((store) => store.storeName === requestedStore);
  const storeId = resolvedStore?.storeId ?? requestedStore;
  const allowedStores = stores.length
    ? stores.map((store) => store.storeId)
    : manager.storeNumber
      ? [manager.storeNumber]
      : [];
  if (!allowedStores.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const employees = await listEmployeesForStoreIds([storeId]);
  return NextResponse.json({ employees });
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!requireRole(user, ["ironhand"])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const id = body?.id as string | undefined;
  if (!id) {
    return NextResponse.json({ error: "Employee id required." }, { status: 400 });
  }

  const success = await deleteEmployeeAccount(id);
  if (!success) {
    return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
