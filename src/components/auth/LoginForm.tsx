"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type FeedbackTone = "info" | "error" | "success";

interface FeedbackMessage {
  text: string;
  tone: FeedbackTone;
}

interface LoginFormProps {
  redirectTo?: string;
}

export default function LoginForm({ redirectTo = "/" }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        setFeedback({
          text: error?.error ?? "Unable to sign in. Try again.",
          tone: "error",
        });
        return;
      }

      setFeedback({
        text: "Success! Redirecting…",
        tone: "success",
      });
      router.replace(redirectTo);
      router.refresh();
    } catch (error) {
      console.error(error);
      setFeedback({
        text: "Network issue. Please try again.",
        tone: "error",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4 text-left">
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-200" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            spellCheck={false}
            className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-slate-100 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
            placeholder="you@hiremote.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <label
            className="block text-sm font-medium text-slate-200"
            htmlFor="password"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-slate-100 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
            placeholder="••••••••"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {feedback && (
          <p
            className={`rounded-xl px-4 py-2 text-sm ${
              feedback.tone === "error"
                ? "bg-red-500/15 text-red-200"
                : feedback.tone === "success"
                  ? "bg-emerald-500/15 text-emerald-200"
                  : "bg-blue-500/15 text-blue-200"
            }`}
          >
            {feedback.text}
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-blue-600 px-6 py-3 text-center text-base font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? "Signing in..." : "Access Portal"}
        </button>
      </form>

    </>
  );
}
