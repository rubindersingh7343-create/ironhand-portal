import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import SurveillancePortal from "@/components/surveillance/SurveillancePortal";

export const dynamic = "force-dynamic";

export default async function SurveillancePage() {
  const user = await getSessionUser();
  if (!user || user.role !== "surveillance") {
    redirect("/auth/login");
  }
  return <SurveillancePortal user={user} />;
}
