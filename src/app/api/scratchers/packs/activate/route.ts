import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import {
  activateScratcherPack,
  listScratcherProducts,
  listScratcherSlotBundle,
  saveScratcherFile,
} from "@/lib/dataStore";
import { sendStoreSystemMessage } from "@/lib/storeChat";

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

export async function POST(request: Request) {
  const user = await getSessionUser();
  const authorized = requireRole(user, ["employee", "ironhand", "client"]);
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await request.formData();
  const storeId = (formData.get("storeId")?.toString() ?? "").trim();
  const slotId = (formData.get("slotId")?.toString() ?? "").trim();
  const productId = (formData.get("productId")?.toString() ?? "").trim();
  const packCode = (formData.get("packCode")?.toString() ?? "").trim();
  const startTicket = (formData.get("startTicket")?.toString() ?? "").trim();
  const receiptFile = formData.get("receipt");

  if (!storeId || !slotId || !productId || !startTicket || !packCode) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }

  if (!hasStoreAccess(authorized, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!(receiptFile instanceof File) || receiptFile.size === 0) {
    return NextResponse.json(
      { error: "Activation receipt photo is required." },
      { status: 400 },
    );
  }

  const products = await listScratcherProducts();
  const product = products.find((item) => item.id === productId);
  if (!product) {
    return NextResponse.json({ error: "Scratcher product not found." }, { status: 404 });
  }
  const packSize = packSizeForPrice(Number(product.price ?? 0));
  if (!packSize) {
    return NextResponse.json(
      { error: "Unsupported scratcher price for auto pack sizing." },
      { status: 400 },
    );
  }
  const endTicket = computeEndTicket(startTicket, packSize);
  if (!endTicket) {
    return NextResponse.json({ error: "Invalid start ticket number." }, { status: 400 });
  }

  const storedReceipt = await saveScratcherFile(receiptFile, "Scratcher Pack Receipt");

  const pack = await activateScratcherPack({
    storeId,
    slotId,
    productId,
    packCode,
    startTicket,
    endTicket,
    activatedByUserId: authorized.id,
    receiptFile: storedReceipt,
  });

  if (!pack) {
    return NextResponse.json(
      { error: "Unable to activate scratcher pack." },
      { status: 500 },
    );
  }

  const employeeName = authorized.name ?? "Employee";
  const bundle = await listScratcherSlotBundle(storeId);
  const slot = bundle.slots.find((entry) => entry.id === slotId);
  const slotLabel = slot ? `Slot ${slot.slotNumber}` : "a slot";
  await sendStoreSystemMessage({
    storeId,
    senderId: authorized.id,
    message: `${employeeName} activated a new scratcher pack (${slotLabel}, $${Number(product.price).toFixed(2)}, pack ${packCode}).`,
  });

  return NextResponse.json({ pack, endTicket });
}
