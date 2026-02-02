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
    <div className="mx-auto max-w-md px-4 py-10 text-white">
      <h1 className="text-2xl font-semibold">Reset password</h1>
      <p className="mt-2 text-sm text-slate-300">
        Enter a new password for your account.
      </p>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div className="space-y-1">
          <label className="text-sm text-slate-200" htmlFor="password">
            New password
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-slate-100 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
            placeholder="••••••••"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm text-slate-200" htmlFor="confirm">
            Confirm password
          </label>
          <input
            id="confirm"
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-slate-100 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
            placeholder="••••••••"
          />
        </div>
        {message && (
          <p
            className={`rounded-xl px-4 py-2 text-sm ${
              status === "error"
                ? "bg-red-500/15 text-red-200"
                : "bg-blue-500/15 text-blue-200"
            }`}
          >
            {message}
          </p>
        )}
        <button
          type="submit"
          disabled={status === "sending"}
          className="w-full rounded-xl bg-blue-600 px-6 py-3 text-center text-base font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {status === "sending" ? "Resetting..." : "Reset password"}
        </button>
      </form>
    </div>
  );
}
