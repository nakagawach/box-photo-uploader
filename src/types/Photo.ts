export type PhotoStatus =
  | "pending"
  | "uploading"
  | "sent"
  | "failed";

export type StoredPhoto = {
  id: string;

  // 未送信時の原本
  file?: Blob;

  // 送信済み履歴用
  thumbnail?: Blob;

  // 端末で撮影・選択した元ファイル名
  fileName: string;

  // 実際にBoxへ送信したファイル名
  uploadedFileName?: string;

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