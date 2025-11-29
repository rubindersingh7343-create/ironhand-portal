import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import {
  createStoreInvites,
  deleteInvite,
  deleteInvitesForStore,
  listInvites,
  regenerateInviteCode,
  listStoresForManager,
} from "@/lib/userStore";

export async function GET() {
  const user = await getSessionUser();
  const authorized = requireRole(user, ["ironhand"]);
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const isMaster = authorized.portal === "master";
  const invites = await listInvites();
  const filtered = isMaster
    ? invites
    : invites.filter((invite) => invite.managerId === authorized.id);

  return NextResponse.json({ invites: filtered });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  const authorized = requireRole(user, ["ironhand"]);
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const { storeName, storeAddress } = (body ?? {}) as {
    storeName?: string;
    storeAddress?: string;
  };

  if (!storeName || !storeAddress) {
    return NextResponse.json(
      { error: "Store name and address are required." },
      { status: 400 },
    );
  }

  const result = await createStoreInvites({
    managerId: authorized.id,
    storeName,
    storeAddress,
  });

  return NextResponse.json({ store: result.store, invites: result.invites });
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  const authorized = requireRole(user, ["ironhand"]);
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const isMaster = authorized.portal === "master";
  const managedStores = isMaster
    ? null
    : (await listStoresForManager(authorized.id)).map((store) => store.storeId);

  const body = await request.json().catch(() => null);
  const { id, storeId } = (body ?? {}) as { id?: string; storeId?: string };

  if (storeId) {
    if (!isMaster && !(managedStores ?? []).includes(storeId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const removed = await deleteInvitesForStore(storeId);
    if (removed === 0) {
      return NextResponse.json({ error: "Store invites not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, removed });
  }

  if (id) {
    if (!isMaster) {
      const invite = (await listInvites()).find((entry) => entry.id === id);
      if (!invite || invite.managerId !== authorized.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    const success = await deleteInvite(id);
    if (!success) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, removed: 1 });
  }

  return NextResponse.json(
    { error: "Invite id or storeId required" },
    { status: 400 },
  );
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  const authorized = requireRole(user, ["ironhand"]);
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const isMaster = authorized.portal === "master";
  const managedStores = isMaster
    ? null
    : (await listStoresForManager(authorized.id)).map((store) => store.storeId);

  const body = await request.json().catch(() => null);
  const { storeId, role } = (body ?? {}) as {
    storeId?: string;
    role?: "client" | "employee";
  };

  if (!storeId || !role) {
    return NextResponse.json(
      { error: "storeId and role are required." },
      { status: 400 },
    );
  }

  if (!isMaster && !(managedStores ?? []).includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const updated = await regenerateInviteCode({ storeId, role });
  if (!updated) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  return NextResponse.json({ invite: updated });
}
