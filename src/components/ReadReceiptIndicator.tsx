import React, { useMemo } from "react";
import { ReadReceipt } from "@/src/types/message";

interface ReadReceiptIndicatorProps {
  /** Whether this message was sent by the current user */
  isOwn: boolean;
  /** Read receipts for this message */
  readReceipts: ReadReceipt[];
  /** Message delivery status */
  status?: "sending" | "sent" | "delivered" | "read";
}

/**
 * Displays read receipt indicators for messages:
 * - Single grey tick: sent
 * - Double grey ticks: delivered
 * - Double blue ticks: read (with count for groups)
 * Only shown on the sender's own messages.
 */
export const ReadReceiptIndicator: React.FC<ReadReceiptIndicatorProps> = ({
  isOwn,
  readReceipts,
  status,
}) => {
  // Only show indicators on own messages
  if (!isOwn) return null;

  const readCount = readReceipts.length;
  const isRead = readCount > 0;

  // Determine effective status
  const effectiveStatus = isRead ? "read" : status || "sent";

  // Format tooltip with reader info
  const tooltip = useMemo(() => {
    if (!isRead) return "";

    if (readCount === 1) {
      const readAt = readReceipts[0].readAt;
      return `Read at ${readAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    }

    return `Read by ${readCount} ${readCount === 1 ? "person" : "people"}`;
  }, [readReceipts, readCount, isRead]);

  return (
    <span className="inline-flex items-center gap-0.5 ml-1" title={tooltip}>
      {effectiveStatus === "sending" && (
        <ClockIcon className="w-3.5 h-3.5 text-gray-400" />
      )}

      {effectiveStatus === "sent" && (
        <SingleCheck className="w-3.5 h-3.5 text-gray-400" />
      )}

      {effectiveStatus === "delivered" && (
        <DoubleCheck className="w-3.5 h-3.5 text-gray-400" />
      )}

      {effectiveStatus === "read" && (
        <>
          <DoubleCheck className="w-3.5 h-3.5 text-blue-400" />
          {readCount > 1 && (
            <span className="text-[10px] text-blue-400 font-medium tabular-nums leading-none">
              {readCount}
            </span>
          )}
        </>
      )}
    </span>
  );
};

// --- SVG Icon components ---

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 4.5V8L10.5 9.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SingleCheck({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M3 8.5L6.5 12L13 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DoubleCheck({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M1.5 8.5L5 12L11.5 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7 8.5L10.5 12L17 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
