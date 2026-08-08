import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import type { StoredPhoto } from "../types/Photo";

type PhotoViewerProps = {
  photos: StoredPhoto[];
  initialPhotoId: string;
  onClose: () => void;
};

type GestureMode =
  | "none"
  | "pending"
  | "swipe"
  | "close"
  | "pan"
  | "pinch";

type PointerPoint = {
  x: number;
  y: number;
};

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;

const SWIPE_THRESHOLD = 60;
const CLOSE_THRESHOLD = 90;
const MOVE_LOCK_THRESHOLD = 8;

const SLIDE_DURATION = 260;
const CLOSE_DURATION = 180;

function getPhotoBlob(
  photo: StoredPhoto | undefined
): Blob | undefined {
  return photo?.file ?? photo?.thumbnail;
}

function usePhotoUrl(
  photo: StoredPhoto | undefined
): string {
  const [url, setUrl] = useState("");

  useEffect(() => {
    const blob = getPhotoBlob(photo);

    if (!blob) {
      setUrl("");
      return;
    }

    const nextUrl = URL.createObjectURL(blob);
    setUrl(nextUrl);

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [photo]);

  return url;
}

function getDisplayName(photo: StoredPhoto): string {
  if (photo.status === "sent") {
    return photo.uploadedFileName ?? photo.fileName;
  }

  return photo.fileName;
}

function clamp(
  value: number,
  min: number,
  max: number
): number {
  return Math.min(max, Math.max(min, value));
}

function PhotoViewer({
  photos,
  initialPhotoId,
  onClose,
}: PhotoViewerProps) {
  const initialIndex = Math.max(
    0,
    photos.findIndex(
      (photo) => photo.id === initialPhotoId
    )
  );

  const [currentIndex, setCurrentIndex] =
    useState(initialIndex);

  const [scale, setScaleState] = useState(1);
  const [offsetX, setOffsetXState] = useState(0);
  const [offsetY, setOffsetYState] = useState(0);

  /*
   * 0 = 現在写真が中央
   * マイナス = 左へドラッグ
   * プラス = 右へドラッグ
   */
  const [trackDragX, setTrackDragXState] = useState(0);
  const [trackTransition, setTrackTransition] =
    useState(false);

  const [closeDragY, setCloseDragYState] = useState(0);
  const [closeTransition, setCloseTransition] =
    useState(false);

  const [stageWidth, setStageWidth] = useState(
    window.innerWidth
  );

  const stageRef = useRef<HTMLDivElement | null>(null);
  const currentImageRef =
    useRef<HTMLImageElement | null>(null);

  /*
   * React stateだけだとpointermove中に値が1フレーム遅れるため、
   * ジェスチャー計算用にrefも同期させます。
   */
  const scaleRef = useRef(1);
  const offsetXRef = useRef(0);
  const offsetYRef = useRef(0);
  const trackDragXRef = useRef(0);
  const closeDragYRef = useRef(0);

  const gestureModeRef =
    useRef<GestureMode>("none");

  const pointersRef =
    useRef<Map<number, PointerPoint>>(new Map());

  const primaryPointerIdRef =
    useRef<number | null>(null);

  const gestureStartRef = useRef({
    x: 0,
    y: 0,
    offsetX: 0,
    offsetY: 0,
  });

  /*
   * ピンチ開始時の情報。
   * focal point（指2本の中心）の真下にある画像位置を
   * 拡大後も同じ場所へ残すために使います。
   */
  const pinchRef = useRef({
    startDistance: 0,
    startScale: 1,
    imagePointX: 0,
    imagePointY: 0,
  });

  /*
   * ダブルタップ判定
   */
  const lastTapRef = useRef({
    time: 0,
    x: 0,
    y: 0,
  });

  const slideCommitRef =
    useRef<"next" | "previous" | null>(null);

  const closeCommitRef = useRef(false);

  const currentPhoto = photos[currentIndex];

  const previousIndex = useMemo(() => {
    if (photos.length === 0) {
      return 0;
    }

    return currentIndex > 0
      ? currentIndex - 1
      : photos.length - 1;
  }, [currentIndex, photos.length]);

  const nextIndex = useMemo(() => {
    if (photos.length === 0) {
      return 0;
    }

    return currentIndex < photos.length - 1
      ? currentIndex + 1
      : 0;
  }, [currentIndex, photos.length]);

  const previousPhoto = photos[previousIndex];
  const nextPhoto = photos[nextIndex];

  /*
   * 前・現在・次の3枚を常にDOMに置いておきます。
   * そのためスワイプ中に次写真がその場で横から見えてきます。
   */
  const previousUrl = usePhotoUrl(previousPhoto);
  const currentUrl = usePhotoUrl(currentPhoto);
  const nextUrl = usePhotoUrl(nextPhoto);

  const syncScale = (value: number) => {
    scaleRef.current = value;
    setScaleState(value);
  };

  const syncOffset = (x: number, y: number) => {
    offsetXRef.current = x;
    offsetYRef.current = y;
    setOffsetXState(x);
    setOffsetYState(y);
  };

  const syncTrackDragX = (value: number) => {
    trackDragXRef.current = value;
    setTrackDragXState(value);
  };

  const syncCloseDragY = (value: number) => {
    closeDragYRef.current = value;
    setCloseDragYState(value);
  };

  const updateStageWidth = useCallback(() => {
    const stage = stageRef.current;

    if (!stage) {
      setStageWidth(window.innerWidth);
      return;
    }

    setStageWidth(stage.clientWidth || window.innerWidth);
  }, []);

  useEffect(() => {
    updateStageWidth();

    window.addEventListener("resize", updateStageWidth);

    return () => {
      window.removeEventListener(
        "resize",
        updateStageWidth
      );
    };
  }, [updateStageWidth]);

  useEffect(() => {
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = oldOverflow;
    };
  }, []);

  /*
   * 画像が切り替わったらズームを初期化。
   */
  useEffect(() => {
    syncScale(1);
    syncOffset(0, 0);
  }, [currentIndex]);

  const getPanBounds = useCallback(
    (targetScale: number) => {
      const stage = stageRef.current;
      const image = currentImageRef.current;

      if (
        !stage ||
        !image ||
        targetScale <= 1
      ) {
        return {
          maxX: 0,
          maxY: 0,
        };
      }

      const stageWidthValue = stage.clientWidth;
      const stageHeightValue = stage.clientHeight;

      /*
       * offsetWidth/Heightはscale前の画像表示サイズ。
       */
      const imageWidth = image.offsetWidth;
      const imageHeight = image.offsetHeight;

      const scaledWidth = imageWidth * targetScale;
      const scaledHeight = imageHeight * targetScale;

      return {
        maxX: Math.max(
          0,
          (scaledWidth - stageWidthValue) / 2
        ),
        maxY: Math.max(
          0,
          (scaledHeight - stageHeightValue) / 2
        ),
      };
    },
    []
  );

  const clampOffset = useCallback(
    (
      x: number,
      y: number,
      targetScale: number
    ) => {
      const { maxX, maxY } =
        getPanBounds(targetScale);

      return {
        x: clamp(x, -maxX, maxX),
        y: clamp(y, -maxY, maxY),
      };
    },
    [getPanBounds]
  );

  const resetZoom = useCallback(() => {
    syncScale(1);
    syncOffset(0, 0);
  }, []);

  /*
   * 指やマウスの位置を中心に拡大します。
   * 「触った場所が飛ぶ」問題を避けるための重要部分です。
   */
  const zoomAt = useCallback(
    (
      clientX: number,
      clientY: number,
      targetScale: number
    ) => {
      const stage = stageRef.current;

      if (!stage) {
        return;
      }

      const stageRect = stage.getBoundingClientRect();

      /*
       * stage中央を(0, 0)にした座標。
       */
      const localX =
        clientX - (stageRect.left + stageRect.width / 2);

      const localY =
        clientY - (stageRect.top + stageRect.height / 2);

      const oldScale = scaleRef.current;
      const oldOffsetX = offsetXRef.current;
      const oldOffsetY = offsetYRef.current;

      /*
       * 指の真下にあった「画像上の座標」。
       */
      const imagePointX =
        (localX - oldOffsetX) / oldScale;

      const imagePointY =
        (localY - oldOffsetY) / oldScale;

      /*
       * 新倍率でも同じ画像座標が指の下に来るようoffsetを逆算。
       */
      const desiredX =
        localX - imagePointX * targetScale;

      const desiredY =
        localY - imagePointY * targetScale;

      const corrected = clampOffset(
        desiredX,
        desiredY,
        targetScale
      );

      syncScale(targetScale);
      syncOffset(corrected.x, corrected.y);
    },
    [clampOffset]
  );

  const getTwoPointers = () => {
    const values = Array.from(
      pointersRef.current.values()
    );

    if (values.length < 2) {
      return null;
    }

    return {
      first: values[0],
      second: values[1],
    };
  };

  const startPinch = () => {
    const pair = getTwoPointers();
    const stage = stageRef.current;

    if (!pair || !stage) {
      return;
    }

    const { first, second } = pair;

    const centerX = (first.x + second.x) / 2;
    const centerY = (first.y + second.y) / 2;

    const stageRect = stage.getBoundingClientRect();

    const localCenterX =
      centerX - (stageRect.left + stageRect.width / 2);

    const localCenterY =
      centerY - (stageRect.top + stageRect.height / 2);

    const startScale = scaleRef.current;

    pinchRef.current = {
      startDistance: Math.hypot(
        second.x - first.x,
        second.y - first.y
      ),
      startScale,

      /*
       * 指2本の中心直下の画像座標を保存。
       */
      imagePointX:
        (localCenterX - offsetXRef.current) /
        startScale,

      imagePointY:
        (localCenterY - offsetYRef.current) /
        startScale,
    };

    gestureModeRef.current = "pinch";

    /*
     * ピンチ開始時は写真スワイプや閉じる動きをキャンセル。
     */
    setTrackTransition(false);
    syncTrackDragX(0);

    setCloseTransition(false);
    syncCloseDragY(0);
  };

  const updatePinch = () => {
    const pair = getTwoPointers();
    const stage = stageRef.current;

    if (!pair || !stage) {
      return;
    }

    const { first, second } = pair;

    const currentDistance = Math.hypot(
      second.x - first.x,
      second.y - first.y
    );

    if (pinchRef.current.startDistance <= 0) {
      return;
    }

    const targetScale = clamp(
      pinchRef.current.startScale *
        (currentDistance /
          pinchRef.current.startDistance),
      MIN_SCALE,
      MAX_SCALE
    );

    const centerX = (first.x + second.x) / 2;
    const centerY = (first.y + second.y) / 2;

    const stageRect = stage.getBoundingClientRect();

    const localCenterX =
      centerX - (stageRect.left + stageRect.width / 2);

    const localCenterY =
      centerY - (stageRect.top + stageRect.height / 2);

    /*
     * ピンチ中心が移動しても、同じ画像位置が
     * その中心の下に残るよう計算。
     */
    const desiredX =
      localCenterX -
      pinchRef.current.imagePointX * targetScale;

    const desiredY =
      localCenterY -
      pinchRef.current.imagePointY * targetScale;

    const corrected = clampOffset(
      desiredX,
      desiredY,
      targetScale
    );

    syncScale(targetScale);
    syncOffset(corrected.x, corrected.y);
  };

  const animatePhotoChange = useCallback(
    (direction: "next" | "previous") => {
      if (
        photos.length <= 1 ||
        scaleRef.current !== 1 ||
        slideCommitRef.current !== null
      ) {
        return;
      }

      const width =
        stageRef.current?.clientWidth || stageWidth;

      slideCommitRef.current = direction;

      setTrackTransition(true);

      syncTrackDragX(
        direction === "next"
          ? -width
          : width
      );
    },
    [photos.length, stageWidth]
  );

  /*
   * trackのCSS transition完了時。
   * currentIndexを書き換えた後、transition無しで中央へ戻します。
   */
  const handleTrackTransitionEnd = () => {
    const direction = slideCommitRef.current;

    if (!direction) {
      return;
    }

    setCurrentIndex((current) => {
      if (direction === "next") {
        return current < photos.length - 1
          ? current + 1
          : 0;
      }

      return current > 0
        ? current - 1
        : photos.length - 1;
    });

    slideCommitRef.current = null;

    setTrackTransition(false);
    syncTrackDragX(0);
  };

  const finishHorizontalSwipe = () => {
    const width =
      stageRef.current?.clientWidth || stageWidth;

    const threshold = Math.min(
      Math.max(SWIPE_THRESHOLD, width * 0.18),
      width * 0.35
    );

    const x = trackDragXRef.current;

    if (Math.abs(x) >= threshold) {
      animatePhotoChange(
        x < 0 ? "next" : "previous"
      );

      return;
    }

    /*
     * 閾値に届かなければヌルっと元へ戻る。
     */
    setTrackTransition(true);
    syncTrackDragX(0);
  };

  const finishCloseSwipe = () => {
    if (closeDragYRef.current >= CLOSE_THRESHOLD) {
      closeCommitRef.current = true;

      setCloseTransition(true);
      syncCloseDragY(window.innerHeight);

      window.setTimeout(() => {
        onClose();
      }, CLOSE_DURATION);

      return;
    }

    setCloseTransition(true);
    syncCloseDragY(0);
  };

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    event.currentTarget.setPointerCapture(
      event.pointerId
    );

    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    /*
     * 2本目の指が来た瞬間にピンチへ移行。
     */
    if (pointersRef.current.size === 2) {
      startPinch();
      return;
    }

    if (pointersRef.current.size !== 1) {
      return;
    }

    primaryPointerIdRef.current = event.pointerId;

    gestureStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      offsetX: offsetXRef.current,
      offsetY: offsetYRef.current,
    };

    if (scaleRef.current > 1) {
      gestureModeRef.current = "pan";
      return;
    }

    gestureModeRef.current = "pending";

    setTrackTransition(false);
    syncTrackDragX(0);

    setCloseTransition(false);
    syncCloseDragY(0);
  };

  const handlePointerMove = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    if (!pointersRef.current.has(event.pointerId)) {
      return;
    }

    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    if (
      gestureModeRef.current === "pinch" ||
      pointersRef.current.size >= 2
    ) {
      if (pointersRef.current.size >= 2) {
        if (gestureModeRef.current !== "pinch") {
          startPinch();
        }

        updatePinch();
      }

      return;
    }

    const start = gestureStartRef.current;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;

    if (gestureModeRef.current === "pan") {
      const corrected = clampOffset(
        start.offsetX + dx,
        start.offsetY + dy,
        scaleRef.current
      );

      syncOffset(corrected.x, corrected.y);
      return;
    }

    /*
     * まだ横・縦どちらのジェスチャーか決めていない状態。
     */
    if (gestureModeRef.current === "pending") {
      if (
        Math.abs(dx) < MOVE_LOCK_THRESHOLD &&
        Math.abs(dy) < MOVE_LOCK_THRESHOLD
      ) {
        return;
      }

      if (
        dy > 0 &&
        Math.abs(dy) > Math.abs(dx) * 1.1
      ) {
        gestureModeRef.current = "close";
      } else if (
        Math.abs(dx) > Math.abs(dy) * 1.05
      ) {
        gestureModeRef.current = "swipe";
      } else {
        return;
      }
    }

    if (gestureModeRef.current === "close") {
      /*
       * 上方向へは動かさない。
       */
      syncCloseDragY(Math.max(0, dy));
      return;
    }

    if (gestureModeRef.current === "swipe") {
      const width =
        stageRef.current?.clientWidth || stageWidth;

      /*
       * 端で少し抵抗を付ける。
       */
      const limited = clamp(
        dx,
        -width,
        width
      );

      syncTrackDragX(limited);
    }
  };

  const maybeHandleDoubleTap = (
    event: ReactPointerEvent<HTMLDivElement>,
    mode: GestureMode
  ) => {
    if (
      event.pointerType !== "touch" ||
      mode !== "pending"
    ) {
      return false;
    }

    const now = performance.now();
    const previous = lastTapRef.current;

    const distanceFromPrevious = Math.hypot(
      event.clientX - previous.x,
      event.clientY - previous.y
    );

    const isDoubleTap =
      now - previous.time < 320 &&
      distanceFromPrevious < 36;

    lastTapRef.current = {
      time: now,
      x: event.clientX,
      y: event.clientY,
    };

    if (!isDoubleTap) {
      return false;
    }

    /*
     * 1倍ならタップ位置を中心に2.5倍へ。
     * 拡大済みなら1倍へ戻す。
     */
    if (scaleRef.current <= 1.01) {
      zoomAt(
        event.clientX,
        event.clientY,
        DOUBLE_TAP_SCALE
      );
    } else {
      resetZoom();
    }

    return true;
  };

  const finishPointer = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    const finishedMode = gestureModeRef.current;

    pointersRef.current.delete(event.pointerId);

    /*
     * ピンチ中に片方の指だけ離れた場合、
     * 残った1本でいきなりパンが始まらないよう一旦終了。
     */
    if (finishedMode === "pinch") {
      if (pointersRef.current.size < 2) {
        gestureModeRef.current = "none";
      }

      if (scaleRef.current <= 1.01) {
        resetZoom();
      } else {
        const corrected = clampOffset(
          offsetXRef.current,
          offsetYRef.current,
          scaleRef.current
        );

        syncOffset(corrected.x, corrected.y);
      }

      return;
    }

    if (
      event.pointerId !== primaryPointerIdRef.current
    ) {
      return;
    }

    primaryPointerIdRef.current = null;

    if (
      maybeHandleDoubleTap(
        event,
        finishedMode
      )
    ) {
      gestureModeRef.current = "none";
      return;
    }

    if (finishedMode === "swipe") {
      finishHorizontalSwipe();
    } else if (finishedMode === "close") {
      finishCloseSwipe();
    } else if (finishedMode === "pan") {
      const corrected = clampOffset(
        offsetXRef.current,
        offsetYRef.current,
        scaleRef.current
      );

      syncOffset(corrected.x, corrected.y);
    }

    gestureModeRef.current = "none";
  };

  const handlePointerUp = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    finishPointer(event);
  };

  const handlePointerCancel = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    pointersRef.current.delete(event.pointerId);
    primaryPointerIdRef.current = null;
    gestureModeRef.current = "none";

    setTrackTransition(true);
    syncTrackDragX(0);

    setCloseTransition(true);
    syncCloseDragY(0);
  };

  const handleDoubleClick = (
    event: ReactMouseEvent<HTMLImageElement>
  ) => {
    if (scaleRef.current <= 1.01) {
      zoomAt(
        event.clientX,
        event.clientY,
        DOUBLE_TAP_SCALE
      );
    } else {
      resetZoom();
    }
  };

  const zoomIn = () => {
    const stage = stageRef.current;

    if (!stage) {
      return;
    }

    const rect = stage.getBoundingClientRect();

    zoomAt(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      clamp(
        scaleRef.current + 0.5,
        MIN_SCALE,
        MAX_SCALE
      )
    );
  };

  const zoomOut = () => {
    const nextScale = clamp(
      scaleRef.current - 0.5,
      MIN_SCALE,
      MAX_SCALE
    );

    if (nextScale <= 1) {
      resetZoom();
      return;
    }

    const stage = stageRef.current;

    if (!stage) {
      return;
    }

    const rect = stage.getBoundingClientRect();

    zoomAt(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      nextScale
    );
  };

  useEffect(() => {
    const handleKeyDown = (
      event: KeyboardEvent
    ) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (scaleRef.current > 1) {
        return;
      }

      if (event.key === "ArrowRight") {
        animatePhotoChange("next");
      }

      if (event.key === "ArrowLeft") {
        animatePhotoChange("previous");
      }
    };

    window.addEventListener(
      "keydown",
      handleKeyDown
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown
      );
    };
  }, [animatePhotoChange, onClose]);

  if (!currentPhoto) {
    return null;
  }

  const displayName = getDisplayName(currentPhoto);
  const tags = currentPhoto.tags ?? [];
  const isSent = currentPhoto.status === "sent";

  const viewerOpacity = Math.max(
    0.35,
    1 - closeDragY / Math.max(500, window.innerHeight)
  );

  /*
   * 3枚トラック:
   * [前][現在][次]
   * idle時は「現在」が中央なので -stageWidth。
   * swipe分だけリアルタイムに加算します。
   */
  const trackX = -stageWidth + trackDragX;

  return (
    <div
      className="viewer"
      role="dialog"
      aria-modal="true"
      aria-label="写真の全画面表示"
      style={{
        transform: `translate3d(0, ${closeDragY}px, 0)`,
        opacity: viewerOpacity,
        transition:
          closeTransition && !closeCommitRef.current
            ? `transform ${CLOSE_DURATION}ms ease, opacity ${CLOSE_DURATION}ms ease`
            : closeTransition
              ? `transform ${CLOSE_DURATION}ms ease-in, opacity ${CLOSE_DURATION}ms ease-in`
              : "none",
      }}
    >
      <header className="viewer-header">
        <button
          type="button"
          className="viewer-close"
          onClick={onClose}
          aria-label="閉じる"
        >
          ×
        </button>

        <div className="viewer-title">
          <strong>
            {isSent ? "送信済み" : "未送信"}
          </strong>

          <span>
            {currentIndex + 1} / {photos.length}
          </span>
        </div>

        <div className="viewer-zoom">
          <button
            type="button"
            onClick={zoomOut}
            disabled={scale <= MIN_SCALE}
            aria-label="縮小"
          >
            −
          </button>

          <button
            type="button"
            onClick={resetZoom}
            aria-label="拡大率をリセット"
          >
            {Math.round(scale * 100)}%
          </button>

          <button
            type="button"
            onClick={zoomIn}
            disabled={scale >= MAX_SCALE}
            aria-label="拡大"
          >
            ＋
          </button>
        </div>
      </header>

      <div
        ref={stageRef}
        className={
          scale > 1
            ? "viewer-stage zoomed"
            : "viewer-stage"
        }
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <div
          className="viewer-track"
          style={{
            width: `${stageWidth * 3}px`,
            transform: `translate3d(${trackX}px, 0, 0)`,
            transition: trackTransition
              ? `transform ${SLIDE_DURATION}ms cubic-bezier(.22,.61,.36,1)`
              : "none",
          }}
          onTransitionEnd={handleTrackTransitionEnd}
        >
          <div
            className="viewer-slide"
            style={{ width: `${stageWidth}px` }}
          >
            {previousUrl && (
              <img
                className="viewer-neighbor-image"
                src={previousUrl}
                alt=""
                draggable={false}
              />
            )}
          </div>

          <div
            className="viewer-slide"
            style={{ width: `${stageWidth}px` }}
          >
            {currentUrl && (
              <img
                ref={currentImageRef}
                className="viewer-image"
                src={currentUrl}
                alt={displayName}
                draggable={false}
                style={{
                  transform: `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${scale})`,
                }}
                onDoubleClick={handleDoubleClick}
              />
            )}
          </div>

          <div
            className="viewer-slide"
            style={{ width: `${stageWidth}px` }}
          >
            {nextUrl && (
              <img
                className="viewer-neighbor-image"
                src={nextUrl}
                alt=""
                draggable={false}
              />
            )}
          </div>
        </div>

        {scale === 1 && photos.length > 1 && (
          <>
            <button
              type="button"
              className="viewer-arrow viewer-arrow-left"
              onClick={(event) => {
                event.stopPropagation();
                animatePhotoChange("previous");
              }}
              aria-label="前の写真"
            >
              ‹
            </button>

            <button
              type="button"
              className="viewer-arrow viewer-arrow-right"
              onClick={(event) => {
                event.stopPropagation();
                animatePhotoChange("next");
              }}
              aria-label="次の写真"
            >
              ›
            </button>
          </>
        )}
      </div>

      <footer className="viewer-footer">
        <p className="viewer-file-name">
          {displayName}
        </p>

        {tags.length > 0 && (
          <div className="viewer-tags">
            {tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        )}

        <p className="viewer-help">
          {scale > 1
            ? "ドラッグ：移動　ピンチ：拡大縮小　ダブルタップ：リセット"
            : "左右：写真切替　↓：閉じる　ダブルタップ：拡大"}
        </p>
      </footer>
    </div>
  );
}

export default PhotoViewer;