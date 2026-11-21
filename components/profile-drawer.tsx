"use client"

import { Drawer } from "vaul"
import { WalletAddress } from "./wallet-address"
import { createClient } from "@/lib/supabase/client"
import { useState, useEffect, type ReactNode } from "react"
import {
  Calendar,
  Users,
  LogOut,
  Copy,
  Check,
  Activity,
} from "lucide-react"
import { StellarTransactionHistoryDialog } from "./stellar-transaction-history-dialog"

type ProfileDrawerProps = {
  publicKey: string
  children: ReactNode
  onDisconnect: () => Promise<void>
}

export function ProfileDrawer({
  publicKey,
  children,
  onDisconnect,
}: ProfileDrawerProps) {
  const [open, setOpen] = useState(false)
  const [txHistoryOpen, setTxHistoryOpen] = useState(false)
  const [joinDate, setJoinDate] = useState<string | null>(null)
  const [groupsCount, setGroupsCount] = useState<number>(0)
  const [copied, setCopied] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    if (!open) return
    fetchProfile()
    fetchGroupsCount()
  }, [open])

  async function fetchProfile() {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user?.created_at) {
        setJoinDate(user.created_at)
      }
    } catch {
      // silently fail
    }
  }

  async function fetchGroupsCount() {
    try {
      const res = await fetch("/api/rooms")
      const data = await res.json()
      if (data.rooms) {
        setGroupsCount(data.rooms.length)
      }
    } catch {
      // silently fail
    }
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(publicKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDisconnect = async () => {
    setOpen(false)
    await onDisconnect()
  }

  const formattedDate = joinDate
    ? new Date(joinDate).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null

  return (
    <>
      <Drawer.Root open={open} onOpenChange={setOpen}>
        <Drawer.Trigger asChild>{children}</Drawer.Trigger>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/40 z-50" />
          <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 mt-24 flex flex-col rounded-t-2xl border border-border/70 bg-card shadow-xl outline-none">
            <div className="mx-auto w-full max-w-md p-4">
              {/* handle */}
              <div className="mx-auto mb-6 h-1.5 w-12 rounded-full bg-muted-foreground/30" />

              <div className="flex flex-col items-center gap-4 py-4">
                {/* Avatar */}
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-linear-to-br from-primary to-accent text-xl font-bold text-primary-foreground">
                  {publicKey.charAt(0).toUpperCase()}
                </div>

                {/* Wallet Address */}
                <div className="text-center">
                  <WalletAddress
                    address={publicKey}
                    className="max-w-full"
                    addressClassName="text-lg font-semibold"
                  />
                </div>

                {/* Copy button */}
                <button
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3" /> Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" /> Copy full address
                    </>
                  )}
                </button>
              </div>

              <div className="space-y-3 py-4">
                <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-muted/30 p-4">
                  <Calendar className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-sm text-muted-foreground">Joined</p>
                    <p className="text-sm font-medium">
                      {formattedDate ?? "Unknown"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-muted/30 p-4">
                  <Users className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-sm text-muted-foreground">Groups Joined</p>
                    <p className="text-sm font-medium">
                      {groupsCount} {groupsCount === 1 ? "group" : "groups"}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setTxHistoryOpen(true)}
                  className="flex w-full items-center justify-between rounded-xl border border-border/50 bg-muted/30 p-4 text-left transition hover:bg-muted/50"
                >
                  <div className="flex items-center gap-3">
                    <Activity className="h-5 w-5 text-primary shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Transaction History
                      </p>
                      <p className="text-xs text-muted-foreground">
                        View on-chain Stellar transactions
                      </p>
                    </div>
                  </div>
                </button>
              </div>

              <button
                onClick={handleDisconnect}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20"
              >
                <LogOut className="h-4 w-4" />
                Disconnect Wallet
              </button>

              <div className="pb-6" />
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      <StellarTransactionHistoryDialog
        walletAddress={publicKey}
        open={txHistoryOpen}
        onOpenChange={setTxHistoryOpen}
      />
    </>
  )
}
