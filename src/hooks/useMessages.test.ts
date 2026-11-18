import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useMessages } from './useMessages';

describe('useMessages', () => {
  it('adds a message with sending status and tempId', () => {
    const { result } = renderHook(() => useMessages({ roomId: undefined }));

    let tempId: string | undefined;
    act(() => {
      tempId = result.current.addMessage({
        text: 'Hello',
        sender: 'wallet_abc',
        isOwn: true,
        isEncrypted: false,
      });
    });

    expect(result.current.messages).toHaveLength(1);
    const msg = result.current.messages[0];
    expect(msg.text).toBe('Hello');
    expect(msg.sender).toBe('wallet_abc');
    expect(msg.isOwn).toBe(true);
    expect(msg.status).toBe('sending');
    expect(msg.tempId).toBe(tempId);
    expect(msg.id).toBe(tempId);
  });

  it('updates message status to sent', () => {
    const { result } = renderHook(() => useMessages({ roomId: undefined }));

    let tempId: string | undefined;
    act(() => {
      tempId = result.current.addMessage({
        text: 'Hello',
        sender: 'wallet_abc',
        isOwn: true,
        isEncrypted: false,
      });
    });

    act(() => {
      result.current.updateMessageStatus(tempId!, 'sent', 'server-123');
    });

    const msg = result.current.messages[0];
    expect(msg.status).toBe('sent');
    expect(msg.id).toBe('server-123');
  });

  it('updates message status to failed', () => {
    const { result } = renderHook(() => useMessages({ roomId: undefined }));

    let tempId: string | undefined;
    act(() => {
      tempId = result.current.addMessage({
        text: 'Hello',
        sender: 'wallet_abc',
        isOwn: true,
        isEncrypted: false,
      });
    });

    act(() => {
      result.current.updateMessageStatus(tempId!, 'failed');
    });

    expect(result.current.messages[0].status).toBe('failed');
  });

  it('removes a message by id', () => {
    const { result } = renderHook(() => useMessages({ roomId: undefined }));

    let tempId: string | undefined;
    act(() => {
      tempId = result.current.addMessage({
        text: 'Hello',
        sender: 'wallet_abc',
        isOwn: true,
        isEncrypted: false,
      });
    });

    expect(result.current.messages).toHaveLength(1);

    act(() => {
      result.current.removeMessage(tempId!);
    });

    expect(result.current.messages).toHaveLength(0);
  });

  it('preserves message order when adding multiple messages', () => {
    const { result } = renderHook(() => useMessages({ roomId: undefined }));

    act(() => {
      result.current.addMessage({
        text: 'First',
        sender: 'wallet_abc',
        isOwn: true,
        isEncrypted: false,
      });
    });

    act(() => {
      result.current.addMessage({
        text: 'Second',
        sender: 'wallet_abc',
        isOwn: true,
        isEncrypted: false,
      });
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].text).toBe('First');
    expect(result.current.messages[1].text).toBe('Second');
  });

  it('retries a failed message', async () => {
    const { result } = renderHook(() => useMessages({ roomId: undefined }));

    let tempId: string | undefined;
    act(() => {
      tempId = result.current.addMessage({
        text: 'Hello',
        sender: 'wallet_abc',
        isOwn: true,
        isEncrypted: false,
      });
    });

    act(() => {
      result.current.updateMessageStatus(tempId!, 'failed');
    });

    const onRetry = vi.fn().mockResolvedValue(undefined);
    act(() => {
      result.current.retryMessage(tempId!, onRetry);
    });

    expect(onRetry).toHaveBeenCalledWith('Hello');
    expect(result.current.messages[0].status).toBe('sending');
  });

  it('does not retry a non-failed message', () => {
    const { result } = renderHook(() => useMessages({ roomId: undefined }));

    let tempId: string | undefined;
    act(() => {
      tempId = result.current.addMessage({
        text: 'Hello',
        sender: 'wallet_abc',
        isOwn: true,
        isEncrypted: false,
      });
    });

    const onRetry = vi.fn();
    act(() => {
      result.current.retryMessage(tempId!, onRetry);
    });

    expect(onRetry).not.toHaveBeenCalled();
  });

  it('defaults status to sending when not provided', () => {
    const { result } = renderHook(() => useMessages({ roomId: undefined }));

    act(() => {
      result.current.addMessage({
        text: 'Hello',
        sender: 'wallet_abc',
        isOwn: true,
        isEncrypted: false,
      });
    });

    expect(result.current.messages[0].status).toBe('sending');
  });
});
