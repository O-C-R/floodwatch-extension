// @flow

import log from 'loglevel';

import {FWApiClient} from './api';
import {Filter} from './filter';
import {FWTabInfo} from './tab';

import {serializeImageElement} from '../core/images';
import {Rect} from '../core/shapes';
import {FWError, setupLogging} from '../core/util';
import {FORCE_AD_SEND_TIMEOUT, ABP_FILTER_RELOAD_TIME_MINUTES, ABP_FILTER_RETRY_DELAY_MS} from '../core/constants';
import type {ApiAd, ApiAdPayload} from '../core/types';

async function loadFilter() {
  try {
    log.info('Reloading filter...');
    await Filter.get().addRulesFromUrl('https://easylist-downloads.adblockplus.org/easylist.txt');

    // TODO: move this into a floodwatch-hosted file
    // await Filter.get().addRulesFromText('*facebook.com%2Fads%2Fimage*$image');

    // Set alarm to do this again after a while.
    chrome.alarms.create('reloadFilter', { periodInMinutes: ABP_FILTER_RELOAD_TIME_MINUTES });
    log.info('Done loading filter!');
  } catch (e) {
    // Set alarm to try again soon.
    chrome.alarms.create('reloadFilter', { when: Date.now() + ABP_FILTER_RETRY_DELAY_MS });
    log.error(e);
  }
}

function onScreenElementMessage(tabId: number, message: Object, sendResponse: (obj: any) => void): void {
  const payload = message.payload;

  let isAd: ?boolean = undefined;
  let error: ?Error = undefined;

  try {
    const isAdObj = Filter.get().isAd({
      html: payload.html,
      topUrl: FWTabInfo.getTabAdUrl(tabId) || payload.topUrl,
      mediaType: payload.mediaType,
      urls: payload.urls || []
    });
    isAd = isAdObj === true || (isAdObj && typeof isAdObj === 'object') || false;
    log.debug('Decided', payload, 'was an ad:', isAdObj, isAd);
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

function recordAdPayload(tabId: number, payload: ApiAdPayload) {
  payload.ad.topUrl = FWTabInfo.getTabAdUrl(tabId) || payload.ad.topUrl;

  // Add to the queue
  FWApiClient.get().addAd(payload);

  // Try sending the ads immediately, only happens if there are enough.
  FWApiClient.get().sendAds();

  // Increment the ads we've seen from that tab.
  FWTabInfo.incrTabAdCount(tabId);

  // Otherwise, wait for ads.
  setTimeout(() => FWApiClient.get().sendAds(true), FORCE_AD_SEND_TIMEOUT);
}

function onCapturedAdMessage(tabId: number, message: Object) {
  const payload: ApiAdPayload = message.payload;
  log.debug('Captured ad!', message);

  recordAdPayload(tabId, payload);
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
    const adData: ApiAd = message.payload.ad;
    const area = message.payload.area;
    const dataUrl = await captureScreenshot(tabId, area);

    log.debug('did capture, sending response', dataUrl.length);

    recordAdPayload(tabId, {
      ad: adData,
      capture: {
        captureType: 'screenshot',
        image: dataUrl
      }
    });
    sendResponse({ error: null, data: { captured: true }});
  } catch (e) {
    log.warn('did not capture, sending error', e);
    sendResponse({ error: e.message, data: null });
  }
}

async function onLoginMessage(message: any, sendResponse: (obj: any) => void) {
  const payload: { username: string, password: string } = message.payload;
  try {
    await FWApiClient.get().login(payload.username, payload.password);
    log.info('Logged in! Responding with', { username: FWApiClient.get().username });
    sendResponse({ username: FWApiClient.get().username });
  } catch (e) {
    sendResponse({ err: e.message });
  }
}

function onGetLoginStatusMessage(message: any, sendResponse: (obj: any) => void) {
  sendResponse({ username: FWApiClient.get().username });
}

async function onLogoutMessage(message: any, sendResponse: (obj: any) => void) {
  try {
    await FWApiClient.get().logout();
    sendResponse({});
  } catch (e) {
    sendResponse({ err: e.message });
  }
}

// $FlowIssue: this is a good definition
function onChromeMessage(message: any, sender: chrome$MessageSender, sendResponse: (obj: any) => void): boolean {
  log.debug('Got message', message, sender);

  // Routes that don't need tabId
  if (message.type === 'getLoginStatus') {
    onGetLoginStatusMessage(message, sendResponse);
    return true;
  } else if (message.type === 'login') {
    onLoginMessage(message, sendResponse);
    return true;
  } else if (message.type === 'logout') {
    onLogoutMessage(message, sendResponse);
    return true;
  }

  const tabId = sender.tab ? sender.tab.id : undefined;
  if (!tabId) {
    log.error('Got message from invalid tabId', tabId);
    return false;
  }


  // Routes that need TabId
  if (message.type === 'screenElement') {
    onScreenElementMessage(tabId, message, sendResponse);
    return true;
  } else if (message.type === 'capturedAd') {
    onCapturedAdMessage(tabId, message);
    return false;
  } else if (message.type === 'captureScreenshot') {
    onCaptureScreenshotMessage(tabId, message, sendResponse);
    return true;
  }

  return false;
}

// $FlowIssue: chrome$Alarm is correct here
async function onChromeAlarm(alarm: chrome$Alarm) {
  console.log(alarm);
  if (alarm.name == 'reloadFilter') {
    await loadFilter();
  }
}

function registerExtension() {
  // $FlowIssue: this is a good definition
  chrome.runtime.onMessage.addListener(onChromeMessage);
  chrome.alarms.onAlarm.addListener(onChromeAlarm);
}

export async function main() {
  setupLogging();

  try {
    // Check to see if we're logged in.
    await FWApiClient.get().getCurrentPerson();
    log.info('Logged in as', FWApiClient.get().username);
  } catch (e) {
    log.info('Not logged in, popping up the login screen...');
    chrome.tabs.create({ url : "popup.html?closeOnLogin=true" });
  }

  // Load the filter the first time
  await loadFilter();

  // Load tabs into memory
  await FWTabInfo.loadTabs();

  // Start listeners
  registerExtension();
}
