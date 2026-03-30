import AppLoadingScreen from "@/components/ui/AppLoadingScreen";
import { cookies } from "next/headers";

export default async function Loading() {
  const cookieStore = await cookies();
  const name = cookieStore.get("ih_display_name")?.value ?? "";
  return <AppLoadingScreen name={name} label="Loading…" />;
}
