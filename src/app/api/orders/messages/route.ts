import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { listStoresForManager } from "@/lib/userStore";
import { addWeeklyOrderMessage, getWeeklyOrder, listWeeklyOrderMessages } from "@/lib/dataStore";

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
  const orderId = searchParams.get("orderId");
  if (!orderId) {
    return NextResponse.json({ error: "orderId required." }, { status: 400 });
  }
  const order = await getWeeklyOrder(orderId);
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }
  const allowedStores = await resolveStoreAccess(user);
  if (!allowedStores.includes(order.storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const messages = await listWeeklyOrderMessages({ orderId });
  return NextResponse.json({ messages });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || !requireRole(user, ["client", "ironhand"])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = await request.json().catch(() => ({}));
  const orderId = String(payload?.orderId ?? "");
  const message = String(payload?.message ?? "").trim();
  if (!orderId || !message) {
    return NextResponse.json({ error: "orderId and message required." }, { status: 400 });
  }
  const order = await getWeeklyOrder(orderId);
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }
  const allowedStores = await resolveStoreAccess(user);
  if (!allowedStores.includes(order.storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const record = await addWeeklyOrderMessage({
    orderId,
    senderRole: user.role === "client" ? "owner" : "manager",
    senderName: user.name,
    message,
  });
  return NextResponse.json({ message: record });
}
