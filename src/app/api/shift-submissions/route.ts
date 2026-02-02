import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  addShiftSubmission,
  recalculateScratcherShift,
  saveUploadedFile,
  upsertShiftReport,
} from "@/lib/dataStore";
import { getClientStoreIds } from "@/lib/userStore";

export async function POST(request: Request) {
  try {
    const isJson =
      request.headers
        .get("content-type")
        ?.toLowerCase()
        .includes("application/json") ?? false;

    const sessionUser = await getSessionUser();
    if (!sessionUser || (sessionUser.role !== "employee" && sessionUser.role !== "client")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    const isOwner = sessionUser.role === "client";
    const resolveStoreId = async (storeId?: string | null) => {
      if (!isOwner) return sessionUser.storeNumber;
      const candidate = storeId?.toString().trim() ?? sessionUser.storeNumber;
      if (!candidate) return "";
      const storeIds = sessionUser.storeIds?.length
        ? sessionUser.storeIds
        : await getClientStoreIds(sessionUser.id);
      return storeIds.includes(candidate) ? candidate : "";
    };

    // JSON mode: expect pre-uploaded file metadata
    if (isJson) {
      const body = await request.json().catch(() => null);
      const files = body?.files ?? {};
      const scratcherVideo = files.scratcherVideo as any;
      const cashPhoto = files.cashPhoto as any;
      const salesPhoto = files.salesPhoto as any;
      const shiftNotes = body?.shiftNotes?.toString() ?? "";
      const storeId = await resolveStoreId(body?.storeId ?? body?.store_id);
      const reportFields = body?.reportFields ?? {};
      const customFields = Array.isArray(body?.customFields)
        ? body.customFields
        : [];

      if (!scratcherVideo || !cashPhoto || !salesPhoto) {
        return NextResponse.json(
          { error: "All end-of-shift files are required." },
          { status: 400 },
        );
      }

      const parseAmount = (value: unknown) => {
        if (value === null || value === undefined) return 0;
        if (typeof value === "string" && value.trim() === "") return 0;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const parseRequired = (value: unknown) => {
        if (value === null || value === undefined) return NaN;
        if (typeof value === "string" && value.trim() === "") return NaN;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : NaN;
      };

      const grossAmount = parseRequired(reportFields.gross);
      const scrAmount = parseRequired(reportFields.scr);
      const lottoAmount = parseRequired(reportFields.lotto);

      if (
        Number.isNaN(grossAmount) ||
        Number.isNaN(scrAmount) ||
        Number.isNaN(lottoAmount)
      ) {
        return NextResponse.json(
          { error: "Gross, Scr, and Lotto are required." },
          { status: 400 },
        );
      }

      const lottoPoAmount = parseAmount(reportFields.lottoPo);
      const atmAmount = parseAmount(reportFields.atm);
      const cashAmount = grossAmount - lottoPoAmount - atmAmount;
      const storeAmount = grossAmount - (scrAmount + lottoAmount);

      const reportDetails = {
        date: new Date().toISOString().slice(0, 10),
        gross: grossAmount,
        liquor: parseAmount(reportFields.liquor),
        beer: parseAmount(reportFields.beer),
        cig: parseAmount(reportFields.cig),
        tobacco: parseAmount(reportFields.tobacco),
        gas: parseAmount(reportFields.gas),
        atm: atmAmount,
        lottoPo: lottoPoAmount,
        deposit: parseAmount(reportFields.deposit),
        scr: scrAmount,
        lotto: lottoAmount,
        cash: cashAmount,
        store: storeAmount,
        customFields: customFields
          .filter((field: any) => field?.label)
          .map((field: any) => ({
            label: String(field.label).trim(),
            amount: parseAmount(field.amount),
          })),
      };

      if (!storeId) {
        return NextResponse.json({ error: "Store access required." }, { status: 403 });
      }

      const submission = await addShiftSubmission({
        employeeName: sessionUser.name,
        storeNumber: storeId,
        shiftNotes,
        reportDetails,
        scratcherVideo,
        cashPhoto,
        salesPhoto,
      });

      const report = await upsertShiftReport({
        storeId,
        employeeId: sessionUser.id,
        employeeName: sessionUser.name,
        date: reportDetails.date,
        grossAmount,
        liquorAmount: reportDetails.liquor,
        beerAmount: reportDetails.beer,
        cigAmount: reportDetails.cig,
        tobaccoAmount: reportDetails.tobacco,
        gasAmount: reportDetails.gas,
        atmAmount: reportDetails.atm,
        lottoPoAmount: reportDetails.lottoPo,
        depositAmount: reportDetails.deposit,
        scrAmount,
        lottoAmount,
        cashAmount,
        storeAmount,
        customFields: reportDetails.customFields,
      });

      try {
        await recalculateScratcherShift({
          shiftReportId: report.id,
          storeId: report.storeId,
        });
      } catch (recalcError) {
        console.error("Scratcher recalculation failed:", recalcError);
      }

      return NextResponse.json({ submission });
    }

    const formData = await request.formData();
    const scratcherVideo = formData.get("scratcherVideo");
    const cashPhoto = formData.get("cashPhoto");
    const salesPhoto = formData.get("salesPhoto");
    const shiftNotes = formData.get("shiftNotes")?.toString() ?? "";
    const storeId = await resolveStoreId(formData.get("storeId") ?? formData.get("store_id"));

    if (
      !(scratcherVideo instanceof File) ||
      !(cashPhoto instanceof File) ||
      !(salesPhoto instanceof File)
    ) {
      return NextResponse.json(
        { error: "All end-of-shift files are required." },
        { status: 400 },
      );
    }

    if (
      scratcherVideo.size === 0 ||
      cashPhoto.size === 0 ||
      salesPhoto.size === 0
    ) {
      return NextResponse.json(
        { error: "Uploaded files cannot be empty." },
        { status: 400 },
      );
    }

    const totalSize =
      scratcherVideo.size + cashPhoto.size + salesPhoto.size;
    const MAX_TOTAL_BYTES = 20 * 1024 * 1024; // ~20 MB safety limit for serverless uploads
    if (totalSize > MAX_TOTAL_BYTES) {
      return NextResponse.json(
        {
          error:
            "Files are too large. Please compress or upload smaller files (total must be under 20 MB).",
        },
        { status: 413 },
      );
    }

    if (!storeId) {
      return NextResponse.json({ error: "Store access required." }, { status: 403 });
    }

    const savedScratcherVideo = await saveUploadedFile(scratcherVideo, {
      folder: "shift",
      label: "Scratcher Count Video",
    });
    const savedCashPhoto = await saveUploadedFile(cashPhoto, {
      folder: "shift",
      label: "Cash Count Photo",
    });
    const savedSalesPhoto = await saveUploadedFile(salesPhoto, {
      folder: "shift",
      label: "Sales Report Photo",
    });

    const submission = await addShiftSubmission({
      employeeName: sessionUser.name,
      storeNumber: storeId,
      shiftNotes,
      scratcherVideo: savedScratcherVideo,
      cashPhoto: savedCashPhoto,
      salesPhoto: savedSalesPhoto,
    });

    return NextResponse.json({ submission });
  } catch (error) {
    console.error("Shift upload failed:", error);
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unable to upload shift right now.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
