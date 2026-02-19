import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { listRecentUploadCounts, listShiftReportsRange } from "@/lib/dataStore";
import { getStoreSummariesByIds } from "@/lib/userStore";

export const runtime = "nodejs";

const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime";
const REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE ?? "alloy";

const safeNumber = (value: unknown) => {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

async function loadPosSummary(storeId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { status: "not_configured" };
  }

  const table = process.env.POS_DAILY_TABLE ?? "pos_daily_sales";
  const storeCol = process.env.POS_STORE_COLUMN ?? "store_id";
  const dateCol = process.env.POS_DATE_COLUMN ?? "business_date";

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);
  const start = startDate.toISOString().slice(0, 10);

  const { data: rows, error } = await supabase
    .from(table)
    .select("*")
    .eq(storeCol, storeId)
    .gte(dateCol, start);
  if (error) {
    if ((error as any)?.code === "PGRST205") {
      return { status: "not_configured" };
    }
    return { status: "unavailable" };
  }

  const totalGross = (rows ?? []).reduce(
    (sum: number, row: any) => sum + safeNumber(row?.gross_sales),
    0,
  );
  const totalNet = (rows ?? []).reduce(
    (sum: number, row: any) => sum + safeNumber(row?.net_sales),
    0,
  );
  return {
    status: "ok",
    window_start: start,
    days: rows?.length ?? 0,
    gross_sales: Number(totalGross.toFixed(2)),
    net_sales: Number(totalNet.toFixed(2)),
  };
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as
    | { storeId?: string }
    | null;
  const storeId = (payload?.storeId ?? "").trim();

  if (!storeId) {
    return NextResponse.json({ error: "Store is required." }, { status: 400 });
  }

  const allowedStores = user.storeIds?.length
    ? user.storeIds
    : user.storeNumber
      ? [user.storeNumber]
      : [];
  if (!allowedStores.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OpenAI API key is not configured." },
      { status: 500 },
    );
  }

  const storeSummary = (await getStoreSummariesByIds([storeId]))[0];
  const today = new Date().toLocaleDateString("en-CA");
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString("en-CA");
  const counts = await listRecentUploadCounts({
    ownerId: user.id,
    storeId,
    today,
    yesterday,
    timeZone: "America/New_York",
  });

  const shiftStart = new Date();
  shiftStart.setDate(shiftStart.getDate() - 14);
  const shiftReports = await listShiftReportsRange({
    storeId,
    startDate: shiftStart.toISOString().slice(0, 10),
    endDate: today,
  });
  const shiftSummary = shiftReports.reduce(
    (acc, report) => {
      acc.count += 1;
      acc.gross += report.grossAmount;
      acc.net += report.netAmount;
      return acc;
    },
    { count: 0, gross: 0, net: 0 },
  );

  const posSummary = await loadPosSummary(storeId);

  const context = {
    store: {
      id: storeId,
      name: storeSummary?.storeName ?? `Store ${storeId}`,
      address: storeSummary?.storeAddress ?? null,
    },
    recent_counts: { today, yesterday, counts },
    shift_summary_14d: {
      report_count: shiftSummary.count,
      gross_total: Number(shiftSummary.gross.toFixed(2)),
      net_total: Number(shiftSummary.net.toFixed(2)),
    },
    pos_summary_30d: posSummary,
  };

  const instructions =
    "You are the Iron Hand store assistant. Use only the provided store context. " +
    "If asked for data you don't have, say so and suggest what data is missing. " +
    `Store context JSON:\\n${JSON.stringify(context)}`;

  const sessionConfig = {
    session: {
      type: "realtime",
      model: REALTIME_MODEL,
      instructions,
      audio: {
        output: {
          voice: REALTIME_VOICE,
        },
      },
    },
  };

  try {
    const response = await fetch(
      "https://api.openai.com/v1/realtime/client_secrets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(sessionConfig),
      },
    );
    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: "Failed to mint realtime token.", details: text },
        { status: 502 },
      );
    }
    const data = await response.json();
    const value = data?.value ?? data?.client_secret?.value;
    if (!value) {
      return NextResponse.json(
        { error: "Realtime token missing in response." },
        { status: 502 },
      );
    }
    return NextResponse.json({ value });
  } catch (error) {
    console.error("realtime token error", error);
    return NextResponse.json(
      { error: "Failed to mint realtime token." },
      { status: 502 },
    );
  }
}
