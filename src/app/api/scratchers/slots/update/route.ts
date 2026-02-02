import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { updateScratcherSlot } from "@/lib/dataStore";

export async function POST(request: Request) {
  const user = await getSessionUser();
  const manager = requireRole(user, ["ironhand", "client"]);
  if (!manager) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const slotId = typeof body?.slotId === "string" ? body.slotId : "";
  if (!slotId) {
    return NextResponse.json({ error: "Missing slot ID." }, { status: 400 });
  }

  const slot = await updateScratcherSlot({
    slotId,
    label: typeof body?.label === "string" ? body.label : undefined,
    isActive: typeof body?.isActive === "boolean" ? body.isActive : undefined,
    defaultProductId:
      body?.defaultProductId === null || typeof body?.defaultProductId === "string"
        ? body.defaultProductId
        : undefined,
  });

  if (!slot) {
    return NextResponse.json({ error: "Unable to update slot." }, { status: 500 });
  }

  return NextResponse.json({ slot });
}
