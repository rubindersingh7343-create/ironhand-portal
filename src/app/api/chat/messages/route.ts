"use server";

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  findDynamicUserById,
  getClientStoreIds,
  getOwnerIdsForStore,
  getStoreManagerId,
  getSurveillanceManagerId,
} from "@/lib/userStore";
import type { ChatType } from "@/lib/types";

const allowedTypes: ChatType[] = ["manager", "surveillance", "owner"];

const resolveOwnerId = async (
  user: { id: string; role: string; storeNumber?: string },
  ownerIdParam?: string | null,
  storeId?: string,
) => {
  if (user.role === "client") return user.id;
  if (user.role === "employee") {
    if (!storeId) return null;
    const ownerIds = await getOwnerIdsForStore(storeId);
    return ownerIds[0] ?? null;
  }
  return ownerIdParam ?? null;
};

const resolveParticipantId = async (storeId: string, type: ChatType) => {
  if (type === "manager") {
    return await getStoreManagerId(storeId);
  }
  if (type === "owner") {
    return null;
  }
  return await getSurveillanceManagerId(storeId);
};

const ensureOwnerAccess = async (
  ownerId: string,
  storeId: string,
): Promise<boolean> => {
  const storeIds = await getClientStoreIds(ownerId);
  return storeIds.includes(storeId);
};

