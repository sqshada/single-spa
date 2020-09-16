import { find } from "../utils/find.js";
import { objectType, toName } from "../applications/app.helpers.js";
import { formatErrorMessage } from "../applications/app-errors.js";

export function validLifecycleFn(fn) {
  return fn && (typeof fn === "function" || isArrayOfFns(fn));

  function isArrayOfFns(arr) {
    return (
      Array.isArray(arr) && !find(arr, (item) => typeof item !== "function")
    );
  }
}

/**
 * 返回一个接受 props 作为参数的函数，这个函数负责执行子应用中的生命周期函数
 * 并确保生命周期函数返回的结果为promise
 * @param {*} appOrParcel
 * @param {*} lifecycle
 */
export function flattenFnArray(appOrParcel, lifecycle) {
  let fns = appOrParcel[lifecycle] || [];
  fns = Array.isArray(fns) ? fns : [fns];
  if (fns.length === 0) {
    fns = [() => Promise.resolve()];
  }

  const type = objectType(appOrParcel);
  const name = toName(appOrParcel);

  return function(props) {
    return fns.reduce((resultPromise, fn, index) => {
      return resultPromise.then(() => {
        const thisPromise = fn(props);
        return smellsLikeAPromise(thisPromise) ?
          thisPromise :
          Promise.reject(
            formatErrorMessage(
              15,
              __DEV__ &&
              `Within ${type} ${name}, the lifecycle function ${lifecycle} at array index ${index} did not return a promise`,
              type,
              name,
              lifecycle,
              index
            )
          );
      });
    }, Promise.resolve());
  };
}

// 判断一个变量是否为 promise
export function smellsLikeAPromise(promise) {
  return (
    promise &&
    typeof promise.then === "function" &&
    typeof promise.catch === "function"
  );
}