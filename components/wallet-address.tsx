import { cn, shortenWalletAddress } from "@/lib/utils"

type WalletAddressProps = {
  address?: string | null
  label?: string
  className?: string
  addressClassName?: string
  startChars?: number
  endChars?: number
  fallback?: string
}

export function WalletAddress({
  address,
  label = "Wallet address",
  className,
  addressClassName,
  startChars = 4,
  endChars = 4,
  fallback = "Unknown wallet",
}: WalletAddressProps) {
  if (!address) {
    return (
      <span className={cn("text-sm text-muted-foreground", className)}>
        {fallback}
      </span>
    )
  }

  return (
    <span className={cn("inline-flex min-w-0 items-center", className)}>
      <span
        className={cn("block max-w-full truncate font-mono text-sm", addressClassName)}
        title={address}
        aria-label={`${label}: ${address}`}
      >
        {shortenWalletAddress(address, startChars, endChars)}
      </span>
    </span>
  )
}
