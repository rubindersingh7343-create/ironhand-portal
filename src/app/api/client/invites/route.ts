import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  createClientStoreInvite,
  deleteInvite,
  listInvites,
  listStoresForManager,
} from "@/lib/userStore";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "client") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const storeId = body?.storeId as string | undefined;
  if (!storeId) {
    return NextResponse.json({ error: "storeId required" }, { status: 400 });
  }

  const stores = await listStoresForManager(user.id, user.storeNumber);
  const target = stores.find((store) => store.storeId === storeId);
  if (!target) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  const invite = await createClientStoreInvite({
    storeId,
    storeName: target.storeName ?? `Store ${storeId}`,
    storeAddress: target.storeAddress ?? "",
    managerId: user.id,
  });

  return NextResponse.json({ invite });
}

export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "client") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const invites = await listInvites();
  const clientInvites = invites.filter((invite) => {
    if (invite.role !== "employee" || invite.managerId !== user.id) {
      return false;
    }
    const expired = new Date(invite.expiresAt).getTime() < Date.now();
    if (expired && !invite.usedAt) {
      deleteInvite(invite.id);
      return false;
    }
    return !expired;
  });
  return NextResponse.json({ invites: clientInvites });
}
