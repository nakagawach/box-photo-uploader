export type PhotoStatus =
  | "pending"
  | "uploading"
  | "sent"
  | "failed";

export type StoredPhoto = {
  id: string;

  // 未送信時に保持する原寸写真
  file?: Blob;

  // 送信済み履歴用のWebPサムネイル
  thumbnail?: Blob;

  fileName: string;
  fileType: string;
  fileSize: number;
  createdAt: string;
  status: PhotoStatus;

  tags: string[];

  sentAt?: string;
  boxFileId?: string;
  boxUrl?: string;
  errorMessage?: string;
};