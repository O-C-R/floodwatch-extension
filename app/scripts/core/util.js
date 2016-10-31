// @flow

export class TimeoutError extends Error {}
export class FWError extends Error {}

export function delayedPromise(time?: ?number): Promise<void> {
  if (time !== null && time !== undefined) {
    return new Promise(function(resolve) {
      // $FlowIssue: lost not-null context
      setTimeout(resolve, time);
    });
  } else {
    // Never resolve
    return new Promise(function(){});
  }
}

export function promiseTimeout<T>(promise: Promise<T>, timeout?: ?number, msg?: string): Promise<T> {
  const stack = new Error().stack;

  const timeoutPromise = delayedPromise(timeout)
    .then(function() { throw new TimeoutError(msg || stack || 'Timeout'); });
  return Promise.race([promise,timeoutPromise]);
}

// Throws on error
export function pollUntil<T>(cb: <T>() => ?T, interval: number, timeout: number): Promise<T> {
  let timedOut = false;

  const stack = new Error().stack;

  const pollPromise = new Promise(function(resolve, reject) {
    function poll() {
      try {
        const res = cb();

        if (res) {
          resolve(res);
        } else if (!timedOut) {
          setTimeout(poll, interval);
        }
      } catch (e) {
        reject(e);
      }
    }

    poll();
  });

  return promiseTimeout(pollPromise, timeout, stack)
    .catch((e) => {
      timedOut = true;
      throw e;
    });
}

// Swallows errors
export function tryUntil<T>(cb: <T>() => Promise<?T>, wait: number, delay: number, timeout: number): Promise<T> {
  let timedOut = false;

  const stack = new Error().stack;

  const pollPromise = new Promise(function(resolve) {
    function poll() {
      promiseTimeout(cb(), wait, stack)
      .then((res) => {
        if (res) {
          resolve(res);
        } else if (!timedOut) {
          setTimeout(poll, delay);
        }
      })
      .catch((e) => {
        if (!timedOut) {
          setTimeout(poll, delay);
        }
      });
    }

    poll();
  });

  return promiseTimeout(pollPromise, timeout, stack)
    .catch((e) => {
      console.log('timed out in overall');
      timedOut = true;
      throw e;
    });
}

export function outerArea($el: JQuery) {
  return $el.outerWidth() * $el.outerHeight();
}

// Adapted from https://gist.github.com/jed/982883
// under the DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE
// $FlowFixMe: yeah, this isn't going to typecheck well...
export const generateUUID = function b(a){return a?(a^Math.random()*16>>a/4).toString(16):([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,b)}
