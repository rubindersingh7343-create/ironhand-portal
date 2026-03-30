"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppLoadingScreen from "@/components/ui/AppLoadingScreen";
import { rememberUserFirstLastName } from "@/lib/userDisplayName";

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
  const [rememberMe, setRememberMe] = useState(true);
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [redirectingName, setRedirectingName] = useState<string | null>(null);

  type CapacitorAuthSession = {
    start: (args: { url: string; callbackScheme: string }) => Promise<void>;
  };
  type CapacitorLike = {
    isNativePlatform?: () => boolean;
    Plugins?: {
      AuthSessionPlugin?: CapacitorAuthSession;
    };
  };

  const getCapacitor = useCallback((): CapacitorLike | null => {
    if (typeof window === "undefined") return null;
    const cap = (window as unknown as { Capacitor?: unknown }).Capacitor;
    if (!cap || typeof cap !== "object") return null;
    return cap as CapacitorLike;
  }, []);

  const startNativeAuthSession = async () => {
    // Only runs inside the native app; no-op on web/Safari.
    const Cap = getCapacitor();
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

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setFeedback(null);

    try {
      // Trigger iOS system Passwords sheet when running in the native wrapper,
      // and skip the web fetch login in that case.
      const Cap = getCapacitor();
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

      const payload = await response.json().catch(() => ({}));
      const userName =
        typeof payload?.user?.name === "string" ? payload.user.name : null;
      if (userName) {
        setRedirectingName(userName);
        rememberUserFirstLastName(userName);
      }
      setIsRedirecting(true);

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

  useEffect(() => {
    const setupDeepLink = async () => {
      const Cap = getCapacitor();
      if (!Cap?.isNativePlatform?.()) return;
      try {
        const { App } = await import("@capacitor/app");
        const listener = await App.addListener("appUrlOpen", ({ url }) => {
          if (url?.startsWith("com.ironhand.operations://auth-callback")) {
            setIsRedirecting(true);
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
  }, [redirectTo, router, getCapacitor]);

  return (
    <>
      {isRedirecting ? (
        <AppLoadingScreen name={redirectingName} label="Logging you in…" />
      ) : null}
      <form
        onSubmit={handleSubmit}
        className="space-y-4 text-left"
        autoComplete="on"
        style={isRedirecting ? { display: "none" } : undefined}
      >
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            spellCheck={false}
            name="username"
            autoComplete="username"
            className="w-full rounded-2xl border border-black/5 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-500 shadow-[0_2px_8px_rgba(15,23,42,0.08)] focus:border-[#223a70] focus:outline-none focus:ring-4 focus:ring-[rgba(34,58,112,0.10)]"
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
            className="h-4 w-4 rounded border-black/10 bg-white text-[#223a70] focus:ring-[#223a70]/30"
          />
          <label htmlFor="rememberMe" className="text-sm text-slate-600">
            Keep me signed in
          </label>
        </div>

        <div className="space-y-2">
          <label
            className="block text-sm font-medium text-slate-700"
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
            className="w-full rounded-2xl border border-black/5 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-500 shadow-[0_2px_8px_rgba(15,23,42,0.08)] focus:border-[#223a70] focus:outline-none focus:ring-4 focus:ring-[rgba(34,58,112,0.10)]"
            placeholder="••••••••"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {feedback && (
          <p
            className={`rounded-xl px-4 py-2 text-sm ${
              feedback.tone === "error"
                ? "border border-red-900/10 bg-red-500/10 text-red-900"
                : feedback.tone === "success"
                  ? "border border-emerald-900/10 bg-emerald-500/10 text-emerald-900"
                  : "border border-[#223a70]/15 bg-[#223a70]/10 text-slate-800"
            }`}
          >
            {feedback.text}
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-[#223a70] px-6 py-3 text-center text-base font-semibold text-white shadow-[0_8px_24px_rgba(15,23,42,0.12)] transition hover:bg-[#1a2c56] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? "Signing in..." : "Access Portal"}
        </button>

        <div className="text-center text-sm text-slate-600">
          <a
            href="/auth/forgot"
            className="text-[#223a70] hover:text-[#1a2c56] underline underline-offset-4"
          >
            Forgot your password?
          </a>
        </div>
      </form>

    </>
  );
}
