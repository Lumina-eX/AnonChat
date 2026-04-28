import { toast } from "react-hot-toast";

/**
 * Valid error contexts to ensure consistent categorization across the app.
 */
export type ErrorContext = "WALLET_CONNECT" | "SEND_MESSAGE" | "NETWORK";

/**
 * Global error handler that logs technical details for developers
 * but provides sanitized, user-friendly feedback via toasts.
 */
export const handleAppError = (error: any, context: ErrorContext) => {
  // Always log the raw technical error for developer debugging
  console.error(`[App Error - ${context}]:`, error);

  let userFriendlyMessage = "An unexpected error occurred.";

  // 1. Set standard context-based fallback messages
  switch (context) {
    case "WALLET_CONNECT":
      userFriendlyMessage = "Wallet connection rejected or not found.";
      break;
    case "SEND_MESSAGE":
      userFriendlyMessage =
        "Message send failed. Please check your connection.";
      break;
    case "NETWORK":
      userFriendlyMessage =
        "Network error. Please check your internet connection.";
      break;
  }

  // 2. Override fallback only for "Allow-listed" specific messages (like Rate Limits)
  // This extracts the message whether 'error' is a string or an Error object
  const rawMessage = typeof error === "string" ? error : error?.message;

  if (rawMessage) {
    // Check if the message is a specific rate-limit instruction (e.g., "Please wait 5s")
    const isRateLimit = rawMessage.toLowerCase().includes("wait");

    // Check if it's a specific server response that isn't a technical [object Event]
    const isCleanServerMessage =
      context === "SEND_MESSAGE" && !rawMessage.includes("[object");

    if (isRateLimit || isCleanServerMessage) {
      userFriendlyMessage = rawMessage;
    }
  }

  // 3. Trigger Toast Notification
  toast.error(userFriendlyMessage, {
    id: context, // Crucial: prevents duplicate toasts if an error fires repeatedly
    duration: 4000,
  });
};
