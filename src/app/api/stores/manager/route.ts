import { NextResponse } from "next/server";
import { getSessionUser, isMasterUser, requireRole } from "@/lib/auth";
import {
  deleteStoreAndAccounts,
  listAllStores,
  setStoreManager,
} from "@/lib/userStore";

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!isMasterUser(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const { storeId, managerId } = (body ?? {}) as {
    storeId?: string;
    managerId?: string;
  };
  if (!storeId || !managerId) {
    return NextResponse.json(
      { error: "storeId and managerId are required." },
      { status: 400 },
    );
  }

  const success = await setStoreManager(storeId, managerId);
  if (!success) {
    return NextResponse.json({ error: "Store not found." }, { status: 404 });
  }

  const stores = await listAllStores();
  return NextResponse.json({ success: true, stores });
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user || !requireRole(user, ["ironhand"])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const storeId = body?.storeId as string | undefined;
  if (!storeId) {
    return NextResponse.json(
      { error: "storeId is required." },
      { status: 400 },
    );
  }

  const success = await deleteStoreAndAccounts(storeId);
  if (!success) {
    return NextResponse.json({ error: "Store not found." }, { status: 404 });
  }

  const stores = await listAllStores();
  return NextResponse.json({ success: true, stores });
}
