import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { returnScratcherPack, saveScratcherFile } from "@/lib/dataStore";
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

export async function POST(request: Request) {
  const user = await getSessionUser();
  const authorized = requireRole(user, ["employee", "ironhand", "client"]);
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await request.formData();
  const storeId = (formData.get("storeId")?.toString() ?? "").trim();
  const packId = (formData.get("packId")?.toString() ?? "").trim();
  const note = (formData.get("note")?.toString() ?? "").trim();
  const receiptFile = formData.get("receipt");

  if (!storeId || !packId) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }
  if (!hasStoreAccess(authorized, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(receiptFile instanceof File) || receiptFile.size === 0) {
    return NextResponse.json(
      { error: "Return receipt photo is required." },
      { status: 400 },
    );
  }

  const storedReceipt = await saveScratcherFile(receiptFile, "Scratcher Pack Return");
  const pack = await returnScratcherPack({
    storeId,
    packId,
    returnedByUserId: authorized.id,
    receiptFile: storedReceipt,
    note: note.length ? note : null,
  });

  if (!pack) {
    return NextResponse.json(
      { error: "Unable to return scratcher pack." },
      { status: 500 },
    );
  }

  const employeeName = authorized.name ?? "Employee";
  await sendStoreSystemMessage({
    storeId,
    senderId: authorized.id,
    message: `${employeeName} returned scratcher pack ${pack.packCode ?? ""}`.trim(),
  });

  return NextResponse.json({ pack });
}
