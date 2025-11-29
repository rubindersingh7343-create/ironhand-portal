import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import {
  createSurveillanceInvite,
  listAllStores,
} from "@/lib/userStore";

export async function POST(request: Request) {
  const user = await getSessionUser();
  const authorized = requireRole(user, ["ironhand"]);
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const storeId = body?.storeId as string | undefined;
  if (!storeId) {
    return NextResponse.json({ error: "storeId required." }, { status: 400 });
  }

  const stores = await listAllStores();
  const target = stores.find((store) => store.storeId === storeId);
  if (!target) {
    return NextResponse.json({ error: "Store not found." }, { status: 404 });
  }

  const invite = await createSurveillanceInvite({
    storeId,
    storeName: target.name ?? `Store ${storeId}`,
    storeAddress: target.address ?? "",
    managerId: target.managerId,
  });

  return NextResponse.json({ invite });
}
