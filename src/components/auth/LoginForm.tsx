"use client";

import { useEffect, useState } from "react";
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
  const LOGIN_URL = "https://ironhand.net/auth/login?redirect=com.ironhand.operations://auth-callback";
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const startNativeAuthSession = async () => {
    // Only runs inside the native app; no-op on web/Safari.
    const Cap = (typeof window !== "undefined" && (window as any).Capacitor) || null;
    if (!Cap?.Plugins?.AuthSessionPlugin || !Cap?.isNativePlatform?.()) return;
    try {
      await Cap.Plugins.AuthSessionPlugin.start({
        url: "https://ironhand.net/auth/login",
        callbackScheme: "com.ironhand.operations",
      });
    } catch (err) {
      console.warn("Native auth session failed", err);
    }
  };

  const handleNativePasswordFill = async () => {
    const Cap = (typeof window !== "undefined" && (window as any).Capacitor) || null;
    const isNative = Cap?.Plugins?.AuthSessionPlugin && Cap?.isNativePlatform?.();
    if (!isNative) return;
    setIsSubmitting(true);
    setFeedback(null);
    try {
      await startNativeAuthSession();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setFeedback(null);

    try {
      // Trigger iOS system Passwords sheet when running in the native wrapper,
      // and skip the web fetch login in that case.
      const Cap = (typeof window !== "undefined" && (window as any).Capacitor) || null;
      const isNative = Cap?.Plugins?.AuthSessionPlugin && Cap?.isNativePlatform?.();
      if (isNative) {
        await startNativeAuthSession();
        setIsSubmitting(false);
        return;
      }

      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password, rememberMe }),
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

      const launchDeepLink = () => {
        const candidates = [
          redirectTo,
          "com.ironhand.operations://auth-callback",
          "ironhand://auth-callback",
        ].filter((v): v is string => !!v);

        // Try each scheme; iOS will open the first it recognizes.
        for (const target of candidates) {
          if (target.startsWith("http")) continue; // deep links only
          try {
            window.location.href = target;
            return;
          } catch (err) {
            console.warn("Deep link failed", err);
          }
        }
      };

      const isExternalScheme =
        redirectTo?.startsWith("com.ironhand.operations://") ||
        redirectTo?.startsWith("ironhand://");

      if (isExternalScheme) {
        launchDeepLink();
        // If the app isn't installed, fall back to the portal after a short delay.
        setTimeout(() => {
          router.replace("/");
          router.refresh();
        }, 1800);
        return;
      }

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

  const openExternalLogin = async () => {
    const Cap = (typeof window !== "undefined" && (window as any).Capacitor) || null;
    const isNative = Cap?.isNativePlatform?.();
    if (isNative) {
      try {
        const { Browser } = await import("@capacitor/browser");
        await Browser.open({ url: LOGIN_URL });
        return;
      } catch (error) {
        console.error("Failed to open native browser", error);
      }
    }
    window.open(LOGIN_URL, "_blank", "noopener,noreferrer");
  };

  useEffect(() => {
    const setupDeepLink = async () => {
      const Cap = (typeof window !== "undefined" && (window as any).Capacitor) || null;
      if (!Cap?.isNativePlatform?.()) return;
      try {
        const { App } = await import("@capacitor/app");
        const listener = await App.addListener("appUrlOpen", ({ url }) => {
          if (url?.startsWith("com.ironhand.operations://auth-callback")) {
            router.replace(redirectTo);
            router.refresh();
          }
        });
        return () => {
          listener?.remove?.();
        };
      } catch (error) {
        console.error("appUrlOpen listener failed", error);
      }
    };
    const cleanup = setupDeepLink();
    return () => {
      Promise.resolve(cleanup).then((fn) => {
        if (typeof fn === "function") fn();
      });
    };
  }, [redirectTo, router]);

  return (
    <>
      <form
        onSubmit={handleSubmit}
        className="space-y-4 text-left"
        autoComplete="on"
      >
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-200" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            spellCheck={false}
            name="username"
            autoComplete="username"
            className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-slate-100 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
            placeholder="you@hiremote.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            id="rememberMe"
            type="checkbox"
            checked={rememberMe}
            onChange={(event) => setRememberMe(event.target.checked)}
            className="h-4 w-4 rounded border-white/30 bg-[#111a32] text-blue-500 focus:ring-blue-400"
          />
          <label htmlFor="rememberMe" className="text-sm text-slate-300">
            Keep me signed in
          </label>
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
            name="password"
            autoComplete="current-password"
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

        <div className="text-center text-sm text-slate-300">
          <a
            href="/auth/forgot"
            className="text-blue-300 hover:text-blue-200 underline underline-offset-4"
          >
            Forgot your password?
          </a>
        </div>
      </form>

    </>
  );
}
