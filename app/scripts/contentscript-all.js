// @flow

import $ from 'jquery';
import log from 'loglevel';

import {setupLogging} from './core/util';
import {Frame} from './contentscript-app/frame';

let frame: Frame;
let frameId = 'none';

window.addEventListener('unhandledrejection', event => {
  log.error('unhandledrejection');
  log.error(event);
});

function attachListener() {
  const msgListener = frame.onWindowMessage.bind(frame);
  setInterval(function setupListener() {
    if (!$(document.body).data('fw-frame-id')) {
      // This notification is important, but it should turn off eventually...
      // log.info(frameId, 'document body not set in', document);

      window.fwFrame = frame;
      $(document.body).attr('data-fw-frame-id', frame.id);
      window.addEventListener('message', msgListener, { passive: true });

      // setTimeout(setupListener, 50);
    }
  }, 50);
}

async function start() {
  try {
    setupLogging();

    frame = new Frame(document);
    frameId = frame.id;

    const shouldScreen = await new Promise((resolve, reject) => {
      frame.sendMessageToBackground('shouldScreen', {}, ({ shouldScreen: boolean }) => {
        resolve(shouldScreen);
      })
    });

    if (!shouldScreen) {
      log.info('Not screening, the extension said so!');
      return;
    }

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
    log.error(`${frameId} preload error!`, e);
  }
}

start();
