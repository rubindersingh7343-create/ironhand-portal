import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { listAllStores, getDynamicUsers } from "@/lib/userStore";
import { mockUsers } from "@/lib/users";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !requireRole(user, ["ironhand"])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const [stores, dynamicUsers] = await Promise.all([
    listAllStores(),
    getDynamicUsers(),
  ]);
  const userMap = new Map(
    [...mockUsers, ...dynamicUsers].map((manager) => [manager.id, manager]),
  );
  const enriched = stores.map((store) => {
    const manager = userMap.get(store.managerId);
    return {
      storeId: store.storeId,
      storeName: store.name,
      address: store.address,
      managerId: store.managerId,
      managerName: manager?.name ?? "—",
      managerEmail: manager?.email ?? "—",
    };
  });
  return NextResponse.json({ stores: enriched });
}
