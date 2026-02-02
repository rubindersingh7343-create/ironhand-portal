import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { recalculateScratcherShift } from "@/lib/dataStore";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ shift_report_id: string }> },
) {
  const user = await getSessionUser();
  const manager = requireRole(user, ["ironhand"]);
  if (!manager) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { shift_report_id } = await context.params;
  const body = await request.json().catch(() => null);
  const storeId = typeof body?.storeId === "string" ? body.storeId : manager.storeNumber;

  const calculation = await recalculateScratcherShift({
    shiftReportId: shift_report_id,
    storeId,
  });

  if (!calculation) {
    return NextResponse.json(
      { error: "Unable to recalculate scratchers." },
      { status: 500 },
    );
  }

  return NextResponse.json({ calculation });
}
