import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type {
  ChangeEvent,
  TouchEvent,
} from "react";

import "./App.css";

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

const TAB_ANIMATION_MS = 220;

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
    tabAnimationClass,
    setTabAnimationClass,
  ] =
    useState("");

  const [
    isRestoringScroll,
    setIsRestoringScroll,
  ] =
    useState(false);

  const tabTouchStartX =
    useRef<number | null>(
      null
    );

  const tabTouchStartY =
    useRef<number | null>(
      null
    );

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

  const restoreTabRef =
    useRef<ActiveTab | null>(
      null
    );

  const stickyTabRef =
    useRef<HTMLDivElement | null>(
      null
    );

  /*
   * Androidでタブ切替後にstickyヘッダーが少し見切れる場合があるため、
   * stickyタブの高さを使って復元位置を補正します。
   */
  const getStickyTopSafeY =
    () => {
      const sticky =
        stickyTabRef.current;

      if (!sticky) {
        return 0;
      }

      const rect =
        sticky.getBoundingClientRect();

      /*
       * stickyが上端を越えて見切れないよう、
       * 現在位置が負ならその分だけ下へ補正。
       */
      return Math.max(
        0,
        -rect.top
      );
    };

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
   * windowだけを使うので二重スクロールは発生しません。
   */
  useEffect(() => {
    const remember =
      () => {
        if (
          isRestoringScroll
        ) {
          return;
        }

        scrollMemory.current[
          activeTab
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
  }, [
    activeTab,
    isRestoringScroll,
  ]);

  /*
   * タブ切替後、一覧を一瞬だけ隠したまま
   * 保存位置へ戻してから表示します。
   *
   * 「違う位置が一瞬見える」ことを防ぎます。
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

    /*
     * stickyの位置はブラウザへ完全に任せます。
     * Android Chrome/PWAの可変ブラウザUIと競合するため、
     * getBoundingClientRect / scrollByによる手動補正はしません。
     */
    window.scrollTo({
      top: targetY,
      behavior: "auto",
    });

    requestAnimationFrame(
      () => {
        window.scrollTo({
          top: targetY,
          behavior: "auto",
        });

        setIsRestoringScroll(
          false
        );
      }
    );
  }, [activeTab]);

  const switchTab =
    (
      nextTab:
        ActiveTab
    ) => {
      if (
        nextTab ===
        activeTab
      ) {
        return;
      }

      scrollMemory.current[
        activeTab
      ] =
        window.scrollY;

      setIsRestoringScroll(
        true
      );

      setTabAnimationClass(
        nextTab === "sent"
          ? "slide-left"
          : "slide-right"
      );

      window.setTimeout(
        () => {
          restoreTabRef.current =
            nextTab;

          setActiveTab(
            nextTab
          );

          setTabAnimationClass(
            ""
          );
        },
        TAB_ANIMATION_MS
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
         * StoredPhotoCardを一度アンマウントし、
         * Object URLも作り直させます。
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
      } catch (error) {
        console.error(
          error
        );

        setErrorMessage(
          "写真一覧の再読み込みに失敗しました。"
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

        if (
          activeTab !==
          "pending"
        ) {
          switchTab(
            "pending"
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

  const handlePageTouchStart =
    (
      event:
        TouchEvent<HTMLDivElement>
    ) => {
      const touch =
        event.touches[0];

      if (!touch) {
        return;
      }

      tabTouchStartX.current =
        touch.clientX;

      tabTouchStartY.current =
        touch.clientY;
    };

  const handlePageTouchEnd =
    (
      event:
        TouchEvent<HTMLDivElement>
    ) => {
      if (
        tabTouchStartX.current ===
        null
      ) {
        return;
      }

      const touch =
        event.changedTouches[0];

      if (!touch) {
        return;
      }

      const dx =
        touch.clientX -
        tabTouchStartX.current;

      const dy =
        touch.clientY -
        (
          tabTouchStartY.current ??
          touch.clientY
        );

      tabTouchStartX.current =
        null;

      tabTouchStartY.current =
        null;

      /*
       * 縦スクロールを優先。
       * 横方向が明確なときだけタブ切替。
       */
      if (
        Math.abs(dx) <
          70 ||
        Math.abs(dx) <=
          Math.abs(dy) *
            1.25
      ) {
        return;
      }

      if (
        dx < 0 &&
        activeTab ===
          "pending"
      ) {
        switchTab(
          "sent"
        );
      }

      if (
        dx > 0 &&
        activeTab ===
          "sent"
      ) {
        switchTab(
          "pending"
        );
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
          aria-label="写真一覧を再読み込み"
          title="写真一覧を再読み込み"
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
          `swipe-page ${tabAnimationClass}` +
          (
            isRestoringScroll
              ? " restoring-scroll"
              : ""
          )
        }
        onTouchStart={
          handlePageTouchStart
        }
        onTouchEnd={
          handlePageTouchEnd
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

        <p className="swipe-guide">
          {activeTab ===
          "pending"
            ? "← スワイプで送信済み"
            : "スワイプで未送信 →"}
        </p>
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