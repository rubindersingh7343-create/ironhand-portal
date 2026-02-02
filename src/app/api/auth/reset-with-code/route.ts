import { NextResponse } from "next/server";
import { resetPasswordWithCode } from "@/lib/userStore";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const newPassword =
    typeof body?.newPassword === "string" ? body.newPassword : "";
  const confirm =
    typeof body?.confirmPassword === "string" ? body.confirmPassword : "";

  if (!email || !code || !newPassword || !confirm) {
    return NextResponse.json(
      { error: "Email, code, and new password are required." },
      { status: 400 },
    );
  }
  if (newPassword !== confirm) {
    return NextResponse.json(
      { error: "Passwords do not match." },
      { status: 400 },
    );
  }

  const ok = await resetPasswordWithCode({ email, code, newPassword });
  if (!ok) {
    return NextResponse.json(
      { error: "Invalid or expired code." },
      { status: 400 },
    );
  }

  return NextResponse.json({ success: true });
}
