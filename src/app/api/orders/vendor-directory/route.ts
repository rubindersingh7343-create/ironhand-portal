import { NextResponse } from "next/server";
import { getSessionUser, isMasterUser, requireRole } from "@/lib/auth";
import {
  createOrderVendorDirectory,
  deleteOrderVendorDirectory,
  listOrderVendorDirectory,
  updateOrderVendorDirectory,
} from "@/lib/dataStore";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !requireRole(user, ["client", "ironhand"])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const vendors = await listOrderVendorDirectory();
  return NextResponse.json({ vendors });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  const authorized = isMasterUser(user);
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = await request.json().catch(() => ({}));
  const name = String(payload?.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "Vendor name is required." }, { status: 400 });
  }
  const vendor = await createOrderVendorDirectory({
    name,
    repName: payload?.repName,
    contact: payload?.contact,
    email: payload?.email,
  });
  if (!vendor) {
    return NextResponse.json(
      { error: "Unable to create vendor directory entry." },
      { status: 500 },
    );
  }
  return NextResponse.json({ vendor });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  const authorized = isMasterUser(user);
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = await request.json().catch(() => ({}));
  const id = String(payload?.id ?? "");
  const name = String(payload?.name ?? "").trim();
  if (!id || !name) {
    return NextResponse.json({ error: "Vendor id and name are required." }, { status: 400 });
  }

  const vendor = await updateOrderVendorDirectory({ id, name });
  if (!vendor) {
    return NextResponse.json({ error: "Vendor not found." }, { status: 404 });
  }

  return NextResponse.json({ vendor });
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  const authorized = isMasterUser(user);
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Vendor id required." }, { status: 400 });
  }

  const success = await deleteOrderVendorDirectory(id);
  return NextResponse.json({ success });
}
