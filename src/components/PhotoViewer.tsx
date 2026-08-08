import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type {
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
} from "react";

import type {
  StoredPhoto,
} from "../types/Photo";

type PhotoViewerProps = {
  photos: StoredPhoto[];
  initialPhotoId: string;
  onClose: () => void;
};

type SlideClass =
  | ""
  | "slide-out-left"
  | "slide-out-right"
  | "slide-in-left"
  | "slide-in-right";

type TouchPoint = {
  clientX: number;
  clientY: number;
};

const MIN_SCALE = 1;
const MAX_SCALE = 5;

const SWIPE_THRESHOLD = 55;

/*
 * 下スワイプで閉じる判定距離
 */
const CLOSE_SWIPE_THRESHOLD = 90;

const SLIDE_TIME = 220;

function getDistance(
  first: TouchPoint,
  second: TouchPoint
): number {
  return Math.hypot(
    second.clientX - first.clientX,
    second.clientY - first.clientY
  );
}

function PhotoViewer({
  photos,
  initialPhotoId,
  onClose,
}: PhotoViewerProps) {
  const initialIndex = Math.max(
    0,
    photos.findIndex(
      (photo) =>
        photo.id === initialPhotoId
    )
  );

  const [
    currentIndex,
    setCurrentIndex,
  ] = useState(initialIndex);

  const [
    previewUrl,
    setPreviewUrl,
  ] = useState("");

  const [
    scale,
    setScale,
  ] = useState(1);

  const [
    offsetX,
    setOffsetX,
  ] = useState(0);

  const [
    offsetY,
    setOffsetY,
  ] = useState(0);

  const [
    slideClass,
    setSlideClass,
  ] = useState<SlideClass>("");

  const [
    isSliding,
    setIsSliding,
  ] = useState(false);

  /*
   * 下スワイプ中の
   * ビューア全体の移動量
   */
  const [
    closeDragY,
    setCloseDragY,
  ] = useState(0);

  const [
    isCloseDragging,
    setIsCloseDragging,
  ] = useState(false);

  /*
   * 写真領域
   */
  const stageRef =
    useRef<HTMLDivElement | null>(
      null
    );

  const imageRef =
    useRef<HTMLImageElement | null>(
      null
    );

  /*
   * 1本指タッチ開始位置
   */
  const touchStartX =
    useRef<number | null>(null);

  const touchStartY =
    useRef<number | null>(null);

  /*
   * 拡大後のドラッグ
   */
  const dragStartX =
    useRef(0);

  const dragStartY =
    useRef(0);

  const dragOriginalX =
    useRef(0);

  const dragOriginalY =
    useRef(0);

  /*
   * ピンチズーム
   */
  const pinchStartDistance =
    useRef<number | null>(null);

  const pinchStartScale =
    useRef(1);

  /*
   * PCマウスドラッグ
   */
  const mouseDragging =
    useRef(false);

  const mouseStartX =
    useRef(0);

  const mouseStartY =
    useRef(0);

  const mouseOriginalX =
    useRef(0);

  const mouseOriginalY =
    useRef(0);

  const currentPhoto =
    photos[currentIndex];

  /*
   * 写真を表示領域の外へ
   * 動かしすぎないように補正
   */
  const clampOffset =
    useCallback(
      (
        x: number,
        y: number,
        targetScale: number
      ) => {
        const stage =
          stageRef.current;

        const image =
          imageRef.current;

        if (
          !stage ||
          !image ||
          targetScale <= 1
        ) {
          return {
            x: 0,
            y: 0,
          };
        }

        const stageRect =
          stage.getBoundingClientRect();

        const baseWidth =
          image.offsetWidth;

        const baseHeight =
          image.offsetHeight;

        const scaledWidth =
          baseWidth *
          targetScale;

        const scaledHeight =
          baseHeight *
          targetScale;

        const maxX =
          Math.max(
            0,
            (
              scaledWidth -
              stageRect.width
            ) / 2
          );

        const maxY =
          Math.max(
            0,
            (
              scaledHeight -
              stageRect.height
            ) / 2
          );

        return {
          x: Math.max(
            -maxX,
            Math.min(
              maxX,
              x
            )
          ),

          y: Math.max(
            -maxY,
            Math.min(
              maxY,
              y
            )
          ),
        };
      },
      []
    );

  const resetTransform =
    useCallback(() => {
      setScale(1);
      setOffsetX(0);
      setOffsetY(0);

      pinchStartDistance.current =
        null;
    }, []);

  /*
   * Blob → 表示URL
   */
  useEffect(() => {
    if (!currentPhoto) {
      setPreviewUrl("");
      return;
    }

    const blob =
      currentPhoto.file ??
      currentPhoto.thumbnail;

    if (!blob) {
      setPreviewUrl("");
      return;
    }

    const objectUrl =
      URL.createObjectURL(
        blob
      );

    setPreviewUrl(
      objectUrl
    );

    return () => {
      URL.revokeObjectURL(
        objectUrl
      );
    };
  }, [currentPhoto]);

  /*
   * 背景ページスクロール停止
   */
  useEffect(() => {
    const oldOverflow =
      document.body.style.overflow;

    document.body.style.overflow =
      "hidden";

    return () => {
      document.body.style.overflow =
        oldOverflow;
    };
  }, []);

  /*
   * 画面サイズ変更時補正
   */
  useEffect(() => {
    const handleResize = () => {
      const corrected =
        clampOffset(
          offsetX,
          offsetY,
          scale
        );

      setOffsetX(
        corrected.x
      );

      setOffsetY(
        corrected.y
      );
    };

    window.addEventListener(
      "resize",
      handleResize
    );

    return () => {
      window.removeEventListener(
        "resize",
        handleResize
      );
    };
  }, [
    clampOffset,
    offsetX,
    offsetY,
    scale,
  ]);

  /*
   * 写真切替
   */
  const changePhoto =
    useCallback(
      (
        direction:
          | "next"
          | "previous"
      ) => {
        if (
          photos.length <= 1 ||
          isSliding ||
          scale !== 1 ||
          isCloseDragging
        ) {
          return;
        }

        setIsSliding(true);

        setSlideClass(
          direction === "next"
            ? "slide-out-left"
            : "slide-out-right"
        );

        window.setTimeout(
          () => {
            setCurrentIndex(
              (current) => {
                if (
                  direction === "next"
                ) {
                  return current <
                    photos.length - 1
                    ? current + 1
                    : 0;
                }

                return current > 0
                  ? current - 1
                  : photos.length - 1;
              }
            );

            resetTransform();

            setSlideClass(
              direction === "next"
                ? "slide-in-right"
                : "slide-in-left"
            );

            requestAnimationFrame(
              () => {
                requestAnimationFrame(
                  () => {
                    setSlideClass("");

                    window.setTimeout(
                      () => {
                        setIsSliding(
                          false
                        );
                      },
                      SLIDE_TIME
                    );
                  }
                );
              }
            );
          },
          SLIDE_TIME
        );
      },
      [
        isCloseDragging,
        isSliding,
        photos.length,
        resetTransform,
        scale,
      ]
    );

  /*
   * キーボード操作
   */
  useEffect(() => {
    const handleKeyDown = (
      event: KeyboardEvent
    ) => {
      if (
        event.key === "Escape"
      ) {
        onClose();
      }

      if (
        event.key ===
          "ArrowRight" &&
        scale === 1
      ) {
        changePhoto("next");
      }

      if (
        event.key ===
          "ArrowLeft" &&
        scale === 1
      ) {
        changePhoto(
          "previous"
        );
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
  }, [
    changePhoto,
    onClose,
    scale,
  ]);

  /*
   * タッチ開始
   */
  const handleTouchStart = (
    event:
      ReactTouchEvent<HTMLDivElement>
  ) => {
    /*
     * 2本指
     * → ピンチ
     */
    if (
      event.touches.length === 2
    ) {
      const first =
        event.touches[0];

      const second =
        event.touches[1];

      if (
        !first ||
        !second
      ) {
        return;
      }

      pinchStartDistance.current =
        getDistance(
          first,
          second
        );

      pinchStartScale.current =
        scale;

      touchStartX.current =
        null;

      touchStartY.current =
        null;

      setIsCloseDragging(
        false
      );

      setCloseDragY(0);

      return;
    }

    if (
      event.touches.length !== 1
    ) {
      return;
    }

    const touch =
      event.touches[0];

    if (!touch) {
      return;
    }

    /*
     * 通常倍率
     */
    if (scale === 1) {
      touchStartX.current =
        touch.clientX;

      touchStartY.current =
        touch.clientY;

      setCloseDragY(0);

      return;
    }

    /*
     * 拡大中
     * → 写真移動
     */
    dragStartX.current =
      touch.clientX;

    dragStartY.current =
      touch.clientY;

    dragOriginalX.current =
      offsetX;

    dragOriginalY.current =
      offsetY;
  };

  /*
   * タッチ移動
   */
  const handleTouchMove = (
    event:
      ReactTouchEvent<HTMLDivElement>
  ) => {
    /*
     * ピンチズーム
     */
    if (
      event.touches.length === 2
    ) {
      const first =
        event.touches[0];

      const second =
        event.touches[1];

      if (
        !first ||
        !second ||
        pinchStartDistance.current ===
          null
      ) {
        return;
      }

      const currentDistance =
        getDistance(
          first,
          second
        );

      const ratio =
        currentDistance /
        pinchStartDistance.current;

      const rawScale =
        pinchStartScale.current *
        ratio;

      const nextScale =
        Math.min(
          MAX_SCALE,
          Math.max(
            MIN_SCALE,
            rawScale
          )
        );

      setScale(
        nextScale
      );

      const corrected =
        clampOffset(
          offsetX,
          offsetY,
          nextScale
        );

      setOffsetX(
        corrected.x
      );

      setOffsetY(
        corrected.y
      );

      return;
    }

    if (
      event.touches.length !== 1
    ) {
      return;
    }

    const touch =
      event.touches[0];

    if (!touch) {
      return;
    }

    /*
     * 拡大中
     * → 画像移動
     */
    if (scale > 1) {
      const moveX =
        touch.clientX -
        dragStartX.current;

      const moveY =
        touch.clientY -
        dragStartY.current;

      const desiredX =
        dragOriginalX.current +
        moveX;

      const desiredY =
        dragOriginalY.current +
        moveY;

      const corrected =
        clampOffset(
          desiredX,
          desiredY,
          scale
        );

      setOffsetX(
        corrected.x
      );

      setOffsetY(
        corrected.y
      );

      return;
    }

    /*
     * 通常倍率の1本指操作
     *
     * 下方向へ一定量動いた場合
     * 閉じる操作として扱う。
     */
    if (
      touchStartX.current ===
        null ||
      touchStartY.current ===
        null
    ) {
      return;
    }

    const dx =
      touch.clientX -
      touchStartX.current;

    const dy =
      touch.clientY -
      touchStartY.current;

    /*
     * 横より縦の動きが明確に大きく、
     * かつ下方向の場合
     */
    if (
      dy > 0 &&
      Math.abs(dy) >
        Math.abs(dx) *
          1.15
    ) {
      setIsCloseDragging(
        true
      );

      /*
       * 指に追従して
       * ビューア全体を少し下げる
       */
      setCloseDragY(
        dy
      );
    }
  };

  /*
   * 指を離した
   */
  const handleTouchEnd = (
    event:
      ReactTouchEvent<HTMLDivElement>
  ) => {
    if (
      event.touches.length < 2
    ) {
      pinchStartDistance.current =
        null;
    }

    /*
     * 拡大中
     */
    if (scale > 1) {
      const corrected =
        clampOffset(
          offsetX,
          offsetY,
          scale
        );

      setOffsetX(
        corrected.x
      );

      setOffsetY(
        corrected.y
      );

      return;
    }

    /*
     * 下スワイプ閉じる
     */
    if (isCloseDragging) {
      const shouldClose =
        closeDragY >=
        CLOSE_SWIPE_THRESHOLD;

      if (shouldClose) {
        setCloseDragY(
          window.innerHeight
        );

        window.setTimeout(
          () => {
            onClose();
          },
          160
        );

        return;
      }

      /*
       * 距離不足なら元の位置へ戻す
       */
      setCloseDragY(0);

      setIsCloseDragging(
        false
      );

      touchStartX.current =
        null;

      touchStartY.current =
        null;

      return;
    }

    if (
      touchStartX.current ===
      null
    ) {
      return;
    }

    const touch =
      event.changedTouches[0];

    if (!touch) {
      touchStartX.current =
        null;

      touchStartY.current =
        null;

      return;
    }

    const dx =
      touch.clientX -
      touchStartX.current;

    const dy =
      touch.clientY -
      (
        touchStartY.current ??
        touch.clientY
      );

    touchStartX.current =
      null;

    touchStartY.current =
      null;

    /*
     * 横スワイプ判定
     */
    if (
      Math.abs(dx) <
        SWIPE_THRESHOLD ||
      Math.abs(dx) <=
        Math.abs(dy)
    ) {
      return;
    }

    if (dx < 0) {
      changePhoto("next");
    } else {
      changePhoto(
        "previous"
      );
    }
  };

  /*
   * PCマウスドラッグ開始
   */
  const handleMouseDown = (
    event:
      ReactMouseEvent<HTMLDivElement>
  ) => {
    if (scale <= 1) {
      return;
    }

    mouseDragging.current =
      true;

    mouseStartX.current =
      event.clientX;

    mouseStartY.current =
      event.clientY;

    mouseOriginalX.current =
      offsetX;

    mouseOriginalY.current =
      offsetY;

    event.preventDefault();
  };

  /*
   * PCマウスドラッグ
   */
  const handleMouseMove = (
    event:
      ReactMouseEvent<HTMLDivElement>
  ) => {
    if (
      !mouseDragging.current ||
      scale <= 1
    ) {
      return;
    }

    const moveX =
      event.clientX -
      mouseStartX.current;

    const moveY =
      event.clientY -
      mouseStartY.current;

    const desiredX =
      mouseOriginalX.current +
      moveX;

    const desiredY =
      mouseOriginalY.current +
      moveY;

    const corrected =
      clampOffset(
        desiredX,
        desiredY,
        scale
      );

    setOffsetX(
      corrected.x
    );

    setOffsetY(
      corrected.y
    );
  };

  const handleMouseUp =
    () => {
      mouseDragging.current =
        false;
    };

  /*
   * 拡大
   */
  const zoomIn = () => {
    const nextScale =
      Math.min(
        MAX_SCALE,
        scale + 0.5
      );

    setScale(
      nextScale
    );

    const corrected =
      clampOffset(
        offsetX,
        offsetY,
        nextScale
      );

    setOffsetX(
      corrected.x
    );

    setOffsetY(
      corrected.y
    );
  };

  /*
   * 縮小
   */
  const zoomOut = () => {
    const nextScale =
      Math.max(
        MIN_SCALE,
        scale - 0.5
      );

    if (
      nextScale === 1
    ) {
      resetTransform();
      return;
    }

    setScale(
      nextScale
    );

    const corrected =
      clampOffset(
        offsetX,
        offsetY,
        nextScale
      );

    setOffsetX(
      corrected.x
    );

    setOffsetY(
      corrected.y
    );
  };

  if (!currentPhoto) {
    return null;
  }

  const isSent =
    currentPhoto.status ===
    "sent";

  const displayFileName =
    isSent
      ? currentPhoto
          .uploadedFileName ??
        currentPhoto.fileName
      : currentPhoto.fileName;

  const tags =
    currentPhoto.tags ?? [];

  /*
   * 下スワイプ時
   * 少し透明にする
   */
  const closeProgress =
    Math.min(
      1,
      closeDragY /
        300
    );

  return (
    <div
      className="viewer"
      role="dialog"
      aria-modal="true"
      aria-label="写真の全画面表示"
      style={{
        transform:
          `translate3d(0, ${closeDragY}px, 0)`,

        opacity:
          1 -
          closeProgress *
            0.45,

        transition:
          isCloseDragging
            ? "none"
            : "transform 180ms ease, opacity 180ms ease",
      }}
    >
      {/* 上部 */}
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
            {isSent
              ? "送信済み"
              : "未送信"}
          </strong>

          <span>
            {currentIndex + 1}
            {" / "}
            {photos.length}
          </span>
        </div>

        <div className="viewer-zoom">
          <button
            type="button"
            onClick={zoomOut}
            disabled={
              scale <= MIN_SCALE
            }
          >
            −
          </button>

          <button
            type="button"
            onClick={
              resetTransform
            }
          >
            {Math.round(
              scale * 100
            )}
            %
          </button>

          <button
            type="button"
            onClick={zoomIn}
            disabled={
              scale >= MAX_SCALE
            }
          >
            ＋
          </button>
        </div>
      </header>

      {/* 写真 */}
      <div
        ref={stageRef}
        className={
          scale > 1
            ? "viewer-stage zoomed"
            : "viewer-stage"
        }
        onTouchStart={
          handleTouchStart
        }
        onTouchMove={
          handleTouchMove
        }
        onTouchEnd={
          handleTouchEnd
        }
        onMouseDown={
          handleMouseDown
        }
        onMouseMove={
          handleMouseMove
        }
        onMouseUp={
          handleMouseUp
        }
        onMouseLeave={
          handleMouseUp
        }
      >
        {previewUrl && (
          <div
            className={
              slideClass
                ? `viewer-slide ${slideClass}`
                : "viewer-slide"
            }
          >
            <img
              ref={imageRef}
              className="viewer-image"
              src={previewUrl}
              alt={
                displayFileName
              }
              draggable={false}
              style={{
                transform:
                  `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${scale})`,
              }}
              onDoubleClick={() => {
                if (
                  scale === 1
                ) {
                  setScale(2);
                } else {
                  resetTransform();
                }
              }}
            />
          </div>
        )}

        {scale === 1 &&
          photos.length > 1 &&
          !isCloseDragging && (
            <>
              <button
                type="button"
                className="viewer-arrow viewer-arrow-left"
                onClick={() =>
                  changePhoto(
                    "previous"
                  )
                }
              >
                ‹
              </button>

              <button
                type="button"
                className="viewer-arrow viewer-arrow-right"
                onClick={() =>
                  changePhoto(
                    "next"
                  )
                }
              >
                ›
              </button>
            </>
          )}
      </div>

      {/* 下部 */}
      <footer className="viewer-footer">
        <p className="viewer-file-name">
          {displayFileName}
        </p>

        {tags.length > 0 && (
          <div className="viewer-tags">
            {tags.map(
              (tag) => (
                <span key={tag}>
                  {tag}
                </span>
              )
            )}
          </div>
        )}

        <p className="viewer-help">
          {scale > 1
            ? "ドラッグして写真を移動"
            : "左右：写真切替　↓：閉じる"}
        </p>
      </footer>
    </div>
  );
}

export default PhotoViewer;