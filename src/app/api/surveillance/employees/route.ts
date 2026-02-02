import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import {
  getSurveillanceStoreIds,
  listEmployeesForStoreIds,
} from "@/lib/userStore";

export async function GET(request: Request) {
  const user = await getSessionUser();
  const surveillance = requireRole(user, ["surveillance"]);
  if (!surveillance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const requestedStore = searchParams.get("storeId") ?? surveillance.storeNumber;

  const allowedStores = new Set(
    [
      surveillance.storeNumber,
      ...(Array.isArray(surveillance.storeIds) ? surveillance.storeIds : []),
      ...(await getSurveillanceStoreIds(surveillance.id)),
    ].filter(Boolean),
  );

  if (!allowedStores.has(requestedStore)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const employees = await listEmployeesForStoreIds([requestedStore]);
  return NextResponse.json({ employees });
}
