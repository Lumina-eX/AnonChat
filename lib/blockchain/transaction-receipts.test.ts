import { describe, expect, it } from "vitest";
import {
  getTransactionReceiptsByOperation,
  upsertTransactionReceipt,
} from "./transaction-receipts";

function makeSupabase() {
  const receipts: any[] = [];
  const events: any[] = [];
  let nextId = 1;

  const client: any = {
    from(table: string) {
      const rows = table === "transaction_receipts" ? receipts : events;
      return {
        select() {
          let filtered = rows;
          const query: any = {
            eq(column: string, value: string) {
              filtered = filtered.filter((row) => row[column] === value);
              return query;
            },
            order() { return query; },
            maybeSingle: async () => ({ data: filtered[0] ?? null, error: null }),
            single: async () => ({ data: filtered[0] ?? null, error: null }),
            then(resolve: (value: { data: any[]; error: null }) => unknown, reject: (reason: unknown) => unknown) {
              return Promise.resolve({ data: filtered, error: null }).then(resolve, reject);
            },
          };
          return query;
        },
        insert(values: any) {
          const row = { id: String(nextId++), created_at: "now", updated_at: "now", ...values };
          rows.push(row);
          return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
        },
        update(values: any) {
          return {
            eq: async (_column: string, value: string) => {
              const row = rows.find((candidate) => candidate.id === value);
              if (row) Object.assign(row, values);
              return { error: null };
            },
          };
        },
      };
    },
  };
  return { client, receipts, events };
}

describe("transaction receipts", () => {
  it("updates the existing hash and records each lifecycle event", async () => {
    const { client, receipts, events } = makeSupabase();
    const first = await upsertTransactionReceipt({
      supabase: client,
      transactionHash: "a".repeat(64),
      operationId: "operation-1",
      status: "pending",
    });
    const second = await upsertTransactionReceipt({
      supabase: client,
      transactionHash: "a".repeat(64),
      operationId: "operation-1",
      status: "confirmed",
      ledgerSequence: 42,
    });

    expect(first.id).toBe(second.id);
    expect(receipts).toHaveLength(1);
    expect(second.status).toBe("confirmed");
    expect(events).toHaveLength(2);
  });

  it("returns receipts by operation id", async () => {
    const { client } = makeSupabase();
    await upsertTransactionReceipt({
      supabase: client,
      transactionHash: "b".repeat(64),
      operationId: "operation-2",
      status: "failed",
    });

    const receipts = await getTransactionReceiptsByOperation(client, "operation-2");
    expect(receipts).toHaveLength(1);
    expect(receipts[0].status).toBe("failed");
  });
});