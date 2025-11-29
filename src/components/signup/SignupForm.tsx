"use client";

import { useState } from "react";

export default function SignupForm() {
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    password: "",
    code: "",
  });
  const [status, setStatus] = useState<"idle" | "submitting">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const updateField = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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

      setMessage("Account created! You can now sign in.");
      setForm({
        name: "",
        phone: "",
        email: "",
        password: "",
        code: "",
      });
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
          <label className="text-sm font-medium text-slate-200" htmlFor="name">
            Full name
          </label>
          <input
            id="name"
            value={form.name}
            onChange={(event) => updateField("name", event.target.value)}
            required
            className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-slate-100 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
            placeholder="Alex Merchant"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-200" htmlFor="phone">
            Phone number
          </label>
          <input
            id="phone"
            value={form.phone}
            onChange={(event) => updateField("phone", event.target.value)}
            required
            className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-slate-100 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
            placeholder="(555) 123-4567"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-200" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={form.email}
            onChange={(event) => updateField("email", event.target.value)}
            required
            className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-slate-100 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
            placeholder="you@store.com"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-200" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={form.password}
            onChange={(event) => updateField("password", event.target.value)}
            required
            className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-slate-100 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
            placeholder="••••••••"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-200" htmlFor="code">
          Invite code
        </label>
        <input
          id="code"
          value={form.code}
          onChange={(event) => updateField("code", event.target.value)}
          required
          className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-slate-100 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
          placeholder="CLI-XXXXXX / EMP-XXXXXX"
        />
      </div>

      {message && (
        <p className="rounded-2xl bg-white/10 px-4 py-3 text-sm text-slate-100">
          {message}
        </p>
      )}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="w-full rounded-2xl bg-blue-600 px-6 py-3 text-base font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed"
      >
        {status === "submitting" ? "Submitting..." : "Create account"}
      </button>
    </form>
  );
}
