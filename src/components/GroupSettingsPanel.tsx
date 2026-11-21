import React, { useState } from 'react';
import { Copy, LogOut, X, Users } from 'lucide-react';

interface GroupSettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  roomName: string;
}

export const GroupSettingsPanel: React.FC<GroupSettingsPanelProps> = ({
  isOpen,
  onClose,
  roomName
}) => {
  const [copied, setCopied] = useState(false);
  const [showConfirmLeave, setShowConfirmLeave] = useState(false);

  // Mock data for presentation purposes
  const inviteCode = "ANON-CHAT-99XF";
  const memberCount = 14;
  const description = "A private, decentralized room for secure group discussions.";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000); // Reset text after 2 seconds
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  };

  const handleLeaveGroup = () => {
    alert("Successfully left the group!"); // Placeholder for actual leave logic
    setShowConfirmLeave(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Dark Overlay/Backdrop */}
      <div 
        className="fixed inset-0 bg-black/60 z-40 transition-opacity animate-fade-in"
        onClick={onClose}
      />

      {/* Drawer Panel Sliding from Right */}
      <div className="fixed top-0 right-0 h-full w-80 sm:w-96 bg-gray-900 border-l border-gray-800 text-gray-100 p-6 shadow-2xl z-50 flex flex-col justify-between transform transition-transform animate-slide-in">
        
        {/* Upper Layout Section */}
        <div>
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-gray-800">
            <h2 className="text-lg font-semibold">Group Details</h2>
            <button 
              onClick={onClose}
              className="p-1 hover:bg-gray-800 rounded-md transition-colors"
            >
              <X className="size-5 text-gray-400 hover:text-gray-100" />
            </button>
          </div>

          {/* 1. Group Info Display */}
          <div className="flex flex-col items-center py-6 text-center">
            <div className="w-20 h-20 bg-purple-600 rounded-full flex items-center justify-center shadow-lg mb-3">
              <Users className="size-10 text-white" />
            </div>
            <h3 className="text-xl font-bold tracking-wide">{roomName || "Anonymous Group"}</h3>
            <span className="text-xs text-purple-400 mt-1 font-medium bg-purple-950/50 px-2.5 py-0.5 rounded-full border border-purple-900/40">
              {memberCount} members online
            </span>
            <p className="text-sm text-gray-400 mt-4 px-2 leading-relaxed">
              {description}
            </p>
          </div>

          {/* 2. Copy Invite Code Section */}
          <div className="mt-4 bg-gray-950 p-4 rounded-xl border border-gray-800/60">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-2">
              Invite Code
            </label>
            <div className="flex items-center justify-between bg-gray-900 px-3 py-2 rounded-lg border border-gray-800">
              <span className="font-mono text-sm tracking-widest text-gray-200">{inviteCode}</span>
              <button
                onClick={handleCopy}
                className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-all ${
                  copied 
                    ? 'bg-green-600 text-white' 
                    : 'bg-purple-600 hover:bg-purple-700 text-white shadow-sm'
                }`}
              >
                <Copy className="size-3.5" />
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        </div>

        {/* 3. Option to Leave the Group */}
        <div className="pt-4 border-t border-gray-800">
          <button
            onClick={() => setShowConfirmLeave(true)}
            className="w-full flex items-center justify-center gap-2 bg-red-950/30 hover:bg-red-600 border border-red-900/50 hover:border-red-500 text-red-400 hover:text-white font-medium py-2.5 px-4 rounded-xl transition-all shadow-sm"
          >
            <LogOut className="size-4" />
            Leave Group
          </button>
        </div>
      </div>

      {/* Confirmation Safety Dialog Modal */}
      {showConfirmLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/70" onClick={() => setShowConfirmLeave(false)} />
          <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-sm w-full p-6 shadow-2xl z-10 text-center animate-scale-up">
            <h4 className="text-lg font-bold text-gray-100">Leave Group?</h4>
            <p className="text-sm text-gray-400 mt-2">
              Are you sure you want to leave <strong>{roomName || "this group"}</strong>? You will lose access to this encrypted chat workspace history.
            </p>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setShowConfirmLeave(false)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium py-2 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleLeaveGroup}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-medium py-2 rounded-xl transition-colors shadow-md"
              >
                Yes, Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};