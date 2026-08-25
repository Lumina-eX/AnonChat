export interface Message {
  id: string;
  text: string;
  sender: string;
  timestamp: Date;
  isOwn: boolean;
  isEncrypted: boolean;
  editedAt?: Date;
  /** Client-generated UUID used for idempotent message submission. */
  clientMessageId?: string;
}
