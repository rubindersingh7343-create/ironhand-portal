import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { listStoresForManager } from "@/lib/userStore";
import {
  getWeeklyOrder,
  getOrderVendor,
  createOrderVendorDirectory,
  updateOrderVendor,
  listWeeklyOrders,
  addOrderVendorItems,
  updateWeeklyOrder,
  upsertWeeklyOrder,
} from "@/lib/dataStore";
import type { OrderPeriod, OrderStatus, WeeklyOrderItem } from "@/lib/types";

async function resolveStoreAccess(user: Awaited<ReturnType<typeof getSessionUser>>) {
  if (!user) return [];
  if (user.role === "client") {
    return user.storeIds?.length ? user.storeIds : user.storeNumber ? [user.storeNumber] : [];
  }
  if (user.role === "ironhand") {
    const stores = await listStoresForManager(user.id, user.storeNumber);
    return stores.map((store) => store.storeId);
  }
  return [];
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !requireRole(user, ["client", "ironhand"])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("storeId");
  const periodType = (searchParams.get("periodType") ?? "weekly") as OrderPeriod;
  const periodStart = searchParams.get("periodStart") ?? "";
  if (!storeId || !periodStart) {
    return NextResponse.json(
      { error: "storeId and periodStart are required." },
      { status: 400 },
    );
  }
  const allowedStores = await resolveStoreAccess(user);
  if (!allowedStores.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const orders = await listWeeklyOrders({
    storeIds: [storeId],
    periodType,
    periodStart,
  });
  return NextResponse.json({ orders });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  const authorized = requireRole(user, ["ironhand"]);
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = await request.json().catch(() => ({}));
  const storeId = String(payload?.storeId ?? authorized.storeNumber ?? "");
  const vendorId = String(payload?.vendorId ?? "");
  const periodType = (payload?.periodType ?? "weekly") as OrderPeriod;
  const periodStart = String(payload?.periodStart ?? "");
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (!storeId || !vendorId || !periodStart) {
    return NextResponse.json(
      { error: "storeId, vendorId, and periodStart are required." },
      { status: 400 },
    );
  }
  const allowedStores = await resolveStoreAccess(authorized);
  if (!allowedStores.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsedItems: Array<Pick<WeeklyOrderItem, "productName" | "unitsOnHand" | "unitsToOrder">> =
    items.map((item: any) => ({
      productName: String(item?.productName ?? "").trim(),
      unitsOnHand: Number(item?.unitsOnHand ?? 0),
      unitsToOrder: Number(item?.unitsToOrder ?? 0),
    })).filter((item: any) => item.productName);

  const order = await upsertWeeklyOrder({
    storeId,
    vendorId,
    periodType,
    periodStart,
    status: "submitted",
    createdById: authorized.id,
    createdByName: authorized.name,
    items: parsedItems,
  });
  let vendor = await getOrderVendor(vendorId);
  if (vendor && !vendor.directoryVendorId) {
    const directoryRecord = await createOrderVendorDirectory({
      name: vendor.name,
      repName: vendor.repName,
      contact: vendor.contact,
      email: vendor.email,
    });
    if (directoryRecord) {
      await updateOrderVendor({
        id: vendor.id,
        name: vendor.name,
        directoryVendorId: directoryRecord.id,
        repName: vendor.repName,
        contact: vendor.contact,
        email: vendor.email,
      });
      vendor = { ...vendor, directoryVendorId: directoryRecord.id };
    }
  }
  if (vendor?.directoryVendorId && parsedItems.length) {
    await addOrderVendorItems({
      directoryVendorId: vendor.directoryVendorId,
      productNames: parsedItems.map((item) => item.productName),
    });
  }
  return NextResponse.json({ order });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user || !requireRole(user, ["client", "ironhand"])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = await request.json().catch(() => ({}));
  const orderId = String(payload?.id ?? "");
  if (!orderId) {
    return NextResponse.json({ error: "Order id required." }, { status: 400 });
  }
  const existing = await getWeeklyOrder(orderId);
  if (!existing) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }
  const allowedStores = await resolveStoreAccess(user);
  if (!allowedStores.includes(existing.storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const status = payload?.status as OrderStatus | undefined;
  const items = Array.isArray(payload?.items) ? payload.items : undefined;
  const parsedItems: Array<Pick<WeeklyOrderItem, "productName" | "unitsOnHand" | "unitsToOrder">> | undefined =
    items
      ? items.map((item: any) => ({
          productName: String(item?.productName ?? "").trim(),
          unitsOnHand: Number(item?.unitsOnHand ?? 0),
          unitsToOrder: Number(item?.unitsToOrder ?? 0),
        })).filter((item: any) => item.productName)
      : undefined;

  const approvedById =
    status === "approved"
      ? user.role === "client"
        ? user.id
        : existing.approvedById ?? null
      : status
        ? null
        : undefined;
  const approvedAt =
    status === "approved"
      ? new Date().toISOString()
      : status
        ? null
        : undefined;

  const order = await updateWeeklyOrder({
    id: orderId,
    status,
    approvedById,
    approvedAt,
    items: parsedItems,
  });
  if (!order) {
    return NextResponse.json({ error: "Unable to update order." }, { status: 400 });
  }
  if (parsedItems?.length) {
    let vendor = await getOrderVendor(order.vendorId);
    if (vendor && !vendor.directoryVendorId) {
      const directoryRecord = await createOrderVendorDirectory({
        name: vendor.name,
        repName: vendor.repName,
        contact: vendor.contact,
        email: vendor.email,
      });
      if (directoryRecord) {
        await updateOrderVendor({
          id: vendor.id,
          name: vendor.name,
          directoryVendorId: directoryRecord.id,
          repName: vendor.repName,
          contact: vendor.contact,
          email: vendor.email,
        });
        vendor = { ...vendor, directoryVendorId: directoryRecord.id };
      }
    }
    if (vendor?.directoryVendorId) {
      await addOrderVendorItems({
        directoryVendorId: vendor.directoryVendorId,
        productNames: parsedItems.map((item) => item.productName),
      });
    }
  }
  return NextResponse.json({ order });
}
