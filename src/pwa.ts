import {
    registerSW,
  } from "virtual:pwa-register";
  
  let registration:
    ServiceWorkerRegistration |
    undefined;
  
  /*
   * vite.config.ts の
   * registerType: "autoUpdate"
   * と組み合わせて使います。
   *
   * immediate: true にすることで、
   * PWA起動時からService Workerを登録し、
   * 新版が検出されたときの自動更新も有効にします。
   */
  const updateSW =
    registerSW({
      immediate: true,
  
      onRegisteredSW(
        _swUrl,
        swRegistration
      ) {
        registration =
          swRegistration;
      },
  
      onRegisterError(
        error
      ) {
        console.error(
          "Service Worker registration error:",
          error
        );
      },
    });
  
  function waitForInstallingWorker(
    worker: ServiceWorker
  ): Promise<boolean> {
    return new Promise(
      (resolve) => {
        const timeout =
          window.setTimeout(
            () => {
              resolve(false);
            },
            5000
          );
  
        const handleStateChange =
          async () => {
            if (
              worker.state ===
                "installed" ||
              worker.state ===
                "activated"
            ) {
              window.clearTimeout(
                timeout
              );
  
              resolve(true);
            }
  
            if (
              worker.state ===
              "redundant"
            ) {
              window.clearTimeout(
                timeout
              );
  
              resolve(false);
            }
          };
  
        worker.addEventListener(
          "statechange",
          () => {
            void handleStateChange();
          }
        );
  
        void handleStateChange();
      }
    );
  }
  
  /*
   * 右上の更新ボタンから呼び出します。
   *
   * 戻り値:
   * true  = 新しいService Workerを検出
   * false = 新版なし / SW未登録 / オフライン
   */
  export async function checkForPwaUpdate():
    Promise<boolean> {
    if (
      !("serviceWorker" in navigator) ||
      !navigator.onLine
    ) {
      return false;
    }
  
    const currentRegistration =
      registration ??
      (
        await navigator.serviceWorker
          .getRegistration()
      );
  
    if (
      !currentRegistration
    ) {
      return false;
    }
  
    registration =
      currentRegistration;
  
    /*
     * registration.update() は
     * Service Workerスクリプトをサーバへ確認します。
     */
    await currentRegistration
      .update();
  
    /*
     * すでにwaiting中の新版があれば即適用。
     */
    if (
      currentRegistration
        .waiting
    ) {
      await updateSW(true);
  
      return true;
    }
  
    /*
     * update()直後にinstallingになった新版があれば、
     * installedまで待ってから適用します。
     */
    const installing =
      currentRegistration
        .installing;
  
    if (
      installing
    ) {
      const installed =
        await waitForInstallingWorker(
          installing
        );
  
      if (
        installed &&
        currentRegistration
          .waiting
      ) {
        await updateSW(true);
      }
  
      return installed;
    }
  
    return false;
  }