import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  getLatestScratcherStartSnapshotByStore,
  listScratcherSlotBundle,
} from "@/lib/dataStore";

const hasStoreAccess = (user: Awaited<ReturnType<typeof getSessionUser>>, storeId: string) => {
  if (!user) return false;
  if (user.role === "employee") return user.storeNumber === storeId;
  if (user.role === "client") return (user.storeIds ?? []).includes(storeId);
  if (user.role === "ironhand") {
    if (user.storeNumber === "HQ" || user.portal === "master") return true;
    const stores = user.storeIds ?? (user.storeNumber ? [user.storeNumber] : []);
    return stores.includes(storeId);
  }
  return false;
};

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("store_id") ?? user.storeNumber;
  if (!storeId || !hasStoreAccess(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [bundle, baseline] = await Promise.all([
    listScratcherSlotBundle(storeId),
    getLatestScratcherStartSnapshotByStore(storeId),
  ]);
  return NextResponse.json({ ...bundle, baseline });
}
