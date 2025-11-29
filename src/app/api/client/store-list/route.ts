import { NextResponse } from "next/server";
import { createSessionToken, getSessionUser } from "@/lib/auth";
import {
  getStoreSummariesByIds,
  removeStoreFromClient,
} from "@/lib/userStore";
import { SESSION_COOKIE } from "@/lib/users";

export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "client") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const storeIds = user.storeIds?.length
    ? user.storeIds
    : user.storeNumber
      ? [user.storeNumber]
      : [];
  const summaries = await getStoreSummariesByIds(storeIds);
  const validIds = summaries.map((store) => store.storeId);
  const missingIds = storeIds.filter((id) => !validIds.includes(id));

  for (const missingId of missingIds) {
    await removeStoreFromClient(user.id, missingId);
  }

  const updatedStoreIds = validIds;
  const updatedUser = {
    ...user,
    storeIds: updatedStoreIds,
    storeNumber: updatedStoreIds[0] ?? "",
  };

  const response = NextResponse.json({ stores: summaries });
  response.cookies.set(SESSION_COOKIE, createSessionToken(updatedUser), {
    path: "/",
    httpOnly: true,
  });
  return response;
}
