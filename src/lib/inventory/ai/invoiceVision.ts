import OpenAI from "openai";

export type InventoryInvoiceVisionLineItem = {
  description: string;
  sku: string | null;
  upc: string | null;
  quantity: number | null;
  quantity_text: string | null;
  unit: string | null; // ex: "case", "pack", "each"
  pack_info: string | null; // ex: "12/750ML"
  units_per_case: number | null;
  units_per_pack: number | null;
  unit_cost: number | null;
  line_total: number | null;
  confidence: number; // 0..1
  evidence: string[];
};

export type InventoryInvoiceVisionOutput = {
  extracted_text: string;
  vendor: {
    name: string | null;
    address: string | null;
    confidence: number;
    evidence: string[];
  };
  customer: {
    name: string | null;
    address: string | null;
    confidence: number;
    evidence: string[];
  };
  invoice: {
    number: string | null;
    date: string | null; // Prefer ISO yyyy-mm-dd
    confidence: number;
    evidence: string[];
  };
  totals: {
    subtotal: number | null;
    tax: number | null;
    deposits: number | null;
    discounts: number | null;
    total: number | null;
    confidence: number;
    evidence: string[];
  };
  line_items: InventoryInvoiceVisionLineItem[];
  notes: string[];
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

const safeJson = (value: unknown) => {
  if (!value || typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const buildSchema = () => ({
  type: "object",
  additionalProperties: false,
  properties: {
    extracted_text: { type: "string", description: "Raw text extracted from the invoice (best effort)." },
    vendor: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: ["string", "null"] },
        address: { type: ["string", "null"] },
        confidence: { type: "number" },
        evidence: { type: "array", items: { type: "string" } },
      },
      required: ["name", "address", "confidence", "evidence"],
    },
    customer: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: ["string", "null"] },
        address: { type: ["string", "null"] },
        confidence: { type: "number" },
        evidence: { type: "array", items: { type: "string" } },
      },
      required: ["name", "address", "confidence", "evidence"],
    },
    invoice: {
      type: "object",
      additionalProperties: false,
      properties: {
        number: { type: ["string", "null"] },
        date: { type: ["string", "null"], description: "Invoice date in ISO yyyy-mm-dd if possible." },
        confidence: { type: "number" },
        evidence: { type: "array", items: { type: "string" } },
      },
      required: ["number", "date", "confidence", "evidence"],
    },
    totals: {
      type: "object",
      additionalProperties: false,
      properties: {
        subtotal: { type: ["number", "null"] },
        tax: { type: ["number", "null"] },
        deposits: { type: ["number", "null"] },
        discounts: { type: ["number", "null"] },
        total: { type: ["number", "null"] },
        confidence: { type: "number" },
        evidence: { type: "array", items: { type: "string" } },
      },
      required: ["subtotal", "tax", "deposits", "discounts", "total", "confidence", "evidence"],
    },
    line_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          description: { type: "string" },
          sku: { type: ["string", "null"] },
          upc: { type: ["string", "null"] },
          quantity: { type: ["number", "null"] },
          quantity_text: { type: ["string", "null"] },
          unit: { type: ["string", "null"], description: "Unit label like case/pack/each/bottle/can." },
          pack_info: { type: ["string", "null"], description: "Pack size text like 12/750ML, 24x16.9oz, etc." },
          units_per_case: { type: ["number", "null"] },
          units_per_pack: { type: ["number", "null"] },
          unit_cost: { type: ["number", "null"], description: "Unit cost in dollars." },
          line_total: { type: ["number", "null"], description: "Extended line total in dollars." },
          confidence: { type: "number", description: "0..1 confidence for the line item extraction." },
          evidence: { type: "array", items: { type: "string" } },
        },
        required: [
          "description",
          "sku",
          "upc",
          "quantity",
          "quantity_text",
          "unit",
          "pack_info",
          "units_per_case",
          "units_per_pack",
          "unit_cost",
          "line_total",
          "confidence",
          "evidence",
        ],
      },
    },
    notes: { type: "array", items: { type: "string" } },
  },
  required: ["extracted_text", "vendor", "customer", "invoice", "totals", "line_items", "notes"],
});

export async function runInventoryInvoiceVision(args: {
  client: OpenAI;
  model: string;
  dataUrl: string;
  detail: "low" | "high";
}) {
  const response = await args.client.responses.create({
    model: args.model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You are an expert invoice parser for liquor / convenience store vendor invoices.\n" +
              "Goal: understand the invoice (not just OCR).\n" +
              "Rules:\n" +
              "- Use the IMAGE as the source of truth.\n" +
              "- Extract the VENDOR (seller) and the CUSTOMER/STORE (receiver) separately.\n" +
              "- Extract invoice number, invoice date, totals, and detailed line items.\n" +
              "- For each line item: keep the description as printed; extract quantity and unit (case/pack/each) when shown; capture pack size text when present.\n" +
              "- Provide short evidence snippets (exact text fragments) for key fields.\n" +
              "- Do not invent missing values. Use null when unknown.\n" +
              "- Output MUST be strict JSON matching the schema.\n",
          },
        ],
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: "Parse this vendor invoice." },
          { type: "input_image", image_url: args.dataUrl, detail: args.detail },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "inventory_invoice_parse",
        strict: true,
        schema: buildSchema(),
      },
    },
  });

  const outputText = extractOutputText(response).trim();
  const parsed = safeJson(outputText) as InventoryInvoiceVisionOutput | null;
  if (!parsed) {
    throw new Error("Inventory invoice vision returned invalid JSON.");
  }
  return { parsed, outputText };
}

