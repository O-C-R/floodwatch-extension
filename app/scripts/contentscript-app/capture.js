// @flow weak

import $ from 'jquery';
import * as _ from 'lodash';

import {Frame} from './frame';
import {Rect, ElementRect, WindowRect} from '../core/shapes';
import {outerArea, pollUntil, promiseTimeout, delayedPromise, FWError, CAPTURE_THRESHOLD} from '../core/util';

export class FWCaptureError extends FWError {}

export type Threshold = {
  ratio: number;
  area: number;
};

export type CaptureOptions = {
  fwId?: string,
  threshold?: Threshold;
  allowScreenshot?: boolean;
}

const IMG_SELECTOR = 'img';
const GRAPHIC_SELECTOR = 'img,canvas';
const EMBED_SELECTOR = 'embed';
const FRAME_SELECTOR = 'iframe,frame';

function outerAreaAbsDiff($a: JQuery, $b: JQuery): number {
  return Math.abs(outerArea($a) - outerArea($b));
}

function outerAreaAbsDiffRatio($a: JQuery, $b: JQuery): number {
  return outerAreaAbsDiff($a, $b) / outerArea($b);
}

function sortByOuterArea(a: HTMLElement, b: HTMLElement) {
  return outerArea($(a)) - outerArea($(b));
}

function sortByOuterAreaAbsDiff($el: JQuery): (a: HTMLElement, b: HTMLElement) => number {
  return function(a: HTMLElement, b: HTMLElement): number {
    return outerAreaAbsDiff($(a), $el) - outerAreaAbsDiff($(b), $el);
  }
}

function passesThreshold($found: JQuery, $el: JQuery, threshold: ?Threshold): boolean {
  if (!threshold) return true;

  return outerAreaAbsDiffRatio($found, $el) <= threshold.ratio &&
    outerArea($found) >= threshold.area;
}

function findSelfOrChildBySize($el: JQuery, selector: string, threshold?: Threshold): JQuery {
  let $found = $();

  if ($el.is(selector)) {
    // if $el matches the selector, just return $el
    $found = $el;
  } else if (outerArea($el) < 4) {
    // if it's really small, just find the biggest element matching the selector
    const sorted = $el.find(selector).toArray().sort(sortByOuterArea);
    $found = $(sorted[sorted.length - 1]);
  } else {
    // otherwise, find the element whose area is closest to $el
    const sorted = $el.find(selector).toArray().sort(sortByOuterAreaAbsDiff($el));
    $found = sorted[0];
  }

  $found = $found || $();
  if ($found.length > 0 && threshold && !passesThreshold($found, $el, threshold)) {
    $found = $();
  }

  return $found;
}

// export class Capture {
  // static bindToDoc(doc: Document) {
  //   doc.addEventListener('fw:capture', function(event: Event) {
  //     if (event.detail) {
  //       const captureEvent: FWCaptureEvent = ((event: Object): FWCaptureEvent);
  //
  //       new Capture().get($('body'), {
  //         fwId: captureEvent.detail.fwId,
  //         allowScreenshot: false
  //       })
  //         // .done(function(dataURL, strategy, details){
  //         //   // captureEvent.detail.respond({ dataURL: dataURL, strategy: strategy, details: details });
  //         // })
  //         // .fail(function(error) {
  //         //   // captureEvent.detail.respond({ error: error });
  //         // });
  //     }
  //   });
  //
  //   doc.addEventListener('fw:captureRect', function(event) {
  //     var detail = event.detail;
  //
  //     if (detail.frame == void 0) {
  //       throw new Error('fw:captureRect event fired without a source frame');
  //     }
  //
  //     var rect = new ElementRect(detail.rect).relativeToElement(detail.frame);
  //
  //     //FW.log.capture('parent frame capturing rect', detail.options.fwId);
  //
  //     new Capture().captureRect(rect, detail.options)
  //       .always(function() {
  //         // FW.log.capture('parent frame got rect capture response', detail.options.fwId);
  //       })
  //       .done(function(data) { detail.respond({ data: data }); })
  //       .fail(function(e) { detail.respond({ error: e }); });
  //   });
  // }

