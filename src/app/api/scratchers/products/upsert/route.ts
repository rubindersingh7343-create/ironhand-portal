import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { upsertScratcherProduct } from "@/lib/dataStore";
import { sendStoreSystemMessage } from "@/lib/storeChat";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || (user.role !== "client" && user.role !== "ironhand" && user.role !== "employee")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (user.role === "employee" && typeof body?.id === "string") {
    return NextResponse.json({ error: "Employees cannot edit products." }, { status: 403 });
  }
  const storeId = typeof body?.storeId === "string" ? body.storeId : null;
  const price = Number(body?.price ?? NaN);
  if (!Number.isFinite(price)) {
    return NextResponse.json({ error: "Price is required." }, { status: 400 });
  }

  const record = await upsertScratcherProduct({
    id: typeof body?.id === "string" ? body.id : undefined,
    name: typeof body?.name === "string" ? body.name : undefined,
    price,
    isActive: typeof body?.isActive === "boolean" ? body.isActive : undefined,
  });

  if (!record) {
    return NextResponse.json(
      { error: "Unable to save scratcher product." },
      { status: 500 },
    );
  }

  if (user.role === "employee" && storeId) {
    const employeeName = user.name ?? "Employee";
    await sendStoreSystemMessage({
      storeId,
      senderId: user.id,
      message: `${employeeName} added scratcher product ${record.name ?? "Scratcher"} ($${record.price}).`,
    });
  }

  return NextResponse.json({ product: record });
}
