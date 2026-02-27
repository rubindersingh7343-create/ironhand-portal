import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getSessionUser } from "@/lib/auth";
import type { SessionUser } from "@/lib/types";
import {
  STORE_ASSISTANT_TOOL_DEFS,
  runStoreAssistantTool,
  type ToolContext,
} from "@/lib/ai/storeAssistantTools";

export const runtime = "nodejs";

const MODEL =
  process.env.OPENAI_ASSISTANT_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5-mini";

type AssistantRequest = {
  user_id?: string;
  active_store_id?: string;
  message?: string;
  mode?: "text" | "voice";
  mentioned_store_hint?: string;
};

type Severity = "low" | "med" | "high";

type AssistantResponsePayload = {
  primary_store_id: string;
  stores_referenced: string[];
  answer: string;
  insights: Array<{ title: string; detail: string; severity: Severity }>;
  followups: string[];
  actions: Array<{ label: string; deep_link: string }>;
};

const buildSchema = () => ({
  type: "object",
  additionalProperties: false,
  properties: {
    primary_store_id: { type: "string" },
    stores_referenced: { type: "array", items: { type: "string" } },
    answer: { type: "string", description: "Short, spoken-friendly answer." },
    insights: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          severity: { type: "string", enum: ["low", "med", "high"] },
        },
        required: ["title", "detail", "severity"],
      },
    },
    followups: { type: "array", items: { type: "string" } },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          deep_link: { type: "string" },
        },
        required: ["label", "deep_link"],
      },
    },
  },
  required: [
    "primary_store_id",
    "stores_referenced",
    "answer",
    "insights",
    "followups",
    "actions",
  ],
});

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

