"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const router = useRouter();
  const token = useMemo(
    () => (typeof searchParams?.token === "string" ? searchParams.token : ""),
    [searchParams],
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">(
    "idle",
  );
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password !== confirm) {
      setMessage("Passwords do not match.");
      return;
    }
    setStatus("sending");
    setMessage(null);
    try {
      const response = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to reset password.");
      }
      setStatus("done");
      setMessage("Password updated. You can now sign in.");
      setTimeout(() => router.push("/auth/login"), 1200);
    } catch (error) {
      console.error(error);
      setStatus("error");
      setMessage(
        error instanceof Error ? error.message : "Unable to reset password.",
      );
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-10 text-slate-900">
      <h1 className="text-2xl font-semibold">Reset password</h1>
      <p className="mt-2 text-sm text-slate-600">
        Enter a new password for your account.
      </p>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div className="space-y-1">
          <label className="text-sm text-slate-700" htmlFor="password">
            New password
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-2xl border border-black/5 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-500 shadow-[0_2px_8px_rgba(15,23,42,0.08)] focus:border-[#223a70] focus:outline-none focus:ring-4 focus:ring-[rgba(34,58,112,0.10)]"
            placeholder="••••••••"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm text-slate-700" htmlFor="confirm">
            Confirm password
          </label>
          <input
            id="confirm"
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full rounded-2xl border border-black/5 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-500 shadow-[0_2px_8px_rgba(15,23,42,0.08)] focus:border-[#223a70] focus:outline-none focus:ring-4 focus:ring-[rgba(34,58,112,0.10)]"
            placeholder="••••••••"
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
          {status === "sending" ? "Resetting..." : "Reset password"}
        </button>
      </form>
    </div>
  );
}
