import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getSessionUser, requireRole } from "@/lib/auth";

export const runtime = "nodejs";

const MODEL =
  process.env.OPENAI_SURVEILLANCE_SUMMARY_MODEL ??
  process.env.OPENAI_MODEL ??
  "gpt-5-mini";

type SummaryRequest = {
  employeeName?: string;
  storeName?: string;
  label?: string;
  grade?: string;
  gradeReason?: string;
  conductGrade?: string;
  conductGradeReason?: string;
  notes?: string;
  fileSummaries?: Array<{
    number?: number;
    label?: string;
    summary?: string;
    filename?: string;
  }>;
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

const fallbackSummary = (payload: SummaryRequest) => {
  const employeeName = String(payload.employeeName ?? "the employee").trim();
  const label = String(payload.label ?? "surveillance").trim() || "surveillance";
  const files = Array.isArray(payload.fileSummaries)
    ? payload.fileSummaries.filter((file) => String(file?.summary ?? "").trim())
    : [];
  const fileText = files.length
    ? files
        .map((file, index) => {
          const number = Number(file.number) || index + 1;
          const fileLabel = String(file.label ?? label).trim() || label;
          const summary = String(file.summary ?? "").trim();
          return `Upload ${number} (${fileLabel}) shows ${summary}`;
        })
        .join(" ")
    : "No detailed file notes were provided.";
  const gradeText = [
    payload.grade ? `Behavior grade: ${payload.grade}` : "",
    payload.gradeReason ? `Reason: ${payload.gradeReason}` : "",
    payload.conductGrade ? `Conduct grade: ${payload.conductGrade}` : "",
    payload.conductGradeReason ? `Reason: ${payload.conductGradeReason}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const notes = String(payload.notes ?? "").trim();
  return [
    `This ${label.toLowerCase()} surveillance upload for ${employeeName} includes ${files.length || 1} upload${files.length === 1 ? "" : "s"}.`,
    fileText,
    gradeText,
    notes ? `Additional note: ${notes}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
};

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || !requireRole(user, ["surveillance"])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = (await request.json().catch(() => null)) as SummaryRequest | null;
  if (!payload) {
    return NextResponse.json({ error: "Payload is required." }, { status: 400 });
  }

  const fileSummaries = Array.isArray(payload.fileSummaries)
    ? payload.fileSummaries
        .map((file, index) => ({
          number: Number(file?.number) || index + 1,
          label: String(file?.label ?? payload.label ?? "routine").trim(),
          summary: String(file?.summary ?? "").trim(),
          filename: String(file?.filename ?? "").trim(),
        }))
        .filter((file) => file.summary)
    : [];

  if (!fileSummaries.length && !String(payload.notes ?? "").trim()) {
    return NextResponse.json(
      { error: "Add at least one file summary or note." },
      { status: 400 },
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ summary: fallbackSummary({ ...payload, fileSummaries }) });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: MODEL,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You write surveillance summaries for a USA store owner.\n" +
                "Input may be Punjabi, Hinglish, broken English, or short notes.\n" +
                "Translate and rewrite into clear, simple American English.\n" +
                "Use plain words. Be professional and direct.\n" +
                "Do not over-restrict yourself; infer reasonable wording from the notes, but do not invent events not supported by the input.\n" +
                "Mention uploads by number: Upload 1, Upload 2, etc.\n" +
                "Keep it 2 short paragraphs unless critical details require more.\n" +
                "Output only the final summary text.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                employeeName: payload.employeeName ?? "",
                storeName: payload.storeName ?? "",
                overallClassification: payload.label ?? "",
                behaviorGrade: payload.grade ?? "",
                behaviorGradeReason: payload.gradeReason ?? "",
                conductGrade: payload.conductGrade ?? "",
                conductGradeReason: payload.conductGradeReason ?? "",
                notes: payload.notes ?? "",
                uploads: fileSummaries,
              }),
            },
          ],
        },
      ],
    });

    const summary = extractOutputText(response).trim();
    return NextResponse.json({
      summary: summary || fallbackSummary({ ...payload, fileSummaries }),
    });
  } catch (error) {
    console.error("[surveillance-summary] failed", error);
    return NextResponse.json({ summary: fallbackSummary({ ...payload, fileSummaries }) });
  }
}
