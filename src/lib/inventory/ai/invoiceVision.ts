import OpenAI from "openai";

export type InventoryInvoiceHeaderOutput = {
  extracted_text: string;
  vendor: { name: string | null; evidence: string | null };
  customer: { name: string | null; evidence: string | null };
  invoice: { number: string | null; date: string | null; evidence: string | null };
  totals: {
    subtotal: number | null;
    tax: number | null;
    total: number | null;
    evidence: string | null;
  };
};

export type InventoryInvoiceLineItemOutput = {
  description: string;
  size: string | null;
  quantity: number | null;
  quantity_text: string | null;
  unit: string | null;
  line_total: number | null;
  evidence: string;
};

export type InventoryInvoiceLineItemsOutput = {
  line_items: InventoryInvoiceLineItemOutput[];
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

const buildHeaderSchema = () => ({
  type: "object",
  additionalProperties: false,
  properties: {
    extracted_text: { type: "string", description: "Raw text extracted from the invoice (best effort)." },
    vendor: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: ["string", "null"] },
        evidence: { type: ["string", "null"], description: "Verbatim snippet that contains the vendor name." },
      },
      required: ["name", "evidence"],
    },
    customer: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: ["string", "null"] },
        evidence: { type: ["string", "null"], description: "Verbatim snippet that contains the customer/store name." },
      },
      required: ["name", "evidence"],
    },
    invoice: {
      type: "object",
      additionalProperties: false,
      properties: {
        number: { type: ["string", "null"] },
        date: { type: ["string", "null"], description: "Invoice date in the format shown on the invoice." },
        evidence: { type: ["string", "null"], description: "Verbatim snippet containing invoice number/date." },
      },
      required: ["number", "date", "evidence"],
    },
    totals: {
      type: "object",
      additionalProperties: false,
      properties: {
        subtotal: { type: ["number", "null"] },
        tax: { type: ["number", "null"] },
        total: { type: ["number", "null"] },
        evidence: { type: ["string", "null"], description: "Verbatim snippet containing the totals." },
      },
      required: ["subtotal", "tax", "total", "evidence"],
    },
  },
  required: ["extracted_text", "vendor", "customer", "invoice", "totals"],
});

const buildLineItemsSchema = () => ({
  type: "object",
  additionalProperties: false,
  properties: {
    line_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          description: { type: "string", description: "Product description as printed on the row." },
          size: { type: ["string", "null"], description: "Size/format token (e.g. 750ML, 50ML, 12/750ML) if printed." },
          quantity: { type: ["number", "null"], description: "Numeric quantity if clearly readable." },
          quantity_text: { type: ["string", "null"], description: "Verbatim quantity cell text (do not normalize)." },
          unit: { type: ["string", "null"], description: "Verbatim unit token/cell text (do not infer)." },
          line_total: { type: ["number", "null"], description: "Extended line total if clearly readable." },
          evidence: { type: "string", description: "Verbatim row snippet that supports the extracted fields." },
        },
        required: ["description", "size", "quantity", "quantity_text", "unit", "line_total", "evidence"],
      },
    },
  },
  required: ["line_items"],
});

const scrubEvidenceLockedHeader = (parsed: InventoryInvoiceHeaderOutput): InventoryInvoiceHeaderOutput => {
  const lockString = (value: string | null, evidence: string | null) => {
    const v = typeof value === "string" ? value.trim() : "";
    const e = typeof evidence === "string" ? evidence : "";
    if (!v) return { value: null as string | null, evidence: evidence ?? null };
    if (!e) return { value: null as string | null, evidence: null };
    const normV = v.toLowerCase();
    const normE = e.toLowerCase();
    if (!normE.includes(normV)) return { value: null as string | null, evidence };
    return { value: v, evidence };
  };

  const vendor = lockString(parsed.vendor?.name ?? null, parsed.vendor?.evidence ?? null);
  const customer = lockString(parsed.customer?.name ?? null, parsed.customer?.evidence ?? null);
  const invoiceNumber = lockString(parsed.invoice?.number ?? null, parsed.invoice?.evidence ?? null);
  const invoiceDate = lockString(parsed.invoice?.date ?? null, parsed.invoice?.evidence ?? null);

  return {
    extracted_text: String(parsed.extracted_text ?? ""),
    vendor: { name: vendor.value, evidence: vendor.evidence },
    customer: { name: customer.value, evidence: customer.evidence },
    invoice: { number: invoiceNumber.value, date: invoiceDate.value, evidence: parsed.invoice?.evidence ?? null },
    totals: {
      subtotal: typeof parsed.totals?.subtotal === "number" ? parsed.totals.subtotal : null,
      tax: typeof parsed.totals?.tax === "number" ? parsed.totals.tax : null,
      total: typeof parsed.totals?.total === "number" ? parsed.totals.total : null,
      evidence: parsed.totals?.evidence ?? null,
    },
  };
};

