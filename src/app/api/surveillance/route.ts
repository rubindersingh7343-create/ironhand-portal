import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { saveUploadedFile, addSurveillanceReport } from "@/lib/dataStore";
import { getSurveillanceStoreIds } from "@/lib/userStore";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || !requireRole(user, ["surveillance"])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const label = formData.get("label") as string | null;
  const summary = formData.get("summary") as string | null;
  const notes = formData.get("notes") as string | null;
  const footage = formData.get("footage") as File | null;
  const storeId = (formData.get("storeId") as string | null) ?? user.storeNumber;

  if (!label || !summary || !footage) {
    return NextResponse.json(
      { error: "Label, summary, and footage are required." },
      { status: 400 },
    );
  }

  try {
    const linkedStores = new Set([
      user.storeNumber,
      ...(Array.isArray(user.storeIds) ? user.storeIds : []),
      ...(await getSurveillanceStoreIds(user.id)),
    ].filter(Boolean));
    if (!linkedStores.has(storeId)) {
      return NextResponse.json({ error: "Store access denied." }, { status: 403 });
    }

    const storedFile = await saveUploadedFile(footage, {
      folder: "surveillance",
      label,
    });
    await addSurveillanceReport({
      employeeName: user.name,
      storeNumber: storeId,
      label,
      summary,
      notes: notes ?? undefined,
      attachments: [storedFile],
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unable to save surveillance report." },
      { status: 500 },
    );
  }
}