type FrameQueryRes = {
  frame: HTMLIFrameElement;
  bestOADiff: ?number;
};

function frameChildCB(fwFrame: Frame, oa: number): () => Promise<?FrameQueryRes> {
  return async function(): Promise<?FrameQueryRes> {
    try {
      const frame: HTMLIFrameElement = this;
      // $FlowIssue: contentWindow is supported by Chrome
      const contentWindow: WindowProxy = frame.contentWindow;

      // const res = await fwFrame.outerAreasOfElementsMatching(contentWindow, GRAPHIC_SELECTOR);
      const res = { outerAreas: [] };

      const areas = res.outerAreas;
      const diffs = areas.map(function(a) { return Math.abs(a - oa); });
      diffs.sort();
      const bestOADiff = diffs[0];

      return { frame, bestOADiff };
    } catch (e) {
      return null;
    }
  }
}

async function bestFrameChild(fwFrame: Frame, $el: JQuery, threshold: ?Threshold): Promise<?FrameQueryRes> {
  const oa = outerArea($el);

  const frames = $el.find(FRAME_SELECTOR);
  if (frames.length == 0) {
    return Promise.resolve(null);
  }

  const promises = frames.map(frameChildCB(fwFrame, oa)).toArray();
  const res: Array<?FrameQueryRes> = await Promise.all(promises);

  const bestFrame: ?FrameQueryRes = res.filter(function(a: ?FrameQueryRes) {
    return a && passesThreshold($(a.frame), $el, threshold);
  })
  .sort(function(a, b) { return a.bestOADiff - b.bestOADiff; })[0];

  return bestFrame;
}

async function findBestGraphicInDocTree(fwFrame: Frame, $el: JQuery, options: { threshold?: Threshold } = {}): Promise<?JQuery> {
  const bestFrame = await bestFrameChild(fwFrame, $el, options.threshold);
  const bestLocal = findSelfOrChildBySize($el, GRAPHIC_SELECTOR, options.threshold);

  if (bestLocal.length > 0) {
    // There's a child element that passes our threshold
    if (bestFrame
        && bestFrame.bestOADiff !== null
        && bestFrame.bestOADiff !== undefined
        && bestFrame.bestOADiff < outerAreaAbsDiff(bestLocal, $el)) {
      // But the frame element is better
      return $(bestFrame.frame);
    } else {
      // Child element is better, or there's no frame element
      return bestLocal;
    }
  } else if (bestFrame) {
    // No child element, but there is a frame element.
    return $(bestFrame.frame);
  } else {
    // Nothing matches
    return null;
  }
}

function getFrameDocumentSafely($el: JQuery): ?Document {
  try {
    return $el.prop('contentDocument');
  } catch (error) {
    return null;
  }
}

// waitForDocumentMutation(doc: Document) {
//   var deferred = $.Deferred();
//
//   // readyState may be complete, but the actual payload of the ad may
//   // be yet to be loaded in the case of script-injected iframes
//   var $body = $(doc.body)
//     , bestGraphic = this.findBestGraphic($body, { threshold: CAPTURE_THRESHOLD });
//   if (! bestGraphic.length) {
//
//     var mutationTimeout = null
//       , docWriteTimeout = null
//       , giveUpTimeout = setTimeout(deferred.resolve, 3000)
//       , dontGiveUp = function() {
//         if (giveUpTimeout) clearTimeout(giveUpTimeout);
//         giveUpTimeout = undefined;
//       }
//       ;
//
//     // muahaha
//     var oldDocWrite = doc.write;
//     doc.write = function() {
//       dontGiveUp();
//
//       if (docWriteTimeout) clearTimeout(docWriteTimeout);
//       docWriteTimeout = setTimeout(deferred.resolve, 500);
//
//       return oldDocWrite.apply(this, arguments);
//     };
//
//     doc.addEventListener('DOMNodeInserted', function(node) {
//       dontGiveUp();
//
//       // wait for document modifications to die down
//       if (mutationTimeout) clearTimeout(mutationTimeout);
//       mutationTimeout = setTimeout(deferred.resolve, 500);
//     });
//   }
//
//   // got something good looking!
//   else {
//     deferred.resolve();
//   }
//
//   return deferred.promise();
// }

