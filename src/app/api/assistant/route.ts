import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getSessionUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  listRecentUploadCounts,
  listShiftReportsRange,
  listScratcherCalculations,
  listScratcherDiscrepancies,
  listRecentSurveillanceReportsForStore,
  listSurveillanceInvestigations,
  listScratcherSnapshots,
  listScratcherSlotBundle,
} from "@/lib/dataStore";
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
type LocalResponseInputMessage = {
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

const safeJson = (value: unknown) => {
  if (!value || typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const truncateText = (value: unknown, max = 320) => {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
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
      if ((error as any)?.code === "PGRST205") {
        return { status: "not_configured" };
      }
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
      if ((itemError as any)?.code === "PGRST205") {
        return {
          status: "ok",
          window_start: start,
          days: dailyRows?.length ?? 0,
          gross_sales: Number(totalGross.toFixed(2)),
          net_sales: Number(totalNet.toFixed(2)),
          transactions: totalTransactions,
          items_sold: totalItems,
          top_items: [],
        };
      }
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
    | {
        storeId?: string;
        message?: string;
        history?: AssistantMessage[];
        primaryLanguage?: string;
        secondaryLanguage?: string;
      }
    | null;
  const storeId = (payload?.storeId ?? "").trim();
  const message = (payload?.message ?? "").trim();
  const history = Array.isArray(payload?.history) ? payload?.history : [];
  const primaryLanguage = (payload?.primaryLanguage ?? "").trim() || "English";
  const secondaryLanguage = (payload?.secondaryLanguage ?? "").trim();

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
        `category,
         employee_name,
         created_at,
         shift_notes,
         notes,
         text_content,
         surveillance_label,
         surveillance_summary,
         surveillance_grade,
         surveillance_grade_reason,
         invoice_company,
         invoice_amount_cents,
         invoice_paid,
         record_files (
           label,
           summary,
           original_name,
           mime_type,
           size
         )`,
      )
      .eq("store_number", storeId)
      .gte("created_at", recordStartIso)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) {
      console.error("assistant records query error", error);
    } else if (records) {
      recentRecords = records.map((record: any) => ({
        category: record.category,
        employee: record.employee_name,
        created_at: record.created_at,
        notes: record.notes ?? record.shift_notes ?? record.text_content ?? undefined,
        report_details: safeJson(record.text_content) ?? undefined,
        invoice_company: record.invoice_company,
        invoice_amount_cents: record.invoice_amount_cents,
        invoice_paid: record.invoice_paid,
        surveillance: record.surveillance_label
          ? {
              label: record.surveillance_label,
              summary: record.surveillance_summary ?? undefined,
              grade: record.surveillance_grade ?? undefined,
              grade_reason: record.surveillance_grade_reason ?? undefined,
            }
          : undefined,
        attachments: Array.isArray(record.record_files)
          ? record.record_files.map((file: any) => ({
              label: file.label ?? undefined,
              summary: file.summary ?? undefined,
              name: file.original_name,
              mime: file.mime_type,
              size: file.size,
            }))
          : [],
      }));
    }
  }

  const shiftStart = new Date();
  shiftStart.setDate(shiftStart.getDate() - 30);
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

  const shiftReportsRecent = shiftReports.slice(0, 30).map((report) => ({
    id: report.id,
    date: report.date,
    employee: report.employeeName ?? null,
    gross: report.grossAmount,
    net: report.netAmount,
    cash: report.cashAmount,
    scr: report.scrAmount,
    lotto: report.lottoAmount,
    lotto_po: report.lottoPoAmount,
    liquor: report.liquorAmount,
    beer: report.beerAmount,
    cig: report.cigAmount,
    tobacco: report.tobaccoAmount,
    gas: report.gasAmount,
    atm: report.atmAmount,
    deposit: report.depositAmount,
    store_amount: report.storeAmount,
    investigation_flag: report.investigationFlag,
    investigation_reason: report.investigationReason ?? undefined,
    scratcher_discrepancy: report.hasScratcherDiscrepancy ?? false,
  }));

  const scratcherCalculations = (await listScratcherCalculations(storeId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 20)
    .map((calc) => ({
      id: calc.id,
      shift_report_id: calc.shiftReportId,
      expected_total_value: calc.expectedTotalValue,
      reported_scr_value: calc.reportedScrValue ?? null,
      variance_value: calc.varianceValue,
      flags: calc.flags,
      updated_at: calc.updatedAt,
    }));

  const scratcherDiscrepancies = (await listScratcherDiscrepancies(storeId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 10)
    .map((calc) => ({
      shift_report_id: calc.shiftReportId,
      variance_value: calc.varianceValue,
      flags: calc.flags,
      updated_at: calc.updatedAt,
    }));

  const surveillanceInvestigations = (
    await listSurveillanceInvestigations({ storeIds: [storeId] })
  )
    .slice(0, 20)
    .map((record) => ({
      id: record.id,
      status: record.status,
      report_id: record.reportId,
      updated_at: record.updatedAt,
      notes: record.notes ?? undefined,
    }));

  let scratcherSnapshotsRecent: Array<Record<string, unknown>> = [];
  try {
    const bundle = await listScratcherSlotBundle(storeId);
    const slotMap = new Map(
      bundle.slots.map((slot) => [
        slot.id,
        { number: slot.slotNumber, label: slot.label ?? undefined },
      ]),
    );
    const productMap = new Map(
      bundle.products.map((product) => [product.id, product.name ?? undefined]),
    );
    const packMap = new Map(
      bundle.packs.map((pack) => [
        pack.id,
        {
          code: pack.packCode ?? undefined,
          product: productMap.get(pack.productId) ?? undefined,
        },
      ]),
    );

    const recentShiftIds = shiftReports.slice(0, 5).map((report) => report.id);
    const snapshotEntries = await Promise.all(
      recentShiftIds.map(async (shiftReportId) => {
        const { snapshots, items } = await listScratcherSnapshots(shiftReportId);
        if (!snapshots.length) return null;
        const endSnapshot = snapshots
          .filter((snap) => snap.snapshotType === "end")
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        if (!endSnapshot) return null;
        const endItems = items.filter((item) => item.snapshotId === endSnapshot.id);
        const sample = endItems.slice(0, 12).map((item) => {
          const slot = slotMap.get(item.slotId);
          const pack = item.packId ? packMap.get(item.packId) : undefined;
          return {
            slot: slot?.number ?? undefined,
            slot_label: slot?.label ?? undefined,
            ticket: item.ticketValue,
            pack_code: pack?.code ?? undefined,
            product: pack?.product ?? undefined,
          };
        });
        return {
          shift_report_id: shiftReportId,
          end_snapshot_at: endSnapshot.createdAt,
          item_count: endItems.length,
          sample,
        };
      }),
    );
    scratcherSnapshotsRecent = snapshotEntries.filter(Boolean) as Array<Record<
      string,
      unknown
    >>;
  } catch (error) {
    console.error("assistant scratcher snapshot error", error);
  }

  let surveillanceReportsRecent: Array<Record<string, unknown>> = [];
  try {
    const rows = await listRecentSurveillanceReportsForStore({
      storeId,
      days: 7,
      limit: 20,
    });
    surveillanceReportsRecent = rows.map((row) => ({
      id: row.id,
      created_at: row.createdAt,
      employee: row.employeeName,
      label: row.label,
      grade: row.grade ?? null,
      grade_reason: truncateText(row.gradeReason, 240),
      summary: truncateText(row.summary, 320),
      notes: truncateText(row.notes, 480),
    }));
  } catch (error) {
    console.error("assistant surveillance report load error", error);
  }

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
    shift_reports_recent: shiftReportsRecent,
    scratcher_calculations_recent: scratcherCalculations,
    scratcher_discrepancies_recent: scratcherDiscrepancies,
    scratcher_snapshots_recent: scratcherSnapshotsRecent,
    surveillance_reports_recent: surveillanceReportsRecent,
    surveillance_investigations_recent: surveillanceInvestigations,
    pos_summary_30d: posSummary,
    recent_records: recentRecords,
  };

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const languageInstruction = secondaryLanguage
    ? `The user may write in ${primaryLanguage} or ${secondaryLanguage}. Respond in the same language as the user when possible. If uncertain, default to ${primaryLanguage}.`
    : `The user prefers ${primaryLanguage}. Respond in ${primaryLanguage}.`;

  const systemPrompt =
    "You are the Iron Hand store assistant. Answer using only the provided store context. " +
    "Tone: friendly, smart, organized, and calm. Professional but warm. Never sarcastic or harsh. " +
    "Be concise but not abrupt: default to 1-4 short sentences. Use bullets only when it improves clarity (max 4 bullets). " +
    "Use all relevant context: recent records + attachments, shift reports, scratcher snapshots/calculations, and surveillance reports/investigations. " +
    "You cannot view or analyze video footage here; rely on surveillance summaries/notes and linked records. " +
    "If the user asks for data you do not have, say what is missing and offer the next best available info. " +
    `${languageInstruction}`;

  const messages: LocalResponseInputMessage[] = [
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
    const err = error as any;
    console.error("assistant error", {
      message: err?.message ?? "Unknown error",
      status: err?.status,
      code: err?.code,
      type: err?.type,
    });
    return NextResponse.json(
      { error: "Assistant unavailable. Please try again in a moment." },
      { status: 502 },
    );
  }
}
