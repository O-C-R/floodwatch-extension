// @flow

import {main} from './background-app/app';

chrome.runtime.onInstalled.addListener(details => {
  console.log('previousVersion:', details.previousVersion);
});

main();