function waitForInnerFrame(win: WindowProxy): Promise<void> {
  let didRespond = false;

  const frame: Frame = window.frame;
  frame.ping(win).then(function() { didRespond = true; }).catch();

  return pollUntil(() => didRespond, 100, 10000);
}

function ensureLoaded($el: JQuery): Promise<void> {
  return new Promise((resolve, reject) => {
    const tagName = $el.prop('localName');

    if (tagName === 'img') {
      if ($el.prop('complete')) {
        // Image is done loading, we're good.
        resolve();
      } else {
        // Image has yet to load, wait for that to happen.
        $el.load(resolve).error(reject);
      }
    } else if (['embed', 'object'].indexOf(tagName) !== -1) {
      const $embed: JQuery = findSelfOrChildBySize($el, EMBED_SELECTOR);

      if ($embed.length > 0) {
        // There's a good embed, make sure it's loaded.
        resolve(ensureSWFLoaded($embed[0]));
      } else {
        // No embed found! Continuing, but this is a warning...
        resolve();
      }
    } else if (tagName === 'iframe') {
      const innerDoc: ?Document = getFrameDocumentSafely($el);

      if (innerDoc) {
        if (innerDoc.readyState === 'loading') {
          // iframe is not done loading.
          $(innerDoc).load(resolve).error(reject);
        } else {
          // iframe claims to to be done loading, but how do we really know?
          // TODO: use mutation listeners
          resolve();
        }
      } else {
        const win = $el.prop('contentWindow');

        if (win) {
          // We couldn't get a document, but we can get the iframe's window.
          resolve(waitForInnerFrame(win));
        } else {
          reject(new Error('Cannot capture a frame without a window. Is it attached to the DOM?'));
        }
      }
    } else if (tagName === 'body') {
      const doc = $el.prop('ownerDocument');
      if (doc.readyState === 'loading') {
        // We're looking at the body of something, but it's not loaded.
        $(doc).load(resolve).error(reject);
      } else {
        // We're looking at the body of something, and it's already loaded.
        resolve();
      }
    } else {
      // Dunno what this element is - proceed anyway.
      resolve();
    }
  });
}

export async function capture(fwFrame: Frame, $el: JQuery, options: CaptureOptions): Promise<string> {
  options = _.extend({
    fwId: $el.data('fw-id'),
    threshold: CAPTURE_THRESHOLD,
    allowScreenshot: true
  }, options);

  await ensureLoaded($el);
  return captureLoadedElement(fwFrame, $el, options);
}

async function captureLoadedElement(fwFrame: Frame, $el: JQuery, options: CaptureOptions): Promise<string> {
  if ($el.prop('localName') == 'body') {
    // reload body in case a document.write() modified the DOM. We're SOL
    // for elements that aren't body.
    $el = $($el.prop('ownerDocument').body);
  }

  const $graphic: ?JQuery = await findBestGraphicInDocTree(fwFrame, $el, options);
  if (!$graphic || $graphic.length == 0) {
    console.error('No graphic element for', $el, $graphic);
    throw new FWError('No graphic element for', $el);
  }

  // TODO: why can't I use CAPTURE_THRESHOLD.area?
  if (outerArea($graphic) < 16) {
    throw new FWError('Skipping graphic that is too small');
  }

  return serializeGraphic($el, $graphic, options)
}

