import { NextResponse } from "next/server";
import { getSessionUser, createSessionToken } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/users";
import {
  updateUserAccount,
  deleteClientAccount,
  deleteEmployeeAccount,
  deleteSurveillanceAccount,
  deleteManagerAccount,
  findDynamicUserById,
} from "@/lib/userStore";
import { mockUsers } from "@/lib/users";

function sanitizeInput(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}

export async function PATCH(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const name = sanitizeInput(body.name);
  const email = sanitizeInput(body.email);
  const currentPassword = sanitizeInput(body.currentPassword);
  const newPassword = sanitizeInput(body.newPassword);

  if (!currentPassword) {
    return NextResponse.json(
      { error: "Current password is required." },
      { status: 400 },
    );
  }

  if (!name && !email && !newPassword) {
    return NextResponse.json(
      { error: "Provide at least one field to update." },
      { status: 400 },
    );
  }

  const result = await updateUserAccount({
    userId: sessionUser.id,
    name,
    email,
    newPassword,
    currentPassword,
  });

  if (!result.success) {
    const message =
      result.reason === "invalid_password"
        ? "Incorrect current password."
        : result.reason === "email_in_use"
          ? "Email is already in use."
          : "Unable to update account.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const updatedSession = {
    ...sessionUser,
    name: result.user.name,
    email: result.user.email,
  };

  const response = NextResponse.json({
    success: true,
    user: {
      id: result.user.id,
      name: result.user.name,
      email: result.user.email,
    },
  });

  response.cookies.set(SESSION_COOKIE, createSessionToken(updatedSession), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  return response;
}

export async function DELETE(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const currentPassword = sanitizeInput(body?.currentPassword);
  if (!currentPassword) {
    return NextResponse.json(
      { error: "Current password is required." },
      { status: 400 },
    );
  }

  const dynamicUser = await findDynamicUserById(sessionUser.id);
  const storedUser =
    dynamicUser ??
    mockUsers.find((entry) => entry.id === sessionUser.id) ??
    null;
  if (!storedUser || storedUser.password !== currentPassword) {
    return NextResponse.json(
      { error: "Incorrect current password." },
      { status: 400 },
    );
  }

  let success = false;
  switch (sessionUser.role) {
    case "client":
      success = await deleteClientAccount(sessionUser.id);
      break;
    case "employee":
      success = await deleteEmployeeAccount(sessionUser.id);
      break;
    case "surveillance":
      success = await deleteSurveillanceAccount(sessionUser.id);
      break;
    case "ironhand":
      success = (await deleteManagerAccount(sessionUser.id)).success;
      break;
    default:
      success = false;
  }

  if (!success) {
    return NextResponse.json(
      { error: "Unable to delete this account." },
      { status: 400 },
    );
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
