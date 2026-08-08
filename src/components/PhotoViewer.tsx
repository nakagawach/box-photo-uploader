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

type Point = {
  x: number;
  y: number;
};

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;

const GESTURE_LOCK = 14;
const SWIPE_THRESHOLD = 56;
const CLOSE_THRESHOLD = 90;
const DOUBLE_TAP_MS = 360;
const DOUBLE_TAP_DISTANCE = 44;

const SLIDE_DURATION = 280;
const CLOSE_DURATION = 180;

function clamp(
  value: number,
  min: number,
  max: number
): number {
  return Math.min(max, Math.max(min, value));
}

function getPhotoBlob(
  photo: StoredPhoto | undefined
): Blob | undefined {
  return photo?.file ?? photo?.thumbnail;
}

function getDisplayName(
  photo: StoredPhoto
): string {
  return photo.status === "sent"
    ? photo.uploadedFileName ?? photo.fileName
    : photo.fileName;
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

  const [urlMap, setUrlMap] =
    useState<Record<string, string>>({});

  const [stageWidth, setStageWidth] =
    useState(window.innerWidth);

  const [scale, setScale] =
    useState(1);

  const [offsetX, setOffsetX] =
    useState(0);

  const [offsetY, setOffsetY] =
    useState(0);

  const [trackDragX, setTrackDragX] =
    useState(0);

  const [trackAnimating, setTrackAnimating] =
    useState(false);

  const [closeDragY, setCloseDragY] =
    useState(0);

  const [closeAnimating, setCloseAnimating] =
    useState(false);

  const stageRef =
    useRef<HTMLDivElement | null>(null);

  const currentImageRef =
    useRef<HTMLImageElement | null>(null);

  const scaleRef =
    useRef(1);

  const offsetXRef =
    useRef(0);

  const offsetYRef =
    useRef(0);

  const trackDragXRef =
    useRef(0);

  const closeDragYRef =
    useRef(0);

  const gestureModeRef =
    useRef<GestureMode>("none");

  const activePointersRef =
    useRef<Map<number, Point>>(
      new Map()
    );

  const primaryPointerIdRef =
    useRef<number | null>(null);

  const gestureStartRef =
    useRef({
      x: 0,
      y: 0,
      offsetX: 0,
      offsetY: 0,
    });

  const pinchRef =
    useRef({
      startDistance: 0,
      startScale: 1,
      imageX: 0,
      imageY: 0,
    });

  const lastTapRef =
    useRef({
      time: 0,
      x: 0,
      y: 0,
    });

  const slideDirectionRef =
    useRef<
      "next" |
      "previous" |
      null
    >(null);

  const currentPhoto =
    photos[currentIndex];

  const previousIndex =
    useMemo(
      () =>
        currentIndex > 0
          ? currentIndex - 1
          : photos.length - 1,
      [
        currentIndex,
        photos.length,
      ]
    );

  const nextIndex =
    useMemo(
      () =>
        currentIndex <
        photos.length - 1
          ? currentIndex + 1
          : 0,
      [
        currentIndex,
        photos.length,
      ]
    );

  const previousPhoto =
    photos[previousIndex];

  const nextPhoto =
    photos[nextIndex];

  /*
   * 重要：
   * 写真ごとにURLを紐付けます。
   *
   * currentIndex変更後に「前のURLが一瞬残る」
   * という現象を防ぎます。
   */
  useEffect(() => {
    const createdUrls:
      Record<string, string> = {};

    for (const photo of photos) {
      const blob =
        getPhotoBlob(photo);

      if (!blob) {
        continue;
      }

      createdUrls[photo.id] =
        URL.createObjectURL(blob);
    }

    setUrlMap(createdUrls);

    return () => {
      Object.values(
        createdUrls
      ).forEach((url) => {
        URL.revokeObjectURL(
          url
        );
      });
    };
  }, [photos]);

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

  const syncScale = (
    value: number
  ) => {
    scaleRef.current =
      value;

    setScale(value);
  };

  const syncOffset = (
    x: number,
    y: number
  ) => {
    offsetXRef.current =
      x;

    offsetYRef.current =
      y;

    setOffsetX(x);
    setOffsetY(y);
  };

  const syncTrack = (
    value: number
  ) => {
    trackDragXRef.current =
      value;

    setTrackDragX(value);
  };

  const syncClose = (
    value: number
  ) => {
    closeDragYRef.current =
      value;

    setCloseDragY(value);
  };

  const updateStageWidth =
    useCallback(() => {
      const width =
        stageRef.current
          ?.clientWidth ??
        window.innerWidth;

      setStageWidth(width);
    }, []);

  useEffect(() => {
    updateStageWidth();

    window.addEventListener(
      "resize",
      updateStageWidth
    );

    return () => {
      window.removeEventListener(
        "resize",
        updateStageWidth
      );
    };
  }, [updateStageWidth]);

  /*
   * 写真切替後は
   * 新写真を100%・中央位置から開始。
   */
  useEffect(() => {
    syncScale(1);
    syncOffset(0, 0);
  }, [currentIndex]);

  const getPanBounds =
    useCallback(
      (
        targetScale: number
      ) => {
        const stage =
          stageRef.current;

        const image =
          currentImageRef.current;

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

        const scaledWidth =
          image.offsetWidth *
          targetScale;

        const scaledHeight =
          image.offsetHeight *
          targetScale;

        return {
          maxX:
            Math.max(
              0,
              (
                scaledWidth -
                stage.clientWidth
              ) / 2
            ),

          maxY:
            Math.max(
              0,
              (
                scaledHeight -
                stage.clientHeight
              ) / 2
            ),
        };
      },
      []
    );

  const clampOffset =
    useCallback(
      (
        x: number,
        y: number,
        targetScale: number
      ) => {
        const {
          maxX,
          maxY,
        } =
          getPanBounds(
            targetScale
          );

        return {
          x:
            clamp(
              x,
              -maxX,
              maxX
            ),

          y:
            clamp(
              y,
              -maxY,
              maxY
            ),
        };
      },
      [getPanBounds]
    );

  const resetZoom =
    useCallback(() => {
      syncScale(1);
      syncOffset(0, 0);
    }, []);

  /*
   * 指やマウスの位置を基準にズーム。
   *
   * stage中心ではなく、
   * 実際に触った場所の画像座標を保存するので、
   * 拡大したい場所が勝手に左上等へ飛びにくくなります。
   */
  const zoomAt =
    useCallback(
      (
        clientX: number,
        clientY: number,
        targetScale: number
      ) => {
        const stage =
          stageRef.current;

        if (!stage) {
          return;
        }

        const rect =
          stage.getBoundingClientRect();

        const localX =
          clientX -
          (
            rect.left +
            rect.width / 2
          );

        const localY =
          clientY -
          (
            rect.top +
            rect.height / 2
          );

        const oldScale =
          scaleRef.current;

        const imageX =
          (
            localX -
            offsetXRef.current
          ) / oldScale;

        const imageY =
          (
            localY -
            offsetYRef.current
          ) / oldScale;

        const desiredX =
          localX -
          imageX *
          targetScale;

        const desiredY =
          localY -
          imageY *
          targetScale;

        const corrected =
          clampOffset(
            desiredX,
            desiredY,
            targetScale
          );

        syncScale(
          targetScale
        );

        syncOffset(
          corrected.x,
          corrected.y
        );
      },
      [clampOffset]
    );

  const getPointerPair =
    () => {
      const values =
        Array.from(
          activePointersRef
            .current
            .values()
        );

      if (
        values.length < 2
      ) {
        return null;
      }

      return {
        first:
          values[0],

        second:
          values[1],
      };
    };

  const beginPinch =
    () => {
      const pair =
        getPointerPair();

      const stage =
        stageRef.current;

      if (
        !pair ||
        !stage
      ) {
        return;
      }

      const {
        first,
        second,
      } = pair;

      const centerX =
        (
          first.x +
          second.x
        ) / 2;

      const centerY =
        (
          first.y +
          second.y
        ) / 2;

      const rect =
        stage.getBoundingClientRect();

      const localX =
        centerX -
        (
          rect.left +
          rect.width / 2
        );

      const localY =
        centerY -
        (
          rect.top +
          rect.height / 2
        );

      const startScale =
        scaleRef.current;

      pinchRef.current = {
        startDistance:
          Math.hypot(
            second.x -
            first.x,

            second.y -
            first.y
          ),

        startScale,

        /*
         * ピンチ開始時の
         * 指中心直下の「画像座標」。
         */
        imageX:
          (
            localX -
            offsetXRef.current
          ) / startScale,

        imageY:
          (
            localY -
            offsetYRef.current
          ) / startScale,
      };

      gestureModeRef.current =
        "pinch";

      setTrackAnimating(
        false
      );

      syncTrack(0);

      setCloseAnimating(
        false
      );

      syncClose(0);
    };

  const updatePinch =
    () => {
      const pair =
        getPointerPair();

      const stage =
        stageRef.current;

      if (
        !pair ||
        !stage ||
        pinchRef.current
          .startDistance <= 0
      ) {
        return;
      }

      const {
        first,
        second,
      } = pair;

      const currentDistance =
        Math.hypot(
          second.x -
          first.x,

          second.y -
          first.y
        );

      const targetScale =
        clamp(
          pinchRef.current
            .startScale *
          (
            currentDistance /
            pinchRef.current
              .startDistance
          ),

          MIN_SCALE,
          MAX_SCALE
        );

      /*
       * 現在の2本指中心。
       * ピンチ中に指自体を動かしても追従します。
       */
      const centerX =
        (
          first.x +
          second.x
        ) / 2;

      const centerY =
        (
          first.y +
          second.y
        ) / 2;

      const rect =
        stage.getBoundingClientRect();

      const localX =
        centerX -
        (
          rect.left +
          rect.width / 2
        );

      const localY =
        centerY -
        (
          rect.top +
          rect.height / 2
        );

      const desiredX =
        localX -
        pinchRef.current
          .imageX *
        targetScale;

      const desiredY =
        localY -
        pinchRef.current
          .imageY *
        targetScale;

      const corrected =
        clampOffset(
          desiredX,
          desiredY,
          targetScale
        );

      syncScale(
        targetScale
      );

      syncOffset(
        corrected.x,
        corrected.y
      );
    };

  const animatePhotoChange =
    useCallback(
      (
        direction:
          | "next"
          | "previous"
      ) => {
        if (
          photos.length <= 1 ||
          scaleRef.current >
            1.01 ||
          slideDirectionRef
            .current !== null
        ) {
          return;
        }

        const width =
          stageRef.current
            ?.clientWidth ??
          stageWidth;

        slideDirectionRef.current =
          direction;

        setTrackAnimating(
          true
        );

        syncTrack(
          direction === "next"
            ? -width
            : width
        );
      },
      [
        photos.length,
        stageWidth,
      ]
    );

  /*
   * ボタンを押しても確実に動くよう、
   * controlsはviewer-stageの外側へ置いています。
   *
   * そのため写真ジェスチャーのPointer Captureに
   * ボタン操作が奪われません。
   */
  const handleTrackTransitionEnd =
    () => {
      const direction =
        slideDirectionRef.current;

      if (!direction) {
        /*
         * スワイプが閾値未満で
         * 元へ戻るアニメーションの場合。
         */
        setTrackAnimating(
          false
        );

        return;
      }

      /*
       * transitionを切った状態で
       * 新写真へindexを進め、
       * track位置を中央へ戻す。
       *
       * URLはphoto.idで引くため、
       * 旧写真が一瞬再表示されません。
       */
      setTrackAnimating(
        false
      );

      setCurrentIndex(
        (current) => {
          if (
            direction ===
            "next"
          ) {
            return current <
              photos.length - 1
              ? current + 1
              : 0;
          }

          return current > 0
            ? current - 1
            : photos.length -
                1;
        }
      );

      syncTrack(0);

      slideDirectionRef.current =
        null;
    };

  const finishSwipe =
    () => {
      const width =
        stageRef.current
          ?.clientWidth ??
        stageWidth;

      const threshold =
        Math.max(
          SWIPE_THRESHOLD,
          width * 0.17
        );

      const x =
        trackDragXRef.current;

      if (
        Math.abs(x) >=
        threshold
      ) {
        animatePhotoChange(
          x < 0
            ? "next"
            : "previous"
        );

        return;
      }

      setTrackAnimating(
        true
      );

      syncTrack(0);
    };

  const finishClose =
    () => {
      if (
        closeDragYRef
          .current >=
        CLOSE_THRESHOLD
      ) {
        setCloseAnimating(
          true
        );

        syncClose(
          window.innerHeight
        );

        window.setTimeout(
          onClose,
          CLOSE_DURATION
        );

        return;
      }

      setCloseAnimating(
        true
      );

      syncClose(0);
    };

  const handlePointerDown =
    (
      event:
        ReactPointerEvent<HTMLDivElement>
    ) => {
      if (
        event.pointerType ===
          "mouse" &&
        event.button !== 0
      ) {
        return;
      }

      try {
        event.currentTarget
          .setPointerCapture(
            event.pointerId
          );
      } catch {
        /*
         * 一部ブラウザで
         * capture不可でも処理継続。
         */
      }

      activePointersRef.current.set(
        event.pointerId,
        {
          x: event.clientX,
          y: event.clientY,
        }
      );

      /*
       * 2本目の指が来たら
       * 即ピンチへ。
       */
      if (
        activePointersRef
          .current.size === 2
      ) {
        beginPinch();
        return;
      }

      if (
        activePointersRef
          .current.size !== 1
      ) {
        return;
      }

      primaryPointerIdRef.current =
        event.pointerId;

      gestureStartRef.current = {
        x: event.clientX,
        y: event.clientY,

        offsetX:
          offsetXRef.current,

        offsetY:
          offsetYRef.current,
      };

      if (
        scaleRef.current >
        1.01
      ) {
        gestureModeRef.current =
          "pan";
      } else {
        gestureModeRef.current =
          "pending";

        setTrackAnimating(
          false
        );

        syncTrack(0);

        setCloseAnimating(
          false
        );

        syncClose(0);
      }
    };

  const handlePointerMove =
    (
      event:
        ReactPointerEvent<HTMLDivElement>
    ) => {
      if (
        !activePointersRef
          .current
          .has(
            event.pointerId
          )
      ) {
        return;
      }

      activePointersRef.current.set(
        event.pointerId,
        {
          x: event.clientX,
          y: event.clientY,
        }
      );

      if (
        activePointersRef
          .current.size >= 2
      ) {
        if (
          gestureModeRef
            .current !==
          "pinch"
        ) {
          beginPinch();
        }

        updatePinch();
        return;
      }

      const start =
        gestureStartRef.current;

      const dx =
        event.clientX -
        start.x;

      const dy =
        event.clientY -
        start.y;

      if (
        gestureModeRef
          .current ===
        "pan"
      ) {
        const corrected =
          clampOffset(
            start.offsetX +
              dx,

            start.offsetY +
              dy,

            scaleRef.current
          );

        syncOffset(
          corrected.x,
          corrected.y
        );

        return;
      }

      if (
        gestureModeRef
          .current ===
        "pending"
      ) {
        if (
          Math.abs(dx) <
            GESTURE_LOCK &&
          Math.abs(dy) <
            GESTURE_LOCK
        ) {
          return;
        }

        if (
          dy > 0 &&
          Math.abs(dy) >
            Math.abs(dx) *
              1.12
        ) {
          gestureModeRef.current =
            "close";
        } else if (
          Math.abs(dx) >
          Math.abs(dy) *
            1.05
        ) {
          gestureModeRef.current =
            "swipe";
        } else {
          return;
        }
      }

      if (
        gestureModeRef
          .current ===
        "close"
      ) {
        syncClose(
          Math.max(
            0,
            dy
          )
        );

        return;
      }

      if (
        gestureModeRef
          .current ===
        "swipe"
      ) {
        const width =
          stageRef.current
            ?.clientWidth ??
          stageWidth;

        syncTrack(
          clamp(
            dx,
            -width,
            width
          )
        );
      }
    };

  const isTapGesture =
    (
      event:
        ReactPointerEvent<HTMLDivElement>
    ) => {
      const start =
        gestureStartRef.current;

      const distance =
        Math.hypot(
          event.clientX -
            start.x,

          event.clientY -
            start.y
        );

      return (
        distance <= 22
      );
    };

  const handleDoubleTap =
    (
      event:
        ReactPointerEvent<HTMLDivElement>
    ) => {
      if (
        event.pointerType !==
        "touch"
      ) {
        return false;
      }

      if (
        !isTapGesture(
          event
        )
      ) {
        /*
         * 少しでも大きく動かした操作は
         * タップ履歴をリセット。
         */
        lastTapRef.current = {
          time: 0,
          x: 0,
          y: 0,
        };

        return false;
      }

      const now =
        performance.now();

      const previous =
        lastTapRef.current;

      const sameArea =
        Math.hypot(
          event.clientX -
            previous.x,

          event.clientY -
            previous.y
        ) <=
        DOUBLE_TAP_DISTANCE;

      const isDouble =
        previous.time > 0 &&
        now -
          previous.time <=
          DOUBLE_TAP_MS &&
        sameArea;

      if (
        isDouble
      ) {
        /*
         * ★2回目で即発火し、
         * その後の3回目が別のダブル判定にならないようリセット。
         */
        lastTapRef.current = {
          time: 0,
          x: 0,
          y: 0,
        };

        if (
          scaleRef.current <=
          1.01
        ) {
          zoomAt(
            event.clientX,
            event.clientY,
            DOUBLE_TAP_SCALE
          );
        } else {
          resetZoom();
        }

        return true;
      }

      lastTapRef.current = {
        time: now,
        x: event.clientX,
        y: event.clientY,
      };

      return false;
    };

  const finishPointer =
    (
      event:
        ReactPointerEvent<HTMLDivElement>
    ) => {
      const mode =
        gestureModeRef.current;

      activePointersRef.current.delete(
        event.pointerId
      );

      if (
        mode ===
        "pinch"
      ) {
        /*
         * 2本指を離したらピンチ終了。
         * 残った1本を勝手にパンへ変換しません。
         */
        if (
          activePointersRef
            .current.size <
          2
        ) {
          gestureModeRef.current =
            "none";
        }

        if (
          scaleRef.current <=
          1.02
        ) {
          resetZoom();
        } else {
          const corrected =
            clampOffset(
              offsetXRef.current,
              offsetYRef.current,
              scaleRef.current
            );

          syncOffset(
            corrected.x,
            corrected.y
          );
        }

        return;
      }

      if (
        event.pointerId !==
        primaryPointerIdRef
          .current
      ) {
        return;
      }

      primaryPointerIdRef.current =
        null;

      if (
        mode ===
        "pending" &&
        handleDoubleTap(
          event
        )
      ) {
        gestureModeRef.current =
          "none";

        return;
      }

      if (
        mode ===
        "swipe"
      ) {
        finishSwipe();
      } else if (
        mode ===
        "close"
      ) {
        finishClose();
      } else if (
        mode ===
        "pan"
      ) {
        const corrected =
          clampOffset(
            offsetXRef.current,
            offsetYRef.current,
            scaleRef.current
          );

        syncOffset(
          corrected.x,
          corrected.y
        );
      }

      gestureModeRef.current =
        "none";
    };

  const handlePointerUp =
    (
      event:
        ReactPointerEvent<HTMLDivElement>
    ) => {
      finishPointer(
        event
      );
    };

  const handlePointerCancel =
    (
      event:
        ReactPointerEvent<HTMLDivElement>
    ) => {
      activePointersRef.current.delete(
        event.pointerId
      );

      primaryPointerIdRef.current =
        null;

      gestureModeRef.current =
        "none";

      setTrackAnimating(
        true
      );

      syncTrack(0);

      setCloseAnimating(
        true
      );

      syncClose(0);
    };

  const handleDoubleClick =
    (
      event:
        ReactMouseEvent<HTMLImageElement>
    ) => {
      if (
        scaleRef.current <=
        1.01
      ) {
        zoomAt(
          event.clientX,
          event.clientY,
          DOUBLE_TAP_SCALE
        );
      } else {
        resetZoom();
      }
    };

  const zoomIn =
    () => {
      const stage =
        stageRef.current;

      if (!stage) {
        return;
      }

      const rect =
        stage.getBoundingClientRect();

      zoomAt(
        rect.left +
          rect.width / 2,

        rect.top +
          rect.height / 2,

        clamp(
          scaleRef.current +
            0.5,

          MIN_SCALE,
          MAX_SCALE
        )
      );
    };

  const zoomOut =
    () => {
      const nextScale =
        clamp(
          scaleRef.current -
            0.5,

          MIN_SCALE,
          MAX_SCALE
        );

      if (
        nextScale <= 1
      ) {
        resetZoom();
        return;
      }

      const stage =
        stageRef.current;

      if (!stage) {
        return;
      }

      const rect =
        stage.getBoundingClientRect();

      zoomAt(
        rect.left +
          rect.width / 2,

        rect.top +
          rect.height / 2,

        nextScale
      );
    };

  useEffect(() => {
    const handleKeyDown =
      (
        event:
          KeyboardEvent
      ) => {
        if (
          event.key ===
          "Escape"
        ) {
          onClose();
          return;
        }

        if (
          scaleRef.current >
          1.01
        ) {
          return;
        }

        if (
          event.key ===
          "ArrowRight"
        ) {
          animatePhotoChange(
            "next"
          );
        }

        if (
          event.key ===
          "ArrowLeft"
        ) {
          animatePhotoChange(
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
    animatePhotoChange,
    onClose,
  ]);

  if (
    !currentPhoto ||
    photos.length === 0
  ) {
    return null;
  }

  const currentUrl =
    urlMap[
      currentPhoto.id
    ] ?? "";

  const previousUrl =
    previousPhoto
      ? urlMap[
          previousPhoto.id
        ] ?? ""
      : "";

  const nextUrl =
    nextPhoto
      ? urlMap[
          nextPhoto.id
        ] ?? ""
      : "";

  const displayName =
    getDisplayName(
      currentPhoto
    );

  const tags =
    currentPhoto.tags ?? [];

  const trackX =
    -stageWidth +
    trackDragX;

  const viewerOpacity =
    Math.max(
      0.3,
      1 -
        closeDragY /
          Math.max(
            420,
            window.innerHeight
          )
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
          viewerOpacity,

        transition:
          closeAnimating
            ? `transform ${CLOSE_DURATION}ms ease, opacity ${CLOSE_DURATION}ms ease`
            : "none",
      }}
    >
      <header className="viewer-header">
        <button
          type="button"
          className="viewer-close"
          onClick={
            onClose
          }
          aria-label="閉じる"
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
            onClick={
              zoomOut
            }
            disabled={
              scale <=
              MIN_SCALE
            }
          >
            −
          </button>

          <button
            type="button"
            onClick={
              resetZoom
            }
          >
            {Math.round(
              scale * 100
            )}
            %
          </button>

          <button
            type="button"
            onClick={
              zoomIn
            }
            disabled={
              scale >=
              MAX_SCALE
            }
          >
            ＋
          </button>
        </div>
      </header>

      <div
        ref={
          stageRef
        }
        className={
          scale > 1
            ? "viewer-stage zoomed"
            : "viewer-stage"
        }
        onPointerDown={
          handlePointerDown
        }
        onPointerMove={
          handlePointerMove
        }
        onPointerUp={
          handlePointerUp
        }
        onPointerCancel={
          handlePointerCancel
        }
      >
        <div
          className="viewer-track"
          style={{
            width:
              `${stageWidth * 3}px`,

            transform:
              `translate3d(${trackX}px, 0, 0)`,

            transition:
              trackAnimating
                ? `transform ${SLIDE_DURATION}ms cubic-bezier(.22,.61,.36,1)`
                : "none",
          }}
          onTransitionEnd={
            handleTrackTransitionEnd
          }
        >
          <div
            className="viewer-slide"
            style={{
              width:
                `${stageWidth}px`,
            }}
          >
            {previousUrl && (
              <img
                className="viewer-neighbor-image"
                src={
                  previousUrl
                }
                alt=""
                draggable={
                  false
                }
              />
            )}
          </div>

          <div
            className="viewer-slide"
            style={{
              width:
                `${stageWidth}px`,
            }}
          >
            {currentUrl && (
              <img
                ref={
                  currentImageRef
                }
                className="viewer-image"
                src={
                  currentUrl
                }
                alt={
                  displayName
                }
                draggable={
                  false
                }
                style={{
                  transform:
                    `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${scale})`,
                }}
                onDoubleClick={
                  handleDoubleClick
                }
              />
            )}
          </div>

          <div
            className="viewer-slide"
            style={{
              width:
                `${stageWidth}px`,
            }}
          >
            {nextUrl && (
              <img
                className="viewer-neighbor-image"
                src={
                  nextUrl
                }
                alt=""
                draggable={
                  false
                }
              />
            )}
          </div>
        </div>
      </div>

      {/*
       * ★左右ボタンはviewer-stageの外側。
       * PCでもPointer Captureの影響を受けません。
       */}
      {scale <= 1.01 &&
        photos.length > 1 && (
        <>
          <button
            type="button"
            className="viewer-arrow viewer-arrow-left"
            onClick={() =>
              animatePhotoChange(
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
              animatePhotoChange(
                "next"
              )
            }
            aria-label="次の写真"
          >
            ›
          </button>
        </>
      )}

      <footer className="viewer-footer">
        <p className="viewer-file-name">
          {displayName}
        </p>

        {tags.length > 0 && (
          <div className="viewer-tags">
            {tags.map(
              (tag) => (
                <span
                  key={
                    tag
                  }
                >
                  {tag}
                </span>
              )
            )}
          </div>
        )}

        <p className="viewer-help">
          {scale > 1
            ? "ドラッグ：移動　ピンチ：拡大縮小　ダブルタップ：100%へ"
            : "左右：写真切替　↓：閉じる　ダブルタップ：拡大"}
        </p>
      </footer>
    </div>
  );
}

export default PhotoViewer;