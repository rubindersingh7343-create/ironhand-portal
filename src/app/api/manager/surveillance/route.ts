import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { deleteSurveillanceAccount } from "@/lib/userStore";

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!requireRole(user, ["ironhand"])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const id = body?.id as string | undefined;
  if (!id) {
    return NextResponse.json(
      { error: "Surveillance id required." },
      { status: 400 },
    );
  }

  const success = await deleteSurveillanceAccount(id);
  if (!success) {
    return NextResponse.json({ error: "Surveillance user not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
