import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import {
  createManagerInvite,
  deleteManagerInvite,
  listManagerInvites,
  regenerateManagerInvite,
} from "@/lib/userStore";

function authorizeMaster(userPromise: ReturnType<typeof getSessionUser>) {
  return userPromise.then((user) =>
    requireRole(user, ["ironhand"]) && user?.storeNumber === "HQ" ? user : null,
  );
}

export async function GET() {
  const user = await authorizeMaster(getSessionUser());
  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const invites = await listManagerInvites();
  return NextResponse.json({ invites });
}

export async function POST() {
  const user = await authorizeMaster(getSessionUser());
  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const invite = await createManagerInvite(user.id);
  return NextResponse.json({ invite });
}

export async function DELETE(request: Request) {
  const user = await authorizeMaster(getSessionUser());
  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const id = body?.id as string | undefined;
  if (!id) {
    return NextResponse.json({ error: "Invite id required" }, { status: 400 });
  }
  const success = await deleteManagerInvite(id);
  if (!success) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}

export async function PATCH(request: Request) {
  const user = await authorizeMaster(getSessionUser());
  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const id = body?.id as string | undefined;
  if (!id) {
    return NextResponse.json({ error: "Invite id required" }, { status: 400 });
  }
  const invite = await regenerateManagerInvite(id);
  if (!invite) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }
  return NextResponse.json({ invite });
}
