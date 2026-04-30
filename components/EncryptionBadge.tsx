import React from 'react';
import { Lock } from "lucide-react";

export const EncryptionBadge = () => {
  return (
    <div 
      className="flex items-center space-x-1 px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-500 text-[10px] font-medium border border-green-500/20"
      aria-label="End-to-end encrypted"
    >
      <Lock className="w-2.5 h-2.5" /> 
      <span>Encrypted</span>
    </div>
  );
};