import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import {
  createSurveillanceInvite,
  listStoresForManager,
} from "@/lib/userStore";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || !requireRole(user, ["ironhand"])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const storeId = body?.storeId as string | undefined;
  if (!storeId) {
    return NextResponse.json({ error: "storeId required." }, { status: 400 });
  }

  const stores = await listStoresForManager(user.id, user.storeNumber);
  const record = stores.find((store) => store.storeId === storeId);
  if (!record) {
    return NextResponse.json({ error: "Store not found." }, { status: 404 });
  }

  const invite = await createSurveillanceInvite({
    storeId,
    storeName: record.storeName ?? `Store ${storeId}`,
    storeAddress: record.storeAddress ?? "",
    managerId: user.id,
  });

  return NextResponse.json({ invite });
}
