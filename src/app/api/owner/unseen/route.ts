import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { listOwnerUnseenCounts } from "@/lib/dataStore";
import type { OwnerSeenType } from "@/lib/types";

const allowedTypes = [
  "reports",
  "shift",
  "full-day",
  "surveillance",
  "invoice",
  "order",
  "chat-manager",
  "chat-surveillance",
  "chat-owner",
] as const;

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "client") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const typeParam = searchParams.get("type") ?? "";
  const storeId = searchParams.get("storeId") ?? undefined;

  if (!allowedTypes.includes(typeParam as (typeof allowedTypes)[number])) {
    return NextResponse.json({ error: "Invalid type." }, { status: 400 });
  }

  const storeIds =
    user.storeIds ?? (user.storeNumber ? [user.storeNumber] : []);

  if (storeId && !storeIds.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const type =
    typeParam === "reports" ? "reports" : (typeParam as OwnerSeenType);

  const data = await listOwnerUnseenCounts({
    ownerId: user.id,
    type,
    storeIds,
    storeId,
  });

  return NextResponse.json(data);
}
