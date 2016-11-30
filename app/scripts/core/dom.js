// @flow

import {FWError} from './util';

export function getFrameDocument(el: Element): ?Document {
  try {
     // $FlowIssue: Chrome responds to contentDocument
    return el.contentDocument;
  } catch (e) {
    return null;
  }
}

// $FlowIgnore: this actually is what we want
export function ensureFrameLoaded(el: Element): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const innerDoc: ?Document = getFrameDocument(el);

    if (innerDoc) {
      if (innerDoc.readyState != 'complete') {
        // iframe is not done loading.

        const readyStateChangeListener = () => {
          if (innerDoc.readyState == 'complete') {
            innerDoc.removeEventListener('readystatechange', readyStateChangeListener);
            resolve(true);
          }
        };
        innerDoc.addEventListener('readystatechange', readyStateChangeListener);
      } else {
        // iframe claims to to be done loading.
        resolve(true);
      }
    } else {
      // $FlowIssue: Element responds to contentWindow
      const win = el.contentWindow;

      if (win) {
        // We couldn't get a document, but we can get the iframe's window,
        // so we proceed with caution. Probably a cross-origin error.
        resolve(false);
      } else {
        reject(new FWError('Frame has no window, maybe not attached to the DOM.'));
      }
    }
  });
}
