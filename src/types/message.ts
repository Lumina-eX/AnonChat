export type MessageStatus = 'sending' | 'sent' | 'failed';

export interface ReplyToInfo {
  id: string;
  text: string;
  sender?: string;
  isDeleted?: boolean;
}

export interface ForwardedFromInfo {
  id: string;
  sender?: string;
  roomId?: string;
}

export interface Message {
  id: string;
  text: string;
  sender: string;
  timestamp: Date;
  isOwn: boolean;
  isEncrypted: boolean;
  editedAt?: Date;
  replyTo: ReplyToInfo | null;
  status?: MessageStatus;
  tempId?: string;
  isDeleted?: boolean;
  forwardedFrom?: ForwardedFromInfo | null;
}

export interface GroupSummary {
  id: string;
  name: string;
}
