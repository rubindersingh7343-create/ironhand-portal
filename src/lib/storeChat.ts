"use server";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getOwnerIdsForStore, getStoreManagerId } from "@/lib/userStore";

export async function sendStoreSystemMessage(options: {
  storeId: string;
  message: string;
  senderId: string;
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;

  const ownerIds = await getOwnerIdsForStore(options.storeId);
  if (!ownerIds.length) return;

  const managerId = await getStoreManagerId(options.storeId);

  await Promise.all(
    ownerIds.map(async (ownerId) => {
      const { data: thread, error: threadError } = await supabase
        .from("store_chats")
        .select("*")
        .eq("store_id", options.storeId)
        .eq("chat_type", "manager")
        .eq("owner_id", ownerId)
        .maybeSingle();
      if (threadError) {
        console.error("store_chats fetch error", threadError);
        return;
      }
      let threadId = thread?.id;
      if (!threadId) {
        const { data: created, error: createError } = await supabase
          .from("store_chats")
          .insert({
            store_id: options.storeId,
            chat_type: "manager",
            owner_id: ownerId,
            participant_id: managerId ?? null,
          })
          .select("*")
          .single();
        if (createError) {
          console.error("store_chats insert error", createError);
          return;
        }
        threadId = created.id;
      } else if (managerId && thread.participant_id !== managerId) {
        const { error: updateError } = await supabase
          .from("store_chats")
          .update({ participant_id: managerId })
          .eq("id", threadId);
        if (updateError) {
          console.error("store_chats update error", updateError);
        }
      }

      const { error: messageError } = await supabase
        .from("store_chat_messages")
        .insert({
          thread_id: threadId,
          store_id: options.storeId,
          chat_type: "manager",
          owner_id: ownerId,
          sender_id: options.senderId,
          sender_role: "system",
          sender_name: "System",
          message: options.message,
        });
      if (messageError) {
        console.error("store_chat_messages insert error", messageError);
      }
    }),
  );
}
