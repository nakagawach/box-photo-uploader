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
        const objectUrl = URL.createObjectURL(photo.file);

        setPreviewUrl(objectUrl);

        return () => {
            URL.revokeObjectURL(objectUrl);
        };
    }, [photo.file]);

    const createdAt = new Date(photo.createdAt);

    const formattedDate = createdAt.toLocaleDateString("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });

    const formattedTime = createdAt.toLocaleTimeString("ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
    });

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

                <p>
                    サイズ：
                    {(photo.fileSize / 1024 / 1024).toFixed(2)} MB
                </p>

                <p>
                    登録日時：{formattedDate} {formattedTime}
                </p>

                <p className="pending-status">
                    <span className="status-dot">●</span>
                    未送信
                </p>

                {previewUrl && (
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
                    この写真を削除
                </button>
            </div>
        </article>
    );
}

export default StoredPhotoCard;