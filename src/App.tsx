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

/*
 * MakeのCustom Webhook URLを設定します。
 * URLの固有部分は、このチャットには貼らないでください。
 */
const MAKE_WEBHOOK_URL =
  "https://hook.us1.make.com/t4kttpgnjopclycliqczbyaqe1qb467v";

function createId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
}

/*
 * 送信済み履歴用のWebPサムネイルを作ります。
 * 長辺800px・品質90%です。
 */
async function createThumbnail(
  source: Blob,
  maxSize = 800
): Promise<Blob> {
  const imageBitmap = await createImageBitmap(source);

  const scale = Math.min(
    1,
    maxSize /
    Math.max(imageBitmap.width, imageBitmap.height)
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

  const webpBlob = await new Promise<Blob | null>(
    (resolve) => {
      canvas.toBlob(resolve, "image/webp", 0.9);
    }
  );

  if (!webpBlob) {
    throw new Error(
      "WebPサムネイルを作成できませんでした。"
    );
  }

  return webpBlob;
}

/*
 * 写真1枚をMake Webhookへ送ります。
 * Make側でBoxへのアップロードが完了し、
 * HTTP 200が返れば成功と判断します。
 */
async function uploadPhotoToMake(
  photo: StoredPhoto
): Promise<void> {
  if (!photo.file) {
    throw new Error("写真本体がありません。");
  }

  if (
    !MAKE_WEBHOOK_URL ||
    MAKE_WEBHOOK_URL.includes("ここを実際")
  ) {
    throw new Error(
      "Make Webhook URLが設定されていません。"
    );
  }

  const uploadFile = new File(
    [photo.file],
    photo.fileName,
    {
      type:
        photo.fileType ||
        photo.file.type ||
        "application/octet-stream",
    }
  );

  const formData = new FormData();

  formData.append("file", uploadFile);
  formData.append("fileName", photo.fileName);
  formData.append("photoId", photo.id);
  formData.append("createdAt", photo.createdAt);
  formData.append(
    "fileSize",
    String(photo.fileSize)
  );

  const response = await fetch(MAKE_WEBHOOK_URL, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(
      `Makeへの送信に失敗しました。HTTP ${response.status}`
    );
  }
}

function App() {
  const [isOnline, setIsOnline] = useState(
    navigator.onLine
  );

  const [photos, setPhotos] = useState<
    StoredPhoto[]
  >([]);

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
      const savedPhotos = await getAllPhotos();
      setPhotos(savedPhotos);
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

  /*
   * 起動時に7日を超えた送信履歴を削除し、
   * IndexedDBから一覧を読み込みます。
   */
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

  /*
   * オンライン・オフラインの変化を監視します。
   */
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

  /*
   * 未送信写真を順番にMakeへ送ります。
   * 成功した写真だけ送信済みに変更します。
   */
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

        /*
         * Make経由でBoxへ原寸写真を送信
         */
        await uploadPhotoToMake(photo);

        /*
         * Box送信成功後に履歴用サムネイルを作成
         */
        const thumbnail =
          await createThumbnail(photo.file);

        const sentPhoto: StoredPhoto = {
          ...photo,

          /*
           * 原寸写真はIndexedDBから外します。
           */
          file: undefined,

          /*
           * WebPサムネイルだけ7日間保持します。
           */
          thumbnail,

          status: "sent",
          sentAt: new Date().toISOString(),

          /*
           * MakeからBoxファイルIDを
           * まだ返していないため空欄です。
           */
          boxFileId: "",
          boxUrl: "",
          errorMessage: undefined,
        };

        await updatePhoto(sentPhoto);
        successCount += 1;
      }

      await loadPhotos();

      /*
       * 送信後は送信済みタブへ移動します。
       */
      setActiveTab("sent");

      alert(
        `${successCount}件をBoxへ送信しました。`
      );
    } catch (error) {
      console.error(error);

      /*
       * 途中まで成功した写真の状態も
       * 画面へ反映します。
       */
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

  /*
   * カメラ撮影・写真選択時の保存処理
   */
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
        createdAt: new Date().toISOString(),
        status: "pending",
      }));

    try {
      /*
       * 通信状態に関係なく、
       * 必ず先にIndexedDBへ保存します。
       */
      await savePhotos(newPhotos);
      await loadPhotos();

      setActiveTab("pending");

      /*
       * 同じファイルを再選択できるようにします。
       */
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
              送信済み履歴とサムネイルは
              7日間保存されます。
            </p>
          )}
      </section>
    </main>
  );
}

export default App;