export interface ReplyToInfo {
  id: string;
  text: string;
  sender?: string;
  isDeleted?: boolean;
}

export interface Message {
  id: string;
  text: string;
  sender: string;
  timestamp: Date;
  isOwn: boolean;
  isEncrypted: boolean;
  editedAt?: Date;
  replyTo?: ReplyToInfo | null;
}

