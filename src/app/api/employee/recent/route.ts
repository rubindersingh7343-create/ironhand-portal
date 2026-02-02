import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getClientStoreIds } from "@/lib/userStore";
import { getRecentInvoiceUploads, getRecentShiftSubmissions } from "@/lib/dataStore";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role !== "employee" && user.role !== "client") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const storeIdParam =
    searchParams.get("storeId") ??
    searchParams.get("store_id") ??
    undefined;
  const daysParam = Number(searchParams.get("days"));
  const days =
    Number.isFinite(daysParam) && daysParam > 0
      ? Math.min(Math.floor(daysParam), 7)
      : 3;

  let storeNumber = user.storeNumber;
  if (user.role === "client") {
    const storeId = storeIdParam ?? "";
    if (!storeId) {
      return NextResponse.json({ error: "Store required." }, { status: 400 });
    }
    const linked = user.storeIds?.length
      ? user.storeIds
      : await getClientStoreIds(user.id);
    if (!linked.includes(storeId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    storeNumber = storeId;
  }

  const submissions = await getRecentShiftSubmissions({
    storeNumber,
    employeeName: user.name,
    days,
  });

  const invoices = await getRecentInvoiceUploads({
    storeNumber,
    employeeName: user.name,
    days,
  });

  return NextResponse.json({ submissions, invoices });
}
