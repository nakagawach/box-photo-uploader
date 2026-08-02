export type PhotoStatus = "pending" | "uploading" | "failed";

export type StoredPhoto = {
    id: string;
    file: Blob;
    fileName: string;
    fileType: string;
    fileSize: number;
    createdAt: string;
    status: PhotoStatus;
};