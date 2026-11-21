/**
 * Blockchain Event Synchronization Service
 * 
 * Continuously monitors Stellar blockchain for relevant events,
 * updates database records, implements retry mechanisms, 
 * and maintains detailed logs of synchronization status.
 */

import { Horizon } from "@stellar/stellar-sdk";
import { loadStellarConfig, isConfigured } from "@/lib/blockchain/stellar-config";
import { logBlockchainOperation } from "@/lib/blockchain/logger";
// Note: If your Supabase server client is imported differently, adjust this line.
// Based on your folder structure, it's likely in @/lib/supabase/server
import { createClient } from "@/lib/supabase/server"; 

export interface BlockchainEvent {
  id: string;
  type: string;
  sourceAccount: string;
  createdAt: string;
  transactionHash: string;
  amount?: string;
  asset?: string;
}

type SyncStatus = "synced" | "failed" | "pending_retry";

const DEFAULT_POLL_INTERVAL_MS = 15000; // 15 seconds
const MAX_RETRIES = 3;

let pollTimer: NodeJS.Timeout | null = null;
let isPolling = false;
let lastPagingToken: string = "now"; // Start from the latest events
let retryQueue: Array<{ event: BlockchainEvent; attempts: number }> = [];

/**
 * Starts automatic event synchronization with polling
 */
export function startEventSync(intervalMs = DEFAULT_POLL_INTERVAL_MS): void {
  if (pollTimer) {
    clearInterval(pollTimer);
  }

  // Immediate first check
  pollEvents().catch((err) => {
    logBlockchainOperation("error", "Initial blockchain event sync failed", {
      error: { type: "SyncError", message: err.message }
    });
  });

  pollTimer = setInterval(() => {
    pollEvents().catch((err) => {
      logBlockchainOperation("error", "Blockchain event sync polling error", {
        error: { type: "SyncError", message: err.message }
      });
    });
  }, intervalMs);

  logBlockchainOperation("info", "Blockchain event synchronization started", {
    intervalMs,
  });
}

/**
 * Stops automatic event synchronization
 */
export function stopEventSync(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  logBlockchainOperation("info", "Blockchain event synchronization stopped", {});
}

/**
 * Polls the Stellar Horizon API for new transactions
 */
async function pollEvents(): Promise<void> {
  if (isPolling) return;
  isPolling = true;

  const config = loadStellarConfig();
  if (!isConfigured() || !config) {
    logBlockchainOperation("warn", "Event sync skipped: Stellar configuration incomplete", {});
    isPolling = false;
    return;
  }

  try {
    const server = new Horizon.Server(config.horizonUrl);
    const supabase = createClient();

    // Fetch recent transactions for the monitored source account
    const response = await server
      .transactions()
      .cursor(lastPagingToken)
      .order("asc")
      .limit(50)
      .call();

    if (response.records.length > 0) {
      logBlockchainOperation("info", `Processing ${response.records.length} new blockchain events`, {});
    }

    for (const tx of response.records) {
      const event: BlockchainEvent = {
        id: tx.id,
        type: "transaction",
        sourceAccount: tx.source_account,
        createdAt: tx.created_at,
        transactionHash: tx.hash,
      };

      await syncEvent(supabase, event);
      
      // Update cursor to the latest record processed
      lastPagingToken = tx.paging_token;
    }

    // After processing new events, attempt to clear any failed retries
    await processRetryQueue(supabase);

  } catch (error: any) {
    logBlockchainOperation("error", "Failed to poll Stellar events", {
      error: { type: "HorizonError", message: error.message }
    });
  } finally {
    isPolling = false;
  }
}

/**
 * Updates database records to reflect blockchain changes
 */
async function syncEvent(supabase: any, event: BlockchainEvent): Promise<void> {
  try {
    const { error } = await supabase
      .from("blockchain_events")
      .upsert({
        event_id: event.id,
        tx_hash: event.transactionHash,
        source_account: event.sourceAccount,
        event_type: event.type,
        payload: event,
        status: "synced",
        synced_at: new Date().toISOString()
      }, { onConflict: 'event_id' });

    if (error) throw error;

    logBlockchainOperation("info", "Blockchain event synced successfully", {
      eventId: event.id,
      txHash: event.transactionHash,
      status: "synced"
    });

  } catch (error: any) {
    logBlockchainOperation("warn", "Failed to sync blockchain event to database", {
      eventId: event.id,
      txHash: event.transactionHash,
      error: { type: "DatabaseError", message: error.message }
    });
    
    // Add to retry queue for eventual consistency
    retryQueue.push({ event, attempts: 0 });
  }
}

/**
 * Implements retry mechanism for failed event updates
 */
async function processRetryQueue(supabase: any): Promise<void> {
  if (retryQueue.length === 0) return;

  const queueToProcess = [...retryQueue];
  retryQueue = []; // Clear the queue, if they fail again, they'll be re-added

  for (const item of queueToProcess) {
    item.attempts += 1;

    try {
      const { error } = await supabase
        .from("blockchain_events")
        .upsert({
          event_id: item.event.id,
          tx_hash: item.event.transactionHash,
          source_account: item.event.sourceAccount,
          event_type: item.event.type,
          payload: item.event,
          status: "synced",
          synced_at: new Date().toISOString()
        }, { onConflict: 'event_id' });

      if (error) throw error;

      logBlockchainOperation("info", "Blockchain event synced on retry", {
        eventId: item.event.id,
        attempts: item.attempts,
        status: "synced"
      });

    } catch (error: any) {
      if (item.attempts < MAX_RETRIES) {
        // Put back in queue for the next cycle
        retryQueue.push(item);
        logBlockchainOperation("warn", `Event sync retry failed (Attempt ${item.attempts}/${MAX_RETRIES})`, {
          eventId: item.event.id,
          error: { type: "RetryError", message: error.message }
        });
      } else {
        // Max retries reached, log permanent failure
        logBlockchainOperation("error", "Event sync permanently failed after max retries", {
          eventId: item.event.id,
          attempts: item.attempts,
          status: "failed",
          error: { type: "MaxRetriesError", message: error.message }
        });
        
        // Optionally update the database to mark this event as permanently failed
        await supabase
          .from("blockchain_events")
          .update({ status: "failed", error_message: error.message })
          .eq("event_id", item.event.id);
      }
    }
  }
}