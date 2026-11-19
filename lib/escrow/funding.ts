import type {
  EscrowFundingBreakdown,
  EscrowFundingTransactionStatus,
  EscrowFundingValidationResult,
  EscrowToken,
} from "@/types/escrow";

const DEFAULT_DECIMALS = 7;
const AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function getDecimals(token?: Pick<EscrowToken, "decimals"> | null): number {
  const decimals = token?.decimals;
  if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    return DEFAULT_DECIMALS;
  }
  return decimals;
}

function pow10(decimals: number): bigint {
  return BigInt(10) ** BigInt(decimals);
}

function normalizeAmountString(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "0";
  if (trimmed.startsWith(".")) return `0${trimmed}`;
  return trimmed;
}

export function parseAmountToUnits(
  amount: string | number | null | undefined,
  decimals = DEFAULT_DECIMALS,
): bigint | null {
  if (amount === null || amount === undefined) return null;
  const raw = typeof amount === "number" ? String(amount) : amount;
  const normalized = normalizeAmountString(raw);
  if (!AMOUNT_PATTERN.test(normalized)) return null;

  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) return null;

  const paddedFraction = (fraction + "0".repeat(decimals)).slice(0, decimals);
  try {
    return BigInt(whole) * pow10(decimals) + BigInt(paddedFraction || "0");
  } catch {
    return null;
  }
}

export function unitsToAmountString(units: bigint, decimals = DEFAULT_DECIMALS): string {
  const sign = units < BigInt(0) ? "-" : "";
  const abs = units < BigInt(0) ? -units : units;
  const base = pow10(decimals);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, "0");
  if (decimals === 0) return `${sign}${whole.toString()}`;
  return `${sign}${whole.toString()}.${fraction}`;
}

export function formatTokenAmount(
  amount: string | number | bigint | null | undefined,
  token?: EscrowToken | null,
  options?: { minimumFractionDigits?: number; maximumFractionDigits?: number },
): string {
  const decimals = getDecimals(token);
  let units: bigint | null = null;

  if (typeof amount === "bigint") {
    units = amount;
  } else {
    units = parseAmountToUnits(amount as string | number, decimals);
  }

  if (units === null) return "—";

  const fixed = unitsToAmountString(units, decimals);
  const [whole, fraction = ""] = fixed.split(".");
  const minFrac = Math.max(0, Math.min(options?.minimumFractionDigits ?? 2, decimals));
  const maxFrac = Math.max(minFrac, Math.min(options?.maximumFractionDigits ?? decimals, decimals));
  let trimmedFraction = fraction.slice(0, maxFrac).replace(/0+$/, "");
  if (trimmedFraction.length < minFrac) {
    trimmedFraction = (trimmedFraction + "0".repeat(minFrac)).slice(0, minFrac);
  }

  const formattedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const display = trimmedFraction.length > 0 ? `${formattedWhole}.${trimmedFraction}` : formattedWhole;
  return token?.code ? `${display} ${token.code}` : display;
}

export function formatFeeAmount(
  fee: string | number | null | undefined,
  token?: EscrowToken | null,
): string {
  const feeToken = token ?? { code: "XLM", decimals: 7 };
  return formatTokenAmount(fee, feeToken, {
    minimumFractionDigits: 2,
    maximumFractionDigits: getDecimals(feeToken),
  });
}

export function sumAmountsToUnits(
  amounts: Array<string | number | null | undefined>,
  decimals = DEFAULT_DECIMALS,
): bigint | null {
  let total = BigInt(0);
  for (const amount of amounts) {
    const units = parseAmountToUnits(amount, decimals);
    if (units === null) return null;
    total += units;
  }
  return total;
}

export function calculateRemainingAmount(
  totalContractValue: string,
  fundedAmount: string,
  decimals = DEFAULT_DECIMALS,
): string | null {
  const totalUnits = parseAmountToUnits(totalContractValue, decimals);
  const fundedUnits = parseAmountToUnits(fundedAmount, decimals);
  if (totalUnits === null || fundedUnits === null) return null;
  const remaining = totalUnits - fundedUnits;
  if (remaining < BigInt(0)) return unitsToAmountString(BigInt(0), decimals);
  return unitsToAmountString(remaining, decimals);
}

