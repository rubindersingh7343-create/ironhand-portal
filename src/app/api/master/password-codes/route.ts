import { NextResponse } from "next/server";
import { getSessionUser, isMasterUser } from "@/lib/auth";
import { createPasswordResetCode } from "@/lib/userStore";

export async function POST(request: Request) {
  const user = await getSessionUser();
  const master = isMasterUser(user);
  if (!master) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const { code, expiresAt } = await createPasswordResetCode(email);
  return NextResponse.json({ code, expiresAt });
}
