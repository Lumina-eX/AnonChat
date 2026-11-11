import React, { useState } from 'react';
import { Copy, Check, X, Share2, UserPlus, Link as LinkIcon } from 'lucide-react';
import toast from 'react-hot-toast';

export interface GroupInviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomName: string;
  inviteCode?: string;
  shareUrl?: string;
}

export const GroupInviteModal: React.FC<GroupInviteModalProps> = ({
  isOpen,
  onClose,
  roomName,
  inviteCode = 'ANON-CHAT-99XF',
  shareUrl,
}) => {
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  if (!isOpen) return null;

  // Construct invite link fallback if not provided
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://anonchat.io';
  const effectiveShareUrl = shareUrl || `${origin}/chat?invite=${encodeURIComponent(inviteCode)}`;

  const copyToClipboard = async (text: string, type: 'code' | 'link') => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for older browsers or non-secure contexts
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }

      if (type === 'code') {
        setCopiedCode(true);
        toast.success('Invite code copied to clipboard!');
        setTimeout(() => setCopiedCode(false), 2000);
      } else {
        setCopiedLink(true);
        toast.success('Invite link copied to clipboard!');
        setTimeout(() => setCopiedLink(false), 2000);
      }
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      toast.error('Failed to copy to clipboard');
    }
  };

  const handleNativeShare = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: `Join ${roomName || 'Anonymous Group'} on AnonChat`,
          text: `You have been invited to join ${roomName || 'a private group'}. Use invite code: ${inviteCode}`,
          url: effectiveShareUrl,
        });
      } catch (err) {
        // User cancelled or aborted share
        if ((err as Error)?.name !== 'AbortError') {
          console.error('Error sharing:', err);
        }
      }
    } else {
      await copyToClipboard(effectiveShareUrl, 'link');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/75 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
        data-testid="invite-modal-backdrop"
      />

      {/* Dialog container */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-modal-title"
        className="relative w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl text-gray-100 z-10 animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 p-1.5 text-gray-400 hover:text-gray-100 hover:bg-gray-800 rounded-lg transition-colors"
        >
          <X className="size-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400">
            <UserPlus className="size-5" />
          </div>
          <div>
            <h3 id="invite-modal-title" className="text-lg font-semibold text-gray-100">
              Invite Members
            </h3>
            <p className="text-xs text-gray-400">
              {roomName ? `to ${roomName}` : 'to private encrypted group'}
            </p>
          </div>
        </div>

        <p className="text-sm text-gray-300 mb-5 leading-relaxed">
          Share this invite code or link with people you want to join this group. Anyone with the code can participate.
        </p>

        {/* Invite Code Box */}
        <div className="mb-4 bg-gray-950 p-4 rounded-xl border border-gray-800">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium uppercase tracking-wider text-gray-400">
              Invite Code
            </span>
            {copiedCode && (
              <span className="text-xs text-green-400 font-medium flex items-center gap-1">
                <Check className="size-3" /> Copied
              </span>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 bg-gray-900 px-3.5 py-2.5 rounded-lg border border-gray-800/80">
            <span
              data-testid="invite-code-display"
              className="font-mono text-base font-bold tracking-widest text-purple-300 select-all"
            >
              {inviteCode}
            </span>
            <button
              type="button"
              onClick={() => copyToClipboard(inviteCode, 'code')}
              data-testid="copy-code-button"
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-all ${
                copiedCode
                  ? 'bg-green-600 text-white'
                  : 'bg-purple-600 hover:bg-purple-700 text-white shadow-sm'
              }`}
            >
              {copiedCode ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copiedCode ? 'Copied' : 'Copy Code'}
            </button>
          </div>
        </div>

        {/* Shareable Link Box */}
        <div className="mb-6 bg-gray-950 p-4 rounded-xl border border-gray-800">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium uppercase tracking-wider text-gray-400 flex items-center gap-1">
              <LinkIcon className="size-3 text-gray-400" /> Shareable Link
            </span>
            {copiedLink && (
              <span className="text-xs text-green-400 font-medium flex items-center gap-1">
                <Check className="size-3" /> Copied
              </span>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 bg-gray-900 px-3 py-2 rounded-lg border border-gray-800/80">
            <input
              type="text"
              readOnly
              value={effectiveShareUrl}
              data-testid="invite-link-input"
              className="bg-transparent text-xs text-gray-300 font-mono truncate w-full outline-none"
            />
            <button
              type="button"
              onClick={() => copyToClipboard(effectiveShareUrl, 'link')}
              data-testid="copy-link-button"
              className="p-1.5 hover:bg-gray-800 rounded-md text-gray-400 hover:text-gray-100 transition-colors shrink-0"
              title="Copy share link"
            >
              {copiedLink ? <Check className="size-4 text-green-400" /> : <Copy className="size-4" />}
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleNativeShare}
            data-testid="share-button"
            className="flex-1 flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 text-white font-medium py-2.5 px-4 rounded-xl transition-all shadow-md active:scale-[0.98]"
          >
            <Share2 className="size-4" />
            Share Invite
          </button>
          <button
            type="button"
            onClick={onClose}
            className="bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium py-2.5 px-4 rounded-xl transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
