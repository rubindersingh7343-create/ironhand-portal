import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { listScratcherProducts } from "@/lib/dataStore";

export async function GET() {
  const user = await getSessionUser();
  if (!user || (user.role !== "ironhand" && user.role !== "client")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const products = await listScratcherProducts();
  return NextResponse.json({ products });
}