function serializeGraphic($el: JQuery, $graphic: JQuery, options: CaptureOptions): Promise<string> {
  if ($graphic.is('img')) {
    const imgElem: HTMLImageElement = (($graphic[0]: Object): HTMLImageElement);
    return serializeImageElement(imgElem, undefined, options);
  } else if ($graphic.is('canvas')) {
    const canvasElem: HTMLCanvasElement = (($graphic[0]: Object): HTMLCanvasElement);
    return serializeCanvasElement(canvasElem, options);
  } else if ($el.is('iframe') || $graphic.is('iframe')) {
    const $target = $graphic.is('iframe') ? $graphic : $el;
    //
    // this.getFrameCapture($target, options)
    //   .done(deferred.resolve)
    //   .fail(function(error) {
    //
    //     if ((error.error || error) == 'DISALLOWED_GET_VISIBLE_ELEMENT_IN_CHILD') {
    //       FW.log.capture('GET VISIBLE ELEMENT in parent of frame');
    //       this.requestScreenshot($el, options).then(deferred.resolve, deferred.reject);
    //
    //     } else {
    //       deferred.reject(error);
    //
    //     }
    //
    //   }.bind(this));
    //
    return Promise.reject(new Error('Not implemented'));
  } else if (options.allowScreenshot) {
    // FW.log.capture('GET VISIBLE ELEMENT', options.fwId);

    return requestScreenshot($el, options);
  } else {
    return Promise.reject(new Error('No way to get this element!'));
  }
}

export async function serializeImageElement(
  img: HTMLImageElement,
  area: { top: number, left: number, width: number, height: number }
    = { top: 0, left: 0, width: $(img).width(), height: $(img).height() }
): Promise<string> {
  let data: ?string = null;
  let err: ?Error = null;

  try {
    const canvas: HTMLCanvasElement = document.createElement('canvas');
    canvas.width = area.width;
    canvas.height = area.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Problem creating canvas.');

    ctx.drawImage(img, area.left, area.top, area.width, area.height, 0, 0, area.width, area.height);
    data = await serializeCanvasElement(canvas);
  } catch (e) {
    err = e;
  }

  if (!data || err) {
    try {
      const src = $(img).prop('src');
      data = await fetchImageData(src);
    } catch (e) {
      err = e;
    }
  }

  if (!data) {
    if (err) {
      throw err;
    } else {
      return '';
    }
  }

  return data;
}

async function fetchImageData(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Bad network response!');
  }

  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = function() {
      URL.revokeObjectURL(blobUrl);

      const canvas: HTMLCanvasElement = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return reject(new Error('Problem creating canvas.'));
      }

      ctx.drawImage(img, 0, 0);
      resolve(serializeCanvasElement(canvas));
    }
    img.src = blobUrl;
  });
}

export function serializeCanvasElement(canvas: HTMLCanvasElement): Promise<string> {
  try {
    const dataUrl = canvas.toDataURL('image/png');
    if (dataUrl) {
      return Promise.resolve(dataUrl);
    } else {
      throw new Error('No data!');
    }
  } catch (e) { // cross-origin error
    return Promise.reject(e);
  }
}

export function getFrameCapture(fwFrame: Frame, $el: JQuery): Promise<string> {
  const doc = getFrameDocumentSafely($el);
  const fwId = $el.attr('data-fw-id');

  if (doc) {
    return capture(fwFrame, $(doc.body), { fwId: fwId, allowScreenshot: false });
  }
  const win: ?WindowProxy = $el.prop('contentWindow');

  if (win) {
    // TODO: is this safe?
    const frameChannel: Frame = window.frameChannel;

    // return frameChannel.capture(win, { fwId: fwId })
    //   .then((response) => response.dataURL);
  }

  return Promise.reject(new FWError('Cannot capture a frame without a window. Is it attached to the DOM?'));
}

