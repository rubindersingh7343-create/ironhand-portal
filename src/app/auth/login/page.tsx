import Image from "next/image";
import { redirect } from "next/navigation";
import LoginForm from "@/components/auth/LoginForm";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const user = await getSessionUser();
  if (user) {
    redirect("/");
  }

  const redirectToParam = (() => {
    const raw = searchParams?.redirect;
    if (Array.isArray(raw)) return raw[0];
    return raw;
  })();
  const redirectTo =
    typeof redirectToParam === "string" && redirectToParam.length
      ? redirectToParam
      : "/";

  // External login URL with callback back into the app (for Keychain flow)
  const appCallback = "com.ironhand.operations://auth-callback";
  const externalLoginUrl = `https://ironhand.net/auth/login?redirect=${encodeURIComponent(appCallback)}`;

  return (
    <div className="login-lock flex items-center justify-center bg-[radial-gradient(circle_at_top,#0f1f3d,#050914_60%,#01030a_95%)] px-4 py-12">
      <div className="w-full max-w-5xl space-y-6">
        <div className="flex justify-center">
          <Image
            src="/logowriting2.png"
            alt="Iron Hand logo"
            width={260}
            height={260}
            sizes="(max-width: 640px) 210px, 260px"
            className="h-40 w-auto object-contain sm:h-52"
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
          <LoginForm redirectTo={redirectTo} />
          <div className="text-center text-sm text-slate-300">
            <a
              href="/signup"
              className="font-semibold text-blue-200 underline decoration-dotted underline-offset-4 hover:text-white"
            >
              Create an account
            </a>
          </div>
        </div>
        </section>
      </div>
    </div>
  );
}
