"use client";

import { useState } from "react";

export default function SignupForm() {
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    password: "",
    confirmPassword: "",
    code: "",
  });
  const [status, setStatus] = useState<"idle" | "submitting">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const updateField = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (form.password !== form.confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }
    setStatus("submitting");
    setMessage(null);
    try {
      const response = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error ?? "Unable to sign up.");
      }

      setMessage("Account created! Signing you in...");
      window.location.assign("/");
    } catch (error) {
      if (error instanceof Error) {
        setMessage(error.message);
      } else {
        setMessage("Unable to sign up.");
      }
    } finally {
      setStatus("idle");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-left">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700" htmlFor="name">
            Full name
          </label>
          <input
            id="name"
            value={form.name}
            onChange={(event) => updateField("name", event.target.value)}
            required
            className="w-full rounded-2xl border border-black/5 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-500 shadow-[0_2px_8px_rgba(15,23,42,0.08)] focus:border-[#223a70] focus:outline-none focus:ring-4 focus:ring-[rgba(34,58,112,0.10)]"
            placeholder="Alex Merchant"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700" htmlFor="phone">
            Phone number
          </label>
          <input
            id="phone"
            value={form.phone}
            onChange={(event) => updateField("phone", event.target.value)}
            required
            className="w-full rounded-2xl border border-black/5 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-500 shadow-[0_2px_8px_rgba(15,23,42,0.08)] focus:border-[#223a70] focus:outline-none focus:ring-4 focus:ring-[rgba(34,58,112,0.10)]"
            placeholder="(555) 123-4567"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={form.email}
            onChange={(event) => updateField("email", event.target.value)}
            required
            className="w-full rounded-2xl border border-black/5 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-500 shadow-[0_2px_8px_rgba(15,23,42,0.08)] focus:border-[#223a70] focus:outline-none focus:ring-4 focus:ring-[rgba(34,58,112,0.10)]"
            placeholder="you@store.com"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={form.password}
            onChange={(event) => updateField("password", event.target.value)}
            required
            className="w-full rounded-2xl border border-black/5 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-500 shadow-[0_2px_8px_rgba(15,23,42,0.08)] focus:border-[#223a70] focus:outline-none focus:ring-4 focus:ring-[rgba(34,58,112,0.10)]"
            placeholder="••••••••"
          />
        </div>
        <div className="space-y-2">
          <label
            className="text-sm font-medium text-slate-700"
            htmlFor="confirmPassword"
          >
            Re-enter password
          </label>
          <input
            id="confirmPassword"
            type="password"
            value={form.confirmPassword}
            onChange={(event) => updateField("confirmPassword", event.target.value)}
            required
            className="w-full rounded-2xl border border-black/5 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-500 shadow-[0_2px_8px_rgba(15,23,42,0.08)] focus:border-[#223a70] focus:outline-none focus:ring-4 focus:ring-[rgba(34,58,112,0.10)]"
            placeholder="••••••••"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700" htmlFor="code">
          Invite code (optional for owner portal)
        </label>
        <input
          id="code"
          value={form.code}
          onChange={(event) => updateField("code", event.target.value)}
          className="w-full rounded-2xl border border-black/5 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-500 shadow-[0_2px_8px_rgba(15,23,42,0.08)] focus:border-[#223a70] focus:outline-none focus:ring-4 focus:ring-[rgba(34,58,112,0.10)]"
          placeholder="Leave blank for owner portal"
        />
      </div>

      {message && (
        <p className="rounded-2xl border border-black/5 bg-black/5 px-4 py-3 text-sm text-slate-700">
          {message}
        </p>
      )}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="w-full rounded-2xl bg-[#223a70] px-6 py-3 text-base font-semibold text-white shadow-[0_8px_24px_rgba(15,23,42,0.12)] transition hover:bg-[#1a2c56] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "submitting" ? "Submitting..." : "Create account"}
      </button>
    </form>
  );
}
