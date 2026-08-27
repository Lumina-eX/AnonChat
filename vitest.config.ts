import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: [
      "lib/blockchain/group-verification.test.ts",
      "lib/blockchain/transaction-verification.test.ts",
      "lib/utils/stellar-address.test.ts",
      "components/GroupVerificationBadge.test.tsx",
      "components/chat-message-bubble.test.tsx",
      "components/MessageItem.test.tsx",
      "src/components/MessageInput.test.tsx",
      "tests/group-roles.test.ts",
      "tests/wallet-ownership-proof.test.ts",
      "tests/group-members-pagination.test.ts",
      "tests/stellar-transaction-history.test.ts",
    ],
    globals: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
