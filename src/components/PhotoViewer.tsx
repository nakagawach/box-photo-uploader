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

type Direction =
  | "next"
  | "previous";

type AnimationState =
  | "idle"
  | "preparing"
  | "moving";

type TouchPoint = {
  clientX: number;
  clientY: number;
};

const MIN_SCALE = 1;
const MAX_SCALE = 5;

const SWIPE_THRESHOLD = 55;
const CLOSE_THRESHOLD = 90;

const SLIDE_DURATION = 280;

function getDistance(
  first: TouchPoint,
  second: TouchPoint
): number {
  return Math.hypot(
    second.clientX - first.clientX,
    second.clientY - first.clientY
  );
}

function getCenter(
  first: TouchPoint,
  second: TouchPoint
) {
  return {
    x:
      (
        first.clientX +
        second.clientX
      ) / 2,

    y:
      (
        first.clientY +
        second.clientY
      ) / 2,
  };
}

function getDisplayName(
  photo: StoredPhoto
): string {
  if (
    photo.status === "sent"
  ) {
    return (
      photo.uploadedFileName ??
      photo.fileName
    );
  }

  return photo.fileName;
}

function PhotoViewer({
  photos,
  initialPhotoId,
  onClose,
}: PhotoViewerProps) {
  const initialIndex =
    Math.max(
      0,
      photos.findIndex(
        (photo) =>
          photo.id ===
          initialPhotoId
      )
    );

  const [
    currentIndex,
    setCurrentIndex,
  ] = useState(
    initialIndex
  );

  /*
   * 写真切替中に表示する
   * 次の写真
   */
  const [
    targetIndex,
    setTargetIndex,
  ] = useState<
    number | null
  >(null);

  const [
    direction,
    setDirection,
  ] = useState<
    Direction | null
  >(null);

  const [
    animationState,
    setAnimationState,
  ] =
    useState<AnimationState>(
      "idle"
    );

  const [
    currentUrl,
    setCurrentUrl,
  ] = useState("");

  const [
    targetUrl,
    setTargetUrl,
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

  /*
   * 下スワイプ閉じる用
   */
  const [
    closeDragY,
    setCloseDragY,
  ] = useState(0);

  const [
    isCloseDragging,
    setIsCloseDragging,
  ] = useState(false);

  const stageRef =
    useRef<HTMLDivElement | null>(
      null
    );

  const imageRef =
    useRef<HTMLImageElement | null>(
      null
    );

  /*
   * 通常スワイプ
   */
  const touchStartX =
    useRef<number | null>(
      null
    );

  const touchStartY =
    useRef<number | null>(
      null
    );

  /*
   * 画像ドラッグ
   */
  const dragStartX =
    useRef(0);

  const dragStartY =
    useRef(0);

  const dragOriginX =
    useRef(0);

  const dragOriginY =
    useRef(0);

  /*
   * ピンチ
   */
  const pinchStartDistance =
    useRef<number | null>(
      null
    );

  const pinchStartScale =
    useRef(1);

  const pinchStartOffsetX =
    useRef(0);

  const pinchStartOffsetY =
    useRef(0);

  /*
   * ピンチ開始時の
   * 指2本の中心位置
   */
  const pinchStartCenterX =
    useRef(0);

  const pinchStartCenterY =
    useRef(0);

  /*
   * マウスドラッグ
   */
  const mouseDragging =
    useRef(false);

  const mouseStartX =
    useRef(0);

  const mouseStartY =
    useRef(0);

  const mouseOriginX =
    useRef(0);

  const mouseOriginY =
    useRef(0);

  const currentPhoto =
    photos[currentIndex];

  const targetPhoto =
    targetIndex !== null
      ? photos[targetIndex]
      : undefined;

  /*
   * Blob → URL
   */
  useEffect(() => {
    if (!currentPhoto) {
      setCurrentUrl("");
      return;
    }

    const blob =
      currentPhoto.file ??
      currentPhoto.thumbnail;

    if (!blob) {
      setCurrentUrl("");
      return;
    }

    const url =
      URL.createObjectURL(
        blob
      );

    setCurrentUrl(url);

    return () => {
      URL.revokeObjectURL(
        url
      );
    };
  }, [currentPhoto]);

  /*
   * 次写真用URL
   */
  useEffect(() => {
    if (!targetPhoto) {
      setTargetUrl("");
      return;
    }

    const blob =
      targetPhoto.file ??
      targetPhoto.thumbnail;

    if (!blob) {
      setTargetUrl("");
      return;
    }

    const url =
      URL.createObjectURL(
        blob
      );

    setTargetUrl(url);

    return () => {
      URL.revokeObjectURL(
        url
      );
    };
  }, [targetPhoto]);

  /*
   * 背景ページ固定
   */
  useEffect(() => {
    const oldOverflow =
      document.body.style
        .overflow;

    document.body.style
      .overflow = "hidden";

    return () => {
      document.body.style
        .overflow =
        oldOverflow;
    };
  }, []);

  /*
   * 移動可能範囲
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
   * 写真切替
   *
   * 旧画像・新画像を
   * 同時に動かす。
   */
  const changePhoto =
    useCallback(
      (
        nextDirection:
          Direction
      ) => {
        if (
          photos.length <= 1 ||
          scale !== 1 ||
          animationState !==
            "idle"
        ) {
          return;
        }

        let nextIndex: number;

        if (
          nextDirection ===
          "next"
        ) {
          nextIndex =
            currentIndex <
            photos.length - 1
              ? currentIndex + 1
              : 0;
        } else {
          nextIndex =
            currentIndex > 0
              ? currentIndex - 1
              : photos.length - 1;
        }

        setDirection(
          nextDirection
        );

        setTargetIndex(
          nextIndex
        );

        /*
         * 最初は新画像を
         * 画面外へ置く
         */
        setAnimationState(
          "preparing"
        );
      },
      [
        animationState,
        currentIndex,
        photos.length,
        scale,
      ]
    );

  /*
   * targetUrlが用意されたら
   * アニメーション開始
   */
  useEffect(() => {
    if (
      animationState !==
        "preparing" ||
      !targetUrl ||
      targetIndex === null
    ) {
      return;
    }

    const frame =
      requestAnimationFrame(
        () => {
          requestAnimationFrame(
            () => {
              setAnimationState(
                "moving"
              );
            }
          );
        }
      );

    const timer =
      window.setTimeout(
        () => {
          setCurrentIndex(
            targetIndex
          );

          setTargetIndex(
            null
          );

          setDirection(
            null
          );

          setAnimationState(
            "idle"
          );

          resetTransform();
        },
        SLIDE_DURATION +
          30
      );

    return () => {
      cancelAnimationFrame(
        frame
      );

      window.clearTimeout(
        timer
      );
    };
  }, [
    animationState,
    resetTransform,
    targetIndex,
    targetUrl,
  ]);

  /*
   * PCキー
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
        changePhoto(
          "next"
        );
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
   * Touch Start
   */
  const handleTouchStart = (
    event:
      ReactTouchEvent<HTMLDivElement>
  ) => {
    /*
     * ピンチ
     */
    if (
      event.touches.length ===
      2
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

      const center =
        getCenter(
          first,
          second
        );

      const stage =
        stageRef.current;

      if (!stage) {
        return;
      }

      const rect =
        stage.getBoundingClientRect();

      /*
       * 画面中央を0とした
       * 指の中心座標
       */
      pinchStartCenterX.current =
        center.x -
        (
          rect.left +
          rect.width / 2
        );

      pinchStartCenterY.current =
        center.y -
        (
          rect.top +
          rect.height / 2
        );

      pinchStartDistance.current =
        getDistance(
          first,
          second
        );

      pinchStartScale.current =
        scale;

      pinchStartOffsetX.current =
        offsetX;

      pinchStartOffsetY.current =
        offsetY;

      setIsCloseDragging(
        false
      );

      return;
    }

    if (
      event.touches.length !==
      1
    ) {
      return;
    }

    const touch =
      event.touches[0];

    if (!touch) {
      return;
    }

    if (scale === 1) {
      touchStartX.current =
        touch.clientX;

      touchStartY.current =
        touch.clientY;

      setCloseDragY(0);

      return;
    }

    dragStartX.current =
      touch.clientX;

    dragStartY.current =
      touch.clientY;

    dragOriginX.current =
      offsetX;

    dragOriginY.current =
      offsetY;
  };

  /*
   * Touch Move
   */
  const handleTouchMove = (
    event:
      ReactTouchEvent<HTMLDivElement>
  ) => {
    /*
     * ピンチ
     */
    if (
      event.touches.length ===
      2
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

      const newScale =
        Math.min(
          MAX_SCALE,
          Math.max(
            MIN_SCALE,
            pinchStartScale.current *
              ratio
          )
        );

      /*
       * ★重要
       *
       * 指2本の中心を
       * 動かさないよう
       * offsetも同時調整する。
       */
      const scaleRatio =
        newScale /
        pinchStartScale.current;

      const desiredX =
        pinchStartCenterX.current -
        (
          pinchStartCenterX.current -
          pinchStartOffsetX.current
        ) *
          scaleRatio;

      const desiredY =
        pinchStartCenterY.current -
        (
          pinchStartCenterY.current -
          pinchStartOffsetY.current
        ) *
          scaleRatio;

      const corrected =
        clampOffset(
          desiredX,
          desiredY,
          newScale
        );

      setScale(
        newScale
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
      event.touches.length !==
      1
    ) {
      return;
    }

    const touch =
      event.touches[0];

    if (!touch) {
      return;
    }

    /*
     * 拡大画像パン
     */
    if (scale > 1) {
      const desiredX =
        dragOriginX.current +
        (
          touch.clientX -
          dragStartX.current
        );

      const desiredY =
        dragOriginY.current +
        (
          touch.clientY -
          dragStartY.current
        );

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
     * 下スワイプ閉じる
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

    if (
      dy > 0 &&
      Math.abs(dy) >
        Math.abs(dx) *
          1.15
    ) {
      setIsCloseDragging(
        true
      );

      setCloseDragY(
        dy
      );
    }
  };

  /*
   * Touch End
   */
  const handleTouchEnd = (
    event:
      ReactTouchEvent<HTMLDivElement>
  ) => {
    if (
      event.touches.length <
      2
    ) {
      pinchStartDistance.current =
        null;
    }

    if (scale > 1) {
      return;
    }

    /*
     * 下へ閉じる
     */
    if (
      isCloseDragging
    ) {
      if (
        closeDragY >=
        CLOSE_THRESHOLD
      ) {
        setCloseDragY(
          window.innerHeight
        );

        window.setTimeout(
          onClose,
          160
        );

        return;
      }

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

    if (
      Math.abs(dx) <
        SWIPE_THRESHOLD ||
      Math.abs(dx) <=
        Math.abs(dy)
    ) {
      return;
    }

    if (dx < 0) {
      changePhoto(
        "next"
      );
    } else {
      changePhoto(
        "previous"
      );
    }
  };

  /*
   * PCマウスパン
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

    mouseOriginX.current =
      offsetX;

    mouseOriginY.current =
      offsetY;

    event.preventDefault();
  };

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

    const desiredX =
      mouseOriginX.current +
      (
        event.clientX -
        mouseStartX.current
      );

    const desiredY =
      mouseOriginY.current +
      (
        event.clientY -
        mouseStartY.current
      );

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

  const stopMouseDrag =
    () => {
      mouseDragging.current =
        false;
    };

  /*
   * ボタン拡大は中央基準
   */
  const zoomIn = () => {
    const newScale =
      Math.min(
        MAX_SCALE,
        scale + 0.5
      );

    setScale(
      newScale
    );

    const corrected =
      clampOffset(
        offsetX,
        offsetY,
        newScale
      );

    setOffsetX(
      corrected.x
    );

    setOffsetY(
      corrected.y
    );
  };

  const zoomOut = () => {
    const newScale =
      Math.max(
        MIN_SCALE,
        scale - 0.5
      );

    if (
      newScale === 1
    ) {
      resetTransform();
      return;
    }

    setScale(
      newScale
    );

    const corrected =
      clampOffset(
        offsetX,
        offsetY,
        newScale
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

  const currentName =
    getDisplayName(
      currentPhoto
    );

  const tags =
    currentPhoto.tags ?? [];

  /*
   * 左右アニメーション位置
   */
  let currentTranslate =
    "0%";

  let targetTranslate =
    "0%";

  if (
    animationState ===
      "preparing" &&
    direction === "next"
  ) {
    currentTranslate =
      "0%";

    targetTranslate =
      "100%";
  }

  if (
    animationState ===
      "moving" &&
    direction === "next"
  ) {
    currentTranslate =
      "-100%";

    targetTranslate =
      "0%";
  }

  if (
    animationState ===
      "preparing" &&
    direction ===
      "previous"
  ) {
    currentTranslate =
      "0%";

    targetTranslate =
      "-100%";
  }

  if (
    animationState ===
      "moving" &&
    direction ===
      "previous"
  ) {
    currentTranslate =
      "100%";

    targetTranslate =
      "0%";
  }

  const closeProgress =
    Math.min(
      1,
      closeDragY / 300
    );

  return (
    <div
      className="viewer"
      role="dialog"
      aria-modal="true"
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
      <header className="viewer-header">
        <button
          type="button"
          className="viewer-close"
          onClick={onClose}
        >
          ×
        </button>

        <div className="viewer-title">
          <strong>
            {currentPhoto.status ===
            "sent"
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
              scale <= 1
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
          stopMouseDrag
        }
        onMouseLeave={
          stopMouseDrag
        }
      >
        {/* 現在の写真 */}
        <div
          className="viewer-animation-image"
          style={{
            transform:
              `translate3d(${currentTranslate}, 0, 0)`,

            transition:
              animationState ===
              "moving"
                ? `transform ${SLIDE_DURATION}ms cubic-bezier(.22,.61,.36,1)`
                : "none",
          }}
        >
          {currentUrl && (
            <img
              ref={imageRef}
              src={currentUrl}
              alt={currentName}
              className="viewer-image"
              draggable={false}
              style={{
                transform:
                  `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${scale})`,
              }}
            />
          )}
        </div>

        {/* 次の写真 */}
        {targetIndex !==
          null &&
          targetUrl && (
          <div
            className="viewer-animation-image"
            style={{
              transform:
                `translate3d(${targetTranslate}, 0, 0)`,

              transition:
                animationState ===
                "moving"
                  ? `transform ${SLIDE_DURATION}ms cubic-bezier(.22,.61,.36,1)`
                  : "none",
            }}
          >
            <img
              src={
                targetUrl
              }
              alt=""
              className="viewer-image"
              draggable={
                false
              }
            />
          </div>
        )}

        {scale === 1 &&
          animationState ===
            "idle" &&
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

      <footer className="viewer-footer">
        <p className="viewer-file-name">
          {currentName}
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