import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { addShiftSubmission, saveUploadedFile } from "@/lib/dataStore";

export async function POST(request: Request) {
  const sessionUser = await getSessionUser();
  const user = requireRole(sessionUser, ["employee"]);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const formData = await request.formData();
  const scratcherVideo = formData.get("scratcherVideo");
  const cashPhoto = formData.get("cashPhoto");
  const salesPhoto = formData.get("salesPhoto");
  const shiftNotes = formData.get("shiftNotes")?.toString() ?? "";

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

  if (scratcherVideo.size === 0 || cashPhoto.size === 0 || salesPhoto.size === 0) {
    return NextResponse.json(
      { error: "Uploaded files cannot be empty." },
      { status: 400 },
    );
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
    employeeName: user.name,
    storeNumber: user.storeNumber,
    shiftNotes,
    scratcherVideo: savedScratcherVideo,
    cashPhoto: savedCashPhoto,
    salesPhoto: savedSalesPhoto,
  });

  return NextResponse.json({ submission });
}
