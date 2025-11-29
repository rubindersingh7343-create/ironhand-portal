import { appendFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { createSessionToken, getSessionUser } from "@/lib/auth";
import { attachStoreToClient } from "@/lib/userStore";
import { SESSION_COOKIE } from "@/lib/users";

const ERROR_LOG = path.join(process.cwd(), "data", "api-errors.log");

export async function POST(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "client") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const code = body?.code as string | undefined;
    if (!code) {
      return NextResponse.json(
        { error: "Invite code required" },
        { status: 400 },
      );
    }

    const result = await attachStoreToClient(user.id, code);
    if (!result.invite || !result.updated) {
      return NextResponse.json(
        { error: "Invalid or expired client code." },
        { status: 400 },
      );
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
      storeId: result.invite.storeId,
      stores,
    });
    response.cookies.set(SESSION_COOKIE, createSessionToken(updatedUser), {
      path: "/",
      httpOnly: true,
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
