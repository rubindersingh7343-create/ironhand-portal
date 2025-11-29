import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { deleteClientAccount } from "@/lib/userStore";

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!requireRole(user, ["ironhand"])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const id = body?.id as string | undefined;
  if (!id) {
    return NextResponse.json({ error: "Client id required." }, { status: 400 });
  }

  const success = await deleteClientAccount(id);
  if (!success) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
