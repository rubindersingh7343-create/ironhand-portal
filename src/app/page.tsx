import { Suspense } from "react";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard/DashboardShell";
import { getSessionUser } from "@/lib/auth";
import AppLoadingScreen from "@/components/ui/AppLoadingScreen";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

async function HomeContent() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/auth/login");
  }
  if (user.role === "surveillance") {
    redirect("/surveillance");
  }
  if (user.portal === "master") {
    redirect("/master");
  }

  return <DashboardShell user={user} />;
}

export default async function Home() {
  const cookieStore = await cookies();
  const name = cookieStore.get("ih_display_name")?.value ?? "";
  return (
    <Suspense fallback={<AppLoadingScreen name={name} label="Loading…" />}>
      <HomeContent />
    </Suspense>
  );
}
