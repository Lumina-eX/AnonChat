import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  consumeNonce,
  generateNonce,
  verifyWalletSignature,
} from "@/lib/auth/stellar-verify";
import { validateWalletAddressWithMessage } from "@/lib/auth/validation";
import { getAuthenticatedWalletAddress } from "@/lib/auth/wallet-identity";
import {
  buildRoomUpdateMessage,
  normalizeDescription,
  type RoomUpdateFields,
} from "@/lib/rooms/ownership";

type UpdateRoomBody = {
  name?: string;
  description?: string | null;
  is_private?: boolean;
  walletAddress?: string;
  nonce?: string;
  signature?: string;
};

type OwnershipChallengeBody = RoomUpdateFields;

function normalizeWallet(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? null;
}

async function loadOwnedRoom(
  roomId: string,
  sessionWallet: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  const { data: room, error } = await supabase
    .from("rooms")
    .select("id, owner_wallet")
    .eq("id", roomId)
    .maybeSingle();

  if (error) throw error;
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const normalizedOwnerWallet = normalizeWallet(room.owner_wallet);
  if (!normalizedOwnerWallet) {
    return NextResponse.json(
      { error: "Room ownership is not initialized for this group" },
      { status: 409 },
    );
  }

  if (normalizedOwnerWallet !== sessionWallet) {
    return NextResponse.json(
      { error: "Only the group owner wallet can update this room" },
      { status: 403 },
    );
  }

  return { room, normalizedOwnerWallet };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sessionWallet = normalizeWallet(getAuthenticatedWalletAddress(user));
    if (!sessionWallet) {
      return NextResponse.json(
        { error: "Authenticated wallet is required" },
        { status: 403 },
      );
    }

    const { roomId } = await params;
    const body = (await request.json().catch(() => ({}))) as OwnershipChallengeBody;

    const nextName = typeof body.name === "string" ? body.name.trim() : undefined;
    const nextDescription = normalizeDescription(body.description);
    const nextIsPrivate =
      typeof body.is_private === "boolean" ? body.is_private : undefined;

    const hasAnyUpdate =
      nextName !== undefined ||
      nextDescription !== undefined ||
      nextIsPrivate !== undefined;

    if (!hasAnyUpdate) {
      return NextResponse.json(
        { error: "At least one field (name, description, is_private) is required" },
        { status: 400 },
      );
    }

    if (nextName !== undefined && nextName.length === 0) {
      return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    }

    const ownedRoomResult = await loadOwnedRoom(roomId, sessionWallet, supabase);
    if (ownedRoomResult instanceof NextResponse) {
      return ownedRoomResult;
    }

    const nonce = generateNonce(sessionWallet);
    const message = buildRoomUpdateMessage({
      nonce,
      roomId,
      name: nextName,
      description: nextDescription,
      is_private: nextIsPrivate,
    });

    return NextResponse.json(
      {
        walletAddress: sessionWallet,
        nonce,
        message,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[rooms] POST /api/rooms/[roomId] ownership challenge error:", error);
    return NextResponse.json(
      { error: "Failed to prepare ownership challenge" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { roomId } = await params;
    const body = (await request.json().catch(() => ({}))) as UpdateRoomBody;

    const nextName =
      typeof body.name === "string" ? body.name.trim() : undefined;
    const nextDescription = normalizeDescription(body.description);
    const nextIsPrivate =
      typeof body.is_private === "boolean" ? body.is_private : undefined;

    const hasAnyUpdate =
      nextName !== undefined ||
      nextDescription !== undefined ||
      nextIsPrivate !== undefined;

    if (!hasAnyUpdate) {
      return NextResponse.json(
        { error: "At least one field (name, description, is_private) is required" },
        { status: 400 },
      );
    }

    if (nextName !== undefined && nextName.length === 0) {
      return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    }

    const walletAddress = body.walletAddress?.trim();
    const nonce = body.nonce?.trim();
    const signature = body.signature?.trim();

    const walletValidationError = validateWalletAddressWithMessage(walletAddress || "");
    if (walletValidationError) {
      return NextResponse.json({ error: walletValidationError }, { status: 400 });
    }

    if (!nonce) {
      return NextResponse.json({ error: "nonce is required" }, { status: 400 });
    }

    if (!signature) {
      return NextResponse.json({ error: "signature is required" }, { status: 400 });
    }

    const ownerWallet = normalizeWallet(walletAddress);
    if (!ownerWallet) {
      return NextResponse.json(
        { error: "Invalid Stellar wallet address" },
        { status: 400 },
      );
    }

    const sessionWallet = normalizeWallet(getAuthenticatedWalletAddress(user));
    if (!sessionWallet || sessionWallet !== ownerWallet) {
      return NextResponse.json(
        { error: "Authenticated wallet does not match request wallet" },
        { status: 403 },
      );
    }

    const ownedRoomResult = await loadOwnedRoom(roomId, sessionWallet, supabase);
    if (ownedRoomResult instanceof NextResponse) {
      return ownedRoomResult;
    }

    const expectedNonce = consumeNonce(ownerWallet);
    if (!expectedNonce || expectedNonce !== nonce) {
      return NextResponse.json(
        { error: "Nonce not found, expired, or mismatched" },
        { status: 401 },
      );
    }

    const verificationMessage = buildRoomUpdateMessage({
      nonce,
      roomId,
      name: nextName,
      description: nextDescription,
      is_private: nextIsPrivate,
    });

    const isValid = verifyWalletSignature(
      ownerWallet,
      verificationMessage,
      signature,
    );

    if (!isValid) {
      return NextResponse.json(
        { error: "Ownership validation failed: invalid wallet signature" },
        { status: 403 },
      );
    }

    const updates: Record<string, unknown> = {};
    if (nextName !== undefined) updates.name = nextName;
    if (nextDescription !== undefined) updates.description = nextDescription;
    if (nextIsPrivate !== undefined) updates.is_private = nextIsPrivate;

    const { data: updatedRoom, error: updateError } = await supabase
      .from("rooms")
      .update(updates)
      .eq("id", roomId)
      .select("*")
      .single();

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({ room: updatedRoom, success: true }, { status: 200 });
  } catch (error) {
    console.error("[rooms] PATCH /api/rooms/[roomId] error:", error);
    return NextResponse.json(
      { error: "Failed to update room" },
      { status: 500 },
    );
  }
}
