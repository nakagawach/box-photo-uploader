import { useEffect, useState } from "react";
import "./App.css";
import StoredPhotoCard from "./components/StoredPhotoCard";
import {
  deleteExpiredSentPhotos,
  deletePhoto,
  getAllPhotos,
  savePhotos,
  updatePhoto,
} from "./db/photoDb";
import type { StoredPhoto } from "./types/Photo";

type ActiveTab = "pending" | "sent";

const MAKE_WEBHOOK_URL =
  "https://hook.us1.make.com/t4kttpgnjopclycliqczbyaqe1qb467v";

function createId(): string {
  if (
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
}

async function createThumbnail(
  source: Blob,
  maxSize = 800
): Promise<Blob> {
  const imageBitmap =
    await createImageBitmap(source);

  const scale = Math.min(
    1,
    maxSize /
    Math.max(
      imageBitmap.width,
      imageBitmap.height
    )
  );

  const width = Math.max(
    1,
    Math.round(
      imageBitmap.width * scale
    )
  );

  const height = Math.max(
    1,
    Math.round(
      imageBitmap.height * scale
    )
  );

  const canvas =
    document.createElement("canvas");

  canvas.width = width;
  canvas.height = height;

  const context =
    canvas.getContext("2d");

  if (!context) {
    imageBitmap.close();

    throw new Error(
      "サムネイル用Canvasを作成できませんでした。"
    );
  }

  context.drawImage(
    imageBitmap,
    0,
    0,
    width,
    height
  );

  imageBitmap.close();

  const webpBlob =
    await new Promise<Blob | null>(
      (resolve) => {
        canvas.toBlob(
          resolve,
          "image/webp",
          0.9
        );
      }
    );

  if (!webpBlob) {
    throw new Error(
      "WebPサムネイルを作成できませんでした。"
    );
  }

  return webpBlob;
}

function createUploadFileName(
  photo: StoredPhoto
): string {
  const createdAt = new Date(photo.createdAt);

  const datePart = [
    createdAt.getFullYear(),
    String(createdAt.getMonth() + 1).padStart(2, "0"),
    String(createdAt.getDate()).padStart(2, "0"),
  ].join("");

  const timePart = [
    String(createdAt.getHours()).padStart(2, "0"),
    String(createdAt.getMinutes()).padStart(2, "0"),
    String(createdAt.getSeconds()).padStart(2, "0"),
  ].join("");

  const tagPart =
    (photo.tags ?? []).length > 0
      ? photo.tags.join("_")
      : "タグなし";

  const idPart = photo.id
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 8);

  const extension =
    photo.fileName.match(/\.[^.]+$/)?.[0] ?? "";

  const originalName = photo.fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .slice(0, 40);

  return `${datePart}_${timePart}_${tagPart}_${idPart}_${originalName}${extension}`;
}

async function uploadPhotoToMake(
  photo: StoredPhoto
): Promise<void> {
  if (!photo.file) {
    throw new Error(
      "写真本体がありません。"
    );
  }

  if (
    !MAKE_WEBHOOK_URL ||
    MAKE_WEBHOOK_URL.includes(
      "実際のWebhook"
    )
  ) {
    throw new Error(
      "Make Webhook URLが設定されていません。"
    );
  }

  const uploadFileName =
    createUploadFileName(photo);

  const uploadFile = new File( 
    [photo.file],
    uploadFileName,
    {
      type:
        photo.fileType ||
        photo.file.type ||
        "application/octet-stream",
    }
  );

  const formData = new FormData();

  formData.append(
    "file",
    uploadFile
  );

  formData.append(
    "fileName",
    uploadFileName
  );

  formData.append(
    "photoId",
    photo.id
  );

  formData.append(
    "createdAt",
    photo.createdAt
  );

  formData.append(
    "fileSize",
    String(photo.fileSize)
  );

  /*
   * MakeにはJSON文字列としてタグを送ります。
   * 例：["境界標","接道"]
   */
  formData.append(
    "tags",
    JSON.stringify(photo.tags ?? [])
  );

  const response = await fetch(
    MAKE_WEBHOOK_URL,
    {
      method: "POST",
      body: formData,
    }
  );

  if (!response.ok) {
    throw new Error(
      `Makeへの送信に失敗しました。HTTP ${response.status}`
    );
  }
}

