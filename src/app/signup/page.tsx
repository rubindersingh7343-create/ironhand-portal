import SignupForm from "@/components/signup/SignupForm";

export const dynamic = "force-dynamic";

export default function SignupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#0f1f3d,#050914_60%,#01030a_95%)] px-4 py-16">
      <div className="w-full max-w-4xl space-y-8 rounded-[32px] border border-white/10 bg-[rgba(10,18,38,0.9)] px-8 py-10 text-white shadow-2xl shadow-slate-950/30 backdrop-blur">
        <div className="space-y-2 text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
            Owner portal signup
          </p>
          <h1 className="text-2xl font-semibold">Create your account</h1>
          <p className="text-sm text-slate-300">
            Owner portal accounts can be created without a code. All other
            portals still require an invite code.
          </p>
        </div>

        <div className="mx-auto max-w-3xl space-y-6 rounded-[24px] border border-white/10 bg-black/25 p-6">
          <SignupForm />
        </div>

        <div className="text-center text-sm text-slate-300">
          <p>
            Already have an account?{" "}
            <a
              href="/auth/login"
              className="font-semibold text-blue-200 underline decoration-dotted underline-offset-4 hover:text-white"
            >
              Go to sign in
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
