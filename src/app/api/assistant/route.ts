import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getSessionUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { listRecentUploadCounts, listShiftReportsRange } from "@/lib/dataStore";
import { getStoreSummariesByIds } from "@/lib/userStore";

export const runtime = "nodejs";

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5-mini";
const POS_DAILY_TABLE = process.env.POS_DAILY_TABLE ?? "pos_daily_sales";
const POS_ITEM_TABLE = process.env.POS_ITEM_TABLE ?? "pos_item_sales";
const POS_STORE_COLUMN = process.env.POS_STORE_COLUMN ?? "store_id";
const POS_DATE_COLUMN = process.env.POS_DATE_COLUMN ?? "business_date";
const POS_ITEM_DATE_COLUMN = process.env.POS_ITEM_DATE_COLUMN ?? "business_date";
const POS_ITEM_STORE_COLUMN =
  process.env.POS_ITEM_STORE_COLUMN ?? POS_STORE_COLUMN;

type AssistantMessage = { role: "user" | "assistant"; content: string };
type ResponseInputMessage = {
  role: "system" | "user" | "assistant";
  content: Array<{ type: "input_text"; text: string }>;
};

const safeFloat = (value: unknown) => {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const safeInt = (value: unknown) => {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
};

const extractOutputText = (response: any) => {
  if (response?.output_text) return response.output_text as string;
  const output = response?.output ?? [];
  for (const item of output) {
    if (item?.type !== "message") continue;
    for (const content of item?.content ?? []) {
      if (content?.text) return content.text as string;
    }
  }
  return "";
};

async function loadPosSummary(storeId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { status: "not_configured" };
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);
  const start = startDate.toISOString().slice(0, 10);

  try {
    const { data: dailyRows, error } = await supabase
      .from(POS_DAILY_TABLE)
      .select("*")
      .eq(POS_STORE_COLUMN, storeId)
      .gte(POS_DATE_COLUMN, start);
    if (error) {
      console.error("POS daily query error", error);
      return { status: "unavailable" };
    }

    const totalGross = (dailyRows ?? []).reduce(
      (sum: number, row: any) => sum + safeFloat(row?.gross_sales),
      0,
    );
    const totalNet = (dailyRows ?? []).reduce(
      (sum: number, row: any) => sum + safeFloat(row?.net_sales),
      0,
    );
    const totalTransactions = (dailyRows ?? []).reduce(
      (sum: number, row: any) => sum + safeInt(row?.transactions),
      0,
    );
    const totalItems = (dailyRows ?? []).reduce(
      (sum: number, row: any) => sum + safeInt(row?.items_sold),
      0,
    );

    let topItems: Array<{ item_name: string; quantity: number; gross_sales: number }> = [];
    try {
      const { data: itemRows, error: itemError } = await supabase
        .from(POS_ITEM_TABLE)
        .select("*")
        .eq(POS_ITEM_STORE_COLUMN, storeId)
        .gte(POS_ITEM_DATE_COLUMN, start);
      if (!itemError && itemRows?.length) {
        const totals = new Map<string, { quantity: number; gross_sales: number }>();
        itemRows.forEach((row: any) => {
          const name = row?.item_name ?? row?.item_sku ?? "Unknown item";
          const current = totals.get(name) ?? { quantity: 0, gross_sales: 0 };
          current.quantity += safeInt(row?.quantity);
          current.gross_sales += safeFloat(row?.gross_sales);
          totals.set(name, current);
        });
        topItems = Array.from(totals.entries())
          .map(([item_name, values]) => ({ item_name, ...values }))
          .sort((a, b) => b.quantity - a.quantity)
          .slice(0, 5);
      }
    } catch (itemError) {
      console.error("POS item query error", itemError);
    }

    return {
      status: "ok",
      window_start: start,
      days: dailyRows?.length ?? 0,
      gross_sales: Number(totalGross.toFixed(2)),
      net_sales: Number(totalNet.toFixed(2)),
      transactions: totalTransactions,
      items_sold: totalItems,
      top_items: topItems,
    };
  } catch (error) {
    console.error("POS summary error", error);
    return { status: "unavailable" };
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as
    | { storeId?: string; message?: string; history?: AssistantMessage[] }
    | null;
  const storeId = (payload?.storeId ?? "").trim();
  const message = (payload?.message ?? "").trim();
  const history = Array.isArray(payload?.history) ? payload?.history : [];

  if (!storeId || !message) {
    return NextResponse.json({ error: "Store and message are required." }, { status: 400 });
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

  const recordStart = new Date();
  recordStart.setDate(recordStart.getDate() - 30);
  const recordStartIso = recordStart.toISOString();
  let recentRecords: Array<Record<string, unknown>> = [];
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data: records, error } = await supabase
      .from("records")
      .select(
        "category, employee_name, created_at, shift_notes, notes, text_content, surveillance_summary, invoice_company, invoice_amount_cents",
      )
      .eq("store_number", storeId)
      .gte("created_at", recordStartIso)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      console.error("assistant records query error", error);
    } else if (records) {
      recentRecords = records.map((record: any) => ({
        category: record.category,
        employee: record.employee_name,
        created_at: record.created_at,
        notes: record.notes ?? record.shift_notes ?? record.text_content ?? undefined,
        invoice_company: record.invoice_company,
        invoice_amount_cents: record.invoice_amount_cents,
        surveillance_summary: record.surveillance_summary,
      }));
    }
  }

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
      acc.discrepancies += report.investigationFlag ? 1 : 0;
      const key = report.employeeName ?? "Unknown";
      const entry = acc.byEmployee.get(key) ?? { name: key, gross: 0, count: 0 };
      entry.gross += report.grossAmount;
      entry.count += 1;
      acc.byEmployee.set(key, entry);
      return acc;
    },
    {
      count: 0,
      gross: 0,
      net: 0,
      discrepancies: 0,
      byEmployee: new Map<string, { name: string; gross: number; count: number }>(),
    },
  );

  const topEmployees = Array.from(shiftSummary.byEmployee.values())
    .sort((a, b) => b.gross - a.gross)
    .slice(0, 5);

  const posSummary = await loadPosSummary(storeId);

  const context = {
    store: {
      id: storeId,
      name: storeSummary?.storeName ?? `Store ${storeId}`,
      address: storeSummary?.storeAddress ?? null,
    },
    generated_at: new Date().toISOString(),
    recent_counts: { today, yesterday, counts },
    shift_summary_14d: {
      report_count: shiftSummary.count,
      gross_total: Number(shiftSummary.gross.toFixed(2)),
      net_total: Number(shiftSummary.net.toFixed(2)),
      discrepancy_flags: shiftSummary.discrepancies,
      top_employees: topEmployees.map((entry) => ({
        name: entry.name,
        gross_total: Number(entry.gross.toFixed(2)),
        report_count: entry.count,
      })),
    },
    pos_summary_30d: posSummary,
    recent_records: recentRecords,
  };

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const systemPrompt =
    "You are the Iron Hand store assistant. Answer using only the provided store context. " +
    "If the user asks for data you do not have, say so and suggest what data is missing. " +
    "Keep responses concise, practical, and store-owner friendly.";

  const messages: ResponseInputMessage[] = [
    {
      role: "system" as const,
      content: [{ type: "input_text" as const, text: systemPrompt }],
    },
    {
      role: "system" as const,
      content: [
        {
          type: "input_text" as const,
          text: `Store context JSON:\n${JSON.stringify(context)}`,
        },
      ],
    },
  ];

  history.slice(-8).forEach((entry) => {
    if (!entry?.content?.trim()) return;
    messages.push({
      role: entry.role,
      content: [{ type: "input_text" as const, text: entry.content.trim() }],
    });
  });

  messages.push({
    role: "user" as const,
    content: [{ type: "input_text" as const, text: message }],
  });

  try {
    const response = await client.responses.create({
      model: OPENAI_MODEL,
      input: messages,
      metadata: {
        store_id: storeId,
        user_id: user.id,
      },
    });

    const reply = extractOutputText(response).trim();

    return NextResponse.json({
      reply: reply || "I couldn't generate a response with the available data.",
      posStatus: posSummary.status ?? "unknown",
    });
  } catch (error) {
    console.error("assistant error", error);
    return NextResponse.json(
      { error: "Assistant unavailable." },
      { status: 502 },
    );
  }
}
