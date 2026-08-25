"use client";

import React, { useState, useEffect } from "react";
import { Loader2, CheckCircle2, XCircle, ExternalLink, RefreshCw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export type TransactionState = 
  | "idle"
  | "preparing"
  | "awaiting_approval"
  | "submitted"
  | "confirming"
  | "confirmed"
  | "failed";

export interface UseStellarTransactionProps {
  onSuccess?: (hash: string) => void;
  onError?: (error: string) => void;
}

export function useStellarTransaction(props?: UseStellarTransactionProps) {
  const [state, setState] = useState<TransactionState>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setState("idle");
    setTxHash(null);
    setError(null);
  };

  const execute = async (
    buildTx: () => Promise<any>,
    signTx: (tx: any) => Promise<any>,
    submitTx: (tx: any) => Promise<string>,
    verifyTx: (hash: string) => Promise<boolean>
  ) => {
    try {
      reset();
      
      // 1. Preparing
      setState("preparing");
      const builtTx = await buildTx();
      
      // 2. Awaiting Approval
      setState("awaiting_approval");
      const signedTx = await signTx(builtTx);
      
      // 3. Submitted
      setState("submitted");
      const hash = await submitTx(signedTx);
      setTxHash(hash);
      
      // 4. Confirming
      setState("confirming");
      const isConfirmed = await verifyTx(hash);
      
      if (!isConfirmed) {
        throw new Error("Transaction could not be verified on the ledger.");
      }
      
      // 5. Confirmed
      setState("confirmed");
      props?.onSuccess?.(hash);
      return hash;
      
    } catch (err: any) {
      // 6. Failed
      setState("failed");
      const errorMessage = err?.message || "An unknown error occurred during the transaction.";
      setError(errorMessage);
      props?.onError?.(errorMessage);
      throw err;
    }
  };

  return { state, txHash, error, execute, reset, setState };
}

interface StellarTransactionFlowProps {
  state: TransactionState;
  txHash: string | null;
  error: string | null;
  onRetry?: () => void;
  onClose?: () => void;
  title?: string;
}

export function StellarTransactionFlow({ 
  state, 
  txHash, 
  error, 
  onRetry, 
  onClose,
  title = "Blockchain Transaction"
}: StellarTransactionFlowProps) {
  
  if (state === "idle") return null;

  const getStellarExpertUrl = (hash: string) => {
    // Assuming testnet for dev, can be configured via env
    const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK === "public" ? "public" : "testnet";
    return `https://stellar.expert/explorer/${network}/tx/${hash}`;
  };

  const renderStateContent = () => {
    switch (state) {
      case "preparing":
        return (
          <div className="flex flex-col items-center justify-center p-6 space-y-4">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground text-center">
              Building and validating transaction securely...
            </p>
          </div>
        );
      case "awaiting_approval":
        return (
          <div className="flex flex-col items-center justify-center p-6 space-y-4">
            <div className="relative">
              <div className="w-12 h-12 rounded-full border-4 border-primary/30 border-t-primary animate-spin" />
            </div>
            <p className="text-sm font-medium text-center">
              Please open your wallet and approve the transaction.
            </p>
          </div>
        );
      case "submitted":
        return (
          <div className="flex flex-col items-center justify-center p-6 space-y-4">
            <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
            <p className="text-sm text-muted-foreground text-center">
              Transaction sent to the Stellar network...
            </p>
          </div>
        );
      case "confirming":
        return (
          <div className="flex flex-col items-center justify-center p-6 space-y-4">
            <Loader2 className="w-10 h-10 animate-spin text-amber-500" />
            <div className="text-center">
              <p className="text-sm font-medium">Awaiting Ledger Confirmation</p>
              <p className="text-xs text-muted-foreground mt-1">Verifying inclusion in the blockchain...</p>
            </div>
          </div>
        );
      case "confirmed":
        return (
          <div className="flex flex-col items-center justify-center p-6 space-y-4">
            <CheckCircle2 className="w-12 h-12 text-green-500" />
            <div className="text-center">
              <p className="text-lg font-semibold text-green-600 dark:text-green-400">Success!</p>
              <p className="text-sm text-muted-foreground mt-1">Transaction has been confirmed on the ledger.</p>
            </div>
          </div>
        );
      case "failed":
        return (
          <div className="flex flex-col items-center justify-center p-4 space-y-4">
            <XCircle className="w-12 h-12 text-destructive" />
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Transaction Failed</AlertTitle>
              <AlertDescription className="text-xs mt-1">
                {error || "The transaction was rejected or timed out."}
              </AlertDescription>
            </Alert>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto shadow-lg animate-in fade-in zoom-in-95 duration-200">
      <CardHeader className="pb-3 border-b border-border/40">
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>
          {state === "confirmed" ? "Completed" : state === "failed" ? "Error" : "Processing"}
        </CardDescription>
      </CardHeader>
      
      <CardContent className="pt-6">
        {renderStateContent()}
        
        {txHash && (state === "submitted" || state === "confirming" || state === "confirmed") && (
          <div className="mt-4 p-3 bg-muted/50 rounded-lg border border-border/50 flex flex-col gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Transaction Hash
            </span>
            <div className="flex items-center justify-between gap-2">
              <code className="text-xs truncate bg-background px-2 py-1 rounded border flex-1">
                {txHash}
              </code>
              <a 
                href={getStellarExpertUrl(txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:text-primary/80 transition-colors"
                title="View on Stellar Expert"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>
        )}
      </CardContent>
      
      {(state === "confirmed" || state === "failed") && (
        <CardFooter className="flex justify-end gap-2 border-t border-border/40 pt-4">
          {state === "failed" && onRetry && (
            <Button variant="outline" onClick={onRetry} className="gap-2">
              <RefreshCw className="w-4 h-4" />
              Retry
            </Button>
          )}
          {onClose && (
            <Button variant={state === "confirmed" ? "default" : "secondary"} onClick={onClose}>
              {state === "confirmed" ? "Done" : "Close"}
            </Button>
          )}
        </CardFooter>
      )}
    </Card>
  );
}
