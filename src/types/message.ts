export interface Message {
  id: string;
  text: string;
  sender: string;
  timestamp: Date;
  isOwn: boolean;
}

export interface IncomingMessage {
  content: string;
  senderAddress: string;
}

export interface ChatSDK {
  onMessage: (callback: (message: IncomingMessage) => void) => () => void;
}

export type AddMessageFn = (msg: Omit<Message, 'id' | 'timestamp'>) => void;
