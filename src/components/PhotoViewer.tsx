import {
    useCallback,
    useEffect,
    useRef,
    useState,
  } from "react";
  import type {
    TouchEvent as ReactTouchEvent,
  } from "react";
  import type { StoredPhoto } from "../types/Photo";
  
  type PhotoViewerProps = {
    photos: StoredPhoto[];
    initialPhotoId: string;
    onClose: () => void;
  };
  
  const MIN_SCALE = 1;
  const MAX_SCALE = 4;
  const SWIPE_DISTANCE = 60;
  
  function getTouchDistance(
    touches: ReactTouchEvent<HTMLDivElement>["touches"]
  ): number {
    if (touches.length < 2) {
      return 0;
    }
  
    const firstTouch = touches[0];
    const secondTouch = touches[1];
  
    return Math.hypot(
      secondTouch.clientX - firstTouch.clientX,
      secondTouch.clientY - firstTouch.clientY
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
        (photo) => photo.id === initialPhotoId
      )
    );
  
    const [currentIndex, setCurrentIndex] =
      useState(initialIndex);
  
    const [previewUrl, setPreviewUrl] =
      useState("");
  
    const [scale, setScale] = useState(1);
  
    const swipeStartX = useRef<number | null>(
      null
    );
  
    const pinchStartDistance = useRef<
      number | null
    >(null);
  
    const pinchStartScale = useRef(1);
  
    const currentPhoto = photos[currentIndex];
  
    const showPrevious = useCallback(() => {
      if (photos.length <= 1) {
        return;
      }
  
      setCurrentIndex((current) =>
        current > 0
          ? current - 1
          : photos.length - 1
      );
    }, [photos.length]);
  
    const showNext = useCallback(() => {
      if (photos.length <= 1) {
        return;
      }
  
      setCurrentIndex((current) =>
        current < photos.length - 1
          ? current + 1
          : 0
      );
    }, [photos.length]);
  
    useEffect(() => {
      if (!currentPhoto) {
        setPreviewUrl("");
        return;
      }
  
      const previewBlob =
        currentPhoto.file ??
        currentPhoto.thumbnail;
  
      if (!previewBlob) {
        setPreviewUrl("");
        return;
      }
  
      const objectUrl =
        URL.createObjectURL(previewBlob);
  
      setPreviewUrl(objectUrl);
  
      return () => {
        URL.revokeObjectURL(objectUrl);
      };
    }, [currentPhoto]);
  
    // 写真が切り替わったら倍率を戻す
    useEffect(() => {
      setScale(1);
      pinchStartDistance.current = null;
      swipeStartX.current = null;
    }, [currentIndex]);
  
    useEffect(() => {
      const previousOverflow =
        document.body.style.overflow;
  
      document.body.style.overflow = "hidden";
  
      const handleKeyDown = (
        event: KeyboardEvent
      ) => {
        if (event.key === "Escape") {
          onClose();
        }
  
        if (event.key === "ArrowLeft") {
          showPrevious();
        }
  
        if (event.key === "ArrowRight") {
          showNext();
        }
  
        if (event.key === "+") {
          setScale((current) =>
            Math.min(MAX_SCALE, current + 0.5)
          );
        }
  
        if (event.key === "-") {
          setScale((current) =>
            Math.max(MIN_SCALE, current - 0.5)
          );
        }
      };
  
      window.addEventListener(
        "keydown",
        handleKeyDown
      );
  
      return () => {
        document.body.style.overflow =
          previousOverflow;
  
        window.removeEventListener(
          "keydown",
          handleKeyDown
        );
      };
    }, [
      onClose,
      showNext,
      showPrevious,
    ]);
  
    const handleTouchStart = (
      event: ReactTouchEvent<HTMLDivElement>
    ) => {
      if (event.touches.length === 2) {
        pinchStartDistance.current =
          getTouchDistance(event.touches);
  
        pinchStartScale.current = scale;
        swipeStartX.current = null;
        return;
      }
  
      if (
        event.touches.length === 1 &&
        scale === 1
      ) {
        swipeStartX.current =
          event.touches[0]?.clientX ?? null;
      }
    };
  
    const handleTouchMove = (
      event: ReactTouchEvent<HTMLDivElement>
    ) => {
      if (
        event.touches.length !== 2 ||
        pinchStartDistance.current === null
      ) {
        return;
      }
  
      const currentDistance =
        getTouchDistance(event.touches);
  
      if (currentDistance === 0) {
        return;
      }
  
      const nextScale =
        pinchStartScale.current *
        (currentDistance /
          pinchStartDistance.current);
  
      setScale(
        Math.min(
          MAX_SCALE,
          Math.max(MIN_SCALE, nextScale)
        )
      );
    };
  
    const handleTouchEnd = (
      event: ReactTouchEvent<HTMLDivElement>
    ) => {
      if (pinchStartDistance.current !== null) {
        if (event.touches.length < 2) {
          pinchStartDistance.current = null;
        }
  
        return;
      }
  
      if (
        swipeStartX.current === null ||
        scale !== 1
      ) {
        swipeStartX.current = null;
        return;
      }
  
      const endTouch =
        event.changedTouches[0];
  
      if (!endTouch) {
        swipeStartX.current = null;
        return;
      }
  
      const distance =
        endTouch.clientX -
        swipeStartX.current;
  
      swipeStartX.current = null;
  
      if (
        Math.abs(distance) <
        SWIPE_DISTANCE
      ) {
        return;
      }
  
      if (distance > 0) {
        showPrevious();
      } else {
        showNext();
      }
    };
  
    const zoomIn = () => {
      setScale((current) =>
        Math.min(MAX_SCALE, current + 0.5)
      );
    };
  
    const zoomOut = () => {
      setScale((current) =>
        Math.max(MIN_SCALE, current - 0.5)
      );
    };
  
    const resetZoom = () => {
      setScale(1);
    };
  
    if (!currentPhoto) {
      return null;
    }
  
    const currentTags =
      currentPhoto.tags ?? [];
  
    return (
      <div
        className="photo-viewer"
        role="dialog"
        aria-modal="true"
        aria-label="写真の全画面表示"
        onClick={onClose}
      >
        <button
          type="button"
          className="photo-viewer-close"
          aria-label="全画面表示を閉じる"
          onClick={onClose}
        >
          ×
        </button>
  
        <div
          className="photo-viewer-toolbar"
          onClick={(event) =>
            event.stopPropagation()
          }
        >
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
            aria-label="倍率を元に戻す"
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
  
        <div
          className="photo-viewer-content"
          onClick={(event) =>
            event.stopPropagation()
          }
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="photo-viewer-image-area">
            {previewUrl && (
              <img
                className="photo-viewer-image"
                src={previewUrl}
                alt={currentPhoto.fileName}
                draggable={false}
                style={{
                  transform: `scale(${scale})`,
                }}
                onDoubleClick={resetZoom}
              />
            )}
          </div>
  
          <div className="photo-viewer-footer">
            <p className="photo-viewer-counter">
              {currentIndex + 1} /{" "}
              {photos.length}
            </p>
  
            <p className="photo-viewer-name">
              {currentPhoto.fileName}
            </p>
  
            {currentTags.length > 0 && (
              <div className="photo-viewer-tags">
                {currentTags.map((tag) => (
                  <span key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
  
            {scale === 1 &&
              photos.length > 1 && (
                <p className="photo-viewer-guide">
                  左右にスワイプして写真を切り替え
                </p>
              )}
          </div>
        </div>
  
        {photos.length > 1 && scale === 1 && (
          <>
            <button
              type="button"
              className="photo-viewer-nav previous"
              aria-label="前の写真"
              onClick={(event) => {
                event.stopPropagation();
                showPrevious();
              }}
            >
              ‹
            </button>
  
            <button
              type="button"
              className="photo-viewer-nav next"
              aria-label="次の写真"
              onClick={(event) => {
                event.stopPropagation();
                showNext();
              }}
            >
              ›
            </button>
          </>
        )}
      </div>
    );
  }
  
  export default PhotoViewer;