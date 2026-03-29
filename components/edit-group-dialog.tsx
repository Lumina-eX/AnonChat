"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, Pencil, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { signMessage } from "@/app/stellar-wallet-kit";

type EditableRoom = {
  id: string;
  name: string;
  description?: string | null;
  is_private?: boolean;
};

type EditGroupDialogProps = {
  room: EditableRoom;
  canEdit: boolean;
  onUpdated: (room: EditableRoom) => void;
};

export function EditGroupDialog({
  room,
  canEdit,
  onUpdated,
}: EditGroupDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(room.name);
  const [description, setDescription] = useState(room.description ?? "");
  const [isPrivate, setIsPrivate] = useState(Boolean(room.is_private));
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setName(room.name);
      setDescription(room.description ?? "");
      setIsPrivate(Boolean(room.is_private));
    }
  }, [open, room]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!canEdit) {
      toast.error("Only the owner wallet can update this group.");
      return;
    }

    const trimmedName = name.trim();
    const trimmedDescription = description.trim();

    if (!trimmedName) {
      toast.error("Group name is required.");
      return;
    }

    setIsSubmitting(true);

    try {
      const challengeRes = await fetch(`/api/rooms/${encodeURIComponent(room.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          description: trimmedDescription || null,
          is_private: isPrivate,
        }),
      });

      const challengeData = await challengeRes.json();
      if (!challengeRes.ok) {
        throw new Error(challengeData.error ?? "Failed to prepare ownership check");
      }

      const signature = await signMessage(challengeData.message);
      if (!signature) {
        throw new Error("Wallet signature was not provided");
      }

      const updateRes = await fetch(`/api/rooms/${encodeURIComponent(room.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          description: trimmedDescription || null,
          is_private: isPrivate,
          walletAddress: challengeData.walletAddress,
          nonce: challengeData.nonce,
          signature,
        }),
      });

      const updateData = await updateRes.json();
      if (!updateRes.ok) {
        throw new Error(updateData.error ?? "Failed to update group");
      }

      onUpdated(updateData.room);
      setOpen(false);
      toast.success("Group ownership verified and details updated.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update group.";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          disabled={!canEdit}
          className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          title={
            canEdit
              ? "Edit group details"
              : "Connect with the owner wallet to edit this group"
          }
        >
          <Pencil className="h-4 w-4" />
          Edit Group
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-card p-6 shadow-lg">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-xl font-semibold">
                Update Group
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">
                Changes require a fresh signature from the owner wallet.
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-full p-2 transition hover:bg-muted">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <label htmlFor="group-name" className="text-sm font-medium">
                Group Name
              </label>
              <input
                id="group-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={isSubmitting}
                className="h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="group-description" className="text-sm font-medium">
                Description
              </label>
              <textarea
                id="group-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={isSubmitting}
                rows={4}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>

            <label className="flex items-center gap-3 rounded-lg border p-3 text-sm">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(event) => setIsPrivate(event.target.checked)}
                disabled={isSubmitting}
              />
              Private group
            </label>

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verifying Ownership...
                </>
              ) : (
                "Sign And Update"
              )}
            </button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
