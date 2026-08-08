import {
  useEffect,
  useState,
} from "react";
import type { StoredPhoto } from "../types/Photo";

type StoredPhotoCardProps = {
  photo: StoredPhoto;

  onDelete: (
    id: string
  ) => void;

  onTagsChange: (
    id: string,
    tags: string[]
  ) => Promise<void>;

  onPreview: (
    id: string
  ) => void;
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

function formatDateTime(
  dateText: string
): string {
  return new Date(
    dateText
  ).toLocaleString(
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
  onPreview,
}: StoredPhotoCardProps) {
  const [
    previewUrl,
    setPreviewUrl,
  ] = useState("");

  const [
    isUpdatingTags,
    setIsUpdatingTags,
  ] = useState(false);

  const isSent =
    photo.status === "sent";

  const currentTags =
    photo.tags ?? [];

  useEffect(() => {
    const previewBlob =
      photo.file ??
      photo.thumbnail;

    if (!previewBlob) {
      setPreviewUrl("");
      return;
    }

    const objectUrl =
      URL.createObjectURL(
        previewBlob
      );

    setPreviewUrl(
      objectUrl
    );

    return () => {
      URL.revokeObjectURL(
        objectUrl
      );
    };
  }, [
    photo.file,
    photo.thumbnail,
  ]);

  const handleTagClick =
    async (
      tag: string
    ) => {
      if (
        isSent ||
        isUpdatingTags
      ) {
        return;
      }

      const selected =
        currentTags.includes(
          tag
        );

      const nextTags =
        selected
          ? currentTags.filter(
              (currentTag) =>
                currentTag !==
                tag
            )
          : [
              ...currentTags,
              tag,
            ];

      try {
        setIsUpdatingTags(
          true
        );

        await onTagsChange(
          photo.id,
          nextTags
        );
      } finally {
        setIsUpdatingTags(
          false
        );
      }
    };

  const displayFileName =
    isSent
      ? photo.uploadedFileName ??
        photo.fileName
      : photo.fileName;

  return (
    <article className="photo-card">
      {previewUrl && (
        <button
          type="button"
          className="preview-image-button"
          onClick={() =>
            onPreview(
              photo.id
            )
          }
        >
          <img
            className="preview-image"
            src={
              previewUrl
            }
            alt={
              displayFileName
            }
          />

          <span className="preview-hint">
            ⛶ 拡大
          </span>
        </button>
      )}

      <div className="tag-section">
        <p className="tag-label">
          {isSent
            ? "写真タグ"
            : "写真タグを選択"}
        </p>

        {!isSent && (
          <div className="tag-list">
            {tagOptions.map(
              (tag) => {
                const selected =
                  currentTags.includes(
                    tag
                  );

                return (
                  <button
                    key={
                      tag
                    }
                    type="button"
                    disabled={
                      isUpdatingTags
                    }
                    className={
                      selected
                        ? "tag-button selected"
                        : "tag-button"
                    }
                    onClick={() =>
                      void handleTagClick(
                        tag
                      )
                    }
                  >
                    {tag}

                    {selected
                      ? " ✓"
                      : ""}
                  </button>
                );
              }
            )}
          </div>
        )}

        {isSent &&
          (currentTags.length >
          0 ? (
            <div className="selected-tag-list">
              {currentTags.map(
                (tag) => (
                  <span
                    key={
                      tag
                    }
                    className="selected-tag"
                  >
                    {
                      tag
                    }
                  </span>
                )
              )}
            </div>
          ) : (
            <p className="no-tag-message">
              タグなし
            </p>
          ))}
      </div>

      <div className="photo-information">
        <p className="file-name">
          {displayFileName}
        </p>

        {!isSent && (
          <>
            <p>
              サイズ：
              {(
                photo.fileSize /
                1024 /
                1024
              ).toFixed(
                2
              )}
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

        {isSent &&
          photo.sentAt && (
            <p>
              送信日時：
              {formatDateTime(
                photo.sentAt
              )}
            </p>
          )}

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

          {isSent
            ? "送信済み"
            : "未送信"}
        </p>

        {!isSent &&
          previewUrl && (
            <a
              className="download-button"
              href={
                previewUrl
              }
              download={
                photo.fileName
              }
            >
              ⬇
              端末へ保存
            </a>
          )}

        <button
          type="button"
          className="delete-button"
          onClick={() =>
            onDelete(
              photo.id
            )
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