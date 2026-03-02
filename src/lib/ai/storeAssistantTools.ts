import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getCombinedRecords,
  listEmployeeHoursEntries,
  listOpenInvestigations,
  listRecentSurveillanceReportsForStore,
  listScratcherDiscrepancies,
  listShiftReportsRange,
} from "@/lib/dataStore";
import { getStoreSummariesByIds } from "@/lib/userStore";
import type { SessionUser } from "@/lib/types";
import { formatHelp, listHelpTopics, resolveHelpTopic } from "@/lib/ai/helpMap";

export type ToolContext = {
  user: SessionUser;
};

type DateRange = {
  start_date?: string;
  end_date?: string;
  days?: number;
};

const toISODate = (value: string) => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(trimmed)) return trimmed;
  if (/^\\d{4}-\\d{2}-\\d{2}T/.test(trimmed)) return trimmed.slice(0, 10);
  return trimmed;
};

const todayISO = () => new Date().toLocaleDateString("en-CA");

function clampDateRange(range: DateRange | null | undefined, fallbackDays: number) {
  const end = toISODate(range?.end_date || "") || todayISO();
  const startFromPayload = toISODate(range?.start_date || "");
  const days = Number(range?.days ?? 0);
  const windowDays =
    Number.isFinite(days) && days > 0 ? Math.min(180, Math.max(1, days)) : fallbackDays;

  const start = (() => {
    if (startFromPayload) return startFromPayload;
    const date = new Date(`${end}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
      const d = new Date();
      d.setDate(d.getDate() - windowDays);
      return d.toISOString().slice(0, 10);
    }
    date.setDate(date.getDate() - windowDays);
    return date.toISOString().slice(0, 10);
  })();

  return { startDate: start, endDate: end };
}

function allowedStoresForUser(user: SessionUser): string[] {
  if (Array.isArray(user.storeIds) && user.storeIds.length) return user.storeIds;
  if (user.storeNumber) return [user.storeNumber];
  return [];
}

function assertStoreAccess(ctx: ToolContext, storeId: string) {
  const allowed = allowedStoresForUser(ctx.user);
  if (!storeId || !allowed.includes(storeId)) {
    const err = new Error("Forbidden");
    (err as any).status = 403;
    throw err;
  }
}

const safeNumber = (value: unknown) => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

export async function tool_get_store_list(ctx: ToolContext, args: { user_id?: string }) {
  const userId = (args?.user_id ?? "").trim();
  if (userId && userId !== ctx.user.id) {
    return [];
  }
  const storeIds = allowedStoresForUser(ctx.user);
  const summaries = await getStoreSummariesByIds(storeIds);
  return (summaries ?? [])
    .filter(Boolean)
    .map((s) => ({
      store_id: s.storeId,
      store_name: s.storeName ?? `Store ${s.storeId}`,
    }));
}

export async function tool_get_store_snapshot(
  ctx: ToolContext,
  args: { store_id: string; range?: DateRange },
) {
  const storeId = String(args?.store_id ?? "").trim();
  assertStoreAccess(ctx, storeId);

  const { startDate, endDate } = clampDateRange(args?.range, 14);
  const [storeSummary] = await getStoreSummariesByIds([storeId]);
  const storeName = storeSummary?.storeName ?? `Store ${storeId}`;

  const shiftReports = await listShiftReportsRange({
    storeId,
    startDate,
    endDate,
  });
  const latestShift = shiftReports
    .slice()
    .sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return b.updatedAt.localeCompare(a.updatedAt);
    })[0];

  const openInvestigations = await listOpenInvestigations({ storeIds: [storeId] });
  const scratcherFlags = await listScratcherDiscrepancies(storeId);
  const surveillanceRecent = await listRecentSurveillanceReportsForStore({
    storeId,
    days: 14,
    limit: 10,
  });

  const upcomingInvoices = await (async () => {
    const records = await getCombinedRecords({
      storeNumber: storeId,
      category: "invoice",
      startDate,
      endDate,
    });
    return (records ?? [])
      .map((row) => ({
        id: row.id,
        company: row.invoiceCompany ?? null,
        invoice_number: row.invoiceNumber ?? null,
        due_date: row.invoiceDueDate ?? null,
        amount: row.invoiceAmountCents ? row.invoiceAmountCents / 100 : null,
        paid: Boolean(row.invoicePaid),
      }))
      .filter((row) => row.due_date)
      .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
      .slice(0, 15);
  })();

  const totals = shiftReports.reduce(
    (acc, r) => {
      acc.gross += safeNumber(r.grossAmount);
      acc.net += safeNumber(r.netAmount);
      acc.liquor += safeNumber(r.liquorAmount);
      acc.beer += safeNumber(r.beerAmount);
      acc.cigarettes += safeNumber(r.cigAmount);
      acc.tobacco += safeNumber(r.tobaccoAmount);
      acc.gas += safeNumber(r.gasAmount);
      acc.lotto_sales += safeNumber(r.lottoAmount);
      acc.lotto_payout += safeNumber(r.lottoPoAmount);
      acc.scr += safeNumber(r.scrAmount);
      acc.count += 1;
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
      lotto_sales: 0,
      lotto_payout: 0,
      scr: 0,
    },
  );

  return {
    store: { store_id: storeId, store_name: storeName },
    range: { start_date: startDate, end_date: endDate },
    last_shift: latestShift
      ? {
          id: latestShift.id,
          date: latestShift.date,
          employee: latestShift.employeeName ?? null,
          gross: latestShift.grossAmount,
          net: latestShift.netAmount,
          liquor: latestShift.liquorAmount,
          beer: latestShift.beerAmount,
          cigarettes: latestShift.cigAmount,
          tobacco: latestShift.tobaccoAmount,
          gas: latestShift.gasAmount,
          lotto_sales: latestShift.lottoAmount,
          lotto_payout: latestShift.lottoPoAmount,
          scratchers_delta: latestShift.scrAmount,
          investigation_flag: Boolean(latestShift.investigationFlag),
        }
      : null,
    totals: {
      shift_count: totals.count,
      gross: Number(totals.gross.toFixed(2)),
      net: Number(totals.net.toFixed(2)),
      liquor: Number(totals.liquor.toFixed(2)),
      beer: Number(totals.beer.toFixed(2)),
      cigarettes: Number(totals.cigarettes.toFixed(2)),
      tobacco: Number(totals.tobacco.toFixed(2)),
      gas: Number(totals.gas.toFixed(2)),
      lotto_sales: Number(totals.lotto_sales.toFixed(2)),
      lotto_payout: Number(totals.lotto_payout.toFixed(2)),
      scratchers_delta: Number(totals.scr.toFixed(2)),
    },
    scratchers_flags: scratcherFlags.slice(0, 12).map((flag) => ({
      shift_report_id: flag.shiftReportId,
      variance_value: flag.varianceValue,
      flags: flag.flags ?? [],
      updated_at: flag.updatedAt,
    })),
    surveillance_latest: surveillanceRecent[0]
      ? {
          id: surveillanceRecent[0].id,
          created_at: surveillanceRecent[0].createdAt,
          label: surveillanceRecent[0].label,
          grade: surveillanceRecent[0].grade ?? null,
          summary: surveillanceRecent[0].summary?.slice(0, 360) ?? "",
          notes: surveillanceRecent[0].notes?.slice(0, 480) ?? null,
        }
      : null,
    open_investigations_count: openInvestigations.length,
    upcoming_invoices: upcomingInvoices,
  };
}

export async function tool_search_shift_reports(
  ctx: ToolContext,
  args: { store_id: string; query?: string; date_range?: DateRange },
) {
  const storeId = String(args?.store_id ?? "").trim();
  assertStoreAccess(ctx, storeId);
  const query = String(args?.query ?? "").trim().toLowerCase();
  const { startDate, endDate } = clampDateRange(args?.date_range, 30);

  const reports = await listShiftReportsRange({ storeId, startDate, endDate });
  const filtered = query
    ? reports.filter((r) => {
        const hay = [
          r.employeeName ?? "",
          r.managerName ?? "",
          r.date,
          r.investigationReason ?? "",
          ...(r.customFields ?? []).map((f) => `${f.label}:${f.amount}`),
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(query);
      })
    : reports;

  return filtered.slice(0, 40).map((r) => ({
    id: r.id,
    date: r.date,
    employee: r.employeeName ?? null,
    gross: r.grossAmount,
    net: r.netAmount,
    liquor: r.liquorAmount,
    beer: r.beerAmount,
    cigarettes: r.cigAmount,
    tobacco: r.tobaccoAmount,
    gas: r.gasAmount,
    lotto_sales: r.lottoAmount,
    lotto_payout: r.lottoPoAmount,
    scratchers_delta: r.scrAmount,
    investigation_flag: Boolean(r.investigationFlag),
    investigation_reason: r.investigationReason ?? null,
  }));
}

export async function tool_search_surveillance(
  ctx: ToolContext,
  args: { store_id: string; query?: string; date_range?: DateRange },
) {
  const storeId = String(args?.store_id ?? "").trim();
  assertStoreAccess(ctx, storeId);
  const query = String(args?.query ?? "").trim().toLowerCase();
  const { startDate, endDate } = clampDateRange(args?.date_range, 30);

  const supabase = getSupabaseAdmin();
  if (!supabase) return [];

  const select = `
    id,
    store_number,
    employee_name,
    notes,
    surveillance_label,
    surveillance_summary,
    surveillance_grade,
    surveillance_grade_reason,
    created_at,
    record_files (
      id,
      label,
      original_name,
      mime_type,
      size,
      storage_path
    )
  `;

  const { data, error } = await supabase
    .from("records")
    .select(select)
    .eq("category", "surveillance")
    .eq("store_number", storeId)
    .gte("created_at", `${startDate}T00:00:00.000Z`)
    .lte("created_at", `${endDate}T23:59:59.999Z`)
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) return [];

  const rows = (data ?? []).filter((row: any) => {
    if (!query) return true;
    const hay = [
      row.employee_name ?? "",
      row.surveillance_label ?? "",
      row.surveillance_summary ?? "",
      row.surveillance_grade_reason ?? "",
      row.notes ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(query);
  });

  return rows.slice(0, 35).map((row: any) => ({
    id: row.id,
    created_at: row.created_at,
    employee: row.employee_name ?? null,
    label: row.surveillance_label ?? "",
    summary: row.surveillance_summary ?? "",
    grade: row.surveillance_grade ?? null,
    grade_reason: row.surveillance_grade_reason ?? null,
    notes: row.notes ?? null,
    images: (row.record_files ?? [])
      .filter((f: any) => String(f.mime_type ?? "").startsWith("image/"))
      .slice(0, 6)
      .map((f: any) => ({
        id: f.id,
        label: f.label ?? null,
        original_name: f.original_name ?? null,
        mime_type: f.mime_type ?? null,
        size: f.size ?? null,
        storage_path: f.storage_path ?? null,
      })),
  }));
}

export async function tool_list_invoices(
  ctx: ToolContext,
  args: { store_id: string; date_range?: DateRange },
) {
  const storeId = String(args?.store_id ?? "").trim();
  assertStoreAccess(ctx, storeId);
  const { startDate, endDate } = clampDateRange(args?.date_range, 60);

  const records = await getCombinedRecords({
    storeNumber: storeId,
    category: "invoice",
    startDate,
    endDate,
  });

  return (records ?? []).slice(0, 60).map((row) => ({
    id: row.id,
    created_at: row.createdAt,
    company: row.invoiceCompany ?? null,
    invoice_number: row.invoiceNumber ?? null,
    due_date: row.invoiceDueDate ?? null,
    amount: row.invoiceAmountCents ? row.invoiceAmountCents / 100 : null,
    paid: Boolean(row.invoicePaid),
    paid_amount: row.invoicePaidAmountCents ? row.invoicePaidAmountCents / 100 : null,
    notes: row.invoiceNotes ?? row.notes ?? null,
  }));
}

export async function tool_list_employee_hours(
  ctx: ToolContext,
  args: { store_id: string; date_range?: DateRange },
) {
  const storeId = String(args?.store_id ?? "").trim();
  assertStoreAccess(ctx, storeId);
  const { startDate, endDate } = clampDateRange(args?.date_range, 30);

  const months = (() => {
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [todayISO().slice(0, 7)];
    const out: string[] = [];
    const cursor = new Date(start);
    cursor.setDate(1);
    while (cursor <= end) {
      out.push(cursor.toISOString().slice(0, 7));
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return out.slice(0, 6);
  })();

  const entries = (await Promise.all(months.map((month) => listEmployeeHoursEntries({ storeId, month }))))
    .flat()
    .filter((e) => e.date >= startDate && e.date <= endDate)
    .slice(0, 220);

  const byDate = new Map<string, typeof entries>();
  for (const entry of entries) {
    const list = byDate.get(entry.date) ?? [];
    list.push(entry);
    byDate.set(entry.date, list);
  }
  const overlaps = Array.from(byDate.entries())
    .flatMap(([date, list]) => {
      const sorted = list.slice().sort((a, b) => `${a.startTime}`.localeCompare(`${b.startTime}`));
      const out: Array<{ date: string; a: string; b: string }> = [];
      for (let i = 0; i < sorted.length; i += 1) {
        for (let j = i + 1; j < sorted.length; j += 1) {
          const A = sorted[i];
          const B = sorted[j];
          if (!A.startTime || !A.endTime || !B.startTime || !B.endTime) continue;
          if (A.endTime <= B.startTime) break;
          out.push({ date, a: A.employeeName, b: B.employeeName });
        }
      }
      return out;
    })
    .slice(0, 30);

  return {
    range: { start_date: startDate, end_date: endDate },
    entries: entries.map((e) => ({
      date: e.date,
      employee: e.employeeName,
      start: e.startTime,
      end: e.endTime,
      hours: e.hours,
      break_minutes: e.breakMinutes,
    })),
    overlaps,
  };
}

export async function tool_app_help(ctx: ToolContext, args: { topic: string }) {
  void ctx;
  const topic = String(args?.topic ?? "").trim();
  const entry = resolveHelpTopic(topic);
  if (!entry) {
    return {
      matched: null,
      available_topics: listHelpTopics(),
    };
  }
  return {
    matched: formatHelp(entry),
  };
}

export const STORE_ASSISTANT_TOOL_DEFS = [
  {
    type: "function" as const,
    function: {
      name: "get_store_list",
      description: "List stores the current user can access.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          user_id: { type: "string", description: "Session user id." },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_store_snapshot",
      description:
        "Get a compact snapshot of a store: recent shift totals, scratcher flags, latest surveillance summary, open investigations count, upcoming invoices.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          store_id: { type: "string" },
          range: {
            type: "object",
            additionalProperties: false,
            properties: {
              start_date: { type: "string" },
              end_date: { type: "string" },
              days: { type: "number" },
            },
          },
        },
        required: ["store_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_shift_reports",
      description: "Search shift reports for a store within an optional date range.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          store_id: { type: "string" },
          query: { type: "string" },
          date_range: {
            type: "object",
            additionalProperties: false,
            properties: {
              start_date: { type: "string" },
              end_date: { type: "string" },
              days: { type: "number" },
            },
          },
        },
        required: ["store_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_surveillance",
      description:
        "Search surveillance uploads for a store. Return summaries and image metadata only (no raw images).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          store_id: { type: "string" },
          query: { type: "string" },
          date_range: {
            type: "object",
            additionalProperties: false,
            properties: {
              start_date: { type: "string" },
              end_date: { type: "string" },
              days: { type: "number" },
            },
          },
        },
        required: ["store_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_invoices",
      description: "List invoices for a store within a date range.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          store_id: { type: "string" },
          date_range: {
            type: "object",
            additionalProperties: false,
            properties: {
              start_date: { type: "string" },
              end_date: { type: "string" },
              days: { type: "number" },
            },
          },
        },
        required: ["store_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_employee_hours",
      description: "List employee hours entries and basic overlaps for a store.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          store_id: { type: "string" },
          date_range: {
            type: "object",
            additionalProperties: false,
            properties: {
              start_date: { type: "string" },
              end_date: { type: "string" },
              days: { type: "number" },
            },
          },
        },
        required: ["store_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "app_help",
      description: "Return app how-to steps for a given topic.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          topic: { type: "string" },
        },
        required: ["topic"],
      },
    },
  },
] as const;

export async function runStoreAssistantTool(ctx: ToolContext, name: string, args: any) {
  switch (name) {
    case "get_store_list":
      return tool_get_store_list(ctx, args ?? {});
    case "get_store_snapshot":
      return tool_get_store_snapshot(ctx, args ?? {});
    case "search_shift_reports":
      return tool_search_shift_reports(ctx, args ?? {});
    case "search_surveillance":
      return tool_search_surveillance(ctx, args ?? {});
    case "list_invoices":
      return tool_list_invoices(ctx, args ?? {});
    case "list_employee_hours":
      return tool_list_employee_hours(ctx, args ?? {});
    case "app_help":
      return tool_app_help(ctx, args ?? {});
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

