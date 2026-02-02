import { NextResponse } from "next/server";
import { getSessionUser, isMasterUser } from "@/lib/auth";
import {
  createManagerInvite,
  deleteManagerInvite,
  listManagerInvites,
  regenerateManagerInvite,
  listAllStores,
} from "@/lib/userStore";

function authorizeMaster(userPromise: ReturnType<typeof getSessionUser>) {
  return userPromise.then((user) => isMasterUser(user));
}

export async function GET() {
  const user = await authorizeMaster(getSessionUser());
  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const invites = await listManagerInvites();
  return NextResponse.json({ invites });
}

export async function POST(request: Request) {
  const user = await authorizeMaster(getSessionUser());
  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const storeId = body?.storeId as string | undefined;
  let storeInfo: { storeId: string; storeName?: string; storeAddress?: string } | undefined;
  if (storeId) {
    const stores = await listAllStores();
    const target = stores.find((store) => store.storeId === storeId);
    if (!target) {
      return NextResponse.json({ error: "Store not found." }, { status: 404 });
    }
    storeInfo = {
      storeId,
      storeName: target.name ?? `Store ${storeId}`,
      storeAddress: target.address ?? "",
    };
  }
  const invite = await createManagerInvite(user.id, storeInfo);
  return NextResponse.json({ invite });
}

export async function DELETE(request: Request) {
  const user = await authorizeMaster(getSessionUser());
  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const id = body?.id as string | undefined;
  if (!id) {
    return NextResponse.json({ error: "Invite id required" }, { status: 400 });
  }
  const success = await deleteManagerInvite(id);
  if (!success) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}

export async function PATCH(request: Request) {
  const user = await authorizeMaster(getSessionUser());
  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const id = body?.id as string | undefined;
  if (!id) {
    return NextResponse.json({ error: "Invite id required" }, { status: 400 });
  }
  const invite = await regenerateManagerInvite(id);
  if (!invite) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }
  return NextResponse.json({ invite });
}
