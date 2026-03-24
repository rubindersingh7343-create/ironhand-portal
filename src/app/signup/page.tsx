import SignupForm from "@/components/signup/SignupForm";

export const dynamic = "force-dynamic";

export default function SignupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-16 text-slate-100">
      <div className="w-full max-w-4xl space-y-8 rounded-[32px] border border-black/5 bg-white/80 px-8 py-10 shadow-[0_8px_24px_rgba(15,23,42,0.08)] backdrop-blur">
        <div className="space-y-2 text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-600">
            Owner portal signup
          </p>
          <h1 className="text-2xl font-semibold">Create your account</h1>
          <p className="text-sm text-slate-600">
            Owner portal accounts can be created without a code. All other
            portals still require an invite code.
          </p>
        </div>

        <div className="mx-auto max-w-3xl space-y-6 rounded-[24px] border border-black/5 bg-white/65 p-6 shadow-[0_2px_8px_rgba(15,23,42,0.08)]">
          <SignupForm />
        </div>

        <div className="text-center text-sm text-slate-600">
          <p>
            Already have an account?{" "}
            <a
              href="/auth/login"
              className="font-semibold text-[#223a70] underline decoration-dotted underline-offset-4 hover:text-[#1a2c56]"
            >
              Go to sign in
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
