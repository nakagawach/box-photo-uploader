import {
  useEffect,
  useState,
} from "react";
import type { ChangeEvent } from "react";
import "./App.css";
import StoredPhotoCard from "./components/StoredPhotoCard";
import PhotoViewer from "./components/PhotoViewer";
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
      "サムネイルを作成できませんでした。"
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

function sanitizeFileNamePart(
  value: string
): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_");
}

function createBoxFileName(
  photo: StoredPhoto
): string {
  const createdAt = new Date(
    photo.createdAt
  );

  const datePart = [
    createdAt.getFullYear(),
    String(
      createdAt.getMonth() + 1
    ).padStart(2, "0"),
    String(
      createdAt.getDate()
    ).padStart(2, "0"),
  ].join("");

  const timePart = [
    String(
      createdAt.getHours()
    ).padStart(2, "0"),
    String(
      createdAt.getMinutes()
    ).padStart(2, "0"),
    String(
      createdAt.getSeconds()
    ).padStart(2, "0"),
  ].join("");

  const tagPart =
    (photo.tags ?? []).length > 0
      ? photo.tags
          .map(sanitizeFileNamePart)
          .join("_")
      : "タグなし";

  const idPart = photo.id
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 8);

  const extension =
    photo.fileName.match(/\.[^.]+$/)?.[0] ??
    "";

  const originalBaseName =
    sanitizeFileNamePart(
      photo.fileName.replace(
        /\.[^.]+$/,
        ""
      )
    ).slice(0, 40);

  return [
    datePart,
    timePart,
    tagPart,
    idPart,
    originalBaseName,
  ].join("_") + extension;
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

  const boxFileName =
    createBoxFileName(photo);

  const uploadFile = new File(
    [photo.file],
    boxFileName,
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
    uploadFile,
    boxFileName
  );

  // 既存のMake設定との互換用
  formData.append(
    "fileName",
    boxFileName
  );

  formData.append(
    "boxFileName",
    boxFileName
  );

  formData.append(
    "originalFileName",
    photo.fileName
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

  formData.append(
    "tags",
    JSON.stringify(photo.tags ?? [])
  );

  const controller =
    new AbortController();

  const timeoutId = window.setTimeout(
    () => {
      controller.abort();
    },
    60_000
  );

  try {
    const response = await fetch(
      MAKE_WEBHOOK_URL,
      {
        method: "POST",
        body: formData,
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      throw new Error(
        `Makeへの送信に失敗しました。HTTP ${response.status}`
      );
    }
  } catch (error) {
    if (
      error instanceof DOMException &&
      error.name === "AbortError"
    ) {
      throw new Error(
        "通信が不安定なため送信を中断しました。写真は未送信のまま保存されています。"
      );
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function App() {
  const [isOnline, setIsOnline] =
    useState(navigator.onLine);

  const [photos, setPhotos] =
    useState<StoredPhoto[]>([]);

  const [activeTab, setActiveTab] =
    useState<ActiveTab>("pending");

  const [
    previewPhotoId,
    setPreviewPhotoId,
  ] = useState<string | null>(null);

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

  const displayedPhotos =
    activeTab === "pending"
      ? pendingPhotos
      : sentPhotos;

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
          await createThumbnail(photo.file);

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
    event: ChangeEvent<HTMLInputElement>
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

      {/* 上部のカメラ・写真選択ボタンも残す */}
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
                  onPreview={
                    setPreviewPhotoId
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

      {/* 右下固定カメラボタン */}
      <label
        className={
          isSaving
            ? "floating-camera-button disabled"
            : "floating-camera-button"
        }
        aria-label="カメラで撮影"
      >
        <span aria-hidden="true">
          📷
        </span>

        <input
          className="hidden-file-input"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handlePhotoChange}
          disabled={isSaving}
        />
      </label>

      {previewPhotoId && (
        <PhotoViewer
          photos={displayedPhotos}
          initialPhotoId={previewPhotoId}
          onClose={() =>
            setPreviewPhotoId(null)
          }
        />
      )}
    </main>
  );
}

export default App;