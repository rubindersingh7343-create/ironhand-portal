import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import {
  attachStoreToSurveillance,
  getStoreSummariesByIds,
  getSurveillanceStoreIds,
} from "@/lib/userStore";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !requireRole(user, ["surveillance"])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const linkedIds = await getSurveillanceStoreIds(user.id);
  const combined = Array.from(
    new Set(
      [
        user.storeNumber,
        ...(Array.isArray(user.storeIds) ? user.storeIds : []),
        ...linkedIds,
      ].filter(Boolean),
    ),
  );

  const summaries = combined.length
    ? await getStoreSummariesByIds(combined)
    : [];

  return NextResponse.json({
    stores: summaries.map((store) => ({
      storeId: store.storeId,
      storeName: store.storeName ?? `Store ${store.storeId}`,
      storeAddress: store.storeAddress ?? "",
    })),
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || !requireRole(user, ["surveillance"])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const code = body?.code?.trim() as string | undefined;
  if (!code) {
    return NextResponse.json({ error: "Invite code required." }, { status: 400 });
  }

  const result = await attachStoreToSurveillance(user.id, code);
  if (!result.updated || !result.invite) {
    return NextResponse.json(
      { error: "Invalid or expired surveillance code." },
      { status: 400 },
    );
  }

  const [summary] = await getStoreSummariesByIds([result.invite.storeId]);
  return NextResponse.json({
    store: summary ?? {
      storeId: result.invite.storeId,
      storeName: result.invite.storeName ?? `Store ${result.invite.storeId}`,
      storeAddress: result.invite.storeAddress ?? "",
    },
  });
}
