// @flow

import crypto from 'crypto';
import log from 'loglevel';

// From http://stackoverflow.com/questions/31089801/extending-error-in-javascript-with-es6-syntax
export class BaseError {
  name: string;
  message: string;
  stack: ?string;

  constructor(message: string = 'Error') {
    this.name = this.constructor.name;
    this.message = message;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    } else {
      this.stack = (new Error(message)).stack;
    }
  }
}

export class TimeoutError extends BaseError { constructor(m: string = 'TimeoutError') { super(m); } }
export class RepeatError extends BaseError { constructor(m: string = 'RepeatError') { super(m); } }
export class FWError extends BaseError { constructor(m?: string = 'FWError') { super(m); } }

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
      .catch(() => {
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

export function setupLogging(): void {
  chrome.storage.sync.get('logLevel', (res: { logLevel: ?number }) => {
    log.setLevel(res.logLevel != undefined ? res.logLevel : log.levels.SILENT);
  });
  chrome.storage.onChanged.addListener((changes: Object) => {
    if (changes.logLevel !== undefined && changes.logLevel.newValue !== undefined) {
      log.setLevel(changes.logLevel.newValue);
    }
  });
}
