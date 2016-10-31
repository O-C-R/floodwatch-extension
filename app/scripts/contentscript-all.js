// @flow

import $ from 'jquery';

import {Frame} from './contentscript-app/frame';
import {promiseTimeout, tryUntil} from './core/util';

let frame: Frame;
let frameId = 'none';

function attachListener() {
  const msgListener = frame.onWindowMessage.bind(frame);
  setTimeout(function setupListener() {
    if (!$(document.body).data('fw-frame-id')) {
      window.fwFrame = frame;
      $(document.body).attr('data-fw-frame-id', frame.id);
      window.addEventListener('message', msgListener, { passive: true });

      setTimeout(setupListener, 5);
    }
  }, 5);
}

async function start() {
  try {
    frame = new Frame(document);
    frameId = frame.id;

    console.log(`${frame.id} created in document`, document);
    attachListener();

    if (window.isTop) {
      console.log(`TOP FRAME: ${frame.id}`);
    }

    try {
      frame.startFrameMutationObserver();
      await frame.registerChildren();
    } catch (e) {
      // ignore
    }

    // Only start for the top frame.
    if (window.isTop) {
      console.log(`${frame.id} screening...`);
      await frame.startScreen();
      console.log(`${frame.id} done screening!`);
    }
  } catch (e) {
    console.error(`${frameId} preload error!`, e);
  }
}

start();
