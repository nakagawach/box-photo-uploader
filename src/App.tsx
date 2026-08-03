import { useEffect, useState } from "react";
import "./App.css";
import StoredPhotoCard from "./components/StoredPhotoCard";
import {
  deletePhoto,
  getAllPhotos,
  savePhotos,
} from "./db/photoDb";
import type { StoredPhoto } from "./types/Photo";

function createId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
}

function App() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [photos, setPhotos] = useState<StoredPhoto[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  const loadPhotos = async () => {
    try {
      const savedPhotos = await getAllPhotos();
      setPhotos(savedPhotos);
    } catch (error) {
      console.error(error);
      setErrorMessage("保存済み写真を読み込めませんでした。");
    }
  };

  useEffect(() => {
    void loadPhotos();
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const uploadPhotos = async () => {

    if (photos.length === 0) {
      return;
    }

    setIsUploading(true);

    await new Promise((resolve) =>
      setTimeout(resolve, 2000)
    );

    alert("Boxへ送信しました（ダミー）");

    setIsUploading(false);

  };

  const handlePhotoChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const selectedFiles = Array.from(
      event.target.files ?? []
    );

    if (selectedFiles.length === 0) {
      return;
    }

    setIsSaving(true);
    setErrorMessage("");

    const newPhotos: StoredPhoto[] = selectedFiles.map(
      (file) => ({
        id: createId(),
        file,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        createdAt: new Date().toISOString(),
        status: "pending",
      })
    );

    try {
      // 先にIndexedDBへ保存する
      await savePhotos(newPhotos);

      // 保存成功後、一覧を再取得する
      await loadPhotos();

      // 同じファイルを再選択できるように空にする
      event.target.value = "";
    } catch (error) {
      console.error(error);
      setErrorMessage("写真の保存に失敗しました。");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const confirmed = window.confirm(
      "この写真を削除しますか？"
    );

    if (!confirmed) {
      return;
    }

    try {
      await deletePhoto(id);
      await loadPhotos();
    } catch (error) {
      console.error(error);
      setErrorMessage("写真の削除に失敗しました。");
    }
  };

  return (
    <main className="container">
      <h1>📷 Box Photo Uploader</h1>

      <div
        className={
          isOnline
            ? "network-status online"
            : "network-status offline"
        }
      >
        <span className="network-dot">●</span>

        {isOnline
          ? "オンライン：Boxへ送信できます"
          : "オフライン：写真はブラウザに保存されます"}
      </div>

      <div className="pending-summary">
        <span>Box未送信</span>
        <strong>{photos.length}件</strong>
      </div>

      <div className="photo-actions">

        {/* カメラ */}
        <label className="photo-action-button">
          📷 カメラで撮影

          <input
            className="hidden-file-input"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoChange}
            disabled={isSaving}
          />
        </label>

        {/* ライブラリ */}
        <label className="photo-action-button secondary">
          🖼 写真から選択

          <input
            className="hidden-file-input"
            type="file"
            accept="image/*"
            multiple
            onChange={handlePhotoChange}
            disabled={isSaving}
          />
        </label>

      </div>

      {isSaving && (
        <p className="saving-message">
          写真をブラウザへ保存しています……
        </p>
      )}

      {errorMessage && (
        <p className="error-message">{errorMessage}</p>
      )}

      <section className="photo-list-section">
        <div className="list-heading">
          <h2>未送信写真</h2>
          <span>{photos.length}件</span>
        </div>

        <button
          className="upload-button"
          onClick={uploadPhotos}
          disabled={isUploading || photos.length === 0}
        >

          {isUploading
            ? "送信中..."
            : "Boxへ送信"}

        </button>

        {photos.length === 0 ? (
          <p className="empty-message">
            保存されている写真はありません。
          </p>
        ) : (
          <div className="photo-list">
            {photos.map((photo) => (
              <StoredPhotoCard
                key={photo.id}
                photo={photo}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

export default App;