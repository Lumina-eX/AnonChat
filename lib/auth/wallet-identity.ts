import { validateStellarAddress } from "@/lib/auth/validation";

type AuthUserLike = {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
};

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function walletFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const lower = email.toLowerCase();
  const suffix = "@wallet.anonchat.local";
  if (!lower.endsWith(suffix)) return null;

  const candidate = email.slice(0, email.length - suffix.length).toUpperCase();
  return validateStellarAddress(candidate) ? candidate : null;
}

export function getAuthenticatedWalletAddress(user: AuthUserLike | null | undefined): string | null {
  if (!user) return null;

  const metadataWallet = readString(user.user_metadata?.wallet_address);
  if (metadataWallet && validateStellarAddress(metadataWallet)) {
    return metadataWallet;
  }

  const appMetadataWallet = readString(user.app_metadata?.wallet_address);
  if (appMetadataWallet && validateStellarAddress(appMetadataWallet)) {
    return appMetadataWallet;
  }

  return walletFromEmail(user.email);
}

