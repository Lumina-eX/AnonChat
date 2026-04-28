"use client";

import React, { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Wallet, ShieldCheck, Zap, Download } from "lucide-react";
import { 
  FREIGHTER_ID, 
  ALBEDO_ID, 
  connectToWallet 
} from "@/app/stellar-wallet-kit";
import { toast } from "react-hot-toast";

interface WalletOptionProps {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  onSelect: (id: string) => void;
  isConnecting: boolean;
}

function WalletOption({ id, name, description, icon, onSelect, isConnecting }: WalletOptionProps) {
  return (
    <button
      onClick={() => onSelect(id)}
      disabled={isConnecting}
      className="group relative flex items-center gap-4 w-full p-4 rounded-xl border border-border/50 bg-card hover:bg-accent/50 hover:border-primary/50 transition-all duration-300 disabled:opacity-50 text-left"
    >
      <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-muted group-hover:bg-primary/10 group-hover:text-primary transition-colors">
        {icon}
      </div>
      <div className="flex-1">
        <h3 className="font-bold text-base group-hover:text-primary transition-colors">{name}</h3>
        <p className="text-xs text-muted-foreground line-clamp-1">{description}</p>
      </div>
      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
        <Zap className="w-4 h-4 text-primary" />
      </div>
    </button>
  );
}

interface WalletSelectionModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConnectSuccess: (address: string) => void;
}

export function WalletSelectionModal({ isOpen, onOpenChange, onConnectSuccess }: WalletSelectionModalProps) {
  const [isConnecting, setIsConnecting] = useState(false);

  const handleWalletSelect = async (walletId: string) => {
    setIsConnecting(true);
    try {
      await connectToWallet(walletId, async () => {
        // The address will be fetched in the parent component via getPublicKey
        // but we can signal success here
        onConnectSuccess(""); 
        onOpenChange(false);
      });
    } catch (error: any) {
      console.error("Wallet connection error:", error);
      if (error.message.includes("not installed")) {
        toast.error(`${walletId === FREIGHTER_ID ? 'Freighter' : 'Wallet'} is not installed.`, {
          icon: <Download className="w-4 h-4" />,
        });
      } else {
        toast.error(error.message || "Failed to connect wallet");
      }
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 animate-in fade-in-0 duration-300" />
        <Dialog.Content className="fixed left-[50%] top-[50%] z-50 grid w-full max-w-md translate-x-[-50%] translate-y-[-50%] gap-4 border border-border/50 bg-card p-8 shadow-2xl duration-300 animate-in zoom-in-95 slide-in-from-left-1/2 slide-in-from-top-[48%] rounded-3xl">
          <div className="flex flex-col space-y-2 text-center mb-4">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-2">
              <Wallet className="w-6 h-6 text-primary" />
            </div>
            <Dialog.Title className="text-2xl font-bold tracking-tight">Connect Wallet</Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">
              Select your preferred Stellar wallet to sign in.
            </Dialog.Description>
          </div>

          <div className="grid gap-3">
            <WalletOption
              id={FREIGHTER_ID}
              name="Freighter"
              description="Official browser extension by Stellar Development Foundation"
              icon={<ShieldCheck className="w-6 h-6" />}
              onSelect={handleWalletSelect}
              isConnecting={isConnecting}
            />
            <WalletOption
              id={ALBEDO_ID}
              name="Albedo"
              description="Safe and easy to use popup-style wallet for Stellar"
              icon={<Zap className="w-6 h-6" />}
              onSelect={handleWalletSelect}
              isConnecting={isConnecting}
            />
          </div>

          <div className="mt-6 pt-6 border-t border-border/50 text-center">
            <p className="text-xs text-muted-foreground">
              New to Stellar? <a href="https://www.stellar.org/wallets" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium">Learn more about wallets</a>
            </p>
          </div>

          <Dialog.Close className="absolute right-6 top-6 rounded-full p-2 opacity-70 ring-offset-background transition-all hover:opacity-100 hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
