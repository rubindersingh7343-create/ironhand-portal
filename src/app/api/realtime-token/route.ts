import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getStoreReportConfig,
  listRecentUploadCounts,
  listRecentSurveillanceReportsForStore,
  listShiftReportsRange,
} from "@/lib/dataStore";
import { getStoreSummariesByIds } from "@/lib/userStore";

export const runtime = "nodejs";

const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime";
const REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE ?? "shimmer";
const REALTIME_PROMPT_ID =
  process.env.OPENAI_REALTIME_PROMPT_ID ??
  "pmpt_699773878364819086a0a88eebf7bdc30059081089d1d71f";
const REALTIME_PROMPT_VERSION = process.env.OPENAI_REALTIME_PROMPT_VERSION;
const ALLOWED_VOICES = new Set([
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "marin",
  "sage",
  "shimmer",
  "verse",
]);

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
    | { storeId?: string; voice?: string; primaryLanguage?: string; secondaryLanguage?: string }
    | null;
  const storeId = (payload?.storeId ?? "").trim();
  const requestedVoice = (payload?.voice ?? "").trim();
  const primaryLanguage = (payload?.primaryLanguage ?? "").trim() || "English";
  const secondaryLanguage = (payload?.secondaryLanguage ?? "").trim();
  const voice = ALLOWED_VOICES.has(requestedVoice) ? requestedVoice : REALTIME_VOICE;

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
      acc.liquor += report.liquorAmount;
      acc.beer += report.beerAmount;
      acc.cig += report.cigAmount;
      acc.tobacco += report.tobaccoAmount;
      acc.gas += report.gasAmount;
      acc.atm += report.atmAmount;
      acc.lotto += report.lottoAmount;
      acc.lottoPo += report.lottoPoAmount;
      acc.scr += report.scrAmount;
      acc.cash += report.cashAmount;
      acc.deposit += report.depositAmount;
      return acc;
    },
    {
      count: 0,
      gross: 0,
      net: 0,
      liquor: 0,
      beer: 0,
      cig: 0,
      tobacco: 0,
      gas: 0,
      atm: 0,
      lotto: 0,
      lottoPo: 0,
      scr: 0,
      cash: 0,
      deposit: 0,
    },
  );

  const posSummary = await loadPosSummary(storeId);

  const truncate = (value: unknown, max = 280) => {
    const text = String(value ?? "").trim();
    if (!text) return null;
    if (text.length <= max) return text;
    return text.slice(0, max - 1) + "…";
  };

  const storeReportConfig = await getStoreReportConfig(storeId);
  const marginByKey = Object.fromEntries(
    (storeReportConfig?.items ?? [])
      .filter((item) => item && typeof item.key === "string" && item.key.length > 0)
      .map((item) => [item.key, item.marginPercent ?? null]),
  ) as Record<string, number | null>;

  const profitEstimate = (amount: number, key: string) => {
    const margin = marginByKey[key];
    if (!Number.isFinite(amount)) return null;
    if (margin === null || margin === undefined) return null;
    if (!Number.isFinite(margin)) return null;
    return Number(((amount * margin) / 100).toFixed(2));
  };

  const recentShiftReports = shiftReports
    .slice()
    .sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return b.updatedAt.localeCompare(a.updatedAt);
    })
    .slice(0, 10)
    .map((report) => ({
      id: report.id,
      date: report.date,
      employee: report.employeeName ?? null,
      gross: report.grossAmount,
      net: report.netAmount,
      liquor: report.liquorAmount,
      beer: report.beerAmount,
      cigarettes: report.cigAmount,
      tobacco: report.tobaccoAmount,
      gas: report.gasAmount,
      atm: report.atmAmount,
      lotto_sales: report.lottoAmount,
      lotto_payout: report.lottoPoAmount,
      scratchers_delta: report.scrAmount,
      cash_delta: report.cashAmount,
      deposit: report.depositAmount,
      custom: (report.customFields ?? []).map((field) => ({
        label: field.label,
        amount: field.amount,
      })),
    }));

  const recent10Summary = recentShiftReports.reduce(
    (acc, report) => {
      acc.count += 1;
      acc.gross += report.gross;
      acc.net += report.net;
      acc.liquor += report.liquor;
      acc.beer += report.beer;
      acc.cigarettes += report.cigarettes;
      acc.tobacco += report.tobacco;
      acc.gas += report.gas;
      acc.atm += report.atm;
      acc.lotto_sales += report.lotto_sales;
      acc.lotto_payout += report.lotto_payout;
      acc.scratchers_delta += report.scratchers_delta;
      acc.cash_delta += report.cash_delta;
      acc.deposit += report.deposit;
      return acc;
    },
    {
      count: 0,
      gross: 0,
      net: 0,
      liquor: 0,
      beer: 0,
      cigarettes: 0,
      tobacco: 0,
      gas: 0,
      atm: 0,
      lotto_sales: 0,
      lotto_payout: 0,
      scratchers_delta: 0,
      cash_delta: 0,
      deposit: 0,
    },
  );

  const context = {
    store: {
      id: storeId,
      name: storeSummary?.storeName ?? `Store ${storeId}`,
      address: storeSummary?.storeAddress ?? null,
    },
    recent_counts: { today, yesterday, counts },
    report_margins_percent: marginByKey,
    surveillance_reports_recent: await listRecentSurveillanceReportsForStore({
      storeId,
      days: 7,
      limit: 20,
    }).then((rows) =>
      rows.map((row) => ({
        id: row.id,
        created_at: row.createdAt,
        employee: row.employeeName,
        label: row.label,
        grade: row.grade ?? null,
        grade_reason: truncate(row.gradeReason, 220),
        summary: truncate(row.summary, 280),
        notes: truncate(row.notes, 420),
      })),
    ),
    shift_summary_14d: {
      report_count: shiftSummary.count,
      gross_total: Number(shiftSummary.gross.toFixed(2)),
      net_total: Number(shiftSummary.net.toFixed(2)),
      liquor_total: Number(shiftSummary.liquor.toFixed(2)),
      beer_total: Number(shiftSummary.beer.toFixed(2)),
      cigarettes_total: Number(shiftSummary.cig.toFixed(2)),
      tobacco_total: Number(shiftSummary.tobacco.toFixed(2)),
      gas_total: Number(shiftSummary.gas.toFixed(2)),
      atm_total: Number(shiftSummary.atm.toFixed(2)),
      lotto_sales_total: Number(shiftSummary.lotto.toFixed(2)),
      lotto_payout_total: Number(shiftSummary.lottoPo.toFixed(2)),
      scratchers_delta_total: Number(shiftSummary.scr.toFixed(2)),
      cash_delta_total: Number(shiftSummary.cash.toFixed(2)),
      deposit_total: Number(shiftSummary.deposit.toFixed(2)),
    },
    shift_summary_recent_10: {
      report_count: recent10Summary.count,
      gross_total: Number(recent10Summary.gross.toFixed(2)),
      net_total: Number(recent10Summary.net.toFixed(2)),
      liquor_total: Number(recent10Summary.liquor.toFixed(2)),
      beer_total: Number(recent10Summary.beer.toFixed(2)),
      cigarettes_total: Number(recent10Summary.cigarettes.toFixed(2)),
      tobacco_total: Number(recent10Summary.tobacco.toFixed(2)),
      gas_total: Number(recent10Summary.gas.toFixed(2)),
      atm_total: Number(recent10Summary.atm.toFixed(2)),
      lotto_sales_total: Number(recent10Summary.lotto_sales.toFixed(2)),
      lotto_payout_total: Number(recent10Summary.lotto_payout.toFixed(2)),
      scratchers_delta_total: Number(recent10Summary.scratchers_delta.toFixed(2)),
      cash_delta_total: Number(recent10Summary.cash_delta.toFixed(2)),
      deposit_total: Number(recent10Summary.deposit.toFixed(2)),
    },
    profit_estimates_recent_10: {
      liquor_profit: profitEstimate(recent10Summary.liquor, "liquor"),
      beer_profit: profitEstimate(recent10Summary.beer, "beer"),
      cigarettes_profit: profitEstimate(recent10Summary.cigarettes, "cig"),
      tobacco_profit: profitEstimate(recent10Summary.tobacco, "tobacco"),
      gas_profit: profitEstimate(recent10Summary.gas, "gas"),
      atm_profit: profitEstimate(recent10Summary.atm, "atm"),
      lotto_profit: profitEstimate(recent10Summary.lotto_sales, "lotto"),
      scratchers_profit: profitEstimate(recent10Summary.scratchers_delta, "scr"),
    },
    shift_reports_recent_10: recentShiftReports,
    pos_summary_30d: posSummary,
  };

  const languageInstruction = secondaryLanguage
    ? `The user may speak ${primaryLanguage} or ${secondaryLanguage}. Respond in the same language as the user when possible. If uncertain, default to ${primaryLanguage}.`
    : `The user prefers ${primaryLanguage}. Respond in ${primaryLanguage}.`;

  const instructions =
    "You are the Iron Hand store assistant. Use only the provided store context. " +
    "Tone: friendly, smart, organized, and calm. Professional but warm. Never sarcastic or harsh. " +
    "Voice: female, deep, soothing, and low-volume. Slow, measured pace with crisp enunciation. " +
    "Be concise but not abrupt: default to 1-4 short sentences. Use bullets only when clarity improves. " +
    "Never invent numbers or claim totals unless they are explicitly present in the store context JSON. " +
    "If the user asks for profit or margin: use report_margins_percent (percent). Estimated profit dollars can be computed as amount * marginPercent / 100. " +
    "Before you answer, confirm the user's intent category. Decide whether the request is about Sales, Surveillance, or Another category. " +
    'If you are not sure which one, ask exactly: "Quick check — is this about sales, surveillance, or something else?" Then stop. ' +
    "Do not answer the underlying question until the category is confirmed. " +
    "Never speak unprompted. Only respond after the user has asked a question or made a request. " +
    "Never switch languages unless the user's most recent message is clearly in that language. If unsure, use the primary language. " +
    "If asked for data you don't have, say what is missing and offer the next best available info. " +
    `${languageInstruction} ` +
    `Store context JSON:\\n${JSON.stringify(context)}`;

  const promptVariables = {
    store_id: storeId,
    store_name: context.store.name,
    store_context: JSON.stringify(context),
    primary_language: primaryLanguage,
    secondary_language: secondaryLanguage,
  };

  const prompt =
    REALTIME_PROMPT_ID && REALTIME_PROMPT_ID.trim().length
      ? {
          id: REALTIME_PROMPT_ID,
          ...(REALTIME_PROMPT_VERSION ? { version: REALTIME_PROMPT_VERSION } : {}),
          variables: promptVariables,
        }
      : null;

  const sessionConfig = {
    session: {
      type: "realtime",
      model: REALTIME_MODEL,
      output_modalities: ["audio"],
      instructions,
      audio: {
        input: {
          transcription: {
            model: "gpt-4o-mini-transcribe",
          },
          // Automatic back-and-forth conversation: server VAD commits turns and triggers responses.
          turn_detection: {
            type: "server_vad",
            threshold: 0.45,
            prefix_padding_ms: 300,
            silence_duration_ms: 250,
            // We'll create responses manually after we see a clear user intent.
            create_response: false,
            interrupt_response: true,
          },
        },
        output: {
          voice,
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
    return NextResponse.json({
      value,
      prompt,
      turn_detection_type: null,
      turn_detection_create_response: null,
    });
  } catch (error) {
    console.error("realtime token error", error);
    return NextResponse.json(
      { error: "Failed to mint realtime token." },
      { status: 502 },
    );
  }
}
