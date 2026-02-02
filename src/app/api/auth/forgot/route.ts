import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { createPasswordReset } from "@/lib/userStore";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = body?.email as string | undefined;
  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  const result = await createPasswordReset(email.trim().toLowerCase());
  if (result?.token && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const resetUrl = `https://ironhand.net/auth/reset?token=${encodeURIComponent(result.token)}`;
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: Number(process.env.SMTP_PORT ?? 587) === 465,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
      await transporter.sendMail({
        from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
        to: email,
        subject: "Reset your Iron Hand password",
        html: `<p>Click the link below to reset your password. This link expires in 1 hour.</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
      });
    } catch (error) {
      console.error("Failed to send reset email", error);
    }
  }

  return NextResponse.json({ ok: true });
}
