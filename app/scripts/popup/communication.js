// @flow

export function sendMessageToBackground(type: string, payload: mixed): Promise<any> {
  return new Promise(function(resolve, reject) {
    try {
      chrome.runtime.sendMessage({ type, payload }, (res) => resolve(res));
    } catch (e) {
      reject(e);
    }
  });
}
