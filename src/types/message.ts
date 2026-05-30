export interface ReadReceipt {
  userId: string;
  readAt: Date;
}

export interface Message {
  id: string;
  text: string;
  sender: string;
  timestamp: Date;
  isOwn: boolean;
  isEncrypted: boolean;
  readBy?: ReadReceipt[];
}
