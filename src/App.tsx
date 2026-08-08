import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type {
  ChangeEvent,
} from "react";

import "./App.css";

import {
  checkForPwaUpdate,
} from "./pwa";

import StoredPhotoCard
  from "./components/StoredPhotoCard";

import PhotoViewer
  from "./components/PhotoViewer";

import {
  deleteExpiredSentPhotos,
  deletePhoto,
  getAllPhotos,
  savePhotos,
  updatePhoto,
} from "./db/photoDb";

import type {
  StoredPhoto,
} from "./types/Photo";

type ActiveTab =
  | "pending"
  | "sent";

const MAKE_WEBHOOK_URL =
  "YOUR_CURRENT_MAKE_WEBHOOK_URL";

function createId(): string {
  if (
    typeof crypto.randomUUID ===
    "function"
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

  const scale =
    Math.min(
      1,
      maxSize /
        Math.max(
          imageBitmap.width,
          imageBitmap.height
        )
    );

  const width =
    Math.max(
      1,
      Math.round(
        imageBitmap.width *
          scale
      )
    );

  const height =
    Math.max(
      1,
      Math.round(
        imageBitmap.height *
          scale
      )
    );

  const canvas =
    document.createElement(
      "canvas"
    );

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

  const blob =
    await new Promise<
      Blob | null
    >((resolve) => {
      canvas.toBlob(
        resolve,
        "image/webp",
        0.9
      );
    });

  if (!blob) {
    throw new Error(
      "WebPサムネイルを作成できませんでした。"
    );
  }

  return blob;
}

function createUploadFileName(
  photo: StoredPhoto
): string {
  const createdAt =
    new Date(photo.createdAt);

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
      ? photo.tags.join("_")
      : "タグなし";

  const idPart =
    photo.id
      .replace(
        /[^a-zA-Z0-9]/g,
        ""
      )
      .slice(0, 8);

  const extension =
    photo.fileName.match(
      /\.[^.]+$/
    )?.[0] ?? "";

  const originalName =
    photo.fileName
      .replace(
        /\.[^.]+$/,
        ""
      )
      .replace(
        /[\\/:*?"<>|]/g,
        "_"
      )
      .slice(0, 40);

  return `${datePart}_${timePart}_${tagPart}_${idPart}_${originalName}${extension}`;
}

async function uploadPhotoToMake(
  photo: StoredPhoto,
  uploadFileName: string
): Promise<void> {
  if (!photo.file) {
    throw new Error(
      "写真本体がありません。"
    );
  }

  if (
    !MAKE_WEBHOOK_URL ||
    MAKE_WEBHOOK_URL ===
      "YOUR_CURRENT_MAKE_WEBHOOK_URL"
  ) {
    throw new Error(
      "Make Webhook URLをApp.tsxへ設定してください。"
    );
  }

  const uploadFile =
    new File(
      [photo.file],
      uploadFileName,
      {
        type:
          photo.fileType ||
          photo.file.type ||
          "application/octet-stream",
      }
    );

  const formData =
    new FormData();

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

  formData.append(
    "tags",
    JSON.stringify(
      photo.tags ?? []
    )
  );

  const controller =
    new AbortController();

  const timer =
    window.setTimeout(
      () => controller.abort(),
      60_000
    );

  try {
    const response =
      await fetch(
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
        "通信が不安定なため送信を中断しました。写真は端末に残っています。"
      );
    }

    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function App() {
  const [
    isOnline,
    setIsOnline,
  ] =
    useState(
      navigator.onLine
    );

  const [
    photos,
    setPhotos,
  ] =
    useState<
      StoredPhoto[]
    >([]);

  const [
    activeTab,
    setActiveTab,
  ] =
    useState<ActiveTab>(
      "pending"
    );

  const [
    previewPhotoId,
    setPreviewPhotoId,
  ] =
    useState<string | null>(
      null
    );

  const [
    isSaving,
    setIsSaving,
  ] =
    useState(false);

  const [
    isUploading,
    setIsUploading,
  ] =
    useState(false);

  const [
    errorMessage,
    setErrorMessage,
  ] =
    useState("");

  const [
    isRefreshing,
    setIsRefreshing,
  ] =
    useState(false);

  const [
    isRestoringScroll,
    setIsRestoringScroll,
  ] =
    useState(false);

  const scrollMemory =
    useRef<
      Record<
        ActiveTab,
        number
      >
    >({
      pending: 0,
      sent: 0,
    });

  /*
   * Androidではstate更新とscrollイベントのタイミングがずれることがあるため、
   * 判定用にはrefも併用します。
   */
  const activeTabRef =
    useRef<ActiveTab>(
      "pending"
    );

  const restoringScrollRef =
    useRef(false);

  const restoreTabRef =
    useRef<ActiveTab | null>(
      null
    );

  const loadPhotos =
    async () => {
      const saved =
        await getAllPhotos();

      setPhotos(
        saved.map(
          (photo) => ({
            ...photo,
            tags:
              photo.tags ??
              [],
          })
        )
      );
    };

  const pendingPhotos =
    photos.filter(
      (photo) =>
        photo.status !==
        "sent"
    );

  const sentPhotos =
    photos.filter(
      (photo) =>
        photo.status ===
        "sent"
    );

  const displayedPhotos =
    activeTab ===
    "pending"
      ? pendingPhotos
      : sentPhotos;

  useEffect(() => {
    const initialize =
      async () => {
        try {
          if (
            navigator.storage
              ?.persist
          ) {
            const granted =
              await navigator.storage
                .persist();

            console.log(
              "Persistent storage:",
              granted
            );
          }

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
    activeTabRef.current =
      activeTab;
  }, [activeTab]);

  useEffect(() => {
    const online =
      () => {
        setIsOnline(true);
      };

    const offline =
      () => {
        setIsOnline(false);
      };

    window.addEventListener(
      "online",
      online
    );

    window.addEventListener(
      "offline",
      offline
    );

    return () => {
      window.removeEventListener(
        "online",
        online
      );

      window.removeEventListener(
        "offline",
        offline
      );
    };
  }, []);

  /*
   * 現在のタブのスクロール位置を記憶。
   * Androidで切替中のscrollイベントが前タブの保存値を上書きしないよう、
   * restoringScrollRefで同期的にロックします。
   */
  useEffect(() => {
    const remember =
      () => {
        if (
          restoringScrollRef.current
        ) {
          return;
        }

        scrollMemory.current[
          activeTabRef.current
        ] =
          window.scrollY;
      };

    window.addEventListener(
      "scroll",
      remember,
      {
        passive: true,
      }
    );

    return () => {
      window.removeEventListener(
        "scroll",
        remember
      );
    };
  }, []);

  /*
   * タブ切替後、一覧を隠したまま保存位置へ復元します。
   *
   * Androidでは画像の高さ確定前にscrollToすると、
   * その時点の最大スクロール量へ丸められてしまうことがあります。
   * そのため画像decode後にも再度同じ位置へ補正します。
   */
  useLayoutEffect(() => {
    if (
      restoreTabRef.current !==
      activeTab
    ) {
      return;
    }

    restoreTabRef.current =
      null;

    const targetY =
      scrollMemory.current[
        activeTab
      ];

    let cancelled =
      false;

    const restore =
      () => {
        if (cancelled) {
          return;
        }

        window.scrollTo({
          top: targetY,
          behavior: "auto",
        });
      };

    const finish =
      async () => {
        restore();

        await new Promise<void>(
          (resolve) => {
            requestAnimationFrame(
              () =>
                requestAnimationFrame(
                  () => resolve()
                )
            );
          }
        );

        restore();

        /*
         * 表示中一覧の画像が読み込まれて高さが確定するのを待つ。
         */
        const images =
          Array.from(
            document.querySelectorAll<
              HTMLImageElement
            >(
              ".swipe-page img"
            )
          );

        await Promise.race([
          Promise.all(
            images.map(
              async (image) => {
                if (
                  image.complete &&
                  image.naturalWidth > 0
                ) {
                  return;
                }

                try {
                  await image.decode();
                } catch {
                  // decode失敗でも続行
                }
              }
            )
          ),
          new Promise<void>(
            (resolve) => {
              window.setTimeout(
                resolve,
                350
              );
            }
          ),
        ]);

        restore();

        await new Promise<void>(
          (resolve) => {
            requestAnimationFrame(
              () => resolve()
            );
          }
        );

        restore();

        if (!cancelled) {
          restoringScrollRef.current =
            false;

          setIsRestoringScroll(
            false
          );
        }
      };

      void finish();

      return () => {
        cancelled = true;
      };
  }, [activeTab]);

  const switchTab =
    (
      nextTab:
        ActiveTab
    ) => {
      const currentTab =
        activeTabRef.current;

      if (
        nextTab ===
        currentTab
      ) {
        return;
      }

      /*
       * state更新より先に同期的に保存・ロック。
       * これでAndroidの途中scrollイベントに上書きされません。
       */
      scrollMemory.current[
        currentTab
      ] =
        window.scrollY;

      restoringScrollRef.current =
        true;

      setIsRestoringScroll(
        true
      );

      restoreTabRef.current =
        nextTab;

      activeTabRef.current =
        nextTab;

      setActiveTab(
        nextTab
      );
    };

  const handleRefresh =
    async () => {
      if (isRefreshing) {
        return;
      }

      try {
        setIsRefreshing(
          true
        );

        setErrorMessage(
          ""
        );

        /*
         * ① まずPWAの最新版を確認。
         *
         * 新しいService Workerが見つかった場合は、
         * vite-plugin-pwaのautoUpdateにより
         * 新版へ切り替わり、ページが再読込される場合があります。
         */
        const pwaUpdateFound =
          await checkForPwaUpdate();

        /*
         * ② PWA更新が無い場合でも、
         * IndexedDBから写真一覧を読み直します。
         *
         * 一度カードをアンマウントすることで
         * BlobのObject URLも作り直します。
         */
        setPhotos([]);

        await new Promise<void>(
          (resolve) => {
            requestAnimationFrame(
              () => resolve()
            );
          }
        );

        await loadPhotos();

        if (
          pwaUpdateFound
        ) {
          console.log(
            "新しいPWAを検出しました。更新を適用します。"
          );
        }
      } catch (error) {
        console.error(
          error
        );

        /*
         * PWA更新確認に失敗しても、
         * 写真一覧の再読み込みは試します。
         */
        try {
          setPhotos([]);

          await new Promise<void>(
            (resolve) => {
              requestAnimationFrame(
                () => resolve()
              );
            }
          );

          await loadPhotos();
        } catch (
          reloadError
        ) {
          console.error(
            reloadError
          );
        }

        setErrorMessage(
          "更新処理に失敗しました。通信状態を確認してください。"
        );
      } finally {
        setIsRefreshing(
          false
        );
      }
    };

  const handlePhotoChange =
    async (
      event:
        ChangeEvent<HTMLInputElement>
    ) => {
      const files =
        Array.from(
          event.target.files ??
            []
        );

      if (
        files.length === 0
      ) {
        return;
      }

      setIsSaving(true);
      setErrorMessage("");

      const newPhotos:
        StoredPhoto[] =
        files.map(
          (file) => ({
            id:
              createId(),

            file,

            thumbnail:
              undefined,

            fileName:
              file.name,

            fileType:
              file.type,

            fileSize:
              file.size,

            createdAt:
              new Date()
                .toISOString(),

            status:
              "pending",

            tags: [],
          })
        );

      try {
        await savePhotos(
          newPhotos
        );

        await loadPhotos();

        /*
         * 新しく撮影/選択した写真を保存したら、
         * 未送信画面は必ず一番上から表示します。
         */
        scrollMemory.current.pending =
          0;

        if (
          activeTabRef.current !==
          "pending"
        ) {
          switchTab(
            "pending"
          );
        } else {
          restoringScrollRef.current =
            true;

          setIsRestoringScroll(
            true
          );

          window.scrollTo({
            top: 0,
            behavior: "auto",
          });

          requestAnimationFrame(
            () => {
              window.scrollTo({
                top: 0,
                behavior: "auto",
              });

              restoringScrollRef.current =
                false;

              setIsRestoringScroll(
                false
              );
            }
          );
        }
      } catch (error) {
        console.error(error);

        setErrorMessage(
          "写真の保存に失敗しました。"
        );
      } finally {
        event.target.value =
          "";

        setIsSaving(false);
      }
    };

  const handleTagsChange =
    async (
      id: string,
      tags: string[]
    ) => {
      const target =
        photos.find(
          (photo) =>
            photo.id === id
        );

      if (!target) {
        return;
      }

      const updated:
        StoredPhoto = {
        ...target,
        tags,
      };

      setPhotos(
        (current) =>
          current.map(
            (photo) =>
              photo.id === id
                ? updated
                : photo
          )
      );

      try {
        await updatePhoto(
          updated
        );
      } catch (error) {
        console.error(error);
        await loadPhotos();

        setErrorMessage(
          "タグの保存に失敗しました。"
        );

        throw error;
      }
    };

  const handleDelete =
    async (
      id: string
    ) => {
      if (
        !window.confirm(
          "削除しますか？"
        )
      ) {
        return;
      }

      try {
        await deletePhoto(id);
        await loadPhotos();
      } catch (error) {
        console.error(error);

        setErrorMessage(
          "削除に失敗しました。"
        );
      }
    };

  const uploadPhotos =
    async () => {
      if (
        !isOnline ||
        isUploading ||
        pendingPhotos.length ===
          0
      ) {
        return;
      }

      setIsUploading(true);
      setErrorMessage("");

      let successCount = 0;

      try {
        for (
          const photo
          of pendingPhotos
        ) {
          if (!photo.file) {
            continue;
          }

          const uploadedFileName =
            createUploadFileName(
              photo
            );

          await uploadPhotoToMake(
            photo,
            uploadedFileName
          );

          const thumbnail =
            await createThumbnail(
              photo.file
            );

          const sentPhoto:
            StoredPhoto = {
            ...photo,

            file:
              undefined,

            thumbnail,

            uploadedFileName,

            status:
              "sent",

            sentAt:
              new Date()
                .toISOString(),

            errorMessage:
              undefined,
          };

          await updatePhoto(
            sentPhoto
          );

          successCount += 1;
        }

        await loadPhotos();

        if (
          activeTab !==
          "sent"
        ) {
          switchTab(
            "sent"
          );
        }

        alert(
          `${successCount}件をBoxへ送信しました。`
        );
      } catch (error) {
        console.error(error);
        await loadPhotos();

        setErrorMessage(
          error instanceof Error
            ? error.message
            : "送信に失敗しました。"
        );
      } finally {
        setIsUploading(false);
      }
    };


  return (
    <main className="container">
      <div className="title-row">
        <h1>
          📷 Box Photo Uploader
        </h1>

        <button
          type="button"
          className="refresh-button"
          onClick={() =>
            void handleRefresh()
          }
          disabled={
            isRefreshing
          }
          aria-label="アプリと写真一覧を更新"
          title="アプリと写真一覧を更新"
        >
          {isRefreshing
            ? "…"
            : "↻"}
        </button>
      </div>

      <div
        className={
          isOnline
            ? "network-status online"
            : "network-status offline"
        }
      >
        <span>●</span>

        {isOnline
          ? "オンライン：Boxへ送信できます"
          : "オフライン：端末に保存します"}
      </div>

      <div className="photo-actions">
        <label className="photo-action-button">
          📷 カメラで撮影

          <input
            className="hidden-file-input"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={
              handlePhotoChange
            }
            disabled={
              isSaving
            }
          />
        </label>

        <label className="photo-action-button secondary">
          🖼 写真から選択

          <input
            className="hidden-file-input"
            type="file"
            accept="image/*"
            multiple
            onChange={
              handlePhotoChange
            }
            disabled={
              isSaving
            }
          />
        </label>
      </div>

      {isSaving && (
        <p className="saving-message">
          写真を端末へ保存しています……
        </p>
      )}

      {errorMessage && (
        <p className="error-message">
          {errorMessage}
        </p>
      )}

      {/*
       * ここだけsticky。
       * タイトルや撮影ボタンは普通に上へ消えます。
       */}
      <div className="sticky-tab-area">
        <div className="photo-tabs">
          <button
            type="button"
            className={
              activeTab ===
              "pending"
                ? "active pending"
                : ""
            }
            onClick={() =>
              switchTab(
                "pending"
              )
            }
          >
            未送信
            <span>
              {pendingPhotos.length}
            </span>
          </button>

          <button
            type="button"
            className={
              activeTab ===
              "sent"
                ? "active sent"
                : ""
            }
            onClick={() =>
              switchTab(
                "sent"
              )
            }
          >
            送信済み
            <span>
              {sentPhotos.length}
            </span>
          </button>
        </div>
      </div>

      <div
        className={
          isRestoringScroll
            ? "swipe-page restoring-scroll"
            : "swipe-page"
        }
      >
        {activeTab ===
          "pending" && (
          <button
            type="button"
            className="upload-button"
            onClick={
              uploadPhotos
            }
            disabled={
              !isOnline ||
              isUploading ||
              pendingPhotos.length ===
                0
            }
          >
            {isUploading
              ? "送信中…"
              : !isOnline
                ? "オフラインのため送信できません"
                : `未送信 ${pendingPhotos.length}件をBoxへ送信`}
          </button>
        )}

        {displayedPhotos.length ===
        0 ? (
          <p className="empty-message">
            {activeTab ===
            "pending"
              ? "未送信写真はありません。"
              : "送信済み写真はありません。"}
          </p>
        ) : (
          <div className="photo-list">
            {displayedPhotos.map(
              (photo) => (
                <StoredPhotoCard
                  key={
                    photo.id
                  }
                  photo={
                    photo
                  }
                  onDelete={
                    handleDelete
                  }
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

      </div>

      <label className="floating-camera-button">
        📷

        <input
          className="hidden-file-input"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={
            handlePhotoChange
          }
          disabled={
            isSaving
          }
        />
      </label>

      {previewPhotoId && (
        <PhotoViewer
          photos={
            displayedPhotos
          }
          initialPhotoId={
            previewPhotoId
          }
          onClose={() =>
            setPreviewPhotoId(
              null
            )
          }
        />
      )}
    </main>
  );
}

export default App;