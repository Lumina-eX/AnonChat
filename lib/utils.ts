import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function shortenWalletAddress(
  address: string,
  startChars = 4,
  endChars = 4,
) {
  const safeStart = Math.max(0, startChars)
  const safeEnd = Math.max(0, endChars)

  if (!address || (!safeStart && !safeEnd)) {
    return address
  }

  if (address.length <= safeStart + safeEnd + 3) {
    return address
  }

  const prefix = safeStart > 0 ? address.slice(0, safeStart) : ""
  const suffix = safeEnd > 0 ? address.slice(-safeEnd) : ""

  return `${prefix}...${suffix}`
}
