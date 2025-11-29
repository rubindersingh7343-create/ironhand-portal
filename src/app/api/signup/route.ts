import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import {
  addDynamicUser,
  attachStoreToSurveillance,
  consumeInvite,
  consumeManagerInvite,
  findDynamicUserByEmail,
  generateEmployeeCode,
  markInviteUsed,
  markManagerInviteUsed,
} from "@/lib/userStore";
import { mockUsers, type AppUser } from "@/lib/users";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { name, phone, email, password, code } = body as {
    name?: string;
    phone?: string;
    email?: string;
    password?: string;
    code?: string;
  };

  if (!name || !phone || !email || !password || !code) {
    return NextResponse.json(
      { error: "All fields are required." },
      { status: 400 },
    );
  }

  const normalized = email.trim().toLowerCase();
  const existsInMock = mockUsers.some(
    (user) => user.email.toLowerCase() === normalized,
  );
  const dynamicExisting = await findDynamicUserByEmail(email);
  if (existsInMock || dynamicExisting) {
    return NextResponse.json(
      { error: "An account with this email already exists." },
      { status: 409 },
    );
  }

  const invite = await consumeInvite(code);
  let newUser: AppUser | null = null;

  if (invite) {
    const inviteRole =
      invite.role === "employee"
        ? "employee"
        : invite.role === "surveillance"
          ? "surveillance"
          : "client";
    newUser = {
      id: randomUUID(),
      name,
      email,
      password,
      role: inviteRole,
      storeNumber: invite.storeId,
      phone,
      storeName: invite.storeName,
      storeAddress: invite.storeAddress,
    };
    await addDynamicUser(newUser);
    await markInviteUsed(invite.id, newUser.id);
    if (inviteRole === "surveillance") {
      await attachStoreToSurveillance(newUser.id, code);
    }
  } else {
    const managerInvite = await consumeManagerInvite(code);
    if (!managerInvite) {
      return NextResponse.json(
        { error: "Invalid or expired sign up code." },
        { status: 400 },
      );
    }
    newUser = {
      id: randomUUID(),
      name,
      email,
      password,
      role: "ironhand",
      storeNumber: "",
      storeIds: [],
      phone,
      employeeCode: await generateEmployeeCode(),
    };
    await addDynamicUser(newUser);
    await markManagerInviteUsed(managerInvite.id, newUser.id);
  }

  return NextResponse.json({ success: true });
}
