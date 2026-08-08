/*
 * PWA更新確認をブラウザ標準のService Worker APIだけで行います。
 *
 * vite-plugin-pwa の virtual:pwa-register を使わないため、
 * TypeScriptの仮想モジュール型エラーが発生しません。
 *
 * vite.config.ts はこれまでどおり
 * registerType: "autoUpdate"
 * のままでOKです。
 */

function waitForControllerChange(
    timeoutMs = 5000
  ): Promise<boolean> {
    return new Promise((resolve) => {
      let finished = false;
  
      const finish = (
        changed: boolean
      ) => {
        if (finished) {
          return;
        }
  
        finished = true;
  
        navigator.serviceWorker
          .removeEventListener(
            "controllerchange",
            handleControllerChange
          );
  
        window.clearTimeout(
          timer
        );
  
        resolve(changed);
      };
  
      const handleControllerChange =
        () => {
          finish(true);
        };
  
      const timer =
        window.setTimeout(
          () => {
            finish(false);
          },
          timeoutMs
        );
  
      navigator.serviceWorker
        .addEventListener(
          "controllerchange",
          handleControllerChange
        );
    });
  }
  
  function waitForWorkerInstalled(
    worker: ServiceWorker,
    timeoutMs = 5000
  ): Promise<void> {
    return new Promise(
      (resolve) => {
        let finished = false;
  
        const finish =
          () => {
            if (finished) {
              return;
            }
  
            finished = true;
  
            worker.removeEventListener(
              "statechange",
              handleStateChange
            );
  
            window.clearTimeout(
              timer
            );
  
            resolve();
          };
  
        const handleStateChange =
          () => {
            if (
              worker.state ===
                "installed" ||
              worker.state ===
                "activated" ||
              worker.state ===
                "redundant"
            ) {
              finish();
            }
          };
  
        const timer =
          window.setTimeout(
            finish,
            timeoutMs
          );
  
        worker.addEventListener(
          "statechange",
          handleStateChange
        );
  
        handleStateChange();
      }
    );
  }
  
  /*
   * true:
   *   更新処理中にService Workerのcontrollerが切り替わった
   *   または新Workerを検出した
   *
   * false:
   *   オフライン / SW未登録 / 明確な新版を検出しなかった
   */
  export async function checkForPwaUpdate():
    Promise<boolean> {
    if (
      !("serviceWorker" in navigator) ||
      !navigator.onLine
    ) {
      return false;
    }
  
    const registration =
      await navigator.serviceWorker
        .getRegistration();
  
    if (!registration) {
      return false;
    }
  
    /*
     * controllerchange監視はupdate()より先に開始します。
     * registerType:autoUpdate のSWが即座にactivateしても
     * イベントを取りこぼさないためです。
     */
    const controllerChangedPromise =
      waitForControllerChange();
  
    const beforeInstalling =
      registration.installing;
  
    const beforeWaiting =
      registration.waiting;
  
    await registration.update();
  
    const worker =
      registration.installing;
  
    if (
      worker &&
      worker !==
        beforeInstalling
    ) {
      await waitForWorkerInstalled(
        worker
      );
    }
  
    const controllerChanged =
      await Promise.race([
        controllerChangedPromise,
  
        new Promise<boolean>(
          (resolve) => {
            window.setTimeout(
              () => resolve(false),
              1200
            );
          }
        ),
      ]);
  
    if (controllerChanged) {
      /*
       * 新SWがcontrollerになったので、
       * 新しいJS/CSSを確実に読むため再読込。
       */
      window.location.reload();
  
      return true;
    }
  
    /*
     * waiting/installingが新たに現れた場合も
     * 「新版を検出した」とみなします。
     *
     * autoUpdate設定では通常skipWaitingされるため、
     * 多くの場合はcontrollerchange→reloadへ進みます。
     */
    const updateDetected =
      (
        registration.waiting &&
        registration.waiting !==
          beforeWaiting
      ) ||
      (
        registration.installing &&
        registration.installing !==
          beforeInstalling
      );
  
    return Boolean(
      updateDetected
    );
  }