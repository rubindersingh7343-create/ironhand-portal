import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { saveUploadedFile, addSurveillanceReport } from "@/lib/dataStore";
import { getSurveillanceStoreIds } from "@/lib/userStore";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

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
  const conductGrade = isJson
    ? payload?.conductGrade
    : (formData?.get("conductGrade") as string | null);
  const conductGradeReason = isJson
    ? payload?.conductGradeReason
    : (formData?.get("conductGradeReason") as string | null);
  const employeeName = isJson
    ? payload?.employeeName
    : (formData?.get("employeeName") as string | null);
  const footage = !isJson ? (formData?.get("footage") as File | null) : null;
  const footageFiles = !isJson
    ? (formData?.getAll("footage") as File[])
        .filter((file) => file && "name" in file && file.name)
    : [];
  const footageLabels = !isJson
    ? (formData?.getAll("footageLabel") as string[]).map((value) =>
        String(value ?? "").trim(),
      )
    : [];
  const footageSummaries = !isJson
    ? (formData?.getAll("footageSummary") as string[]).map((value) =>
        String(value ?? "").trim(),
      )
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
    !conductGrade ||
    !conductGradeReason ||
    !employeeName ||
    (!isJson && (footageFiles.length === 0 || !footageFiles.some(Boolean)) && !footage) ||
    (isJson && jsonFiles.length === 0)
  ) {
    return NextResponse.json(
      {
        error:
          "Label, summary, behavior grade, conduct grade, employee, reasons, and footage are required.",
      },
      { status: 400 },
    );
  }

  const primaryFootageLabel = footageLabels.find(Boolean) ?? "";
  const primaryFootageSummary = footageSummaries.find(Boolean) ?? "";

  if (!isJson && !primaryFootageLabel) {
    return NextResponse.json(
      { error: "Choose a classification for the footage." },
      { status: 400 },
    );
  }
  if (
    (!isJson && !primaryFootageSummary) ||
    (isJson &&
      jsonFiles.some((file: unknown) => {
        const record =
          file && typeof file === "object"
            ? (file as Record<string, unknown>)
            : null;
        const summary = record?.summary;
        return !String(summary ?? "").trim();
      }))
  ) {
    return NextResponse.json(
      { error: "Add a short summary for each file." },
      { status: 400 },
    );
  }

  try {
    const supabase = getSupabaseAdmin();
    const linkedStores = new Set([
      user.storeNumber,
      ...(Array.isArray(user.storeIds) ? user.storeIds : []),
      ...(await getSurveillanceStoreIds(user.id)),
    ].filter(Boolean));
    if (!linkedStores.has(storeId)) {
      return NextResponse.json({ error: "Store access denied." }, { status: 403 });
    }

    const uploadPaths =
      isJson && jsonFiles.length
        ? jsonFiles
            .map((file: unknown) => {
              const record =
                file && typeof file === "object"
                  ? (file as Record<string, unknown>)
                  : null;
              const value =
                typeof record?.path === "string"
                  ? record.path
                  : typeof record?.id === "string"
                    ? record.id
                    : "";
              return String(value).replace(/^\/+/, "").trim();
            })
            .filter(Boolean)
        : [];

    if (supabase && uploadPaths.length) {
      try {
        await supabase
          .from("upload_items")
          .update({ status: "processing", updated_at: new Date().toISOString() })
          .in("storage_path", uploadPaths);
      } catch (error) {
        console.error("[surveillance] Unable to mark processing:", error);
      }
    }

    const storedFiles = isJson
      ? jsonFiles.map((file: unknown) => {
          const record =
            file && typeof file === "object"
              ? (file as Record<string, unknown>)
              : {};
          const sizeRaw = record.size;
          const size =
            typeof sizeRaw === "number" && Number.isFinite(sizeRaw)
              ? sizeRaw
              : Number(sizeRaw ?? 0);
          return {
            id: typeof record.id === "string" ? record.id : "",
            path: typeof record.path === "string" ? record.path : "",
            dataUrl: undefined,
            originalName:
              typeof record.originalName === "string" ? record.originalName : "upload",
            mimeType:
              typeof record.mimeType === "string"
                ? record.mimeType
                : "application/octet-stream",
            size: Number.isFinite(size) ? size : 0,
            label: typeof record.label === "string" ? record.label : label,
            summary: typeof record.summary === "string" ? record.summary : undefined,
            kind: typeof record.kind === "string" ? record.kind : "other",
          };
        })
      : await Promise.all(
          (footageFiles.length ? footageFiles : [footage]).filter(Boolean).map(
            (file, index) =>
              saveUploadedFile(file as File, {
                folder: "surveillance",
                label: footageLabels[index] || primaryFootageLabel || label,
                summary:
                  footageSummaries[index] || primaryFootageSummary || undefined,
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
      conductGrade,
      conductGradeReason,
      notes: notes ?? undefined,
      attachments: storedFiles,
    });

    if (supabase && uploadPaths.length) {
      try {
        await supabase
          .from("upload_items")
          .update({ status: "complete", updated_at: new Date().toISOString() })
          .in("storage_path", uploadPaths);
      } catch (error) {
        console.error("[surveillance] Unable to mark complete:", error);
      }
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    const supabase = getSupabaseAdmin();
    if (supabase && isJson && Array.isArray(payload?.files)) {
      const rawFiles = payload.files as unknown[];
      const uploadPaths = rawFiles
        .map((file: unknown) => {
          const record =
            file && typeof file === "object"
              ? (file as Record<string, unknown>)
              : null;
          const value =
            typeof record?.path === "string"
              ? record.path
              : typeof record?.id === "string"
                ? record.id
                : "";
          return String(value).replace(/^\/+/, "").trim();
        })
        .filter(Boolean);
      if (uploadPaths.length) {
        try {
          await supabase
            .from("upload_items")
            .update({
              status: "error",
              error_message: "Unable to save surveillance report.",
              updated_at: new Date().toISOString(),
            })
            .in("storage_path", uploadPaths);
        } catch (updateError) {
          console.error("[surveillance] Unable to mark error:", updateError);
        }
      }
    }
    return NextResponse.json(
      { error: "Unable to save surveillance report." },
      { status: 500 },
    );
  }
}
