// @flow

import crypto from 'crypto';

export class TimeoutError extends Error {}
export class RepeatError extends Error {}
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
  const timeoutPromise = delayedPromise(timeout)
    .then(function() { throw new TimeoutError(msg || 'Timeout'); });
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

export async function tryRepeat<T>(cb: () => Promise<?T>, times: number, delay?: number): Promise<T> {
  for (let i = 0; i < times; ++i) {
    try {
      const res = await cb();
      if (res) {
        return res;
      }
    } catch (e) {
      // Ignore
    }

    await delayedPromise(delay);
  }

  throw new RepeatError('RepeatError');
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

export function generateUUID(): string {
  return crypto.randomBytes(20).toString('hex');
}
