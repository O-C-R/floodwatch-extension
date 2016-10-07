// @flow

import $ from 'jquery';

import {Frame} from './contentscript-app/frame';
import {promiseTimeout, tryUntil} from './core/util';

async function onload() {
  let frameId = 'none';
  try {
    const frame = new Frame(document);
    frameId = frame.id;

    console.log(`${frame.id} created in document`, document);

    const msgListener = frame.onWindowMessage.bind(frame);

    // TODO: do we have to do this in a setInterval? Maybe we can do it until
    // the attribute sticks?
    setTimeout(function() {
      window.fwFrame = frame;
      $(document.body).attr('fw-frame-id',frame.id);
      window.addEventListener('message', msgListener);
    }, 5);

    window.addEventListener('unload', () => { console.log('UNLOADING', frame.id); });

    console.log(`${frame.id} registering...`);
    try {
      // await promiseTimeout(frame.register(), 10000);
      await frame.register();
      console.log(`${frame.id} done registering!`);
    } catch (e) {
      console.error(`${frame.id} could not register.`, e);
    }

    console.log(`${frame.id} screening...`);
    await frame.screenAll();
    console.log(`${frame.id} done screening!`);
  } catch(e) {
    console.error(`${frameId} error!`, e);
  };
}

function start() {
  if (document.readyState == 'complete') {
    onload();
  } else {
    window.addEventListener('load', () => onload());
  }
}

start();
