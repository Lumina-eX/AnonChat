import { createHash } from "crypto";

export type RoomUpdateFields = {
  name?: string;
  description?: string | null;
  is_private?: boolean;
};

export function normalizeDescription(input: unknown): string | null | undefined {
  if (input === undefined) return undefined;
  if (input === null) return null;
  if (typeof input !== "string") return undefined;
  const trimmed = input.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function buildRoomUpdateMessage(params: {
  nonce: string;
  roomId: string;
  name?: string;
  description?: string | null;
  is_private?: boolean;
}): string {
  const payload = JSON.stringify({
    roomId: params.roomId,
    name: params.name ?? null,
    description: params.description ?? null,
    is_private: params.is_private ?? null,
  });

  const payloadHash = createHash("sha256").update(payload).digest("hex");
  return `anonchat:update-room:${params.roomId}:${params.nonce}:${payloadHash}`;
}
