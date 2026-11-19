export type EscrowFundingTransactionStatus =
  | "idle"
  | "pending"
  | "confirmed"
  | "failed"
  | "cancelled";

export type EscrowNetwork = "testnet" | "mainnet";

export interface EscrowToken {
  /** Token/asset code shown to the user, e.g. XLM, USDC */
  code: string;
  /** Optional issuer for non-native assets */
  issuer?: string | null;
  /** Number of decimal places to use for display/validation (defaults to 7) */
  decimals?: number;
}

export interface EscrowMilestoneAllocation {
  id: string;
  label: string;
  /** Amount allocated to this milestone as a decimal string */
  amount: string;
  /** Optional description or due info */
  description?: string | null;
}

export interface EscrowFundingBreakdown {
  contractId: string;
  contractTitle?: string | null;
  /** Total contract value as a decimal string */
  totalContractValue: string;
  /** Milestone allocations that should sum to the total contract value */
  milestones: EscrowMilestoneAllocation[];
  /** Amount already funded/escrowed as a decimal string */
  fundedAmount: string;
  token: EscrowToken;
  network: EscrowNetwork;
  /** Estimated network/transaction fee as a decimal string, separate from escrow funds */
  estimatedTransactionFee: string;
}

export interface EscrowFundingValidationResult {
  isValid: boolean;
  errors: string[];
  totalAllocated: string;
  remainingAmount: string;
  allocationMatchesTotal: boolean;
  hasMilestones: boolean;
  amountsAreValid: boolean;
}

export interface EscrowFundingTransaction {
  status: EscrowFundingTransactionStatus;
  transactionHash?: string | null;
  ledger?: number | null;
  errorMessage?: string | null;
  /** True when the current failure can be retried */
  retryable?: boolean;
  updatedAt?: string | null;
}

export const ESCROW_FUNDING_STATUS_LABELS: Record<
  EscrowFundingTransactionStatus,
  { label: string; description: string }
> = {
  idle: {
    label: "Ready to fund",
    description: "Review the funding details before submitting the transaction.",
  },
  pending: {
    label: "Awaiting confirmation",
    description: "Transaction submitted. Waiting for blockchain confirmation.",
  },
  confirmed: {
    label: "Funding confirmed",
    description: "Blockchain confirmation received. Escrow funding is complete.",
  },
  failed: {
    label: "Funding failed",
    description: "The transaction failed. Escrow funds were not confirmed.",
  },
  cancelled: {
    label: "Funding cancelled",
    description: "The funding transaction was cancelled before confirmation.",
  },
};

export const ESCROW_FUNDING_STATUS_ORDER: EscrowFundingTransactionStatus[] = [
  "idle",
  "pending",
  "confirmed",
  "failed",
  "cancelled",
];
