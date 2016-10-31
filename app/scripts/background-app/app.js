// @flow

import {FWApiClient} from './api';
import {Filter} from './filter';

let apiClient: FWApiClient;

async function loadFilter() {
  try {
    // TODO: do this more often than on extension reload
    await Filter.get().addRulesFromUrl('https://easylist-downloads.adblockplus.org/easylist.txt');

    // TODO: move this into a floodwatch-hosted file
    await Filter.get().addRulesFromText('*facebook.com%2Fads%2Fimage*$image');

    // TODO: remove
    window.filter = Filter;

    console.log('Done loading filter!');
  } catch (e) {
    console.error(e);
  }
}

function onScreenElementMessage(message, sendResponse: (obj: any) => void): void {
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
    console.log('Decided', payload, 'was an ad:', isAdObj, isAd);
  } catch (e) {
    console.error('Error detecting ad from message', message, e);
    error = e;
  }

  sendResponse({ isAd, error });
}

function onCapturedAdMessage(message) {
  const payload = message.payload;

  apiClient.addAd(payload);
  apiClient.sendAds(true);
}

function onChromeMessage(message: any, sender: chrome$MessageSender, sendResponse: (obj: any) => void): void {
  console.log('Got message');
  console.log(message, sender);

  if (message.type === 'screenElement') {
    onScreenElementMessage(message, sendResponse)
  } else if (message.type === 'capturedAd') {
    onCapturedAdMessage(message);
  }
}

function registerExtension() {
  // $FlowIssue: this is a good definition
  chrome.runtime.onMessage.addListener(onChromeMessage);
}

export async function main() {
  apiClient = new FWApiClient('http://localhost:8000');

  registerExtension();
  await loadFilter();
}
