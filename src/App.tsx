import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type {
  ChangeEvent,
  PointerEvent as ReactPointerEvent,
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

type TabGestureMode =
  | "none"
  | "pending"
  | "swipe";

const TAB_SLIDE_DURATION =
  260;

const TAB_GESTURE_LOCK =
  12;

const TAB_SWIPE_MIN =
  60;

/*
 * ★ここだけ、現在正常に動いているMake Webhook URLへ戻してください。
 */
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
    await createImageBitmap(
      source
    );

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

  canvas.width =
    width;

  canvas.height =
    height;

  const context =
    canvas.getContext(
      "2d"
    );

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
    >(
      (resolve) => {
        canvas.toBlob(
          resolve,
          "image/webp",
          0.9
        );
      }
    );

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
    new Date(
      photo.createdAt
    );

  const datePart = [
    createdAt.getFullYear(),

    String(
      createdAt.getMonth() +
        1
    ).padStart(
      2,
      "0"
    ),

    String(
      createdAt.getDate()
    ).padStart(
      2,
      "0"
    ),
  ].join("");

  const timePart = [
    String(
      createdAt.getHours()
    ).padStart(
      2,
      "0"
    ),

    String(
      createdAt.getMinutes()
    ).padStart(
      2,
      "0"
    ),

    String(
      createdAt.getSeconds()
    ).padStart(
      2,
      "0"
    ),
  ].join("");

  const tagPart =
    (photo.tags ?? [])
      .length > 0
      ? photo.tags.join(
          "_"
        )
      : "タグなし";

  const idPart =
    photo.id
      .replace(
        /[^a-zA-Z0-9]/g,
        ""
      )
      .slice(
        0,
        8
      );

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
      .slice(
        0,
        40
      );

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
    String(
      photo.fileSize
    )
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
      () =>
        controller.abort(),
      60_000
    );

  try {
    const response =
      await fetch(
        MAKE_WEBHOOK_URL,
        {
          method:
            "POST",

          body:
            formData,

          signal:
            controller.signal,
        }
      );

    if (
      !response.ok
    ) {
      throw new Error(
        `Makeへの送信に失敗しました。HTTP ${response.status}`
      );
    }
  } catch (error) {
    if (
      error instanceof
        DOMException &&
      error.name ===
        "AbortError"
    ) {
      throw new Error(
        "通信が不安定なため送信を中断しました。写真は端末に残っています。"
      );
    }

    throw error;
  } finally {
    window.clearTimeout(
      timer
    );
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
    useState<
      string | null
    >(null);

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


  /*
   * タブ下の2画面は横並びのままDOMに常駐させます。
   * ただし縦スクロールはブラウザ(window)の1本だけです。
   *
   * タブごとのwindow.scrollYを記憶し、
   * 切替中は2画面のうち高い方の高さをviewportへ確保することで、
   * 「送信済み0件」へ切り替えてもページ高が急に縮まず、
   * Android ChromeにscrollYを勝手に補正されにくくします。
   */
  const tabViewportRef =
    useRef<HTMLDivElement | null>(
      null
    );

  const scrollMemoryRef =
    useRef<Record<ActiveTab, number>>({
      pending: 0,
      sent: 0,
    });

  const [
    paneHeights,
    setPaneHeights,
  ] =
    useState({
      pending: 0,
      sent: 0,
    });

  const tabSwitchTargetRef =
    useRef<ActiveTab | null>(
      null
    );

  const [
    tabViewportWidth,
    setTabViewportWidth,
  ] =
    useState(
      window.innerWidth
    );

  const [
    tabDragX,
    setTabDragX,
  ] =
    useState(0);

  const tabDragXRef =
    useRef(0);

  const [
    tabAnimating,
    setTabAnimating,
  ] =
    useState(false);

  const tabGestureModeRef =
    useRef<TabGestureMode>(
      "none"
    );

  const tabPointerIdRef =
    useRef<
      number | null
    >(null);

  const tabStartRef =
    useRef({
      x: 0,
      y: 0,
    });

  const pendingPaneRef =
    useRef<HTMLElement | null>(
      null
    );

  const sentPaneRef =
    useRef<HTMLElement | null>(
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
            navigator
              .storage
              ?.persist
          ) {
            const granted =
              await navigator
                .storage
                .persist();

            console.log(
              "Persistent storage:",
              granted
            );
          }

          await deleteExpiredSentPhotos();

          await loadPhotos();
        } catch (
          error
        ) {
          console.error(
            error
          );

          setErrorMessage(
            "写真データの初期処理に失敗しました。"
          );
        }
      };

    void initialize();
  }, []);

  useEffect(() => {
    const online =
      () =>
        setIsOnline(
          true
        );

    const offline =
      () =>
        setIsOnline(
          false
        );

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
   * タブviewport幅を追跡。
   */
  const updateTabWidth =
    useCallback(() => {
      const width =
        tabViewportRef.current
          ?.clientWidth ??
        window.innerWidth;

      setTabViewportWidth(
        width
      );
    }, []);

  useEffect(() => {
    updateTabWidth();

    window.addEventListener(
      "resize",
      updateTabWidth
    );

    return () => {
      window.removeEventListener(
        "resize",
        updateTabWidth
      );
    };
  }, [updateTabWidth]);

  /*
   * 両paneの実コンテンツ高を監視します。
   * viewportは常に高い方へ合わせるため、
   * 短いタブへ切り替えてもページ全体の高さが急に縮みません。
   */
  useEffect(() => {
    const pending =
      pendingPaneRef.current;

    const sent =
      sentPaneRef.current;

    if (!pending || !sent) {
      return;
    }

    const measure = () => {
      setPaneHeights({
        pending:
          pending.scrollHeight,
        sent:
          sent.scrollHeight,
      });
    };

    measure();

    const observer =
      new ResizeObserver(
        measure
      );

    observer.observe(
      pending
    );

    observer.observe(
      sent
    );

    window.addEventListener(
      "resize",
      measure
    );

    return () => {
      observer.disconnect();

      window.removeEventListener(
        "resize",
        measure
      );
    };
  }, [
    photos,
    isUploading,
    isOnline,
  ]);

  /*
   * 現在のタブのwindowスクロール位置を常時記憶。
   * 内側スクロールは使いません。
   */
  useEffect(() => {
    const rememberScroll =
      () => {
        if (
          tabSwitchTargetRef.current
        ) {
          return;
        }

        scrollMemoryRef.current[
          activeTab
        ] =
          window.scrollY;
      };

    window.addEventListener(
      "scroll",
      rememberScroll,
      {
        passive: true,
      }
    );

    return () => {
      window.removeEventListener(
        "scroll",
        rememberScroll
      );
    };
  }, [activeTab]);

  const restoreWindowScroll =
    (
      tab: ActiveTab
    ) => {
      const targetY =
        scrollMemoryRef.current[
          tab
        ];

      requestAnimationFrame(
        () => {
          window.scrollTo({
            top:
              targetY,
            behavior:
              "auto",
          });

          requestAnimationFrame(
            () => {
              window.scrollTo({
                top:
                  targetY,
                behavior:
                  "auto",
              });

              tabSwitchTargetRef.current =
                null;
            }
          );
        }
      );
    };

  const syncTabDrag =
    (
      value: number
    ) => {
      tabDragXRef.current =
        value;

      setTabDragX(
        value
      );
    };

  /*
   * activeTabをボタンから切り替える場合も
   * 横スライドアニメーションさせます。
   */
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

      /*
       * 切替前の位置を確定保存。
       */
      scrollMemoryRef.current[
        activeTab
      ] =
        window.scrollY;

      tabSwitchTargetRef.current =
        nextTab;

      setTabAnimating(
        true
      );

      syncTabDrag(
        0
      );

      setActiveTab(
        nextTab
      );
    };

  /*
   * transitionendが発火しない環境向けの保険。
   */
  useEffect(() => {
    if (
      !tabAnimating ||
      !tabSwitchTargetRef.current
    ) {
      return;
    }

    const timer =
      window.setTimeout(
        () => {
          const target =
            tabSwitchTargetRef.current;

          if (!target) {
            return;
          }

          setTabAnimating(
            false
          );

          restoreWindowScroll(
            target
          );
        },
        TAB_SLIDE_DURATION +
          80
      );

    return () => {
      window.clearTimeout(
        timer
      );
    };
  }, [
    activeTab,
    tabAnimating,
  ]);

  const handleTabPointerDown =
    (
      event:
        ReactPointerEvent<HTMLDivElement>
    ) => {
      /*
       * ボタン・リンク・タグ操作等から始まった場合は
       * タブスワイプとして扱いません。
       */
      const target =
        event.target as
          HTMLElement;

      if (
        target.closest(
          "button, a, input, label"
        )
      ) {
        return;
      }

      if (
        event.pointerType ===
          "mouse" &&
        event.button !== 0
      ) {
        return;
      }

      tabPointerIdRef.current =
        event.pointerId;

      tabStartRef.current = {
        x:
          event.clientX,

        y:
          event.clientY,
      };

      tabGestureModeRef.current =
        "pending";

      setTabAnimating(
        false
      );

      syncTabDrag(
        0
      );
    };

  const handleTabPointerMove =
    (
      event:
        ReactPointerEvent<HTMLDivElement>
    ) => {
      if (
        event.pointerId !==
        tabPointerIdRef.current
      ) {
        return;
      }

      const dx =
        event.clientX -
        tabStartRef.current.x;

      const dy =
        event.clientY -
        tabStartRef.current.y;

      if (
        tabGestureModeRef.current ===
        "pending"
      ) {
        if (
          Math.abs(dx) <
            TAB_GESTURE_LOCK &&
          Math.abs(dy) <
            TAB_GESTURE_LOCK
        ) {
          return;
        }

        /*
         * 縦操作が優勢ならブラウザの通常スクロールに任せます。
         */
        if (
          Math.abs(dy) >
          Math.abs(dx)
        ) {
          tabGestureModeRef.current =
            "none";

          tabPointerIdRef.current =
            null;

          return;
        }

        if (
          Math.abs(dx) >
          Math.abs(dy) *
            1.05
        ) {
          tabGestureModeRef.current =
            "swipe";

          try {
            event.currentTarget
              .setPointerCapture(
                event.pointerId
              );
          } catch {
            // captureできなくても続行
          }
        }
      }

      if (
        tabGestureModeRef.current !==
        "swipe"
      ) {
        return;
      }

      let nextX =
        dx;

      /*
       * 左端（未送信）から右へ、
       * 右端（送信済み）から左へは
       * 画面が存在しないので抵抗を付けます。
       */
      if (
        activeTab ===
          "pending" &&
        nextX > 0
      ) {
        nextX *=
          0.22;
      }

      if (
        activeTab ===
          "sent" &&
        nextX < 0
      ) {
        nextX *=
          0.22;
      }

      nextX =
        Math.max(
          -tabViewportWidth,
          Math.min(
            tabViewportWidth,
            nextX
          )
        );

      syncTabDrag(
        nextX
      );
    };

  const finishTabSwipe =
    () => {
      const x =
        tabDragXRef.current;

      const threshold =
        Math.max(
          TAB_SWIPE_MIN,
          tabViewportWidth *
            0.18
        );

      let nextTab =
        activeTab;

      if (
        activeTab ===
          "pending" &&
        x <=
          -threshold
      ) {
        nextTab =
          "sent";
      }

      if (
        activeTab ===
          "sent" &&
        x >=
          threshold
      ) {
        nextTab =
          "pending";
      }

      setTabAnimating(
        true
      );

      syncTabDrag(
        0
      );

      if (
        nextTab !==
        activeTab
      ) {
        scrollMemoryRef.current[
          activeTab
        ] =
          window.scrollY;

        tabSwitchTargetRef.current =
          nextTab;

        setActiveTab(
          nextTab
        );
      }
    };

  const handleTabPointerUp =
    (
      event:
        ReactPointerEvent<HTMLDivElement>
    ) => {
      if (
        event.pointerId !==
        tabPointerIdRef.current
      ) {
        return;
      }

      if (
        tabGestureModeRef.current ===
        "swipe"
      ) {
        finishTabSwipe();
      }

      tabPointerIdRef.current =
        null;

      tabGestureModeRef.current =
        "none";
    };

  const handleTabPointerCancel =
    (
      event:
        ReactPointerEvent<HTMLDivElement>
    ) => {
      if (
        event.pointerId !==
        tabPointerIdRef.current
      ) {
        return;
      }

      tabPointerIdRef.current =
        null;

      tabGestureModeRef.current =
        "none";

      setTabAnimating(
        true
      );

      syncTabDrag(
        0
      );
    };

  const handlePhotoChange =
    async (
      event:
        ChangeEvent<HTMLInputElement>
    ) => {
      const files =
        Array.from(
          event.target
            .files ??
            []
        );

      if (
        files.length ===
        0
      ) {
        return;
      }

      setIsSaving(
        true
      );

      setErrorMessage(
        ""
      );

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

        switchTab(
          "pending"
        );
      } catch (
        error
      ) {
        console.error(
          error
        );

        setErrorMessage(
          "写真の保存に失敗しました。"
        );
      } finally {
        event.target.value =
          "";

        setIsSaving(
          false
        );
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
            photo.id ===
            id
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
              photo.id ===
              id
                ? updated
                : photo
          )
      );

      try {
        await updatePhoto(
          updated
        );
      } catch (
        error
      ) {
        console.error(
          error
        );

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
        await deletePhoto(
          id
        );

        await loadPhotos();
      } catch (
        error
      ) {
        console.error(
          error
        );

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

      setIsUploading(
        true
      );

      setErrorMessage(
        ""
      );

      let successCount =
        0;

      try {
        for (
          const photo
          of pendingPhotos
        ) {
          if (
            !photo.file
          ) {
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

          successCount +=
            1;
        }

        await loadPhotos();

        switchTab(
          "sent"
        );

        alert(
          `${successCount}件をBoxへ送信しました。`
        );
      } catch (
        error
      ) {
        console.error(
          error
        );

        await loadPhotos();

        setErrorMessage(
          error instanceof
            Error
            ? error.message
            : "送信に失敗しました。"
        );
      } finally {
        setIsUploading(
          false
        );
      }
    };

  const renderPhotoList =
    (
      list:
        StoredPhoto[]
    ) => {
      if (
        list.length ===
        0
      ) {
        return (
          <p className="empty-message">
            写真はありません。
          </p>
        );
      }

      return (
        <div className="photo-list">
          {list.map(
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
      );
    };

  /*
   * trackは2画面幅。
   *
   * 未送信 = 0px
   * 送信済み = -viewportWidth
   *
   * スワイプ中だけtabDragXを足します。
   */
  const activeBaseX =
    activeTab ===
    "pending"
      ? 0
      : -tabViewportWidth;

  const tabTrackX =
    activeBaseX +
    tabDragX;

  return (
    <main className="container">
      {/*
       * ここは通常スクロール。
       * タイトルや通信状態は上へ消えます。
       */}
      <h1>
        📷 Box Photo
        Uploader
      </h1>

      <div
        className={
          isOnline
            ? "network-status online"
            : "network-status offline"
        }
      >
        <span>
          ●
        </span>

        {isOnline
          ? "オンライン：Boxへ送信できます"
          : "オフライン：端末に保存します"}
      </div>

      <div className="photo-actions">
        <label className="photo-action-button">
          📷
          カメラで撮影

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
          🖼
          写真から選択

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
       * ★ここだけsticky。
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
              {
                pendingPhotos.length
              }
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
              {
                sentPhotos.length
              }
            </span>
          </button>
        </div>
      </div>

      {/*
       * ★タブ以下だけが独立した横スライド領域。
       * 未送信・送信済みpaneを両方常駐させます。
       */}
      <div
        ref={
          tabViewportRef
        }
        className="tab-viewport"
        style={{
          height:
            `${Math.max(
              paneHeights.pending,
              paneHeights.sent,
              420
            )}px`,
        }}
        onPointerDown={
          handleTabPointerDown
        }
        onPointerMove={
          handleTabPointerMove
        }
        onPointerUp={
          handleTabPointerUp
        }
        onPointerCancel={
          handleTabPointerCancel
        }
      >
        <div
          className="tab-track"
          style={{
            width:
              `${tabViewportWidth * 2}px`,

            transform:
              `translate3d(${tabTrackX}px, 0, 0)`,

            transition:
              tabAnimating
                ? `transform ${TAB_SLIDE_DURATION}ms cubic-bezier(.22,.61,.36,1)`
                : "none",
          }}
          onTransitionEnd={() => {
            setTabAnimating(
              false
            );

            const target =
              tabSwitchTargetRef.current;

            if (target) {
              restoreWindowScroll(
                target
              );
            }
          }}
        >
          <section
            ref={
              pendingPaneRef
            }
            className="tab-pane"
            style={{
              width:
                `${tabViewportWidth}px`,
            }}
            aria-hidden={
              activeTab !==
              "pending"
            }
          >
            <div className="tab-pane-inner">
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

              {renderPhotoList(
                pendingPhotos
              )}

              <p className="swipe-guide">
                ←
                スワイプで送信済み
              </p>
            </div>
          </section>

          <section
            ref={
              sentPaneRef
            }
            className="tab-pane"
            style={{
              width:
                `${tabViewportWidth}px`,
            }}
            aria-hidden={
              activeTab !==
              "sent"
            }
          >
            <div className="tab-pane-inner">
              {renderPhotoList(
                sentPhotos
              )}

              <p className="swipe-guide">
                スワイプで未送信
                →
              </p>
            </div>
          </section>
        </div>
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