import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { mockUsers } from "@/lib/users";
import {
  addDynamicUser,
  consumeInvite,
  consumeManagerInvite,
  findDynamicUserByEmail,
  generateEmployeeCode,
  markInviteUsed,
  markManagerInviteUsed,
  setStoreManager,
} from "@/lib/userStore";
import {
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
} from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/users";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = body?.name?.toString().trim();
  const phone = body?.phone?.toString().trim();
  const email = body?.email?.toString().trim();
  const password = body?.password?.toString();
  const codeRaw = body?.code?.toString().trim();

  if (!name || !phone || !email || !password) {
    return NextResponse.json(
      { error: "All fields are required." },
      { status: 400 },
    );
  }

  const normalizedEmail = normalizeEmail(email);
  const existing =
    mockUsers.find((user) => normalizeEmail(user.email) === normalizedEmail) ??
    (await findDynamicUserByEmail(normalizedEmail));
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists. Please sign in." },
      { status: 409 },
    );
  }

  const code = codeRaw ? codeRaw.toUpperCase() : "";
  const isManagerCode = code.startsWith("MGR-");
  try {
    if (!code) {
      const user = {
        id: randomUUID(),
        name,
        email: normalizedEmail,
        phone,
        password,
        role: "client" as const,
        storeNumber: "",
        storeIds: [],
      };
      await addDynamicUser(user);
      const response = NextResponse.json({ success: true, user });
      response.cookies.set({
        name: SESSION_COOKIE,
        value: createSessionToken(user),
        httpOnly: true,
        maxAge: SESSION_MAX_AGE_SECONDS,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      });
      return response;
    }

    if (isManagerCode) {
      const invite = await consumeManagerInvite(code);
      if (!invite) {
        return NextResponse.json(
          { error: "Invalid or expired manager invite code." },
          { status: 400 },
        );
      }

      const user = {
        id: randomUUID(),
        name,
        email: normalizedEmail,
        phone,
        password,
        role: "ironhand" as const,
        portal: "manager" as const,
        storeNumber: invite.storeId ?? "",
        storeIds: invite.storeId ? [invite.storeId] : [],
        employeeCode: await generateEmployeeCode(),
      };

      await addDynamicUser(user);
      await markManagerInviteUsed(invite.id, user.id);
      if (invite.storeId) {
        await setStoreManager(invite.storeId, user.id);
      }

      const response = NextResponse.json({ success: true, user });
      response.cookies.set({
        name: SESSION_COOKIE,
        value: createSessionToken(user),
        httpOnly: true,
        maxAge: SESSION_MAX_AGE_SECONDS,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      });
      return response;
    }

    const invite = await consumeInvite(code);
    if (!invite) {
      return NextResponse.json(
        { error: "Invalid or expired invite code." },
        { status: 400 },
      );
    }

    const baseUser = {
      id: randomUUID(),
      name,
      email: normalizedEmail,
      phone,
      password,
      storeNumber: invite.storeId,
      storeName: invite.storeName,
      storeAddress: invite.storeAddress,
      storeIds: [invite.storeId],
    };

    if (invite.role === "employee") {
      const user = {
        ...baseUser,
        role: "employee" as const,
        employeeCode: await generateEmployeeCode(),
      };
      await addDynamicUser(user);
      await markInviteUsed(invite.id, user.id);
      const response = NextResponse.json({ success: true, user });
      response.cookies.set({
        name: SESSION_COOKIE,
        value: createSessionToken(user),
        httpOnly: true,
        maxAge: SESSION_MAX_AGE_SECONDS,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      });
      return response;
    }

    if (invite.role === "client") {
      const user = {
        ...baseUser,
        role: "client" as const,
      };
      await addDynamicUser(user);
      await markInviteUsed(invite.id, user.id);
      const response = NextResponse.json({ success: true, user });
      response.cookies.set({
        name: SESSION_COOKIE,
        value: createSessionToken(user),
        httpOnly: true,
        maxAge: SESSION_MAX_AGE_SECONDS,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      });
      return response;
    }

    if (invite.role === "surveillance") {
      const user = {
        ...baseUser,
        role: "surveillance" as const,
      };
      await addDynamicUser(user);
      await markInviteUsed(invite.id, user.id);
      const response = NextResponse.json({ success: true, user });
      response.cookies.set({
        name: SESSION_COOKIE,
        value: createSessionToken(user),
        httpOnly: true,
        maxAge: SESSION_MAX_AGE_SECONDS,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      });
      return response;
    }

    return NextResponse.json(
      { error: "Unsupported invite role." },
      { status: 400 },
    );
  } catch (error) {
    console.error("signup error", error);
    return NextResponse.json(
      {
        error:
          "Account creation failed. Please try again or contact your administrator.",
      },
      { status: 500 },
    );
  }
}
