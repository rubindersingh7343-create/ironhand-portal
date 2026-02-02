import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { saveUploadedFile, addSurveillanceReport } from "@/lib/dataStore";
import { getSurveillanceStoreIds } from "@/lib/userStore";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || !requireRole(user, ["surveillance"])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  const payload = isJson ? await request.json().catch(() => null) : null;
  const formData = !isJson ? await request.formData().catch(() => null) : null;

  const label = isJson ? payload?.label : (formData?.get("label") as string | null);
  const summary = isJson
    ? payload?.summary
    : (formData?.get("summary") as string | null);
  const notes = isJson ? payload?.notes : (formData?.get("notes") as string | null);
  const grade = isJson
    ? payload?.grade
    : (formData?.get("grade") as string | null);
  const gradeReason = isJson
    ? payload?.gradeReason
    : (formData?.get("gradeReason") as string | null);
  const employeeName = isJson
    ? payload?.employeeName
    : (formData?.get("employeeName") as string | null);
  const footage = !isJson ? (formData?.get("footage") as File | null) : null;
  const footageFiles = !isJson
    ? (formData?.getAll("footage") as File[])
        .filter((file) => file && "name" in file && file.name)
    : [];
  const footageLabels = !isJson
    ? (formData?.getAll("footageLabel") as string[])
    : [];
  const footageSummaries = !isJson
    ? (formData?.getAll("footageSummary") as string[])
    : [];
  const storeId =
    (isJson ? payload?.storeId : (formData?.get("storeId") as string | null)) ??
    user.storeNumber;

  const jsonFiles = isJson
    ? (Array.isArray(payload?.files) ? payload?.files : payload?.file ? [payload.file] : [])
    : [];

  if (
    !label ||
    !summary ||
    !grade ||
    !gradeReason ||
    !employeeName ||
    (!isJson && (footageFiles.length === 0 || !footageFiles.some(Boolean)) && !footage) ||
    (isJson && jsonFiles.length === 0)
  ) {
    return NextResponse.json(
      {
        error: "Label, summary, grade, employee, reason, and footage are required.",
      },
      { status: 400 },
    );
  }

  if (
    (!isJson &&
      footageSummaries
        .slice(0, footageFiles.length)
        .some((value) => !String(value ?? "").trim())) ||
    (isJson &&
      jsonFiles.some((file: any) => !String(file?.summary ?? "").trim()))
  ) {
    return NextResponse.json(
      { error: "Add a short summary for each file." },
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

    const storedFiles = isJson
      ? jsonFiles.map((file: any) => ({
          id: file?.id ?? "",
          path: file?.path ?? "",
          dataUrl: undefined,
          originalName: file?.originalName ?? "upload",
          mimeType: file?.mimeType ?? "application/octet-stream",
          size: Number(file?.size ?? 0),
          label: file?.label ?? label,
          summary: file?.summary ?? undefined,
          kind: file?.kind ?? "other",
        }))
      : await Promise.all(
          (footageFiles.length ? footageFiles : [footage]).filter(Boolean).map(
            (file, index) =>
              saveUploadedFile(file as File, {
                folder: "surveillance",
                label: footageLabels[index] ?? label,
                summary: footageSummaries[index] ?? undefined,
              }),
          ),
        );

    if (!storedFiles.length || storedFiles.some((file: { path?: string }) => !file.path)) {
      return NextResponse.json(
        { error: "Upload failed. Missing file path." },
        { status: 400 },
      );
    }
    await addSurveillanceReport({
      employeeName,
      storeNumber: storeId,
      label,
      summary,
      grade,
      gradeReason,
      notes: notes ?? undefined,
      attachments: storedFiles,
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
