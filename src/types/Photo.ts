export type PhotoStatus =
    | "pending"
    | "uploading"
    | "sent"
    | "failed";

export type StoredPhoto = {
    id: string;

    // 未送信時の原寸写真
    file?: Blob;

    // 送信済み履歴用の小さい画像
    thumbnail?: Blob;

    fileName: string;
    fileType: string;
    fileSize: number;
    createdAt: string;
    status: PhotoStatus;

    sentAt?: string;
    boxFileId?: string;
    boxUrl?: string;
    errorMessage?: string;
};