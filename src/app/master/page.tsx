import Image from "next/image";
import { redirect } from "next/navigation";
import MasterDashboard from "@/components/master/MasterDashboard";
import LoginForm from "@/components/auth/LoginForm";
import { getSessionUser, isMasterUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function MasterPage() {
  const user = await getSessionUser();
  if (!user) {
    return <MasterAccessCard />;
  }

  if (!isMasterUser(user)) {
    redirect("/");
  }
  return <MasterDashboard user={user} />;
}

function MasterAccessCard() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#0f1f3d,#050914_60%,#01030a_95%)] px-4 py-16">
      <div className="w-full max-w-4xl space-y-6">
        <div className="flex justify-center">
          <Image
            src="/IronHandsLogo.png"
            alt="Iron Hand logo"
            width={96}
            height={96}
            className="object-contain"
            priority
          />
        </div>
        <section className="space-y-6 rounded-[62px] border border-white/10 bg-[rgba(10,18,38,0.9)] px-8 py-10 text-white shadow-2xl shadow-slate-950/30 backdrop-blur">
          <div className="space-y-2 text-center">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
              HQ access only
            </p>
            <h1 className="text-2xl font-semibold text-white">
              Sign in to Master Control
            </h1>
            <p className="text-sm text-slate-400">
              Use your Iron Hand HQ credentials to open the manager invite
              console.
            </p>
          </div>
          <div className="mx-auto max-w-md">
            <LoginForm redirectTo="/master" />
          </div>
        </section>
      </div>
    </div>
  );
}
