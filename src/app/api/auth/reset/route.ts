import { NextResponse } from "next/server";
import { usePasswordResetToken } from "@/lib/userStore";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const token = body?.token as string | undefined;
  const password = body?.password as string | undefined;

  if (!token || !password) {
    return NextResponse.json(
      { error: "Token and new password are required." },
      { status: 400 },
    );
  }

  const updated = await usePasswordResetToken(token, password);
  if (!updated) {
    return NextResponse.json({ error: "Invalid or expired token." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
