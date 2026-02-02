import { NextResponse } from "next/server";
import { getSessionUser, isMasterUser, requireRole } from "@/lib/auth";
import { listStoresForManager } from "@/lib/userStore";
import {
  createOrderVendor,
  createOrderVendorDirectory,
  deleteOrderVendor,
  getOrderVendor,
  getOrderVendorDirectory,
  listOrderVendors,
  updateOrderVendorDirectory,
  updateOrderVendor,
} from "@/lib/dataStore";

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
  const allowedStores = await resolveStoreAccess(user);
  const storeIds = storeId ? [storeId] : allowedStores;
  if (storeId && !allowedStores.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const vendors = await listOrderVendors({ storeIds });
  return NextResponse.json({ vendors });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  const authorized = requireRole(user, ["ironhand"]);
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const masterUser = isMasterUser(user);

  const payload = await request.json().catch(() => ({}));
  const name = String(payload?.name ?? "").trim();
  const directoryVendorId = String(payload?.directoryVendorId ?? "").trim();
  const storeId = String(payload?.storeId ?? authorized.storeNumber ?? "");
  if (!storeId) {
    return NextResponse.json({ error: "Store is required." }, { status: 400 });
  }
  const allowedStores = await resolveStoreAccess(authorized);
  if (!allowedStores.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!masterUser && !directoryVendorId) {
    return NextResponse.json(
      { error: "Select a vendor from the directory." },
      { status: 400 },
    );
  }

  let directoryRecord = directoryVendorId
    ? await getOrderVendorDirectory(directoryVendorId)
    : null;
  const fallbackVendor = directoryVendorId
    ? await getOrderVendor(directoryVendorId)
    : null;

  if (!directoryRecord && !fallbackVendor && !name) {
    return NextResponse.json(
      { error: "Vendor name is required." },
      { status: 400 },
    );
  }
  if (!directoryRecord && name && masterUser) {
    directoryRecord = await createOrderVendorDirectory({
      name,
      repName: payload?.repName,
      contact: payload?.contact,
      email: payload?.email,
    });
  }

  const repName = masterUser
    ? directoryRecord?.repName ?? fallbackVendor?.repName ?? payload?.repName
    : payload?.repName ?? fallbackVendor?.repName ?? directoryRecord?.repName;
  const contact = masterUser
    ? directoryRecord?.contact ?? fallbackVendor?.contact ?? payload?.contact
    : payload?.contact ?? fallbackVendor?.contact ?? directoryRecord?.contact;
  const email = masterUser
    ? directoryRecord?.email ?? fallbackVendor?.email ?? payload?.email
    : payload?.email ?? fallbackVendor?.email ?? directoryRecord?.email;

  const vendor = await createOrderVendor({
    storeId,
    directoryVendorId: directoryRecord?.id,
    name: directoryRecord?.name ?? fallbackVendor?.name ?? name,
    repName,
    contact,
    email,
  });
  if (!vendor) {
    return NextResponse.json(
      { error: "Unable to add vendor for this store." },
      { status: 500 },
    );
  }
  return NextResponse.json({ vendor });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  const authorized = requireRole(user, ["ironhand"]);
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const masterUser = isMasterUser(user);

  const payload = await request.json().catch(() => ({}));
  const id = String(payload?.id ?? "");
  const name = String(payload?.name ?? "").trim();
  if (!id) {
    return NextResponse.json({ error: "Vendor id is required." }, { status: 400 });
  }

  if (!masterUser) {
    const existing = await getOrderVendor(id);
    if (!existing) {
      return NextResponse.json({ error: "Vendor not found." }, { status: 404 });
    }
    const vendor = await updateOrderVendor({
      id,
      name: existing.name,
      repName: payload?.repName,
      contact: payload?.contact,
      email: payload?.email,
    });
    if (!vendor) {
      return NextResponse.json({ error: "Vendor not found." }, { status: 404 });
    }
    return NextResponse.json({ vendor });
  }

  if (!name) {
    return NextResponse.json({ error: "Vendor name is required." }, { status: 400 });
  }
  const vendor = await updateOrderVendor({
    id,
    name,
    repName: payload?.repName,
    contact: payload?.contact,
    email: payload?.email,
  });
  if (!vendor) {
    return NextResponse.json({ error: "Vendor not found." }, { status: 404 });
  }
  if (vendor.directoryVendorId) {
    await updateOrderVendorDirectory({
      id: vendor.directoryVendorId,
      name: vendor.name,
      repName: vendor.repName,
      contact: vendor.contact,
      email: vendor.email,
    });
  }
  return NextResponse.json({ vendor });
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  const authorized = requireRole(user, ["ironhand"]);
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Vendor id required." }, { status: 400 });
  }
  const success = await deleteOrderVendor(id);
  return NextResponse.json({ success });
}
