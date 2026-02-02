import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { createScratcherSlot, listScratcherSlotBundle } from "@/lib/dataStore";

const MAX_SLOTS = 32;

export async function POST(request: Request) {
  const user = await getSessionUser();
  const manager = requireRole(user, ["ironhand", "client"]);
  if (!manager) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const storeId =
    typeof body?.storeId === "string"
      ? body.storeId
      : manager.storeNumber;
  if (!storeId) {
    return NextResponse.json({ error: "Missing store ID." }, { status: 400 });
  }

  const { slots } = await listScratcherSlotBundle(storeId);
  const existingNumbers = new Set(slots.map((slot) => slot.slotNumber));
  const nextSlot =
    typeof body?.slotNumber === "number"
      ? body.slotNumber
      : Math.max(0, ...slots.map((slot) => slot.slotNumber)) + 1;

  if (nextSlot > MAX_SLOTS) {
    return NextResponse.json(
      { error: "Maximum slot limit reached." },
      { status: 400 },
    );
  }
  if (existingNumbers.has(nextSlot)) {
    return NextResponse.json(
      { error: "Slot already exists." },
      { status: 409 },
    );
  }

  const slot = await createScratcherSlot({
    storeId,
    slotNumber: nextSlot,
    label: typeof body?.label === "string" ? body.label : null,
  });

  if (!slot) {
    return NextResponse.json(
      { error: "Unable to create slot." },
      { status: 500 },
    );
  }

  return NextResponse.json({ slot });
}
