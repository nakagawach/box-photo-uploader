import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type {
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
const SLIDE_TIME = 220;

/*
 * 2本指の距離を計算
 */
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
  /*
   * 最初に表示する写真
   */
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

  /*
   * 拡大倍率
   */
  const [
    scale,
    setScale,
  ] = useState(1);

  /*
   * 拡大後の写真位置
   */
  const [
    offsetX,
    setOffsetX,
  ] = useState(0);

  const [
    offsetY,
    setOffsetY,
  ] = useState(0);

  /*
   * 写真切替アニメーション
   */
  const [
    slideClass,
    setSlideClass,
  ] = useState<SlideClass>("");

  const [
    isSliding,
    setIsSliding,
  ] = useState(false);

  /*
   * 1本指スワイプ開始位置
   */
  const touchStartX =
    useRef<number | null>(null);

  const touchStartY =
    useRef<number | null>(null);

  /*
   * 拡大後ドラッグ用
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
   * ピンチズーム用
   */
  const pinchStartDistance =
    useRef<number | null>(null);

  const pinchStartScale =
    useRef(1);

  const currentPhoto =
    photos[currentIndex];

  /*
   * 拡大状態を初期化
   */
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
      URL.createObjectURL(blob);

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
   * ビューア表示中は
   * 背景ページのスクロールを停止
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
   * 次・前の写真へ移動
   *
   * いきなり切り替えず
   * 一度現在の写真を横へ出してから
   * 新しい写真を横から入れる。
   */
  const changePhoto = useCallback(
    (
      direction:
        | "next"
        | "previous"
    ) => {
      if (
        photos.length <= 1 ||
        isSliding ||
        scale !== 1
      ) {
        return;
      }

      setIsSliding(true);

      /*
       * 現在の写真を外へ
       */
      setSlideClass(
        direction === "next"
          ? "slide-out-left"
          : "slide-out-right"
      );

      window.setTimeout(
        () => {
          /*
           * 写真番号を変更
           */
          setCurrentIndex(
            (current) => {
              if (
                direction === "next"
              ) {
                if (
                  current <
                  photos.length - 1
                ) {
                  return current + 1;
                }

                return 0;
              }

              if (current > 0) {
                return current - 1;
              }

              return photos.length - 1;
            }
          );

          /*
           * 新しい写真を
           * 反対側に配置
           */
          setSlideClass(
            direction === "next"
              ? "slide-in-right"
              : "slide-in-left"
          );

          /*
           * 次フレームで中央へ移動
           */
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
      isSliding,
      photos.length,
      scale,
    ]
  );

  /*
   * PC用キー操作
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
     * → ピンチ開始
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

      return;
    }

    /*
     * 1本指
     */
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
     * 通常倍率なら
     * 写真切替スワイプ
     */
    if (scale === 1) {
      touchStartX.current =
        touch.clientX;

      touchStartY.current =
        touch.clientY;

      return;
    }

    /*
     * 拡大中なら
     * 写真移動開始
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
   * 指を動かす
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

      const nextScale =
        pinchStartScale.current *
        ratio;

      const limitedScale =
        Math.min(
          MAX_SCALE,
          Math.max(
            MIN_SCALE,
            nextScale
          )
        );

      setScale(
        limitedScale
      );

      if (
        limitedScale === 1
      ) {
        setOffsetX(0);
        setOffsetY(0);
      }

      return;
    }

    /*
     * 拡大中の
     * 1本指ドラッグ
     */
    if (
      event.touches.length === 1 &&
      scale > 1
    ) {
      const touch =
        event.touches[0];

      if (!touch) {
        return;
      }

      const moveX =
        touch.clientX -
        dragStartX.current;

      const moveY =
        touch.clientY -
        dragStartY.current;

      /*
       * translate3dで
       * GPU描画させるため
       * 滑らかに動く
       */
      setOffsetX(
        dragOriginalX.current +
          moveX
      );

      setOffsetY(
        dragOriginalY.current +
          moveY
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
    /*
     * ピンチ終了
     */
    if (
      event.touches.length < 2
    ) {
      pinchStartDistance.current =
        null;
    }

    /*
     * 拡大中は
     * 写真切替しない
     */
    if (scale > 1) {
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
     * 縦操作は写真切替と
     * 判定しない
     */
    if (
      Math.abs(dx) <
        SWIPE_THRESHOLD ||
      Math.abs(dx) <=
        Math.abs(dy)
    ) {
      return;
    }

    /*
     * 左へスワイプ
     * → 次
     */
    if (dx < 0) {
      changePhoto("next");
      return;
    }

    /*
     * 右へスワイプ
     * → 前
     */
    changePhoto(
      "previous"
    );
  };

  /*
   * ＋ボタン
   */
  const zoomIn = () => {
    setScale(
      (current) =>
        Math.min(
          MAX_SCALE,
          current + 0.5
        )
    );
  };

  /*
   * −ボタン
   */
  const zoomOut = () => {
    setScale(
      (current) => {
        const next =
          Math.max(
            MIN_SCALE,
            current - 0.5
          );

        if (next === 1) {
          setOffsetX(0);
          setOffsetY(0);
        }

        return next;
      }
    );
  };

  if (!currentPhoto) {
    return null;
  }

  const isSent =
    currentPhoto.status ===
    "sent";

  /*
   * 送信済みなら
   * 実際にBoxへ送った名前
   */
  const displayFileName =
    isSent
      ? currentPhoto
          .uploadedFileName ??
        currentPhoto.fileName
      : currentPhoto.fileName;

  const tags =
    currentPhoto.tags ?? [];

  return (
    <div
      className="viewer"
      role="dialog"
      aria-modal="true"
      aria-label="写真の全画面表示"
    >
      {/* ======================
          上部情報
          ====================== */}
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

      {/* ======================
          写真
          ====================== */}
      <div
        className="viewer-stage"
        onTouchStart={
          handleTouchStart
        }
        onTouchMove={
          handleTouchMove
        }
        onTouchEnd={
          handleTouchEnd
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

        {/* 通常倍率のみ矢印表示 */}
        {scale === 1 &&
          photos.length > 1 && (
            <>
              <button
                type="button"
                className="viewer-arrow viewer-arrow-left"
                onClick={() =>
                  changePhoto(
                    "previous"
                  )
                }
                aria-label="前の写真"
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
                aria-label="次の写真"
              >
                ›
              </button>
            </>
          )}
      </div>

      {/* ======================
          下部情報
          ====================== */}
      <footer className="viewer-footer">
        <p className="viewer-file-name">
          {displayFileName}
        </p>

        {tags.length > 0 && (
          <div className="viewer-tags">
            {tags.map(
              (tag) => (
                <span
                  key={tag}
                >
                  {tag}
                </span>
              )
            )}
          </div>
        )}

        <p className="viewer-help">
          {scale > 1
            ? "写真を指で動かせます"
            : photos.length > 1
              ? "左右スワイプで写真を切り替え"
              : "ピンチ操作で拡大"}
        </p>
      </footer>
    </div>
  );
}

export default PhotoViewer;