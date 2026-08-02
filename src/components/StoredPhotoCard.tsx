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

    const createdAt = new Date(
        photo.createdAt
    ).toLocaleString("ja-JP");

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

                <p>登録日時：{createdAt}</p>

                <p className="pending-status">状態：未送信</p>

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