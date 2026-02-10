import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  activateScratcherPack,
  getLatestScratcherStartSnapshotByStore,
  listScratcherSlotBundle,
  saveScratcherFile,
} from "@/lib/dataStore";

const hasStoreAccess = (user: Awaited<ReturnType<typeof getSessionUser>>, storeId: string) => {
  if (!user) return false;
  if (user.role === "employee") return user.storeNumber === storeId;
  if (user.role === "client") return (user.storeIds ?? []).includes(storeId);
  if (user.role === "ironhand") {
    if (user.storeNumber === "HQ" || user.portal === "master") return true;
    const stores = user.storeIds ?? (user.storeNumber ? [user.storeNumber] : []);
    return stores.includes(storeId);
  }
  return false;
};

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("store_id") ?? user.storeNumber;
  if (!storeId || !hasStoreAccess(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const packSizeForPrice = (price: number) => {
    const normalized = Number(price.toFixed(2));
    if (normalized === 40 || normalized === 30 || normalized === 25 || normalized === 20) {
      return 30;
    }
    if (normalized === 10) return 50;
    if (normalized === 5) return 80;
    if (normalized === 3 || normalized === 2) return 100;
    if (normalized === 1) return 240;
    return null;
  };

  const computeEndTicket = (startTicket: string, size: number) => {
    const trimmed = startTicket.trim();
    const startValue = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(startValue)) return null;
    const endValue = startValue + size - 1;
    const endText = `${endValue}`.padStart(trimmed.length, "0");
    return endText;
  };

  const [baseline, initialBundle] = await Promise.all([
    getLatestScratcherStartSnapshotByStore(storeId),
    listScratcherSlotBundle(storeId),
  ]);

  // One-time backfill: if a baseline snapshot exists, treat baseline slots as "activated"
  // by creating packs for slots that have never had a pack record.
  let bundle = initialBundle;
  try {
    const baselineItems = baseline?.items ?? [];
    const baselineMap = new Map(
      baselineItems.map((item) => [item.slotId, String(item.ticketValue ?? "").trim()]),
    );
    const hasBaseline = Boolean(baseline?.snapshot) && baselineMap.size > 0;
    if (hasBaseline) {
      const packsBySlot = new Set(bundle.packs.map((pack) => pack.slotId));
      const needsBaselinePacks = bundle.slots.filter((slot) => {
        if (!slot.isActive) return false;
        if (slot.activePackId) return false;
        if (!slot.defaultProductId) return false;
        const ticket = baselineMap.get(slot.id) ?? "";
        if (!ticket) return false;
        // If the slot has ever had a pack, don't auto-create one (returned packs should stay empty).
        if (packsBySlot.has(slot.id)) return false;
        return true;
      });

      if (needsBaselinePacks.length) {
        const placeholderPng = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOqk7+8AAAAASUVORK5CYII=",
          "base64",
        );
        const placeholderFile = new File([placeholderPng], "baseline-receipt.png", {
          type: "image/png",
        });
        const receipt = await saveScratcherFile(
          placeholderFile,
          "Baseline activation receipt",
        );

        for (const slot of needsBaselinePacks) {
          const startTicket = baselineMap.get(slot.id) ?? "";
          const product = bundle.products.find(
            (item) => item.id === slot.defaultProductId,
          );
          const packSize = product ? packSizeForPrice(Number(product.price ?? 0)) : null;
          const endTicket = packSize ? computeEndTicket(startTicket, packSize) : null;
          if (!product || !endTicket) continue;
          await activateScratcherPack({
            storeId,
            slotId: slot.id,
            productId: product.id,
            packCode: `BASELINE-${slot.slotNumber}`,
            startTicket,
            endTicket,
            activatedByUserId: user.id,
            receiptFile: receipt,
          });
        }

        bundle = await listScratcherSlotBundle(storeId);
      }
    }
  } catch (error) {
    console.error("Unable to backfill baseline packs:", error);
  }

  return NextResponse.json({ ...bundle, baseline });
}
