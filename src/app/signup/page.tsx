import SignupForm from "@/components/signup/SignupForm";

export const dynamic = "force-dynamic";

export default function SignupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#0f1f3d,#050914_60%,#01030a_95%)] px-4 py-16">
      <div className="w-full max-w-3xl space-y-8 rounded-[32px] border border-white/10 bg-[rgba(10,18,38,0.85)] px-10 py-10 text-white shadow-2xl shadow-slate-950/30 backdrop-blur">
        <div className="space-y-2 text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
            Client onboarding
          </p>
          <h1 className="text-2xl font-semibold">Create your Iron Hand account</h1>
          <p className="text-sm text-slate-400">
            Enter your invite details from Iron Hand HQ.
          </p>
        </div>
        <SignupForm />
        <p className="mt-4 text-center text-xs text-slate-400">
          Already have access?{" "}
          <a
            href="/auth/login"
            className="font-semibold text-blue-300 underline decoration-dotted underline-offset-4 hover:text-white"
          >
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
