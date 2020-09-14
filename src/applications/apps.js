import { ensureJQuerySupport } from "../jquery-support.js";
import {
  isActive,
  toName,
  NOT_LOADED,
  NOT_BOOTSTRAPPED,
  NOT_MOUNTED,
  MOUNTED,
  LOAD_ERROR,
  SKIP_BECAUSE_BROKEN,
  LOADING_SOURCE_CODE,
  shouldBeActive,
} from "./app.helpers.js";
import { reroute } from "../navigation/reroute.js";
import { find } from "../utils/find.js";
import { toUnmountPromise } from "../lifecycles/unmount.js";
import {
  toUnloadPromise,
  getAppUnloadInfo,
  addAppToUnload,
} from "../lifecycles/unload.js";
import { formatErrorMessage } from "./app-errors.js";
import { isInBrowser } from "../utils/runtime-environment.js";
import { assign } from "../utils/assign";

const apps = [];

export function getAppChanges() {
  const appsToUnload = [],
    appsToUnmount = [],
    appsToLoad = [],
    appsToMount = [];

  // We re-attempt to download applications in LOAD_ERROR after a timeout of 200 milliseconds
  const currentTime = new Date().getTime();

  apps.forEach((app) => {
    const appShouldBeActive =
      app.status !== SKIP_BECAUSE_BROKEN && shouldBeActive(app);

    switch (app.status) {
      case LOAD_ERROR:
        if (currentTime - app.loadErrorTime >= 200) {
          appsToLoad.push(app);
        }
        break;
      case NOT_LOADED:
      case LOADING_SOURCE_CODE:
        if (appShouldBeActive) {
          appsToLoad.push(app);
        }
        break;
      case NOT_BOOTSTRAPPED:
      case NOT_MOUNTED:
        if (!appShouldBeActive && getAppUnloadInfo(toName(app))) {
          appsToUnload.push(app);
        } else if (appShouldBeActive) {
          appsToMount.push(app);
        }
        break;
      case MOUNTED:
        if (!appShouldBeActive) {
          appsToUnmount.push(app);
        }
        break;
        // all other statuses are ignored
    }
  });

  return { appsToUnload, appsToUnmount, appsToLoad, appsToMount };
}

export function getMountedApps() {
  return apps.filter(isActive).map(toName);
}

export function getAppNames() {
  return apps.map(toName);
}

// used in devtools, not (currently) exposed as a single-spa API
export function getRawAppData() {
  return [...apps];
}

export function getAppStatus(appName) {
  const app = find(apps, (app) => toName(app) === appName);
  return app ? app.status : null;
}

/**
 * 注册应用，两种方式
 * registerApplication('app1', loadApp(url), activeWhen('/app1'), customProps)
 * registerApplication({
 *    name: 'app1',
 *    app: loadApp(url),
 *    activeWhen: activeWhen('/app1'),
 *    customProps: {}
 * })
 * @param appNameOrConfig 应用名称或者应用配置对象
 * @param appOrLoadApp 应用的加载方法，是一个 promise
 * @param activeWhen 判断应用是否激活的一个方法，方法返回 true or false
 * @param customProps 传递给子应用的 props 对象
 */
export function registerApplication(
  appNameOrConfig,
  appOrLoadApp,
  activeWhen,
  customProps
) {

  /**
   * 格式化用户传递的应用配置参数
   * registration = {
   *    name: 'app1',
   *    loadApp: 返回promise的函数,
   *    activeWhen: 返回boolean值的函数,
   *    customProps: props 对象,
   * }
   */
  const registration = sanitizeArguments(
    appNameOrConfig,
    appOrLoadApp,
    activeWhen,
    customProps
  );

  // 判断 app 是否重名
  if (getAppNames().indexOf(registration.name) !== -1)
    throw Error(
      formatErrorMessage(
        21,
        __DEV__ &&
        `There is already an app registered with name ${registration.name}`,
        registration.name
      )
    );

  // 放入 apps 数组中
  apps.push(
    assign({
        loadErrorTime: null,
        // 应用状态
        status: NOT_LOADED,
        parcels: {},
        devtools: {
          overlays: {
            options: {},
            selectors: [],
          },
        },
      },
      registration
    )
  );

  if (isInBrowser) {
    // https://zh-hans.single-spa.js.org/docs/api/#ensurejquerysupport
    // 给 JQuery 打 patch
    ensureJQuerySupport();
    reroute();
  }
}

export function checkActivityFunctions(location = window.location) {
  return apps.filter((app) => app.activeWhen(location)).map(toName);
}

export function unregisterApplication(appName) {
  if (apps.filter((app) => toName(app) === appName).length === 0) {
    throw Error(
      formatErrorMessage(
        25,
        __DEV__ &&
        `Cannot unregister application '${appName}' because no such application has been registered`,
        appName
      )
    );
  }

  return unloadApplication(appName).then(() => {
    const appIndex = apps.map(toName).indexOf(appName);
    apps.splice(appIndex, 1);
  });
}

