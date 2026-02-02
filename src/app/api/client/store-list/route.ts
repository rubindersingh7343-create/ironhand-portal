import { NextResponse } from "next/server";
import {
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  getSessionUser,
} from "@/lib/auth";
import {
  getStoreSummariesByIds,
  getStoreManagerId,
  getSurveillanceManagerId,
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
  const summaryMap = new Map(summaries.map((store) => [store.storeId, store]));
  const serviceStates = await Promise.all(
    storeIds.map(async (storeId) => {
      const [managerId, surveillanceId] = await Promise.all([
        getStoreManagerId(storeId),
        getSurveillanceManagerId(storeId),
      ]);
      return {
        storeId,
        hasManager: Boolean(managerId),
        hasSurveillance: Boolean(surveillanceId),
      };
    }),
  );
  const stateMap = new Map(
    serviceStates.map((state) => [state.storeId, state]),
  );
  const mergedSummaries = storeIds.map((id) => {
    const found = summaryMap.get(id);
    const state = stateMap.get(id);
    return {
      ...(found ?? {
        storeId: id,
        storeName: `Store ${id}`,
      }),
      hasManager: state?.hasManager ?? false,
      hasSurveillance: state?.hasSurveillance ?? false,
    };
  });

  const updatedStoreIds = storeIds;
  const updatedUser = {
    ...user,
    storeIds: updatedStoreIds,
    storeNumber: updatedStoreIds[0] ?? "",
  };

  const response = NextResponse.json({ stores: mergedSummaries });
  response.cookies.set(SESSION_COOKIE, createSessionToken(updatedUser), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
