import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { listStoresForManager } from "@/lib/userStore";

export async function GET() {
  const user = await getSessionUser();
  const authorized = requireRole(user, ["ironhand"]);
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const stores = await listStoresForManager(
    authorized.id,
    authorized.storeNumber,
  );

  return NextResponse.json({ stores });
}