export function unloadApplication(appName, opts = { waitForUnmount: false }) {
  if (typeof appName !== "string") {
    throw Error(
      formatErrorMessage(
        26,
        __DEV__ && `unloadApplication requires a string 'appName'`
      )
    );
  }
  const app = find(apps, (App) => toName(App) === appName);
  if (!app) {
    throw Error(
      formatErrorMessage(
        27,
        __DEV__ &&
        `Could not unload application '${appName}' because no such application has been registered`,
        appName
      )
    );
  }

  const appUnloadInfo = getAppUnloadInfo(toName(app));
  if (opts && opts.waitForUnmount) {
    // We need to wait for unmount before unloading the app

    if (appUnloadInfo) {
      // Someone else is already waiting for this, too
      return appUnloadInfo.promise;
    } else {
      // We're the first ones wanting the app to be resolved.
      const promise = new Promise((resolve, reject) => {
        addAppToUnload(app, () => promise, resolve, reject);
      });
      return promise;
    }
  } else {
    /* We should unmount the app, unload it, and remount it immediately.
     */

    let resultPromise;

    if (appUnloadInfo) {
      // Someone else is already waiting for this app to unload
      resultPromise = appUnloadInfo.promise;
      immediatelyUnloadApp(app, appUnloadInfo.resolve, appUnloadInfo.reject);
    } else {
      // We're the first ones wanting the app to be resolved.
      resultPromise = new Promise((resolve, reject) => {
        addAppToUnload(app, () => resultPromise, resolve, reject);
        immediatelyUnloadApp(app, resolve, reject);
      });
    }

    return resultPromise;
  }
}

function immediatelyUnloadApp(app, resolve, reject) {
  toUnmountPromise(app)
    .then(toUnloadPromise)
    .then(() => {
      resolve();
      setTimeout(() => {
        // reroute, but the unload promise is done
        reroute();
      });
    })
    .catch(reject);
}

// 验证参数是否合法
function validateRegisterWithArguments(
  name,
  appOrLoadApp,
  activeWhen,
  customProps
) {
  if (typeof name !== "string" || name.length === 0)
    throw Error(
      formatErrorMessage(
        20,
        __DEV__ &&
        `The 1st argument to registerApplication must be a non-empty string 'appName'`
      )
    );

  if (!appOrLoadApp)
    throw Error(
      formatErrorMessage(
        23,
        __DEV__ &&
        "The 2nd argument to registerApplication must be an application or loading application function"
      )
    );

  if (typeof activeWhen !== "function")
    throw Error(
      formatErrorMessage(
        24,
        __DEV__ &&
        "The 3rd argument to registerApplication must be an activeWhen function"
      )
    );

  if (!validCustomProps(customProps))
    throw Error(
      formatErrorMessage(
        22,
        __DEV__ &&
        "The optional 4th argument is a customProps and must be an object"
      )
    );
}

/**
 * 验证应用配置对象的各个属性是否存在不合法的情况，存在则抛出错误
 * @param {*} config = { name: 'app1', app: function, activeWhen: function, customProps: {} }
 */
export function validateRegisterWithConfig(config) {
  // config 是数组或者 null 直接抛错
  if (Array.isArray(config) || config === null)
    throw Error(
      formatErrorMessage(
        39,
        __DEV__ && "Configuration object can't be an Array or null!"
      )
    );
  const validKeys = ["name", "app", "activeWhen", "customProps"];
  const invalidKeys = Object.keys(config).reduce(
    (invalidKeys, prop) =>
    validKeys.indexOf(prop) >= 0 ? invalidKeys : invalidKeys.concat(prop), []
  );
  // 如果存在 validKeys 之外的 key 抛错
  if (invalidKeys.length !== 0)
    throw Error(
      formatErrorMessage(
        38,
        __DEV__ &&
        `The configuration object accepts only: ${validKeys.join(
            ", "
          )}. Invalid keys: ${invalidKeys.join(", ")}.`,
        validKeys.join(", "),
        invalidKeys.join(", ")
      )
    );
  // 应用名不是 string 或者为空报错
  if (typeof config.name !== "string" || config.name.length === 0)
    throw Error(
      formatErrorMessage(
        20,
        __DEV__ &&
        "The config.name on registerApplication must be a non-empty string"
      )
    );
  // app 参数只能是一个 object 或者 function
  // object 是一个被解析过的对象，包含各个生命周期
  // 加载函数必须返回一个 promise
  if (typeof config.app !== "object" && typeof config.app !== "function")
    throw Error(
      formatErrorMessage(
        20,
        __DEV__ &&
        "The config.app on registerApplication must be an application or a loading function"
      )
    );
  // activeWhen 可以是字符串或者函数，也可以是两者组成的数组，表示当前应该被激活的应用的baseURL
  const allowsStringAndFunction = (activeWhen) =>
    typeof activeWhen === "string" || typeof activeWhen === "function";
  if (!allowsStringAndFunction(config.activeWhen) &&
    !(
      Array.isArray(config.activeWhen) &&
      config.activeWhen.every(allowsStringAndFunction)
    )
  )
    throw Error(
      formatErrorMessage(
        24,
        __DEV__ &&
        "The config.activeWhen on registerApplication must be a string, function or an array with both"
      )
    );
  // props 必须是一个对象
  if (!validCustomProps(config.customProps))
    throw Error(
      formatErrorMessage(
        22,
        __DEV__ && "The optional config.customProps must be an object"
      )
    );
}

