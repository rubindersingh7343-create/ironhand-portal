import { appendFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import {
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  getSessionUser,
} from "@/lib/auth";
import {
  attachStoreToClient,
  createStoreForClient,
  deleteStoreForClient,
  getClientStoreIds,
  getDynamicUsers,
} from "@/lib/userStore";
import { mockUsers, SESSION_COOKIE } from "@/lib/users";

const ERROR_LOG = path.join(process.cwd(), "data", "api-errors.log");

export async function POST(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "client") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const code = body?.code as string | undefined;
    const storeName = body?.storeName as string | undefined;
    const storeAddress = body?.storeAddress as string | undefined;
    if (!code && (!storeName || !storeName.trim())) {
      return NextResponse.json(
        { error: "Store name required" },
        { status: 400 },
      );
    }

    let result:
      | { invite: { storeId: string; storeName?: string } | null; updated: boolean; stores: string[] }
      | { store: { storeId: string; name: string }; stores: string[] };

    if (code) {
      const inviteResult = await attachStoreToClient(user.id, code);
      if (!inviteResult.invite || !inviteResult.updated) {
        return NextResponse.json(
          { error: "Invalid or expired client code." },
          { status: 400 },
        );
      }
      result = inviteResult;
    } else {
      const created = await createStoreForClient({
        userId: user.id,
        storeName: storeName?.trim() ?? "",
        storeAddress: storeAddress?.trim(),
      });
      result = created;
    }

    const stores = Array.from(
      new Set(
        [
          ...(user.storeIds ?? (user.storeNumber ? [user.storeNumber] : [])),
          ...(result.stores ?? []),
        ].filter(Boolean),
      ),
    );

    const updatedUser = {
      ...user,
      storeIds: stores,
      storeNumber: stores[0] ?? user.storeNumber,
    };

    const response = NextResponse.json({
      success: true,
      storeId: "invite" in result ? result.invite?.storeId : result.store.storeId,
      storeName: "invite" in result ? result.invite?.storeName : result.store.name,
      stores,
    });
    response.cookies.set(SESSION_COOKIE, createSessionToken(updatedUser), {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    console.error("Failed to add store", error);
    try {
      await appendFile(
        ERROR_LOG,
        `[${new Date().toISOString()}] add-store failure: ${
          error instanceof Error ? error.stack ?? error.message : String(error)
        }\n`,
        "utf-8",
      );
    } catch {
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected error while adding store.",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "client") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const storeId = (body?.storeId as string | undefined)?.trim();
    const password = (body?.password as string | undefined) ?? "";
    if (!storeId) {
      return NextResponse.json(
        { error: "Store ID required" },
        { status: 400 },
      );
    }
    if (!password) {
      return NextResponse.json(
        { error: "Password required" },
        { status: 400 },
      );
    }

    const dynamicUsers = await getDynamicUsers();
    const account =
      dynamicUsers.find((entry) => entry.id === user.id) ??
      mockUsers.find((entry) => entry.id === user.id);
    if (!account || account.password !== password) {
      return NextResponse.json(
        { error: "Incorrect password." },
        { status: 401 },
      );
    }

    const allowedStoreIds = new Set(
      (user.storeIds?.length ? user.storeIds : [user.storeNumber]).filter(Boolean),
    );
    if (!allowedStoreIds.has(storeId)) {
      return NextResponse.json(
        { error: "You don't have access to that store." },
        { status: 403 },
      );
    }

    const result = await deleteStoreForClient({ userId: user.id, storeId });

    const linkedStores = await getClientStoreIds(user.id);
    const nextStores = Array.from(
      new Set(
        [
          ...(Array.isArray(user.storeIds) ? user.storeIds : []),
          user.storeNumber,
          ...linkedStores,
        ]
          .filter(Boolean)
          .filter((id) => id !== storeId),
      ),
    );

    const updatedUser = {
      ...user,
      storeIds: nextStores,
      storeNumber: nextStores[0] ?? "",
    };

    const response = NextResponse.json({
      success: true,
      storeId,
      deletedEmployees: result.deletedEmployees,
      stores: nextStores,
    });
    response.cookies.set(SESSION_COOKIE, createSessionToken(updatedUser), {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    console.error("Failed to delete store", error);
    try {
      await appendFile(
        ERROR_LOG,
        `[${new Date().toISOString()}] delete-store failure: ${
          error instanceof Error ? error.stack ?? error.message : String(error)
        }\n`,
        "utf-8",
      );
    } catch {
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected error while deleting store.",
      },
      { status: 500 },
    );
  }
}
