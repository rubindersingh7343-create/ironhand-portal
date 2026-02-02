import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { addOrderVendorItems, listOrderVendorItemSuggestions } from "@/lib/dataStore";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !requireRole(user, ["client", "ironhand"])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const directoryVendorId = String(searchParams.get("directoryVendorId") ?? "");
  const vendorId = String(searchParams.get("vendorId") ?? "");
  if (!directoryVendorId && !vendorId) {
    return NextResponse.json(
      { error: "directoryVendorId or vendorId is required." },
      { status: 400 },
    );
  }
  const items = await listOrderVendorItemSuggestions({
    directoryVendorId: directoryVendorId || undefined,
    vendorId: vendorId || undefined,
  });
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  const authorized = requireRole(user, ["ironhand"]);
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = await request.json().catch(() => ({}));
  const directoryVendorId = String(payload?.directoryVendorId ?? "");
  const productNames = Array.isArray(payload?.productNames)
    ? (payload.productNames as Array<unknown>).map((name) =>
        String(name ?? "").trim(),
      )
    : [];
  if (!directoryVendorId || productNames.length === 0) {
    return NextResponse.json(
      { error: "directoryVendorId and productNames are required." },
      { status: 400 },
    );
  }
  await addOrderVendorItems({ directoryVendorId, productNames });
  return NextResponse.json({ success: true });
}
