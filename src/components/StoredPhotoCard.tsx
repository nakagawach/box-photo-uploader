import { useEffect, useState } from "react";
import type { StoredPhoto } from "../types/Photo";

type StoredPhotoCardProps = {
  photo: StoredPhoto;
  onDelete: (id: string) => void;
};

function StoredPhotoCard({
  photo,
  onDelete,
}: StoredPhotoCardProps) {
  const [previewUrl, setPreviewUrl] = useState("");

  useEffect(() => {
    const previewBlob = photo.file ?? photo.thumbnail;

    if (!previewBlob) {
      setPreviewUrl("");
      return;
    }

    const objectUrl = URL.createObjectURL(previewBlob);
    setPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [photo.file, photo.thumbnail]);

  const createdAt = new Date(photo.createdAt);

  const formattedCreatedAt = createdAt.toLocaleString(
    "ja-JP",
    {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }
  );

  const formattedSentAt = photo.sentAt
    ? new Date(photo.sentAt).toLocaleString("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  const isSent = photo.status === "sent";

  return (
    <article className="photo-card">
      {previewUrl && (
        <img
          className="preview-image"
          src={previewUrl}
          alt={photo.fileName}
        />
      )}

      <div className="photo-information">
        <p className="file-name">{photo.fileName}</p>

        {!isSent && (
          <>
            <p>
              サイズ：
              {(photo.fileSize / 1024 / 1024).toFixed(2)} MB
            </p>

            <p>登録日時：{formattedCreatedAt}</p>
          </>
        )}

        {isSent && (
          <>
            <p>送信日時：{formattedSentAt}</p>

            <p className="history-description">
              Box送信済み・履歴は7日間保存
            </p>
          </>
        )}

        <p
          className={
            isSent ? "sent-status" : "pending-status"
          }
        >
          <span className="status-dot">●</span>
          {isSent ? "送信済み" : "未送信"}
        </p>

        {!isSent && previewUrl && (
          <a
            href={previewUrl}
            download={photo.fileName}
            className="download-button"
          >
            ⬇ 端末へ保存
          </a>
        )}

        <button
          type="button"
          className="delete-button"
          onClick={() => onDelete(photo.id)}
        >
          {isSent ? "この履歴を削除" : "この写真を削除"}
        </button>
      </div>
    </article>
  );
}

export default StoredPhotoCard;