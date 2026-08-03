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

function createId(): string {
  if (typeof crypto.randomUUID === "function") {
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
  const imageBitmap = await createImageBitmap(source);

  const scale = Math.min(
    1,
    maxSize / Math.max(imageBitmap.width, imageBitmap.height)
  );

  const width = Math.max(
    1,
    Math.round(imageBitmap.width * scale)
  );

  const height = Math.max(
    1,
    Math.round(imageBitmap.height * scale)
  );

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");

  if (!context) {
    imageBitmap.close();
    throw new Error("Canvasを作成できませんでした。");
  }

  context.drawImage(
    imageBitmap,
    0,
    0,
    width,
    height
  );

  imageBitmap.close();

  const webpBlob = await new Promise<Blob | null>(
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

const MAKE_WEBHOOK_URL = "https://hook.us1.make.com/t4kttpgnjopclycliqczbyaqe1qb467v";

function App() {
  const [makeApiKey, setMakeApiKey] = useState("");
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [photos, setPhotos] = useState<StoredPhoto[]>([]);
  const [activeTab, setActiveTab] =
    useState<ActiveTab>("pending");

  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const loadPhotos = async () => {
    try {
      const savedPhotos = await getAllPhotos();
      setPhotos(savedPhotos);
    } catch (error) {
      console.error(error);
      setErrorMessage(
        "保存済み写真を読み込めませんでした。"
      );
    }
  };

  const testMakeWebhookOnly = async () => {
    const firstPhoto = pendingPhotos[0];

    if (!firstPhoto?.file) {
      alert("未送信写真を1枚用意してください。");
      return;
    }

    const formData = new FormData();

    formData.append(
      "file",
      new File([firstPhoto.file], firstPhoto.fileName, {
        type: firstPhoto.fileType || "application/octet-stream",
      })
    );

    formData.append("fileName", firstPhoto.fileName);
    formData.append("photoId", firstPhoto.id);
    formData.append("createdAt", firstPhoto.createdAt);
    formData.append("fileSize", String(firstPhoto.fileSize));

    try {
      const response = await fetch(MAKE_WEBHOOK_URL, {
        method: "POST",
        body: formData,
      });

      alert(`Make応答：HTTP ${response.status}`);
    } catch (error) {
      console.error(error);

      alert(
        error instanceof Error
          ? error.message
          : "Makeへの通信に失敗しました。"
      );
    }
  };

  // 未送信と送信済みを分ける
  const pendingPhotos = photos.filter(
    (photo) => photo.status !== "sent"
  );

  const sentPhotos = photos.filter(
    (photo) => photo.status === "sent"
  );

  // アプリ起動時：
  // 7日を超えた送信済み履歴を削除して一覧を読み込む
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

  // オンライン・オフライン状態を監視
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

  // ダミーBox送信
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

    try {
      // 現時点ではBox送信を再現するため2秒待機
      await new Promise((resolve) =>
        setTimeout(resolve, 2000)
      );

      const sentAt = new Date().toISOString();

      for (const photo of pendingPhotos) {
        if (!photo.file) {
          continue;
        }

        // 原寸写真から小さいサムネイルを作る
        const thumbnail = await createThumbnail(photo.file);

        const sentPhoto: StoredPhoto = {
          ...photo,

          // 原寸画像はブラウザDBから外す
          file: undefined,

          // 小さいサムネイルだけ7日間残す
          thumbnail,

          status: "sent",
          sentAt,

          // 現在はダミー値
          boxFileId: `dummy-${photo.id}`,
          boxUrl: "",
          errorMessage: undefined,
        };

        await updatePhoto(sentPhoto);
      }

      await loadPhotos();

      // 送信済みタブへ自動で移動
      setActiveTab("sent");

      alert("Boxへ送信しました（ダミー）");
    } catch (error) {
      console.error(error);
      setErrorMessage(
        "写真の送信処理に失敗しました。"
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

    const newPhotos: StoredPhoto[] = selectedFiles.map(
      (file) => ({
        id: createId(),
        file,
        thumbnail: undefined,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        createdAt: new Date().toISOString(),
        status: "pending",
      })
    );

    try {
      // 必ず先にIndexedDBへ保存
      await savePhotos(newPhotos);

      await loadPhotos();

      // 登録後は未送信タブへ移動
      setActiveTab("pending");

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
      setErrorMessage("写真の削除に失敗しました。");
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
        <span className="network-dot">●</span>

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
        <p className="error-message">{errorMessage}</p>
      )}

      <section className="photo-list-section">
        <div className="photo-tabs">
          <button
            type="button"
            className={
              activeTab === "pending" ? "active" : ""
            }
            onClick={() => setActiveTab("pending")}
          >
            未送信 {pendingPhotos.length}件
          </button>

          <button
            type="button"
            className={
              activeTab === "sent" ? "active" : ""
            }
            onClick={() => setActiveTab("sent")}
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
            {displayedPhotos.map((photo) => (
              <StoredPhotoCard
                key={photo.id}
                photo={photo}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}

        {activeTab === "sent" &&
          sentPhotos.length > 0 && (
            <p className="history-note">
              送信済み履歴とサムネイルは7日間保存されます。
            </p>
          )}
      </section>
      <label className="token-field">
        <span>Make Webhook APIキー</span>

        <input
          type="password"
          value={makeApiKey}
          onChange={(event) =>
            setMakeApiKey(event.target.value)
          }
          placeholder="テスト用APIキーを入力"
          autoComplete="off"
        />

        <small>
          APIキーは保存されず、再読み込みすると消えます。
        </small>
      </label>
      <button
        type="button"
        className="upload-button"
        onClick={testMakeWebhookOnly}
        disabled={pendingPhotos.length === 0}
      >
        Make Webhook接続テスト
      </button>
    </main>
  );
}



export default App;