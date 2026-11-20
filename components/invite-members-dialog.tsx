"use client"

import * as Dialog from "@radix-ui/react-dialog"
import { Check, Copy, UserPlus, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import toast from "react-hot-toast"
import { cn } from "@/lib/utils"

export type InviteMembersDialogProps = {
  inviteCode: string
  groupName?: string
  triggerClassName?: string
}

export function InviteMembersDialog({
  inviteCode,
  groupName,
  triggerClassName,
}: InviteMembersDialogProps) {
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    }
  }, [])

  const handleCopy = useCallback(async () => {
    const code = inviteCode?.trim()
    if (!code) {
      toast.error("No invite code is available for this group")
      return
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code)
      } else {
        const textarea = document.createElement("textarea")
        textarea.value = code
        textarea.setAttribute("readonly", "")
        textarea.style.position = "fixed"
        textarea.style.opacity = "0"
        document.body.appendChild(textarea)
        textarea.select()
        const didCopy = document.execCommand("copy")
        document.body.removeChild(textarea)
        if (!didCopy) throw new Error("Copy command was unsuccessful")
      }

      setCopied(true)
      toast.success("Invite code copied to clipboard")
      if (resetTimer.current) clearTimeout(resetTimer.current)
      resetTimer.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
      toast.error("Couldn't copy the invite code. Please try again.")
    }
  }, [inviteCode])

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-lg border border-border/80 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            triggerClassName,
          )}
        >
          <UserPlus className="h-3.5 w-3.5 shrink-0" />
          <span>Invite Members</span>
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border/60 bg-[#0f0f16] p-5 shadow-xl sm:p-6 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="hidden shrink-0 rounded-xl bg-primary/15 p-2 text-primary sm:block">
                <UserPlus className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <Dialog.Title className="text-base font-semibold sm:text-lg">
                  Invite Members
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-xs leading-relaxed text-muted-foreground sm:text-sm">
                  Share this invite code with anyone you want to join
                  {groupName ? ` ${groupName}` : " this group"}.
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close invite dialog"
                className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="mt-5 rounded-xl border border-border/60 bg-muted/25 p-3 sm:p-4">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Invite code
            </span>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <code
                aria-label="Invite code"
                className="min-w-0 flex-1 break-all rounded-lg border border-border/60 bg-background/80 px-3 py-2.5 font-mono text-sm tracking-wider sm:text-base"
              >
                {inviteCode || "No invite code available"}
              </code>
              <button
                type="button"
                onClick={handleCopy}
                disabled={!inviteCode?.trim()}
                aria-label="Copy invite code"
                className={cn(
                  "inline-flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium text-primary-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto",
                  copied
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-primary hover:bg-primary/90",
                )}
              >
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {copied ? "Copied!" : "Copy code"}
              </button>
            </div>
          </div>

          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            Ask them to choose{" "}
            <span className="font-medium text-foreground">Join Group</span> in
            AnonChat and enter this code as the invite code.
          </p>

          <div className="mt-5 flex justify-end border-t border-border/60 pt-4">
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg border border-border/80 px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
              >
                Done
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