function App() {
  const [isOnline, setIsOnline] =
    useState(navigator.onLine);

  const [photos, setPhotos] =
    useState<StoredPhoto[]>([]);

  const [activeTab, setActiveTab] =
    useState<ActiveTab>("pending");

  const [isSaving, setIsSaving] =
    useState(false);

  const [isUploading, setIsUploading] =
    useState(false);

  const [errorMessage, setErrorMessage] =
    useState("");

  const loadPhotos = async () => {
    try {
      const savedPhotos =
        await getAllPhotos();

      /*
       * 過去に保存したデータにtagsがなくても
       * 動作するように補完します。
       */
      const normalizedPhotos =
        savedPhotos.map((photo) => ({
          ...photo,
          tags: photo.tags ?? [],
        }));

      setPhotos(normalizedPhotos);
    } catch (error) {
      console.error(error);

      setErrorMessage(
        "保存済み写真を読み込めませんでした。"
      );
    }
  };

  const pendingPhotos = photos.filter(
    (photo) => photo.status !== "sent"
  );

  const sentPhotos = photos.filter(
    (photo) => photo.status === "sent"
  );

  useEffect(() => {
    const initialize = async () => {
      try {
        await deleteExpiredSentPhotos();
        await loadPhotos();
      } catch (error) {
        console.error(error);

        setErrorMessage(
          "写真データの初期処理に失敗しました。"
        );
      }
    };

    void initialize();
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener(
      "online",
      handleOnline
    );

    window.addEventListener(
      "offline",
      handleOffline
    );

    return () => {
      window.removeEventListener(
        "online",
        handleOnline
      );

      window.removeEventListener(
        "offline",
        handleOffline
      );
    };
  }, []);

  const uploadPhotos = async () => {
    if (
      pendingPhotos.length === 0 ||
      !isOnline ||
      isUploading
    ) {
      return;
    }

    setIsUploading(true);
    setErrorMessage("");

    let successCount = 0;

    try {
      for (const photo of pendingPhotos) {
        if (!photo.file) {
          continue;
        }

        await uploadPhotoToMake(photo);

        const thumbnail =
          await createThumbnail(
            photo.file
          );

        const sentPhoto: StoredPhoto = {
          ...photo,
          tags: photo.tags ?? [],
          file: undefined,
          thumbnail,
          status: "sent",
          sentAt:
            new Date().toISOString(),
          boxFileId: "",
          boxUrl: "",
          errorMessage: undefined,
        };

        await updatePhoto(sentPhoto);

        successCount += 1;
      }

      await loadPhotos();
      setActiveTab("sent");

      alert(
        `${successCount}件をBoxへ送信しました。`
      );
    } catch (error) {
      console.error(error);

      await loadPhotos();

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Boxへの送信に失敗しました。"
      );
    } finally {
      setIsUploading(false);
    }
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

    const newPhotos: StoredPhoto[] =
      selectedFiles.map((file) => ({
        id: createId(),
        file,
        thumbnail: undefined,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        createdAt:
          new Date().toISOString(),
        status: "pending",
        tags: [],
      }));

    try {
      await savePhotos(newPhotos);
      await loadPhotos();

      setActiveTab("pending");

      event.target.value = "";
    } catch (error) {
      console.error(error);

      setErrorMessage(
        "写真の保存に失敗しました。"
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleTagsChange = async (
    id: string,
    tags: string[]
  ) => {
    const targetPhoto = photos.find(
      (photo) => photo.id === id
    );

    if (!targetPhoto) {
      return;
    }

    const updatedPhoto: StoredPhoto = {
      ...targetPhoto,
      tags,
    };

    /*
     * 先に画面を更新するため、
     * タップ直後にタグの色が変わります。
     */
    setPhotos((currentPhotos) =>
      currentPhotos.map((photo) =>
        photo.id === id
          ? updatedPhoto
          : photo
      )
    );

    try {
      await updatePhoto(updatedPhoto);
    } catch (error) {
      console.error(error);

      /*
       * 保存失敗時はIndexedDBから
       * 正しい状態を再読込します。
       */
      await loadPhotos();

      setErrorMessage(
        "タグの保存に失敗しました。"
      );

      throw error;
    }
  };

  const handleDelete = async (
    id: string
  ) => {
    const confirmed = window.confirm(
      "この写真または履歴を削除しますか？"
    );

    if (!confirmed) {
      return;
    }

    try {
      await deletePhoto(id);
      await loadPhotos();
    } catch (error) {
      console.error(error);

      setErrorMessage(
        "写真の削除に失敗しました。"
      );
    }
  };

  const displayedPhotos =
    activeTab === "pending"
      ? pendingPhotos
      : sentPhotos;

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
        <span className="network-dot">
          ●
        </span>

        {isOnline
          ? "オンライン：Boxへ送信できます"
          : "オフライン：写真はブラウザに保存されます"}
      </div>

      <div className="photo-actions">
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
        <p className="error-message">
          {errorMessage}
        </p>
      )}

      <section className="photo-list-section">
        <div className="photo-tabs">
          <button
            type="button"
            className={
              activeTab === "pending"
                ? "active"
                : ""
            }
            onClick={() =>
              setActiveTab("pending")
            }
          >
            未送信 {pendingPhotos.length}件
          </button>

          <button
            type="button"
            className={
              activeTab === "sent"
                ? "active"
                : ""
            }
            onClick={() =>
              setActiveTab("sent")
            }
          >
            送信済み {sentPhotos.length}件
          </button>
        </div>

        {activeTab === "pending" && (
          <button
            type="button"
            className="upload-button"
            onClick={uploadPhotos}
            disabled={
              isUploading ||
              pendingPhotos.length === 0 ||
              !isOnline
            }
          >
            {isUploading
              ? "送信中..."
              : !isOnline
                ? "オフラインのため送信できません"
                : `未送信${pendingPhotos.length}件をBoxへ送信`}
          </button>
        )}

        {displayedPhotos.length === 0 ? (
          <p className="empty-message">
            {activeTab === "pending"
              ? "未送信写真はありません。"
              : "送信済み履歴はありません。"}
          </p>
        ) : (
          <div className="photo-list">
            {displayedPhotos.map(
              (photo) => (
                <StoredPhotoCard
                  key={photo.id}
                  photo={photo}
                  onDelete={handleDelete}
                  onTagsChange={
                    handleTagsChange
                  }
                />
              )
            )}
          </div>
        )}

        {activeTab === "sent" &&
          sentPhotos.length > 0 && (
            <p className="history-note">
              送信済み履歴とサムネイルは
              7日間保存されます。
            </p>
          )}
      </section>
    </main>
  );
}

export default App;