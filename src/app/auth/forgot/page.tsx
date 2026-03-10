"use client";

import { useState } from "react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("sending");
    setMessage(null);
    try {
      const response = await fetch("/api/auth/reset-with-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, newPassword, confirmPassword }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to reset password with this code.");
      }
      setStatus("done");
      setMessage("Password updated. You can now sign in with the new password.");
    } catch (error) {
      console.error(error);
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Unable to reset password.");
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-10 text-slate-900">
      <h1 className="text-2xl font-semibold">Reset password with a code</h1>
      <p className="mt-2 text-sm text-slate-600">
        Enter your email, the one-time code provided by HQ, and your new password.
      </p>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div className="space-y-1">
          <label className="text-sm text-slate-700" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-2xl border border-black/5 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-500 shadow-[0_2px_8px_rgba(15,23,42,0.08)] focus:border-[#223a70] focus:outline-none focus:ring-4 focus:ring-[rgba(34,58,112,0.10)]"
            placeholder="you@hiremote.com"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm text-slate-700" htmlFor="code">
            Reset code
          </label>
          <input
            id="code"
            type="text"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full rounded-2xl border border-black/5 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-500 shadow-[0_2px_8px_rgba(15,23,42,0.08)] focus:border-[#223a70] focus:outline-none focus:ring-4 focus:ring-[rgba(34,58,112,0.10)]"
            placeholder="E.g. ABCD1234"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm text-slate-700" htmlFor="newPassword">
            New password
          </label>
          <input
            id="newPassword"
            type="password"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full rounded-2xl border border-black/5 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-500 shadow-[0_2px_8px_rgba(15,23,42,0.08)] focus:border-[#223a70] focus:outline-none focus:ring-4 focus:ring-[rgba(34,58,112,0.10)]"
            placeholder="Enter new password"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm text-slate-700" htmlFor="confirmPassword">
            Confirm new password
          </label>
          <input
            id="confirmPassword"
            type="password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full rounded-2xl border border-black/5 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-500 shadow-[0_2px_8px_rgba(15,23,42,0.08)] focus:border-[#223a70] focus:outline-none focus:ring-4 focus:ring-[rgba(34,58,112,0.10)]"
            placeholder="Re-enter new password"
          />
        </div>
        {message && (
          <p
            className={`rounded-xl px-4 py-2 text-sm ${
              status === "error"
                ? "border border-red-900/10 bg-red-500/10 text-red-900"
                : "border border-[#223a70]/15 bg-[#223a70]/10 text-slate-800"
            }`}
          >
            {message}
          </p>
        )}
        <button
          type="submit"
          disabled={status === "sending"}
          className="w-full rounded-xl bg-[#223a70] px-6 py-3 text-center text-base font-semibold text-white shadow-[0_8px_24px_rgba(15,23,42,0.12)] transition hover:bg-[#1a2c56] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {status === "sending" ? "Updating..." : "Reset password"}
        </button>
      </form>
      <div className="mt-4 text-sm">
        <a
          href="/auth/login"
          className="text-[#223a70] underline underline-offset-4 hover:text-[#1a2c56]"
        >
          Go back to sign in
        </a>
      </div>
    </div>
  );
}