const ensureParticipantAccess = async (
  user: { id: string; role: string; storeNumber?: string },
  storeId: string,
  type: ChatType,
) => {
  if (user.role === "ironhand") {
    const managerId = await getStoreManagerId(storeId);
    return managerId === user.id;
  }
  if (user.role === "surveillance") {
    const surveillanceId = await getSurveillanceManagerId(storeId);
    return surveillanceId === user.id;
  }
  if (user.role === "employee") {
    return user.storeNumber === storeId;
  }
  return false;
};

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("storeId") ?? "";
  const typeParam = searchParams.get("type") ?? "";
  const ownerIdParam = searchParams.get("ownerId");

  if (!storeId || !allowedTypes.includes(typeParam as ChatType)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const ownerId = await resolveOwnerId(user, ownerIdParam, storeId);
  if (!ownerId) {
    return NextResponse.json({ error: "Owner required." }, { status: 400 });
  }

  if (user.role === "client") {
    const storeIds = user.storeIds ?? (user.storeNumber ? [user.storeNumber] : []);
    if (!storeIds.includes(storeId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else {
    const allowed = await ensureParticipantAccess(user, storeId, typeParam as ChatType);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  if (user.role !== "client") {
    const ownerHasStore = await ensureOwnerAccess(ownerId, storeId);
    if (!ownerHasStore) {
      return NextResponse.json({ error: "Owner not linked." }, { status: 403 });
    }
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase unavailable." }, { status: 500 });
  }

  const chatType = typeParam as ChatType;
  const participantId = await resolveParticipantId(storeId, chatType);
  if (!participantId && chatType !== "owner") {
    return NextResponse.json({ error: "Participant not assigned." }, { status: 404 });
  }

  const { data: existingThread, error: threadError } = await supabase
    .from("store_chats")
    .select("*")
    .eq("store_id", storeId)
    .eq("chat_type", chatType)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (threadError) {
    console.error("store_chats fetch error", threadError);
    return NextResponse.json({ error: "Unable to load chat." }, { status: 500 });
  }

  let thread = existingThread;
  if (!thread) {
    const { data: inserted, error: insertError } = await supabase
      .from("store_chats")
    .insert({
      store_id: storeId,
      chat_type: chatType,
      owner_id: ownerId,
      participant_id: participantId ?? null,
    })
    .select("*")
    .single();
    if (insertError) {
      console.error("store_chats insert error", insertError);
      return NextResponse.json({ error: "Unable to start chat." }, { status: 500 });
    }
    thread = inserted;
  } else if (thread.participant_id !== participantId) {
    const { error: updateError } = await supabase
      .from("store_chats")
      .update({ participant_id: participantId ?? null })
      .eq("id", thread.id);
    if (updateError) {
      console.error("store_chats update error", updateError);
    }
  }

  const { data: messages, error: messageError } = await supabase
    .from("store_chat_messages")
    .select("*")
    .eq("thread_id", thread.id)
    .order("created_at", { ascending: true })
    .limit(200);

  if (messageError) {
    console.error("store_chat_messages query error", messageError);
    return NextResponse.json({ error: "Unable to load messages." }, { status: 500 });
  }

  const participant =
    chatType === "owner"
      ? await findDynamicUserById(ownerId)
      : participantId
        ? await findDynamicUserById(participantId)
        : null;

  return NextResponse.json({
    threadId: thread.id,
    participantName: participant?.name ?? "Assigned User",
    messages: (messages ?? []).map((msg: any) => ({
      id: msg.id,
      threadId: msg.thread_id,
      storeId: msg.store_id,
      chatType: msg.chat_type,
      ownerId: msg.owner_id,
      senderId: msg.sender_id,
      senderRole: msg.sender_role,
      senderName: msg.sender_name,
      message: msg.message,
      createdAt: msg.created_at,
    })),
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as
    | { storeId?: string; type?: string; message?: string; ownerId?: string }
    | null;
  const storeId = payload?.storeId ?? "";
  const typeParam = payload?.type ?? "";
  const content = (payload?.message ?? "").trim();

  if (!storeId || !allowedTypes.includes(typeParam as ChatType) || !content) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const ownerId = await resolveOwnerId(user, payload?.ownerId ?? null, storeId);
  if (!ownerId) {
    return NextResponse.json({ error: "Owner required." }, { status: 400 });
  }

  if (user.role === "client") {
    const storeIds = user.storeIds ?? (user.storeNumber ? [user.storeNumber] : []);
    if (!storeIds.includes(storeId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else {
    const allowed = await ensureParticipantAccess(user, storeId, typeParam as ChatType);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  if (user.role !== "client") {
    const ownerHasStore = await ensureOwnerAccess(ownerId, storeId);
    if (!ownerHasStore) {
      return NextResponse.json({ error: "Owner not linked." }, { status: 403 });
    }
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase unavailable." }, { status: 500 });
  }

  const chatType = typeParam as ChatType;
  const participantId = await resolveParticipantId(storeId, chatType);
  if (!participantId && chatType !== "owner") {
    return NextResponse.json({ error: "Participant not assigned." }, { status: 404 });
  }

  const { data: thread, error: threadError } = await supabase
    .from("store_chats")
    .select("*")
    .eq("store_id", storeId)
    .eq("chat_type", chatType)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (threadError) {
    console.error("store_chats fetch error", threadError);
    return NextResponse.json({ error: "Unable to open chat." }, { status: 500 });
  }

  let threadId = thread?.id;
  if (!threadId) {
    const { data: created, error: createError } = await supabase
      .from("store_chats")
      .insert({
        store_id: storeId,
        chat_type: chatType,
        owner_id: ownerId,
        participant_id: participantId ?? null,
      })
      .select("*")
      .single();
    if (createError) {
      console.error("store_chats insert error", createError);
      return NextResponse.json({ error: "Unable to open chat." }, { status: 500 });
    }
    threadId = created.id;
  }

  const senderRole =
    user.role === "client"
      ? "owner"
      : user.role === "ironhand"
        ? "manager"
        : user.role === "surveillance"
          ? "surveillance"
          : "employee";

  const { data: inserted, error: insertError } = await supabase
    .from("store_chat_messages")
    .insert({
      thread_id: threadId,
      store_id: storeId,
      chat_type: chatType,
      owner_id: ownerId,
      sender_id: user.id,
      sender_role: senderRole,
      sender_name: user.name ?? "User",
      message: content,
    })
    .select("*")
    .single();

  if (insertError) {
    console.error("store_chat_messages insert error", insertError);
    return NextResponse.json({ error: "Unable to send message." }, { status: 500 });
  }

  return NextResponse.json({
    message: {
      id: inserted.id,
      threadId: inserted.thread_id,
      storeId: inserted.store_id,
      chatType: inserted.chat_type,
      ownerId: inserted.owner_id,
      senderId: inserted.sender_id,
      senderRole: inserted.sender_role,
      senderName: inserted.sender_name,
      message: inserted.message,
      createdAt: inserted.created_at,
    },
  });
}