function validCustomProps(customProps) {
  return (!customProps ||
    typeof customProps === "function" ||
    (typeof customProps === "object" &&
      customProps !== null &&
      !Array.isArray(customProps))
  );
}

function sanitizeArguments(
  appNameOrConfig,
  appOrLoadApp,
  activeWhen,
  customProps
) {
  // 判断是何种方式入参
  const usingObjectAPI = typeof appNameOrConfig === "object";

  const registration = {
    name: null,
    loadApp: null,
    activeWhen: null,
    customProps: null,
  };

  if (usingObjectAPI) {
    // 参数是对象
    validateRegisterWithConfig(appNameOrConfig);
    registration.name = appNameOrConfig.name;
    registration.loadApp = appNameOrConfig.app;
    registration.activeWhen = appNameOrConfig.activeWhen;
    registration.customProps = appNameOrConfig.customProps;
  } else {
    // 参数列表
    validateRegisterWithArguments(
      appNameOrConfig,
      appOrLoadApp,
      activeWhen,
      customProps
    );
    registration.name = appNameOrConfig;
    registration.loadApp = appOrLoadApp;
    registration.activeWhen = activeWhen;
    registration.customProps = customProps;
  }

  // 参数不是函数 返回一个 promise 对象
  registration.loadApp = sanitizeLoadApp(registration.loadApp);
  // 没有 props 默认为 {}
  registration.customProps = sanitizeCustomProps(registration.customProps);
  // 保证 activeWhen 是一个返回 boolean 的函数
  registration.activeWhen = sanitizeActiveWhen(registration.activeWhen);

  return registration;
}

function sanitizeLoadApp(loadApp) {
  if (typeof loadApp !== "function") {
    return () => Promise.resolve(loadApp);
  }

  return loadApp;
}

function sanitizeCustomProps(customProps) {
  return customProps ? customProps : {};
}

function sanitizeActiveWhen(activeWhen) {
  let activeWhenArray = Array.isArray(activeWhen) ? activeWhen : [activeWhen];
  activeWhenArray = activeWhenArray.map((activeWhenOrPath) =>
    typeof activeWhenOrPath === "function" ?
    activeWhenOrPath :
    pathToActiveWhen(activeWhenOrPath)
  );

  return (location) =>
    activeWhenArray.some((activeWhen) => activeWhen(location));
}

export function pathToActiveWhen(path) {
  const regex = toDynamicPathValidatorRegex(path);

  return (location) => {
    const route = location.href
      .replace(location.origin, "")
      .replace(location.search, "")
      .split("?")[0];
    return regex.test(route);
  };
}

export function toDynamicPathValidatorRegex(path) {
  let lastIndex = 0,
    inDynamic = false,
    regexStr = "^";

  if (path[0] !== "/") {
    path = "/" + path;
  }

  for (let charIndex = 0; charIndex < path.length; charIndex++) {
    const char = path[charIndex];
    const startOfDynamic = !inDynamic && char === ":";
    const endOfDynamic = inDynamic && char === "/";
    if (startOfDynamic || endOfDynamic) {
      appendToRegex(charIndex);
    }
  }

  appendToRegex(path.length);
  return new RegExp(regexStr, "i");

  function appendToRegex(index) {
    const anyCharMaybeTrailingSlashRegex = "[^/]+/?";
    const commonStringSubPath = escapeStrRegex(path.slice(lastIndex, index));

    regexStr += inDynamic ?
      anyCharMaybeTrailingSlashRegex :
      commonStringSubPath;

    if (index === path.length && !inDynamic) {
      regexStr =
        // use charAt instead as we could not use es6 method endsWith
        regexStr.charAt(regexStr.length - 1) === "/" ?
        `${regexStr}.*$` :
        `${regexStr}([/#].*)?$`;
    }

    inDynamic = !inDynamic;
    lastIndex = index;
  }

  function escapeStrRegex(str) {
    // borrowed from https://github.com/sindresorhus/escape-string-regexp/blob/master/index.js
    return str.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
  }
}