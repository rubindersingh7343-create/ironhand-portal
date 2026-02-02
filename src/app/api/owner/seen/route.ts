import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { markOwnerSeenItems } from "@/lib/dataStore";
import type { OwnerSeenType } from "@/lib/types";

type SeenPayload = {
  items: Array<{
    storeId: string;
    itemType: OwnerSeenType;
    itemId: string;
  }>;
};

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "client") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as SeenPayload | null;
  const items = Array.isArray(payload?.items) ? payload?.items : [];
  if (!items.length) {
    return NextResponse.json({ error: "No items provided." }, { status: 400 });
  }

  const storeIds =
    user.storeIds ?? (user.storeNumber ? [user.storeNumber] : []);

  const filtered = items
    .filter((item) => storeIds.includes(item.storeId))
    .filter((item) => item.itemId && item.itemType);

  if (!filtered.length) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await markOwnerSeenItems(
      filtered.map((item) => ({
        ownerId: user.id,
        storeId: item.storeId,
        itemType: item.itemType,
        itemId: item.itemId,
      })),
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to persist owner seen items", error);
    const message =
      error && typeof error === "object" && "message" in error
        ? String(error.message)
        : "Unable to mark items as seen.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
