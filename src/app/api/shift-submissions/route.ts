import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  addShiftSubmission,
  createScratcherSnapshot,
  createEmployeeHoursEntry,
  getLatestScratcherStartSnapshotByStore,
  listScratcherSlotBundle,
  listScratcherSnapshots,
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
      const scratcherPhotos = Array.isArray(files.scratcherPhotos)
        ? (files.scratcherPhotos as any[])
        : null;
      const cashPhoto = files.cashPhoto as any;
      const salesPhoto = files.salesPhoto as any;
      const shiftNotes = body?.shiftNotes?.toString() ?? "";
      const storeId = await resolveStoreId(body?.storeId ?? body?.store_id);
      const reportFields = body?.reportFields ?? {};
      const customFields = Array.isArray(body?.customFields)
        ? body.customFields
        : [];
      const hoursPayload = body?.hours ?? null;
      const scratcherEndSnapshotPayload = body?.scratcherEndSnapshot ?? null;
      const isEmployee = sessionUser.role === "employee";

      const hasScratcherMedia =
        (Array.isArray(scratcherPhotos) && scratcherPhotos.length > 0) ||
        Boolean(scratcherVideo);
      if (!hasScratcherMedia || !cashPhoto || !salesPhoto) {
        return NextResponse.json(
          { error: "All end-of-shift files are required." },
          { status: 400 },
        );
      }

      if (Array.isArray(scratcherPhotos) && scratcherPhotos.length !== 2) {
        return NextResponse.json(
          { error: "Please upload 2 scratcher photos (rows 1-4 and 5-8)." },
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

      const toMinutes = (value: string) => {
        const [h, m] = value.split(":").map((part) => Number(part));
        if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
        return h * 60 + m;
      };

      let shiftDate = new Date().toISOString().slice(0, 10);
      let hoursEntry:
        | {
            date: string;
            startTime: string;
            endTime: string;
            breakMinutes: number;
            hours: number;
          }
        | null = null;

      if (isEmployee) {
        const date = String(hoursPayload?.date ?? "").slice(0, 10);
        const startTime = String(hoursPayload?.startTime ?? "");
        const endTime = String(hoursPayload?.endTime ?? "");
        const breakMinutes = Math.max(0, Number(hoursPayload?.breakMinutes ?? 0));
        if (!date || !startTime || !endTime) {
          return NextResponse.json(
            { error: "Hours check-in (date, start time, end time) is required." },
            { status: 400 },
          );
        }
        const startMinutes = toMinutes(startTime);
        const endMinutes = toMinutes(endTime);
        if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
          return NextResponse.json(
            { error: "Invalid hours check-in time range." },
            { status: 400 },
          );
        }
        const rawMinutes = Math.max(0, endMinutes - startMinutes - breakMinutes);
        if (rawMinutes <= 0) {
          return NextResponse.json(
            { error: "Invalid hours check-in time range." },
            { status: 400 },
          );
        }
        shiftDate = date;
        hoursEntry = {
          date,
          startTime,
          endTime,
          breakMinutes,
          hours: Number((rawMinutes / 60).toFixed(2)),
        };
      }

      const reportDetails = {
        date: shiftDate,
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

      const endItemsRaw = Array.isArray(scratcherEndSnapshotPayload?.items)
        ? (scratcherEndSnapshotPayload.items as any[])
        : [];
      if (endItemsRaw.length > 0) {
        const parseTicketNumber = (value: string) => {
          const trimmed = value.trim();
          if (!trimmed) return null;
          const parsed = Number.parseInt(trimmed, 10);
          return Number.isFinite(parsed) ? parsed : null;
        };

        const { slots } = await listScratcherSlotBundle(storeId);
        const activeSlots = slots.filter((slot) => slot.isActive);

        const endMap = new Map(
          endItemsRaw.map((entry) => [
            String(entry?.slotId ?? ""),
            String(entry?.ticketValue ?? "").trim(),
          ]),
        );

        const missing = activeSlots.filter(
          (slot) => !String(endMap.get(slot.id) ?? "").trim(),
        );
        if (missing.length) {
          return NextResponse.json(
            {
              error: `Missing scratcher end ticket numbers for slots: ${missing
                .map((slot) => slot.slotNumber)
                .join(", ")}.`,
            },
            { status: 400 },
          );
        }

        const { snapshots, items } = await listScratcherSnapshots(report.id);
        let startSnapshot = snapshots.find((snap) => snap.snapshotType === "start");
        let startItems = startSnapshot
          ? items.filter((item) => item.snapshotId === startSnapshot?.id)
          : [];

        if (!startSnapshot) {
          const latestBaseline = await getLatestScratcherStartSnapshotByStore(storeId);
          if (latestBaseline) {
            const cloneResult = await createScratcherSnapshot({
              shiftReportId: report.id,
              storeId,
              employeeUserId: sessionUser.id,
              snapshotType: "start",
              items: latestBaseline.items.map((item) => ({
                slotId: item.slotId,
                ticketValue: item.ticketValue,
              })),
            });
            if (cloneResult) {
              startSnapshot = cloneResult.snapshot;
              startItems = cloneResult.items;
            }
          }
        }

        if (startItems.length) {
          const startMap = new Map(startItems.map((item) => [item.slotId, item]));
          const rolloverSlots: Array<{ slotId: string; slotNumber: number }> = [];
          for (const slot of activeSlots) {
            const startItem = startMap.get(slot.id);
            if (!startItem) continue;
            const startValue = parseTicketNumber(String(startItem.ticketValue ?? ""));
            const endValue = parseTicketNumber(String(endMap.get(slot.id) ?? ""));
            if (startValue === null || endValue === null) continue;
            if (endValue < startValue) {
              const activePackId = slot.activePackId ?? null;
              const startPackId = startItem.packId ?? null;
              const baselinePack = !activePackId && !startPackId;
              const samePack =
                (activePackId && activePackId === startPackId) || baselinePack;
              if (samePack) {
                rolloverSlots.push({ slotId: slot.id, slotNumber: slot.slotNumber });
              }
            }
          }
          if (rolloverSlots.length) {
            return NextResponse.json(
              {
                error:
                  "Pack rollover detected. Activate a new pack before submitting shift package.",
                rolloverSlots,
              },
              { status: 409 },
            );
          }
        }

        // Create the end snapshot. If one already exists, keep the existing one (no-op).
        await createScratcherSnapshot({
          shiftReportId: report.id,
          storeId,
          employeeUserId: sessionUser.id,
          snapshotType: "end",
          items: activeSlots.map((slot) => ({
            slotId: slot.id,
            ticketValue: String(endMap.get(slot.id) ?? "").trim(),
          })),
        });
      }

      const submission = await addShiftSubmission({
        employeeName: sessionUser.name,
        storeNumber: storeId,
        shiftNotes,
        reportDetails,
        scratcherPhotos: Array.isArray(scratcherPhotos) ? scratcherPhotos : undefined,
        scratcherVideo: scratcherPhotos ? undefined : scratcherVideo,
        cashPhoto,
        salesPhoto,
      });

      if (hoursEntry) {
        await createEmployeeHoursEntry({
          storeId,
          employeeId: sessionUser.id,
          employeeName: sessionUser.name,
          date: hoursEntry.date,
          startTime: hoursEntry.startTime,
          endTime: hoursEntry.endTime,
          breakMinutes: hoursEntry.breakMinutes,
          hours: hoursEntry.hours,
          notes: shiftNotes?.trim() || undefined,
        });
      }

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
    const storeIdRaw = formData.get("storeId") ?? formData.get("store_id");
    const storeId = await resolveStoreId(
      typeof storeIdRaw === "string" ? storeIdRaw : null,
    );

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
          : typeof error === "object" && error && "message" in error
            ? String((error as { message?: unknown }).message ?? "Unable to upload shift right now.")
            : "Unable to upload shift right now.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
