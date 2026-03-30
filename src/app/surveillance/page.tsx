import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import SurveillancePortal from "@/components/surveillance/SurveillancePortal";
import AppLoadingScreen from "@/components/ui/AppLoadingScreen";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

async function SurveillanceContent() {
  const user = await getSessionUser();
  if (!user || user.role !== "surveillance") {
    redirect("/auth/login");
  }
  return <SurveillancePortal user={user} />;
}

export default async function SurveillancePage() {
  const cookieStore = await cookies();
  const name = cookieStore.get("ih_display_name")?.value ?? "";
  return (
    <Suspense fallback={<AppLoadingScreen name={name} label="Loading…" />}>
      <SurveillanceContent />
    </Suspense>
  );
}
