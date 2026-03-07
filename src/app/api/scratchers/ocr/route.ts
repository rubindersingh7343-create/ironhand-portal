import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getSessionUser, requireRole } from "@/lib/auth";
import { extractScratcherTicketIdFromOcrText } from "@/lib/scratchers/ocr";

export const runtime = "nodejs";

const MODEL =
  process.env.OPENAI_SCRATCHER_OCR_MODEL ??
  process.env.OPENAI_VISION_MODEL ??
  "gpt-4o-mini";

const MAX_IMAGE_BYTES = (() => {
  const parsed = Number(process.env.IH_SCRATCHER_OCR_MAX_IMAGE_MB ?? "2");
  if (!Number.isFinite(parsed) || parsed <= 0) return 2 * 1024 * 1024;
  return Math.round(Math.min(6, Math.max(1, parsed)) * 1024 * 1024);
})();

const LIMIT_PER_MINUTE = (() => {
  const parsed = Number(process.env.IH_SCRATCHER_OCR_RPM ?? "30");
  if (!Number.isFinite(parsed) || parsed <= 0) return 30;
  return Math.round(Math.min(60, Math.max(5, parsed)));
})();

type WindowEntry = { at: number; count: number };
const windows = new Map<string, WindowEntry>();

const allowRequest = (userId: string) => {
  const now = Date.now();
  const entry = windows.get(userId);
  if (!entry || now - entry.at > 60_000) {
    windows.set(userId, { at: now, count: 1 });
    return true;
  }
  if (entry.count >= LIMIT_PER_MINUTE) return false;
  entry.count += 1;
  return true;
};

const estimateBytes = (dataUrlOrBase64: string) => {
  const raw = dataUrlOrBase64.startsWith("data:")
    ? dataUrlOrBase64.slice(dataUrlOrBase64.indexOf(",") + 1)
    : dataUrlOrBase64;
  return Math.floor((raw.length * 3) / 4);
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

export async function POST(req: Request) {
  const user = await getSessionUser();
  const authorized = requireRole(user, ["employee", "client", "ironhand"]);
  if (!authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OpenAI API key is not configured." },
      { status: 500 },
    );
  }

  if (!allowRequest(authorized.id)) {
    return NextResponse.json(
      { error: "Too many scratcher scans. Try again in a minute." },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const imageBase64 = body?.image_base64;
  if (!imageBase64 || typeof imageBase64 !== "string") {
    return NextResponse.json({ error: "Missing image_base64." }, { status: 400 });
  }

  const approxBytes = estimateBytes(imageBase64);
  if (approxBytes > MAX_IMAGE_BYTES * 1.6) {
    return NextResponse.json(
      { error: `Image too large. Max ${(MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0)}MB.` },
      { status: 413 },
    );
  }

  const dataUrl = imageBase64.startsWith("data:")
    ? imageBase64
    : `data:image/jpeg;base64,${imageBase64}`;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const buildInput = (detail: "low" | "high") => [
    {
      role: "system" as const,
      content: [
        {
          type: "input_text" as const,
          text:
            "You are an OCR engine.\n" +
            "Task: read the printed scratcher ticket id line from the image.\n" +
            "Rules:\n" +
            "- Output ONLY text you can see (no commentary).\n" +
            "- Prefer the ticket id line formatted like ####-######(6-8)-#-##(2-3).\n" +
            "- If multiple candidates are visible, output them on separate lines.\n" +
            "- Do NOT invent missing digits.\n",
        },
      ],
    },
    {
      role: "user" as const,
      content: [
        { type: "input_text" as const, text: "Extract the scratcher ticket id line." },
        { type: "input_image" as const, image_url: dataUrl, detail },
      ],
    },
  ];

  // Fast path: low-detail is usually enough for the digit line and is faster/cheaper.
  // Reliability path: if parsing fails, retry once with high detail.
  const responseLow = await client.responses.create({
    model: MODEL,
    input: buildInput("low"),
  });

  const lowText = extractOutputText(responseLow).trim();
  const lowParsed = lowText ? extractScratcherTicketIdFromOcrText(lowText) : null;
  if (lowParsed) {
    return NextResponse.json({ parsed: lowParsed, ocrText: lowText, detail: "low" });
  }

  const responseHigh = await client.responses.create({
    model: MODEL,
    input: buildInput("high"),
  });

  const highText = extractOutputText(responseHigh).trim();
  const highParsed = highText ? extractScratcherTicketIdFromOcrText(highText) : null;
  return NextResponse.json({ parsed: highParsed, ocrText: highText, detail: "high" });
}
