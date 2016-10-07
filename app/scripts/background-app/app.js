// @flow

import {Filter} from './filter';
import $ from 'jquery';

async function loadFilter() {
  try {
    await Filter.get().addRulesFromUrl('https://easylist-downloads.adblockplus.org/easylist.txt');
    await Filter.get().addRulesFromText('*facebook.com%2Fads%2Fimage*$image');
  } catch (e) {
    console.error(e);
  }
}

function registerExtension() {
  // $FlowIssue: this is actually a good definition
  chrome.runtime.onMessage.addListener(
    (message: any, sender: chrome$MessageSender, sendResponse: (obj: any) => void): void => {
      console.log('Got message');
      console.log(message, sender);

      if (message.type === 'screenElement') {
        const payload = message.payload;

        let isAd: ?boolean = undefined;
        let error: ?Error = undefined;

        try {
          const isAdObj = Filter.get().isAd({
            adHtml: payload.adHtml,
            topUrl: payload.topUrl,
            mediaType: payload.mediaType,
            urls: payload.urls || []
          });
          isAd = isAdObj === true || typeof isAdObj === 'object';
          console.log('Decided', payload, 'was an ad:', isAdObj);
        } catch (e) {
          console.error('Error detecting ad from message', message, e);
          error = e;
        }

        sendResponse({ isAd, error });
      }

      // const tab: ?chrome$Tab = sender.tab;
      // if (tab && tab.id !== undefined) {
      //   chrome.tabs.sendMessage(tab.id, message);
      // }
    }
  );
}

export async function main() {
  registerExtension();
  await loadFilter();
}
