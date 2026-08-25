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
      "tests/group-roles.test.ts",
      "tests/group-member-removal.test.ts",
    ],
    globals: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
