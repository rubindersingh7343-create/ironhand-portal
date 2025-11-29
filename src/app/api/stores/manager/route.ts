import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { deleteStoreAndAccounts, listAllStores } from "@/lib/userStore";
import { readFile, writeFile } from "fs/promises";
import path from "path";

const STORES_PATH = path.join(process.cwd(), "data", "stores.json");

async function updateStoreManager(storeId: string, managerId: string) {
  const data = await readFile(STORES_PATH, "utf-8").catch(() => "[]");
  const stores = JSON.parse(data) as Array<any>;
  const store = stores.find((entry) => entry.storeId === storeId);
  if (!store) return false;
  store.managerId = managerId;
  await writeFile(STORES_PATH, JSON.stringify(stores, null, 2), "utf-8");
  return true;
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user || !requireRole(user, ["ironhand"]) || user.storeNumber !== "HQ") {
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

  const success = await updateStoreManager(storeId, managerId);
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
