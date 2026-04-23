import { useEffect } from 'react';
import { Message } from '../types/message';

type AddMessageFn = (msg: Omit<Message, 'id' | 'timestamp'>) => void;

export function useChatSubscription(sdk: any, addMessage: AddMessageFn) {
  useEffect(() => {
    const unsubscribe = sdk.onMessage((incomingMsg: any) => {
      addMessage({
        text: incomingMsg.content,
        sender: incomingMsg.senderAddress,
        isOwn: false,
      });
    });
    return () => unsubscribe();
  }, [sdk, addMessage]);
}
