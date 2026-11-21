import { type SupabaseClient } from "@supabase/supabase-js";
import { memoMatchesGroup, validateMemoGroupId } from "./memo";

export interface GroupMemoMapping {
  groupId: string;
  memoGroupId: string;
  txHash: string;
}

export interface GroupMemoValidationResult {
  valid: boolean;
  reason?: string;
}

export async function persistGroupTransactionMemo(
  supabase: SupabaseClient,
  mapping: GroupMemoMapping,
): Promise<{ error: Error | null }> {
  const validation = await validateStoredGroupMemo(
    supabase,
    mapping.groupId,
    mapping.memoGroupId,
  );

  if (!validation.valid) {
    return { error: new Error(validation.reason ?? "Invalid group memo") };
  }

  const { error } = await supabase.from("group_tx_memos").insert({
    group_id: mapping.groupId,
    memo_group_id: mapping.memoGroupId,
    tx_hash: mapping.txHash,
  });

  return { error: error ? new Error(error.message) : null };
}

export async function validateStoredGroupMemo(
  supabase: SupabaseClient,
  groupId: string,
  memoGroupId: string,
): Promise<GroupMemoValidationResult> {
  const validation = validateMemoGroupId(memoGroupId);
  if (!validation.valid) {
    return validation;
  }

  if (!memoMatchesGroup(groupId, memoGroupId)) {
    return { valid: false, reason: "memo does not match group ID" };
  }

  const { data: room, error } = await supabase
    .from("rooms")
    .select("id")
    .eq("id", groupId)
    .maybeSingle();

  if (error) {
    return { valid: false, reason: "failed to validate group record" };
  }

  if (!room) {
    return { valid: false, reason: "group does not exist" };
  }

  return { valid: true };
}
