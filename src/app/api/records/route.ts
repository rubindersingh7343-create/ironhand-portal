import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  deleteRecordById,
  getCombinedRecords,
  listStoreNumbers,
} from "@/lib/dataStore";
import { getStoreSummariesByIds, listStoresForManager } from "@/lib/userStore";
import type { RecordFilters } from "@/lib/types";

async function buildStorePayload(ids: string[]) {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!unique.length) return [];
  const summaries = await getStoreSummariesByIds(unique);
  const summaryMap = new Map(summaries.map((summary) => [summary.storeId, summary]));
  return unique.map((id) => {
    const found = summaryMap.get(id);
    return found ?? { storeId: id, storeName: `Store ${id}` };
  });
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isManager =
    user.role === "ironhand" && user.portal !== "master";
  const managedStores = isManager
    ? await listStoresForManager(user.id)
    : [];
  const managedStoreIds = managedStores.map((store) => store.storeId);

  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category") ?? undefined;
  const employee = searchParams.get("employee") ?? undefined;
  const startDate = searchParams.get("startDate") ?? undefined;
  const endDate = searchParams.get("endDate") ?? undefined;
  const requestedStore = searchParams.get("store") ?? undefined;

  let storeNumber: string | undefined;
  if (user.role === "client") {
    const allowedStores =
      (user.storeIds?.length ? user.storeIds : [user.storeNumber]).filter(Boolean);
    if (requestedStore && allowedStores.includes(requestedStore)) {
      storeNumber = requestedStore;
    } else {
      storeNumber = allowedStores[0];
    }
  } else if (isManager) {
    if (requestedStore && managedStoreIds.includes(requestedStore)) {
      storeNumber = requestedStore;
    }
  } else if (requestedStore && requestedStore !== "all") {
    storeNumber = requestedStore;
  }

  const filters: RecordFilters = {
    storeNumber,
    category: (category as RecordFilters["category"]) ?? undefined,
    employee,
    startDate,
    endDate,
  };

  const [records, storeIds] = await Promise.all([
    getCombinedRecords(filters),
    listStoreNumbers(),
  ]);

  const availableStores = isManager
    ? managedStores
    : await buildStorePayload(storeIds);

  const filteredRecords = isManager
    ? records.filter((record) => managedStoreIds.includes(record.storeNumber))
    : records;

  const allowedStoreIds =
    user.role === "client"
      ? (user.storeIds?.length ? user.storeIds : [user.storeNumber]).filter(Boolean)
      : [];
  const clientStores = allowedStoreIds.length
    ? await buildStorePayload(allowedStoreIds)
    : [];

  return NextResponse.json({
    records: filteredRecords,
    stores: user.role === "client" ? clientStores : availableStores,
    activeStore: storeNumber ?? "all",
  });
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user || (user.role !== "ironhand" && user.role !== "client")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const id = body?.id as string | undefined;
  if (!id) {
    return NextResponse.json({ error: "Missing record id" }, { status: 400 });
  }

  const result = await deleteRecordById(id);
  if (!result.success) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }

  if (user.role === "client" && result.storeNumber !== user.storeNumber) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ success: true });
}