const safeJson = (value: unknown) => {
  if (!value || typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

function allowedStoresForUser(user: SessionUser): string[] {
  if (Array.isArray(user.storeIds) && user.storeIds.length) return user.storeIds;
  if (user.storeNumber) return [user.storeNumber];
  return [];
}

function pickPrimaryStore(user: SessionUser, requested: string) {
  const allowed = allowedStoresForUser(user);
  const trimmed = requested.trim();
  if (trimmed && allowed.includes(trimmed)) return trimmed;
  return allowed[0] ?? "";
}

function shouldConfirmVoiceTopic(message: string) {
  const normalized = message.toLowerCase();
  const hasExplicitTopic =
    /\b(sales|gross|net|profit|margin|pos|report|reports|shift|totals?)\b/.test(normalized) ||
    /\b(lotto|lottery|scratchers?|scr|p\/o|payout|atm|cash|deposit)\b/.test(normalized) ||
    /\b(surveillance|camera|incident|theft|stolen|robbery|fight|police|footage|investigation|case|cases)\b/.test(
      normalized,
    ) ||
    /\b(invoice|invoices|bill|bills|due|payment)\b/.test(normalized) ||
    /\b(order|orders)\b/.test(normalized) ||
    /\b(hours?|payroll|schedule)\b/.test(normalized);

  if (hasExplicitTopic) return false;

  const clearIntent =
    /\b(what|why|how|when|where|who|show|tell|give|pull|check|find|explain|summarize|compare|open|latest|today|yesterday)\b/.test(
      normalized,
    ) || normalized.split(/\s+/).filter(Boolean).length >= 6;

  return clearIntent;
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OpenAI API key is not configured." },
      { status: 500 },
    );
  }

  const payload = (await request.json().catch(() => null)) as AssistantRequest | null;
  const message = String(payload?.message ?? "").trim();
  if (!message) return NextResponse.json({ error: "Message is required." }, { status: 400 });

  const requestedUserId = String(payload?.user_id ?? "").trim();
  if (requestedUserId && requestedUserId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const primaryStoreId = pickPrimaryStore(user, String(payload?.active_store_id ?? ""));
  if (!primaryStoreId) {
    return NextResponse.json({ error: "No stores are linked to this user." }, { status: 400 });
  }

  const mode = payload?.mode === "voice" ? "voice" : "text";
  const hint = String(payload?.mentioned_store_hint ?? "").trim();

  // Voice UX: if the user didn't clearly indicate "sales" vs "surveillance" (or another topic),
  // ask for the category first to avoid wrong answers.
  if (mode === "voice" && shouldConfirmVoiceTopic(message)) {
    const isPunjabi = /[\u0A00-\u0A7F]/.test(message);
    return NextResponse.json({
      primary_store_id: primaryStoreId,
      stores_referenced: [primaryStoreId],
      answer: isPunjabi
        ? "ਤੁਸੀਂ ਸੇਲਜ਼, ਸਰਵੇਲੈਂਸ, ਜਾਂ ਕੁਝ ਹੋਰ ਬਾਰੇ ਪੁੱਛ ਰਹੇ ਹੋ?"
        : "Quick check: sales, surveillance, or something else?",
      insights: [],
      followups: ["Sales", "Surveillance", "Something else"],
      actions: [],
    } satisfies AssistantResponsePayload);
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const ctx: ToolContext = { user };

  const system =
    "You are Iron Hand's Store Assistant.\n" +
    "You answer using Supabase data via tools.\n" +
    "Languages: English + Punjabi only. Detect which one the user used and respond in that language. If unsure, ask once: \"English or Punjabi?\".\n" +
    "Default scope: active store.\n" +
    "If user asks about another store, call get_store_list, resolve best match, then fetch that store's data.\n" +
    "If ambiguous, ask ONE clarifying question listing 2-3 likely stores.\n" +
    "If the user is off-topic, keep it short and redirect back to store topics: \"Let’s keep it on the store. Want sales, surveillance, or invoices?\".\n" +
    "Do not invent numbers.\n" +
    "Cash/deposit cash: only discuss if explicitly asked.\n" +
    "Tone: serious, helpful, concise.\n" +
    "Output MUST be strict JSON matching the schema.\n" +
    `Session: user_id=${user.id}, active_store_id=${primaryStoreId}, mode=${mode}` +
    (hint ? `, mentioned_store_hint=${hint}` : "");

  const baseInput = [
    { role: "system" as const, content: [{ type: "input_text" as const, text: system }] },
    { role: "user" as const, content: [{ type: "input_text" as const, text: message }] },
  ];

  const create = async (opts: { previous_response_id?: string; toolOutputs?: any[] }) => {
    return client.responses.create({
      model: MODEL,
      previous_response_id: opts.previous_response_id,
      input: opts.toolOutputs?.length ? opts.toolOutputs : baseInput,
      tools: STORE_ASSISTANT_TOOL_DEFS as any,
      text: {
        format: {
          type: "json_schema",
          name: "iron_hand_store_assistant",
          strict: true,
          schema: buildSchema(),
        },
      },
    });
  };

  const maxTurns = 6;
  let response = await create({});

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const calls =
      (response as any)?.output?.filter?.((item: any) => item?.type === "function_call") ?? [];
    if (!calls.length) break;

    const toolOutputs: any[] = [];
    for (const call of calls) {
      const name = String(call?.name ?? "");
      const callId = String(call?.call_id ?? "");
      const rawArgs = call?.arguments;
      const args = typeof rawArgs === "string" ? safeJson(rawArgs) ?? {} : rawArgs ?? {};
      try {
        const output = await runStoreAssistantTool(ctx, name, args);
        toolOutputs.push({
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(output ?? null),
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Tool failed";
        toolOutputs.push({
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({ error: msg }),
        });
      }
    }

    response = await create({ previous_response_id: (response as any).id, toolOutputs });
  }

  const outputText = extractOutputText(response).trim();
  const parsed = safeJson(outputText) as AssistantResponsePayload | null;
  if (!parsed) {
    return NextResponse.json({ error: "Assistant returned invalid JSON." }, { status: 502 });
  }

  if (!parsed.primary_store_id) parsed.primary_store_id = primaryStoreId;
  if (!Array.isArray(parsed.stores_referenced) || parsed.stores_referenced.length === 0) {
    parsed.stores_referenced = [parsed.primary_store_id];
  }

  return NextResponse.json(parsed);
}
