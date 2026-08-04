import { useEffect, useState } from "react";
import type { StoredPhoto } from "../types/Photo";

type StoredPhotoCardProps = {
  photo: StoredPhoto;
  onDelete: (id: string) => void;
  onTagsChange: (
    id: string,
    tags: string[]
  ) => Promise<void>;
};

const tagOptions = [
  "境界標",
  "建物外観",
  "建物内部",
  "接道",
  "土地現況",
  "測量",
  "資料",
  "その他",
];

function formatDateTime(dateText: string): string {
  return new Date(dateText).toLocaleString(
    "ja-JP",
    {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }
  );
}

function StoredPhotoCard({
  photo,
  onDelete,
  onTagsChange,
}: StoredPhotoCardProps) {
  const [previewUrl, setPreviewUrl] =
    useState("");

  const [isUpdatingTags, setIsUpdatingTags] =
    useState(false);

  const isSent = photo.status === "sent";

  /*
   * 古い保存データにはtagsが存在しないことがあるため、
   * 空配列を予備値にしています。
   */
  const currentTags = photo.tags ?? [];

  useEffect(() => {
    const previewBlob =
      photo.file ?? photo.thumbnail;

    if (!previewBlob) {
      setPreviewUrl("");
      return;
    }

    const objectUrl =
      URL.createObjectURL(previewBlob);

    setPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [photo.file, photo.thumbnail]);

  const handleTagClick = async (
    tag: string
  ) => {
    if (isSent || isUpdatingTags) {
      return;
    }

    const isSelected =
      currentTags.includes(tag);

    const nextTags = isSelected
      ? currentTags.filter(
          (currentTag) => currentTag !== tag
        )
      : [...currentTags, tag];

    try {
      setIsUpdatingTags(true);

      await onTagsChange(
        photo.id,
        nextTags
      );
    } finally {
      setIsUpdatingTags(false);
    }
  };

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
        <p className="file-name">
          {photo.fileName}
        </p>

        {!isSent && (
          <>
            <p>
              サイズ：
              {(
                photo.fileSize /
                1024 /
                1024
              ).toFixed(2)}
              {" MB"}
            </p>

            <p>
              登録日時：
              {formatDateTime(
                photo.createdAt
              )}
            </p>
          </>
        )}

        {isSent && photo.sentAt && (
          <>
            <p>
              送信日時：
              {formatDateTime(photo.sentAt)}
            </p>

            <p className="history-description">
              Box送信済み・履歴は7日間保存
            </p>
          </>
        )}

        <div className="tag-section">
          <p className="tag-label">
            {isSent
              ? "送信した写真タグ"
              : "写真タグ"}
          </p>

          {!isSent && (
            <div className="tag-list">
              {tagOptions.map((tag) => {
                const isSelected =
                  currentTags.includes(tag);

                return (
                  <button
                    key={tag}
                    type="button"
                    className={
                      isSelected
                        ? "tag-button selected"
                        : "tag-button"
                    }
                    disabled={isUpdatingTags}
                    onClick={() =>
                      void handleTagClick(tag)
                    }
                  >
                    {tag}
                    {isSelected ? " ✓" : ""}
                  </button>
                );
              })}
            </div>
          )}

          {isSent &&
            (currentTags.length === 0 ? (
              <p className="no-tag-message">
                タグなし
              </p>
            ) : (
              <div className="selected-tag-list">
                {currentTags.map((tag) => (
                  <span
                    key={tag}
                    className="selected-tag"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ))}
        </div>

        <p
          className={
            isSent
              ? "sent-status"
              : "pending-status"
          }
        >
          <span className="status-dot">
            ●
          </span>

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
          onClick={() =>
            onDelete(photo.id)
          }
        >
          {isSent
            ? "この履歴を削除"
            : "この写真を削除"}
        </button>
      </div>
    </article>
  );
}

export default StoredPhotoCard;