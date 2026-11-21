import { createClient } from "@/lib/supabase/server";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: groupId } = await params;

  if (!groupId) {
    return NextResponse.json({ error: "Group ID is required" }, { status: 400 });
  }

  try {
    const supabase = await createClient();

    // 1. Authenticate user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error("[chat-export] auth error:", authError);
      return NextResponse.json(
        { error: "Unauthorized. You must be logged in to export chat history." },
        { status: 401 },
      );
    }

    // 2. Check room membership (only members can export)
    const { data: membership, error: memberErr } = await supabase
      .from("room_members")
      .select("id, removed_at")
      .eq("room_id", groupId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (memberErr) {
      console.error("[chat-export] membership check error:", memberErr);
      return NextResponse.json(
        { error: "Failed to verify group membership" },
        { status: 500 },
      );
    }

    if (!membership) {
      return NextResponse.json(
        { error: "Forbidden. You are not a member of this group." },
        { status: 403 },
      );
    }

    if (membership.removed_at) {
      return NextResponse.json(
        { error: "Forbidden. You have been removed from this group." },
        { status: 403 },
      );
    }

    // 3. Fetch room metadata (for naming the export file)
    const { data: room, error: roomErr } = await supabase
      .from("rooms")
      .select("name")
      .eq("id", groupId)
      .maybeSingle();

    if (roomErr) {
      console.error("[chat-export] room lookup error:", roomErr);
      return NextResponse.json(
        { error: "Failed to retrieve group details" },
        { status: 500 },
      );
    }

    const groupName = room?.name || "chat-history";
    const format = request.nextUrl.searchParams.get("format") === "txt" ? "txt" : "json";
    const filename = `${groupName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-export.${format}`;

    const encoder = new TextEncoder();
    const BATCH_SIZE = 1000;

    // 4. Create readable stream for efficient memory scaling with large history
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let offset = 0;
          let hasMore = true;
          let isFirst = true;

          if (format === "json") {
            controller.enqueue(encoder.encode("[\n"));
          }

          while (hasMore) {
            const { data: messages, error: fetchErr } = await supabase
              .from("messages")
              .select("*, profiles(display_name)")
              .eq("room_id", groupId)
              .order("created_at", { ascending: true })
              .range(offset, offset + BATCH_SIZE - 1);

            if (fetchErr) {
              console.error("[chat-export] message fetch error:", fetchErr);
              throw fetchErr;
            }

            if (!messages || messages.length === 0) {
              hasMore = false;
              break;
            }

            for (const msg of messages) {
              if (format === "json") {
                if (!isFirst) {
                  controller.enqueue(encoder.encode(",\n"));
                }
                const exportMsg = {
                  id: msg.id,
                  content: msg.content,
                  created_at: msg.created_at,
                  sender: msg.profiles?.display_name || msg.user_id,
                  is_encrypted: msg.is_encrypted,
                  edited_at: msg.edited_at,
                };
                controller.enqueue(encoder.encode(JSON.stringify(exportMsg)));
                isFirst = false;
              } else {
                const dateStr = new Date(msg.created_at).toISOString().replace("T", " ").substring(0, 19);
                const senderName = msg.profiles?.display_name || msg.user_id;
                const txtLine = `[${dateStr}] ${senderName}: ${msg.content}\n`;
                controller.enqueue(encoder.encode(txtLine));
              }
            }

            if (messages.length < BATCH_SIZE) {
              hasMore = false;
            } else {
              offset += BATCH_SIZE;
            }
          }

          if (format === "json") {
            controller.enqueue(encoder.encode("\n]"));
          }

          controller.close();
        } catch (err) {
          console.error("[chat-export] stream generation error:", err);
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": format === "json" ? "application/json" : "text/plain",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (error) {
    console.error(`[chat-export] GET /api/groups/${groupId}/export unexpected error:`, error);
    return NextResponse.json({ error: "Failed to export chat history" }, { status: 500 });
  }
}
