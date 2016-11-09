// @flow

import $ from 'jquery';
import log from 'loglevel';

import {Frame} from './contentscript-app/frame';
import {promiseTimeout, tryUntil} from './core/util';

let frame: Frame;
let frameId = 'none';

window.addEventListener('unhandledrejection', event => {
  console.error('unhandledrejection');
  console.error(event);
});

function attachListener() {
  const msgListener = frame.onWindowMessage.bind(frame);
  setInterval(function setupListener() {
    if (!$(document.body).data('fw-frame-id')) {
      log.info(frameId, 'document body not set in', document);

      window.fwFrame = frame;
      $(document.body).attr('data-fw-frame-id', frame.id);
      window.addEventListener('message', msgListener, { passive: true });

      // setTimeout(setupListener, 50);
    }
  }, 50);
}

async function start() {
  try {
    // Debug
    log.setLevel(log.levels.TRACE);

    // Staging
    // log.setLevel(log.levels.WARN);

    frame = new Frame(document);
    frameId = frame.id;

    log.info(`${frame.id} created in document`, document);
    attachListener();

    if (window.isTop) {
      log.info(`TOP FRAME: ${frame.id}`);
    }

    try {
      frame.startFrameMutationObserver();
      await frame.registerChildren();
    } catch (e) {
      // ignore
    }

    // Only start for the top frame.
    if (window.isTop) {
      $(document).ready(async () => {
        log.info(`${frame.id} screening...`);
        await frame.startScreen();
        log.info(`${frame.id} done screening!`);
      });
    }
  } catch (e) {
    console.error(`${frameId} preload error!`, e);
  }
}

start();
