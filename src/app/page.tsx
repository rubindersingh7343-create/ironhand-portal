import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard/DashboardShell";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
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
