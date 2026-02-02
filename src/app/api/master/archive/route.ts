import { NextResponse } from "next/server";
import { getSessionUser, isMasterUser } from "@/lib/auth";
import { mockUsers } from "@/lib/users";
import {
  getDynamicUsers,
  listAllStores,
  type StoreRecord,
} from "@/lib/userStore";
import { getCombinedRecords } from "@/lib/dataStore";
import type { CombinedRecord } from "@/lib/types";

async function authorizeMaster() {
  const user = await getSessionUser();
  return isMasterUser(user);
}

export async function GET() {
  const user = await authorizeMaster();
  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [dynamicUsers, stores, records] = await Promise.all([
    getDynamicUsers(),
    listAllStores(),
    getCombinedRecords({}),
  ]);

  const managers = [
    ...mockUsers.filter((entry) => entry.role === "ironhand"),
    ...dynamicUsers.filter((entry) => entry.role === "ironhand"),
  ];

  const managerMap = new Map<string, { id: string; name: string; email: string }>();
  managers.forEach((manager) => {
    managerMap.set(manager.id, {
      id: manager.id,
      name: manager.name,
      email: manager.email,
    });
  });

  const recordsByStore = new Map<string, CombinedRecord[]>();
  records.forEach((record) => {
    if (!recordsByStore.has(record.storeNumber)) {
      recordsByStore.set(record.storeNumber, []);
    }
    recordsByStore.get(record.storeNumber)?.push(record);
  });
  recordsByStore.forEach((list) =>
    list.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    ),
  );

  const storesByManager = new Map<
    string,
    Array<StoreRecord & { records: CombinedRecord[] }>
  >();
  stores.forEach((store) => {
    const managerId = store.managerId ?? "unassigned";
    if (!storesByManager.has(managerId)) {
      storesByManager.set(managerId, []);
    }
    storesByManager.get(managerId)?.push({
      ...store,
      records: recordsByStore.get(store.storeId) ?? [],
    });
  });

  // Include stores that exist in record history but not in the store registry
  recordsByStore.forEach((storeRecords, storeId) => {
    if (stores.some((store) => store.storeId === storeId)) return;
    const managerId = "unassigned";
    if (!storesByManager.has(managerId)) {
      storesByManager.set(managerId, []);
    }
    storesByManager.get(managerId)?.push({
      id: storeId,
      storeId,
      name: `Store ${storeId}`,
      address: "",
      managerId,
      createdAt: "",
      records: storeRecords,
    });
  });

  const payload = Array.from(storesByManager.entries()).map(
    ([managerId, storeList]) => {
      const managerInfo =
        managerMap.get(managerId) ??
        ({
          id: managerId,
          name: managerId === "unassigned" ? "Unassigned stores" : "Unknown",
          email: "",
        } as const);
      return {
        managerId: managerInfo.id,
        managerName: managerInfo.name,
        managerEmail: managerInfo.email,
        stores: storeList.map((store) => ({
          storeId: store.storeId,
          storeName: store.name ?? `Store ${store.storeId}`,
          address: store.address,
          records: store.records,
        })),
      };
    },
  );

  return NextResponse.json({ managers: payload });
}
