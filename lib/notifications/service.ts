import type { SupabaseClient } from "@supabase/supabase-js";
import { pushNotificationRealtime } from "@/lib/notifications/dispatch";
import type {
  CreateNotificationInput,
  NotificationRecord,
} from "@/types/notifications";

export interface CreateNotificationResult {
  notification: NotificationRecord | null;
  delivered: boolean;
  deliveryError: string | null;
}

export async function createNotification(
  supabase: SupabaseClient,
  input: CreateNotificationInput,
): Promise<CreateNotificationResult> {
  const { data, error } = await supabase
    .from("notifications")
    .insert({
      user_id: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      group_id: input.groupId ?? null,
      metadata: input.metadata ?? {},
      delivery_status: "pending",
    })
    .select("*")
    .single();

  if (error || !data) {
    console.error("[notifications] failed to persist notification:", error);
    return {
      notification: null,
      delivered: false,
      deliveryError: error?.message ?? "Failed to store notification",
    };
  }

  const notification = data as NotificationRecord;
  const dispatch = await pushNotificationRealtime(input.userId, notification);

  const { error: updateError } = await supabase
    .from("notifications")
    .update({
      delivery_status: dispatch.delivered ? "delivered" : "failed",
      delivery_error: dispatch.error,
    })
    .eq("id", notification.id);

  if (updateError) {
    console.warn(
      "[notifications] failed to update delivery status:",
      updateError.message,
    );
  }

  return {
    notification: {
      ...notification,
      delivery_status: dispatch.delivered ? "delivered" : "failed",
      delivery_error: dispatch.error,
    },
    delivered: dispatch.delivered,
    deliveryError: dispatch.error,
  };
}

export async function notifyGroupAdded(
  supabase: SupabaseClient,
  userId: string,
  groupId: string,
  groupName: string,
): Promise<CreateNotificationResult> {
  return createNotification(supabase, {
    userId,
    type: "group_added",
    title: "Added to group",
    body: `You were added to "${groupName}".`,
    groupId,
    metadata: { groupName },
  });
}

export async function notifyOwnershipTransferred(
  supabase: SupabaseClient,
  params: {
    userId: string;
    groupId: string;
    groupName: string;
    role: "new_owner" | "previous_owner";
    counterpartyWallet?: string | null;
  },
): Promise<CreateNotificationResult> {
  const isNewOwner = params.role === "new_owner";

  return createNotification(supabase, {
    userId: params.userId,
    type: "ownership_transferred",
    title: isNewOwner ? "You now own a group" : "Ownership transferred",
    body: isNewOwner
      ? `You are now the owner of "${params.groupName}".`
      : `Ownership of "${params.groupName}" was transferred${
          params.counterpartyWallet
            ? ` to ${params.counterpartyWallet.slice(0, 8)}…`
            : ""
        }.`,
    groupId: params.groupId,
    metadata: {
      groupName: params.groupName,
      role: params.role,
      counterpartyWallet: params.counterpartyWallet ?? null,
    },
  });
}

export async function notifyMemberRemoved(
  supabase: SupabaseClient,
  userId: string,
  groupId: string,
  groupName: string,
): Promise<CreateNotificationResult> {
  return createNotification(supabase, {
    userId,
    type: "group_removed",
    title: "Removed from group",
    body: `You were removed from "${groupName}".`,
    groupId,
    metadata: { groupName },
  });
}

export function parsePagination(
  searchParams: URLSearchParams,
): { limit: number; offset: number; unreadOnly: boolean } {
  const limit = Math.min(
    Math.max(parseInt(searchParams.get("limit") || "20", 10) || 20, 1),
    100,
  );
  const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10) || 0, 0);
  const unreadOnly = searchParams.get("unread_only") === "true";

  return { limit, offset, unreadOnly };
}
