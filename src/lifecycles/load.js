import {
  LOAD_ERROR,
  NOT_BOOTSTRAPPED,
  LOADING_SOURCE_CODE,
  SKIP_BECAUSE_BROKEN,
  NOT_LOADED,
  objectType,
  toName,
} from "../applications/app.helpers.js";
import { ensureValidAppTimeouts } from "../applications/timeouts.js";
import {
  handleAppError,
  formatErrorMessage,
} from "../applications/app-errors.js";
import {
  flattenFnArray,
  smellsLikeAPromise,
  validLifecycleFn,
} from "./lifecycle.helpers.js";
import { getProps } from "./prop.helpers.js";
import { assign } from "../utils/assign.js";

export function toLoadPromise(app) {
  return Promise.resolve().then(() => {
    if (app.loadPromise) {
      // 说明app已经在被加载
      return app.loadPromise;
    }

    // 只有状态为NOT_LOADED和LOAD_ERROR的app才可以被加载
    if (app.status !== NOT_LOADED && app.status !== LOAD_ERROR) {
      return app;
    }

    // 设置App的状态
    app.status = LOADING_SOURCE_CODE;

    let appOpts, isUserErr;

    return (app.loadPromise = Promise.resolve()
      .then(() => {
        // 执行 app 加载函数，传递 props
        const loadPromise = app.loadApp(getProps(app));
        if (!smellsLikeAPromise(loadPromise)) {
          // The name of the app will be prepended to this error message inside of the handleAppError function
          isUserErr = true;
          throw Error(
            formatErrorMessage(
              33,
              __DEV__ &&
              `single-spa loading function did not return a promise. Check the second argument to registerApplication('${toName(
                  app
                )}', loadingFunction, activityFunction)`,
              toName(app)
            )
          );
        }
        // 这里很重要，这个val就是示例项目中加载函数中return出来的window.singleSpa，这个属性是子应用打包时设置的
        return loadPromise.then((val) => {
          app.loadErrorTime = null;

          appOpts = val;

          let validationErrMessage, validationErrCode;

          // window.singleSpa 必须为对象
          if (typeof appOpts !== "object") {
            validationErrCode = 34;
            if (__DEV__) {
              validationErrMessage = `does not export anything`;
            }
          }

          // window.singleSpa 必须到处 bootstrap 生命周期函数
          if (!validLifecycleFn(appOpts.bootstrap)) {
            validationErrCode = 35;
            if (__DEV__) {
              validationErrMessage = `does not export a bootstrap function or array of functions`;
            }
          }

          // window.singleSpa 必须导出mount生命周期函数
          if (!validLifecycleFn(appOpts.mount)) {
            validationErrCode = 36;
            if (__DEV__) {
              validationErrMessage = `does not export a bootstrap function or array of functions`;
            }
          }
          // window.singleSpa 必须导出unmount生命周期函数
          if (!validLifecycleFn(appOpts.unmount)) {
            validationErrCode = 37;
            if (__DEV__) {
              validationErrMessage = `does not export a bootstrap function or array of functions`;
            }
          }

          const type = objectType(appOpts);

          // 验证失败
          if (validationErrCode) {
            let appOptsStr;
            try {
              appOptsStr = JSON.stringify(appOpts);
            } catch {}
            console.error(
              formatErrorMessage(
                validationErrCode,
                __DEV__ &&
                `The loading function for single-spa ${type} '${toName(
                    app
                  )}' resolved with the following, which does not have bootstrap, mount, and unmount functions`,
                type,
                toName(app),
                appOptsStr
              ),
              appOpts
            );
            handleAppError(validationErrMessage, app, SKIP_BECAUSE_BROKEN);
            return app;
          }

          if (appOpts.devtools && appOpts.devtools.overlays) {
            // app.devtools.overlays添加子应用的devtools.overlays的属性
            app.devtools.overlays = assign({},
              app.devtools.overlays,
              appOpts.devtools.overlays
            );
          }

          // 设置app状态为未初始化，表示加载完了
          app.status = NOT_BOOTSTRAPPED;
          // 在app对象上挂载生命周期方法，每个方法都接收一个props作为参数
          // 方法内部执行子应用导出的生命周期函数，并确保生命周期函数返回一个promise
          app.bootstrap = flattenFnArray(appOpts, "bootstrap");
          app.mount = flattenFnArray(appOpts, "mount");
          app.unmount = flattenFnArray(appOpts, "unmount");
          app.unload = flattenFnArray(appOpts, "unload");
          app.timeouts = ensureValidAppTimeouts(appOpts.timeouts);

          // 执行到这里说明子应用已成功加载，删除app.loadPromise属性
          delete app.loadPromise;

          return app;
        });
      })
      .catch((err) => {
        delete app.loadPromise;

        let newStatus;
        if (isUserErr) {
          newStatus = SKIP_BECAUSE_BROKEN;
        } else {
          newStatus = LOAD_ERROR;
          app.loadErrorTime = new Date().getTime();
        }
        handleAppError(err, app, newStatus);

        return app;
      }));
  });
}