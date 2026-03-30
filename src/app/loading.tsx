import AppLoadingScreen from "@/components/ui/AppLoadingScreen";
import { cookies } from "next/headers";

export default function Loading() {
  const name = cookies().get("ih_display_name")?.value ?? "";
  return <AppLoadingScreen name={name} label="Loading…" />;
}