export function requestScreenshot($el: JQuery, options: CaptureOptions): Promise<string> {
  const rect = Rect.forElement($el[0])

  if (!$el.is(':visible')) {
    return Promise.reject(new FWCaptureError("Can't capture element that is not :visible."));
  }

  if (options.threshold && rect.width * rect.height < options.threshold.area) {
    return Promise.reject(new Error('Ignoring elements that are smaller than ' + options.threshold.area + ' pixels'));
  }

  return captureScreenshot(rect, options);
}

function captureScreenshot(rect: ElementRect, options: CaptureOptions, lastRelativeRect?: ElementRect): Promise<string> {
  return Promise.resolve('');

  // if (!rect.window) throw new Error('Rect has no window!');
  // const win: WindowProxy = rect.window;
  //
  // if (!rect.isAbsolute) {
  //   // The rect is not the largest container - bump this request up a node.
  //
  //   // FW.log.capture('capturing rect in parent', options.fwId, rect.window.frameChannel.id);
  //   const frameChannel: Frame = win.frameChannel;
  //   const parentWin = win.parent;
  //
  //   // Always be sure to register with parent first
  //   return frameChannel.registerWithParent(parentWin)
  //     .then(() => frameChannel.captureRect(parentWin, rect, options))
  //     .then((response) => response.data);
  // }
  //
  // if (!Rect.forWindow(rect.window).contains(rect)) {
  //   // Rect is not visible. Add this to the queue.
  //
  //   // FW.log.capture('waiting for rect to become visible', options.fwId);
  //
  //   $(window).one('scroll', (event: Event) => {
  //     this.captureRect(rect, options)
  //   });
  //
  //   return Promise.reject(new Error('Not implemented!'));
  // } else if (! (lastRelativeRect || rect).equals(rect.relativeToCurrentViewport())) {
  //
  //   // FW.log.capture('waiting for rect to become stable', options.fwId);
  //
  //   setTimeout(function() {
  //     this.captureRect(rect, options, rect.relativeToCurrentViewport())
  //       .then(deferred.resolve, deferred.reject);
  //   }.bind(this), 10);
  //
  //
  // } else {
  //
  //   // FW.log.capture('sending rect to background for capture', options.fwId);
  //
  //   var area = rect.relativeToCurrentViewport().scaled(win.devicePixelRatio).baked();
  //
  //   chrome.extension.sendMessage({
  //     whatKind: 'captureVisibleArea',
  //     rect: area,
  //     fwId: options.fwId
  //   }, function(response) {
  //     if (response.error) {
  //       if (response.error == 'TAB_NOT_ACTIVE') {
  //         FW.log.capture('Tab no longer active. Trying again.', options.fwId);
  //         this.captureRect(rect, options)
  //           .then(deferred.resolve, deferred.reject);
  //       } else {
  //         deferred.reject(response.error);
  //       }
  //     } else {
  //       deferred.resolve(response.dataURL, 'requestScreenshot');
  //     }
  //   });
  // }
}

// The API used in this is only available to the background script
function captureScreenshotBackground(tabId: number, rect: Rect, fwId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab: chrome$Tab) => {
      if (!tab.active) {
        return reject(new FWError('Tab not active!'));
      }

      chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, (dataUrl) => {
        // FW.log.capture('background captured tab', fwId);

        const image = new Image();
        image.onerror = reject;
        image.onload = () => resolve(this.serializeImageElement(image, rect));
        image.src = dataUrl;
      });
    });
  });
}

// NOTE: this only works for SWFObject loaded SWFs. Not sure what happens otherwise
function ensureSWFLoaded(embed: HTMLElement, timeout: number = 5000): Promise<void> {
    return pollUntil(function() {
      if (typeof embed.PercentLoaded === 'function') {
        return embed.PercentLoaded() == 100;
      } else {
        return false;
      }
    }, 50, timeout).then(function() {
      // seems like we need an extra 50 ms to ensure the SWF is really rendered
      // and everything
      return delayedPromise(50);
    });
}