export function validateEscrowFundingBreakdown(
  breakdown: EscrowFundingBreakdown,
): EscrowFundingValidationResult {
  const decimals = getDecimals(breakdown.token);
  const errors: string[] = [];

  const totalUnits = parseAmountToUnits(breakdown.totalContractValue, decimals);
  const fundedUnits = parseAmountToUnits(breakdown.fundedAmount, decimals);
  const feeUnits = parseAmountToUnits(breakdown.estimatedTransactionFee, decimals);
  const milestoneUnits = breakdown.milestones.map((m) => parseAmountToUnits(m.amount, decimals));

  const amountsAreValid =
    totalUnits !== null &&
    fundedUnits !== null &&
    feeUnits !== null &&
    milestoneUnits.every((u): u is bigint => u !== null);

  if (totalUnits === null) {
    errors.push("Total contract value is invalid.");
  } else if (totalUnits <= BigInt(0)) {
    errors.push("Total contract value must be greater than zero.");
  }

  if (fundedUnits === null) {
    errors.push("Funded amount is invalid.");
  } else if (fundedUnits < BigInt(0)) {
    errors.push("Funded amount cannot be negative.");
  }

  if (feeUnits === null) {
    errors.push("Estimated transaction fee is invalid.");
  } else if (feeUnits < BigInt(0)) {
    errors.push("Estimated transaction fee cannot be negative.");
  }

  const hasMilestones = breakdown.milestones.length > 0;
  if (!hasMilestones) {
    errors.push("At least one milestone allocation is required.");
  }

  breakdown.milestones.forEach((milestone, index) => {
    const units = milestoneUnits[index];
    const label = milestone.label?.trim() || `Milestone ${index + 1}`;
    if (!milestone.id?.trim()) {
      errors.push(`${label} is missing an identifier.`);
    }
    if (!milestone.label?.trim()) {
      errors.push(`Milestone ${index + 1} must have a label.`);
    }
    if (units === null) {
      errors.push(`${label} has an invalid amount.`);
    } else if (units <= BigInt(0)) {
      errors.push(`${label} amount must be greater than zero.`);
    }
  });

  let allocatedUnits = BigInt(0);
  let allocationMatchesTotal = false;
  if (hasMilestones && milestoneUnits.every((u): u is bigint => u !== null)) {
    allocatedUnits = milestoneUnits.reduce((sum, u) => sum + u, BigInt(0));
    if (totalUnits !== null) {
      allocationMatchesTotal = allocatedUnits === totalUnits;
      if (!allocationMatchesTotal) {
        errors.push("Milestone allocations must equal the total contract value.");
      }
    }
  } else if (milestoneUnits.some((u) => u !== null)) {
    allocatedUnits = milestoneUnits
      .filter((u): u is bigint => u !== null)
      .reduce((sum, u) => sum + u, BigInt(0));
  }

  if (totalUnits !== null && fundedUnits !== null && fundedUnits > totalUnits) {
    errors.push("Funded amount cannot exceed the total contract value.");
  }

  const remainingUnits =
    totalUnits !== null && fundedUnits !== null
      ? totalUnits - fundedUnits < BigInt(0)
        ? BigInt(0)
        : totalUnits - fundedUnits
      : BigInt(0);

  const isValid =
    errors.length === 0 &&
    amountsAreValid &&
    hasMilestones &&
    allocationMatchesTotal &&
    totalUnits !== null &&
    fundedUnits !== null &&
    feeUnits !== null &&
    totalUnits > BigInt(0) &&
    fundedUnits <= totalUnits;

  return {
    isValid,
    errors,
    totalAllocated: unitsToAmountString(allocatedUnits, decimals),
    remainingAmount: unitsToAmountString(remainingUnits, decimals),
    allocationMatchesTotal,
    hasMilestones,
    amountsAreValid,
  };
}

export function getFundingProgressPercent(
  totalContractValue: string,
  fundedAmount: string,
  decimals = DEFAULT_DECIMALS,
): number {
  const totalUnits = parseAmountToUnits(totalContractValue, decimals);
  const fundedUnits = parseAmountToUnits(fundedAmount, decimals);
  if (!totalUnits || totalUnits <= BigInt(0) || !fundedUnits || fundedUnits <= BigInt(0)) return 0;
  if (fundedUnits >= totalUnits) return 100;
  const scaled = (fundedUnits * BigInt(1000)) / totalUnits;
  return Math.max(0, Math.min(100, Number(scaled) / 10));
}

export function canSubmitFunding(
  breakdown: EscrowFundingBreakdown,
  status: EscrowFundingTransactionStatus,
  hasReviewed: boolean,
): { allowed: boolean; reason?: string } {
  if (status === "pending") {
    return { allowed: false, reason: "A transaction is already pending confirmation." };
  }
  if (status === "confirmed") {
    return { allowed: false, reason: "Funding has already been confirmed on-chain." };
  }

  const validation = validateEscrowFundingBreakdown(breakdown);
  if (!validation.isValid) {
    return { allowed: false, reason: validation.errors[0] ?? "Funding details are invalid." };
  }

  const decimals = getDecimals(breakdown.token);
  const remainingUnits = parseAmountToUnits(validation.remainingAmount, decimals);
  if (remainingUnits !== null && remainingUnits <= BigInt(0)) {
    return { allowed: false, reason: "There is no remaining amount to fund." };
  }

  if (!hasReviewed) {
    return { allowed: false, reason: "Please review and confirm the funding details before submitting." };
  }

  return { allowed: true };
}

export function getNetworkDisplayName(network: EscrowFundingBreakdown["network"]): string {
  return network === "mainnet" ? "Stellar Mainnet" : "Stellar Testnet";
}

export function normalizeFundingStatus(
  status: string | null | undefined,
): EscrowFundingTransactionStatus {
  if (status === "pending" || status === "confirmed" || status === "failed" || status === "cancelled") {
    return status;
  }
  return "idle";
}
