import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { GroupInviteModal } from './GroupInviteModal';
import { GroupSettingsPanel } from './GroupSettingsPanel';
import toast from 'react-hot-toast';

// Mock react-hot-toast
const { mockToast } = vi.hoisted(() => {
  const mockToast = {
    success: vi.fn(),
    error: vi.fn(),
  };
  return { mockToast };
});

vi.mock('react-hot-toast', () => ({
  default: mockToast,
  toast: mockToast,
}));

describe('GroupInviteModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <GroupInviteModal
        isOpen={false}
        onClose={vi.fn()}
        roomName="Alpha Room"
        inviteCode="ALPHA-INVITE-001"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders modal header, room name and invite code when isOpen is true', () => {
    render(
      <GroupInviteModal
        isOpen={true}
        onClose={vi.fn()}
        roomName="Secret Citadel"
        inviteCode="CITADEL-777"
      />
    );

    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText('Invite Members')).toBeDefined();
    expect(screen.getByText(/to Secret Citadel/i)).toBeDefined();
    expect(screen.getByTestId('invite-code-display').textContent).toBe('CITADEL-777');
    expect(screen.getByTestId('copy-code-button')).toBeDefined();
  });

  it('copies invite code to clipboard on click and displays success toast', async () => {
    render(
      <GroupInviteModal
        isOpen={true}
        onClose={vi.fn()}
        roomName="Alpha Room"
        inviteCode="ALPHA-1234"
      />
    );

    const copyBtn = screen.getByTestId('copy-code-button');
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('ALPHA-1234');
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Invite code copied to clipboard!');
    });
  });

  it('copies share link to clipboard on click', async () => {
    render(
      <GroupInviteModal
        isOpen={true}
        onClose={vi.fn()}
        roomName="Alpha Room"
        inviteCode="ALPHA-1234"
        shareUrl="https://anonchat.io/chat?invite=ALPHA-1234"
      />
    );

    const copyLinkBtn = screen.getByTestId('copy-link-button');
    fireEvent.click(copyLinkBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'https://anonchat.io/chat?invite=ALPHA-1234'
    );
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Invite link copied to clipboard!');
    });
  });

  it('calls onClose when close icon or backdrop is clicked', () => {
    const handleClose = vi.fn();
    render(
      <GroupInviteModal
        isOpen={true}
        onClose={handleClose}
        roomName="Alpha Room"
        inviteCode="ALPHA-1234"
      />
    );

    const closeBtn = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);

    const backdrop = screen.getByTestId('invite-modal-backdrop');
    fireEvent.click(backdrop);
    expect(handleClose).toHaveBeenCalledTimes(2);
  });
});

describe('GroupSettingsPanel Invite Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Invite Members button and opens GroupInviteModal when clicked', () => {
    render(
      <GroupSettingsPanel
        isOpen={true}
        onClose={vi.fn()}
        roomName="DeFi Builders"
        inviteCode="BUILD-999"
      />
    );

    const inviteBtn = screen.getByTestId('open-invite-modal-button');
    expect(inviteBtn).toBeDefined();
    expect(inviteBtn.textContent).toContain('Invite Members');

    // Click Invite Members
    fireEvent.click(inviteBtn);

    // Modal should now be open
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByTestId('invite-code-display').textContent).toBe('BUILD-999');
  });
});