export async function runInventoryInvoiceHeaderVision(args: {
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
              "You extract header fields from a liquor/convenience vendor invoice IMAGE.\n" +
              "STRICT RULES (anti-hallucination):\n" +
              "- Use ONLY values you can read in the image.\n" +
              "- Every non-null field MUST include verbatim evidence copied from the image that contains that value.\n" +
              "- If you cannot find verbatim evidence in the image, set the value to null.\n" +
              "- Do NOT infer names, addresses, totals, or dates.\n" +
              "- Output MUST be strict JSON matching the schema.\n",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Extract vendor/customer/invoice header fields from this invoice. Do not extract line items in this pass.",
          },
          { type: "input_image", image_url: args.dataUrl, detail: args.detail },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "inventory_invoice_header",
        strict: true,
        schema: buildHeaderSchema(),
      },
    },
  });

  const outputText = extractOutputText(response).trim();
  const parsed = safeJson(outputText) as InventoryInvoiceHeaderOutput | null;
  if (!parsed) {
    throw new Error("Inventory invoice vision returned invalid JSON.");
  }
  return { parsed: scrubEvidenceLockedHeader(parsed), outputText };
}

export async function runInventoryInvoiceLineItemsVision(args: {
  client: OpenAI;
  model: string;
  dataUrl: string;
  detail: "high";
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
              "You extract ONLY the LINE-ITEM TABLE from a liquor distributor invoice IMAGE.\n" +
              "Treat the invoice as a structured table: one product per visible row.\n" +
              "STRICT RULES (anti-hallucination):\n" +
              "- Use ONLY values you can read in the image.\n" +
              "- Do NOT guess quantities, units, sizes, or totals.\n" +
              "- If a cell value is not clearly readable from the row, set that field to null.\n" +
              "- For EVERY returned row, include a verbatim row evidence snippet copied from the image.\n" +
              "- Evidence MUST be copied verbatim (no paraphrase) and should include the row's key tokens.\n" +
              "- Output MUST be strict JSON matching the schema.\n",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Extract all visible line-item rows. For each row, populate description/size/quantity/unit/line_total only if clearly readable. Keep quantity_text and unit as verbatim cell text when present.",
          },
          { type: "input_image", image_url: args.dataUrl, detail: args.detail },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "inventory_invoice_line_items",
        strict: true,
        schema: buildLineItemsSchema(),
      },
    },
  });

  const outputText = extractOutputText(response).trim();
  const parsed = safeJson(outputText) as InventoryInvoiceLineItemsOutput | null;
  if (!parsed) {
    throw new Error("Inventory invoice line-item vision returned invalid JSON.");
  }
  const line_items = Array.isArray(parsed.line_items) ? parsed.line_items : [];
  const cleaned: InventoryInvoiceLineItemsOutput = {
    line_items: line_items
      .map((item) => {
        const description = String(item?.description ?? "").trim();
        if (!description) return null;
        const evidence = String(item?.evidence ?? "").trim();
        if (!evidence) return null;
        return {
          description,
          size: item?.size ? String(item.size).trim() : null,
          quantity: typeof item?.quantity === "number" && Number.isFinite(item.quantity) ? item.quantity : null,
          quantity_text: item?.quantity_text ? String(item.quantity_text).trim() : null,
          unit: item?.unit ? String(item.unit).trim() : null,
          line_total: typeof item?.line_total === "number" && Number.isFinite(item.line_total) ? item.line_total : null,
          evidence,
        } satisfies InventoryInvoiceLineItemOutput;
      })
      .filter(Boolean) as InventoryInvoiceLineItemOutput[],
  };
  return { parsed: cleaned, outputText };
}
