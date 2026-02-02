"use client";

import { useState } from "react";
import CopyButton from "@/components/ui/CopyButton";

export default function PasswordResetCodesPanel() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setCode(null);
    setExpiresAt(null);
    try {
      const res = await fetch("/api/master/password-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Unable to generate code.");
      setCode(data.code);
      setExpiresAt(data.expiresAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate code.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="ui-card text-white">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
            Password resets
          </p>
          <h2 className="text-xl font-semibold text-white">
            Generate one-time reset codes
          </h2>
          <p className="text-sm text-slate-400">
            Give the user a code; they enter email + code + new password on the
            reset page. Codes expire in 60 minutes and are single-use.
          </p>
        </div>
      </div>
      <form onSubmit={generate} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-2xl border border-white/10 bg-[#0f1b3a] px-4 py-3 text-white placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
          placeholder="user@example.com"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-2xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-70"
        >
          {loading ? "Generating..." : "Generate code"}
        </button>
      </form>
      {error && (
        <p className="mt-3 rounded-xl bg-red-500/10 px-4 py-2 text-sm text-red-200">
          {error}
        </p>
      )}
      {code && (
        <div className="mt-4 space-y-1 rounded-2xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-100">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-white">Code: {code}</p>
            <CopyButton value={code} label="Copy reset code" />
          </div>
          {expiresAt && (
            <p className="text-xs text-blue-200">
              Expires at: {new Date(expiresAt).toLocaleString()}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
