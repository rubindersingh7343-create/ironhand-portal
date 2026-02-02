import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  getStoreReportConfig,
  upsertStoreReportConfig,
} from "@/lib/dataStore";
import { normalizeReportItems } from "@/lib/reportConfig";

function assertStoreAccess(user: Awaited<ReturnType<typeof getSessionUser>>, storeId: string) {
  if (!user) return false;
  if (user.role === "client") {
    return (user.storeIds ?? []).includes(storeId);
  }
  if (user.role === "employee") {
    return user.storeNumber === storeId;
  }
  return false;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const url = new URL(request.url);
  const storeId = url.searchParams.get("storeId") ?? user.storeNumber;
  if (!storeId || !assertStoreAccess(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const config = await getStoreReportConfig(storeId);
  const items = normalizeReportItems(config?.items);
  return NextResponse.json({
    storeId,
    items,
    updatedAt: config?.updatedAt ?? null,
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "client") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const storeId = body?.storeId?.toString() ?? "";
  if (!storeId || !(user.storeIds ?? []).includes(storeId)) {
    return NextResponse.json({ error: "Invalid store." }, { status: 400 });
  }

  const items = normalizeReportItems(
    Array.isArray(body?.items) ? body.items : [],
  );
  const saved = await upsertStoreReportConfig({
    storeId,
    ownerId: user.id,
    items,
  });

  return NextResponse.json({ config: saved });
}
