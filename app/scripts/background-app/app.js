// @flow

import log from 'loglevel';

import {FWApiClient} from './api';
import {Filter} from './filter';
import {serializeImageElement} from '../core/images';
import {Rect} from '../core/shapes';
import {FWError} from '../core/util';

let apiClient: FWApiClient;

async function loadFilter() {
  try {
    // TODO: do this more often than on extension reload
    await Filter.get().addRulesFromUrl('https://easylist-downloads.adblockplus.org/easylist.txt');

    // TODO: move this into a floodwatch-hosted file
    // await Filter.get().addRulesFromText('*facebook.com%2Fads%2Fimage*$image');

    // TODO: remove
    window.filter = Filter;

    log.info('Done loading filter!');
  } catch (e) {
    log.error(e);
  }
}

function onScreenElementMessage(message: Object, sendResponse: (obj: any) => void): void {
  const payload = message.payload;

  let isAd: ?boolean = undefined;
  let error: ?Error = undefined;

  try {
    const isAdObj = Filter.get().isAd({
      html: payload.html,
      topUrl: payload.topUrl,
      mediaType: payload.mediaType,
      urls: payload.urls || []
    });
    isAd = isAdObj === true || (isAdObj && typeof isAdObj === 'object') || false;
    // log.info('Decided', payload, 'was an ad:', isAdObj, isAd);
  } catch (e) {
    log.error('Error detecting ad from message', message, e);
    error = e;
  }

  sendResponse({ isAd, error });
}

function debugImage(src: string): void {
  if (log.getLevel() <= log.levels.DEBUG) {
    const image = new Image();
    image.src = src;
    document.body.appendChild(image);
  }
}

function onCapturedAdMessage(message: Object) {
  const payload = message.payload;

  log.debug('Captured ad!', message);
  debugImage(payload.imgData);

  apiClient.addAd(payload);
  apiClient.sendAds(true);
}

// The API used in this is only available to the background script
function captureScreenshot(tabId: number, area: Rect): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab: chrome$Tab) => {
      if (!tab.active) {
        return reject(new FWError('Tab not active!'));
      }

      try {
        chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, (dataUrl) => {
          try {
            const image = new Image();
            image.onerror = reject;
            image.onload = async () => {
              log.debug('Captured screenshot in', tabId, image, area);
              const dataUrl = await serializeImageElement(image, area);
              debugImage(dataUrl);
              resolve(dataUrl);
            };
            image.src = dataUrl;
          } catch (e) {
            reject(e);
          }
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function onCaptureScreenshotMessage(tabId: number, message: Object, sendResponse: (obj: any) => void) {
  try {
    const area = message.payload.area;
    const dataUrl = await captureScreenshot(tabId, area);
    // log.info('GOT SCREENSHOT', area, dataUrl);
    log.info('sending response', dataUrl.length);
    sendResponse({ error: null, data: { dataUrl: '' }})
  } catch (e) {
    log.error('sending error', e);
    sendResponse({ error: e.message, data: null });
  }
}

// $FlowIssue: this is a good definition
function onChromeMessage(message: any, sender: chrome$MessageSender, sendResponse: (obj: any) => void): boolean {
  // log.info('Got message');
  // log.info(message, sender);

  if (message.type === 'screenElement') {
    onScreenElementMessage(message, sendResponse);
    return true;
  } else if (message.type === 'capturedAd') {
    onCapturedAdMessage(message);
    return false;
  } else if (message.type === 'captureScreenshot') {
    log.info('Got message');
    log.info(message, sender, sendResponse );

    const tabId = sender.tab ? sender.tab.id : undefined;
    if (!tabId) {
      log.error('Got message from invalid tabId', tabId);
      return false;
    }

    onCaptureScreenshotMessage(tabId, message, sendResponse);
    return true;
  }

  return false;
}

function registerExtension() {
  // $FlowIssue: this is a good definition
  chrome.runtime.onMessage.addListener(onChromeMessage);
}

export async function main() {
  // Debug
  log.setLevel(log.levels.TRACE);

  // Staging
  // log.setLevel(log.levels.WARN);

  apiClient = new FWApiClient('http://localhost:8000');

  registerExtension();
  await loadFilter();
}
