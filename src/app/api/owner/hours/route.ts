import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { listEmployeeHoursEntries, listEmployeeHourlyRates, listEmployeeHoursPayments } from "@/lib/dataStore";
import { getClientStoreIds } from "@/lib/userStore";

const parseMonth = (value?: string | null) => {
  if (value && /^\d{4}-\d{2}$/.test(value)) return value;
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}`;
};

export async function GET(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "client") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const storeId = (searchParams.get("storeId") ?? searchParams.get("store_id") ?? "").trim();
    if (!storeId) {
      return NextResponse.json({ error: "Store required." }, { status: 400 });
    }

    // Some sessions don't include `storeIds`; fall back to the database list.
    const allowedStores = user.storeIds?.length
      ? user.storeIds
      : await getClientStoreIds(user.id);
    const allowed = allowedStores?.length
      ? allowedStores
      : user.storeNumber
        ? [user.storeNumber]
        : [];

    if (!allowed.includes(storeId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const month = parseMonth(searchParams.get("month"));
    const [entries, rates, payments] = await Promise.all([
      listEmployeeHoursEntries({ storeId, month }),
      listEmployeeHourlyRates(storeId),
      listEmployeeHoursPayments(storeId, month),
    ]);
    return NextResponse.json({ month, entries, rates, payments });
  } catch (error) {
    console.error("Owner hours fetch failed:", error);
    const message =
      error instanceof Error ? error.message : "Unable to load hours.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
