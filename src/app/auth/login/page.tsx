import Image from "next/image";
import { redirect } from "next/navigation";
import LoginForm from "@/components/auth/LoginForm";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) {
    redirect("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#0f1f3d,#050914_60%,#01030a_95%)] px-4 py-16">
      <div className="w-full max-w-5xl space-y-6">
        <div className="flex justify-center">
          <Image
            src="/IronHandsLogo.png"
            alt="Iron Hand logo"
            width={112}
            height={112}
            className="object-contain"
            priority
          />
        </div>

        <section className="space-y-6 rounded-[62px] border border-white/10 bg-[rgba(10,18,38,0.85)] px-10 py-10 text-center text-white shadow-2xl shadow-slate-950/30 backdrop-blur">
        <div className="space-y-2 text-white">
          <h2 className="text-xl font-light uppercase tracking-[0.4em]">
            Portal
          </h2>
        </div>

        <div className="mx-auto max-w-md space-y-6">
          <LoginForm />
          <p className="text-center text-sm text-slate-300">
            <a
              href="/signup"
              className="font-semibold text-blue-200 underline decoration-dotted underline-offset-4 hover:text-white"
            >
              Create account
            </a>
          </p>
        </div>
        </section>
      </div>
    </div>
  );
}
