// @flow weak
// Portions adapted from adblockplus: https://github.com/adblockplus/adblockpluschrome/blob/master/include.preload.js


import $ from 'jquery';
import * as _ from 'lodash';
import log from 'loglevel';

import {Frame} from './frame';
import {TYPE_MAP, ELEMENT_SELECTOR, CAPTURE_THRESHOLD, SCROLL_WAIT_TIME, FRAME_LOAD_WAIT_TIME} from '../core/constants';
import {pollUntil, generateUUID, delayedPromise, FWError} from '../core/util';
import {serializeImageElement, serializeCanvasElement} from '../core/images';
import {findSelfOrChildBySize, outerArea, Rect} from '../core/shapes';
import {ensureFrameLoaded} from '../core/dom';
import type {Threshold} from '../core/shapes';

const CLASS_SCREEN_PROGRESS = 'floodwatch-screen-inprogress';
const CLASS_SCREEN_DONE = 'floodwatch-screen-done';
const CLASS_NOTAD = 'floodwatch-notad';
const CLASS_ISAD = 'floodwatch-isad';
const CLASS_RECORDED = 'floodwatch-recorded';
const CLASS_NOTRECORDED = 'floodwatch-notrecorded';

const ALL_CLASSES = [
  CLASS_SCREEN_PROGRESS,
  CLASS_SCREEN_DONE,
  CLASS_NOTAD,
  CLASS_ISAD,
  CLASS_RECORDED,
  CLASS_NOTRECORDED
];

const IMG_SELECTOR = 'img';
const CANVAS_SELECTOR = 'canvas';
const GRAPHIC_SELECTOR = 'img,canvas';
const EMBED_SELECTOR = 'embed';
const FRAME_SELECTOR = 'iframe,frame';

export type CaptureOptions = {
  threshold?: Threshold;
}

export class AdElement {
  localId: string;
  serverId: ?string;

  frame: Frame;

  el: Element;
  $el: JQuery;

  graphicEl: ?Element;
  $graphicEl: ?JQuery;

  topUrl: string;
  urls: string[];
  tag: string;
  mediaType: string;
  isAd: boolean;
  adHtml: string;

  screenState: 'none' | 'started' | 'done';
  recordedAdState: 'none' | 'done';

  screenshotState: 'none' | 'active';
  timeAtScreenshotRequest: ?Date;

  constructor(frame: Frame, el: Element, topUrl: string) {
    this.localId = generateUUID();
    this.serverId = null;

    this.frame = frame;
    this.el = el;
    this.$el = $(el);
    this.topUrl = topUrl;

    this.urls = AdElement.getURLsFromElement(this.$el[0]);
    this.tag = el.localName;
    this.mediaType = TYPE_MAP[this.tag];
    this.adHtml = this.$el.prop('outerHTML');

    this.isAd = false;
    this.screenState = 'none';
    this.recordedAdState = 'none';
  }

  static getURLsFromObjectElement(element: HTMLElement): string[] {
    const url = element.getAttribute('data');
    if (url) return [url];

    for (let i = 0; i < element.children.length; i++) {
      const child = element.children[i];
      if (child.localName != 'param') continue;

      const name = child.getAttribute('name');
      if (name != 'movie'  && // Adobe Flash
          name != 'source' && // Silverlight
          name != 'src'    && // Real Media + Quicktime
          name != 'FileName') // Windows Media
        continue;

      const value = child.getAttribute('value');
      if (!value) continue;

      return [value];
    }

    return [];
  }

  static getURLsFromAttributes(element: HTMLElement): string[] {
    const urls: string[] = [];

    if (element.src && typeof element.src === 'string') {
      urls.push(element.src);
    }

    if (element.srcset && typeof element.srcset === 'string') {
      const candidates = element.srcset.split(',');
      for (let i = 0; i < candidates.length; i++) {
        const url = candidates[i].trim().replace(/\s+\S+$/, '');
        if (url) {
          urls.push(url);
        }
      }
    }

    return urls;
  }

  static getURLsFromMediaElement(element: HTMLElement): string[] {
    const urls = this.getURLsFromAttributes(element);

    for (let i = 0; i < element.children.length; i++) {
      const child = element.children[i];
      if (child.localName == 'source' || child.localName == 'track')
        urls.push.apply(urls, this.getURLsFromAttributes(child));
    }

    if (element.poster && typeof element.poster === 'string') {
      urls.push(element.poster);
    }

    return urls;
  }

  static getURLsFromElement(element: HTMLElement): string[] {
    let urls: string[];
    switch (element.localName) {
      case 'object':
        urls = this.getURLsFromObjectElement(element);
        break;

      case 'video':
      case 'audio':
      case 'picture':
        urls = this.getURLsFromMediaElement(element);
        break;

      default:
        urls = this.getURLsFromAttributes(element);
        break;
    }

    for (let i = 0; i < urls.length; i++) {
      if (/^(?!https?:)[\w-]+:/i.test(urls[i]))
        urls.splice(i--, 1);
    }

    return urls;
  }

  async screen(frame: Frame): Promise<boolean> {
    if (this.screenState != 'none') {
      throw new FWError('Already screened!');
    }

    // TODO: can we put this somewhere else?
    this.$el.attr('data-fw-local-ad-id', this.localId);

    this.screenState = 'started';
    this.setStyle();

    log.info('Screening in background...', this.$el);
    this.isAd = await this.screenInBackground(frame);
    this.screenState = 'done';
    this.setStyle();
    log.info('Done screening in background.');

    return this.isAd;
  }

  screenInBackground(frame: Frame): Promise<boolean> {
    return new Promise((resolve, reject) => {
      frame.sendMessageToBackground('screenElement', this.toApiJson(), (response) => {
        if (response.error) {
          log.error('Response contained error!', response);
          return reject(response.error);
        }

        this.isAd = response.isAd;
        resolve(this.isAd);
      });
    });
  }

  ensureImageLoaded(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.$el.prop('complete')) {
        // Image is done loading, we're good.
        resolve();
      } else {
        // Image has yet to load, wait for that to happen.
        this.$el.on('load', resolve).on('error', e => reject(new FWError('Error on image load')));
      }
    });
  }

  // NOTE: this only works for SWFObject loaded SWFs. Not sure what happens otherwise
  ensureSWFLoaded(embed: Element, timeout: number = 5000): Promise<void> {
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

  async ensureObjectLoaded(): Promise<void> {
    const embed: ?Element = findSelfOrChildBySize(this.el, EMBED_SELECTOR);

    if (embed) {
      // There's a good embed, make sure it's loaded.
      await this.ensureSWFLoaded(embed);
    } else {
      // No embed found! Continuing, but this is a warning...
    }
  }

  ensureLoaded(): Promise<void> {
    if (this.tag === 'img') {
      return this.ensureImageLoaded();
    } else if (['embed', 'object'].indexOf(this.tag) >= 0) {
      return this.ensureObjectLoaded();
    } else if (['frame', 'iframe'].indexOf(this.tag) >= 0) {
      return ensureFrameLoaded(this.el);
    } else {
      throw new FWError('Unsupported ad type');
    }
  }

  async requestScreenshotRelative(target: Element, innerRect: ?Rect, options?: CaptureOptions) {
    log.info(this.localId, this.el, 'requesting screenshot of', target);

    return new Promise((resolve, reject) => {
      const rect = Rect.forElement(target);

      // Check the rect is in a window
      if (!rect.window) {
        return reject(new FWError('Rect has no window!'));
      }
      const win: WindowProxy = rect.window;

      const area = rect.relativeToCurrentViewport().scaled(win.devicePixelRatio).baked();
      const payload = { area };
      // rect.

      this.frame.sendMessageToBackground('captureScreenshot', payload, (res) => {
        if (res.error) {
          return reject(res.error);
        }

        return resolve(res.data.dataUrl);
      });
    });
  }

  requestScreenshot(target: Element, options?: CaptureOptions): Promise<string> {
    return this.requestScreenshotRelative(target, null, options);
  }

  async ensureFrameInView(targetIfAny: ?Element, options?: CaptureOptions): Promise<void> {
    const target = targetIfAny || this.el;
    const rect = Rect.forElement(target);

    // if ($(target).is(':visible')) {
    //   log.error(this.localId, target, this.el, 'not visible');
    //   throw new FWError('Can\'t capture element that is not :visible.');
    // }

    if (options && options.threshold && rect.width * rect.height < options.threshold.area) {
      throw new FWError(`Ignoring iframe smaller than ${options.threshold.area} pixels`);
    }

    // The rect is not the largest container - bump this request up a node.
    if (!rect.isAbsolute) {
      try {
        // await this.frame.
      } catch (e) {
        log.error(e);
        throw new FWError('Error capturing in parent!');
      } finally {
        throw new FWError('Captured in parent!');
      }
    }

    // Rect is not visible, wait for it to be still in the screen.
    const scrolledRecently = new Date() - this.frame.lastScrollTime < SCROLL_WAIT_TIME;
    const isInView = Rect.forWindow(rect.window).contains(rect);
    if (scrolledRecently || !isInView) {
      await new Promise((resolve, reject) => {
        let scrollTimer: ?number = null;

        const scrollDone = () => {
          const newRect = Rect.forElement(target);
          if (Rect.forWindow(newRect.window).contains(newRect)) {
            log.info(this.el, 'scrolled into view!');
            resolve();
            this.frame.view.removeEventListener('scroll', scrollListener);
          }
        }

        const scrollListener = (e: UIEvent) => {
          if (scrollTimer != null) {
            clearTimeout(scrollTimer);
          }
          scrollTimer = setTimeout(scrollDone, SCROLL_WAIT_TIME);
        }
        this.frame.view.addEventListener('scroll', scrollListener);
      });
    }
  }

  async captureTarget(target: Element, options?: CaptureOptions): Promise<string> {
    const $target: JQuery = $(target);

    if ($target.is(IMG_SELECTOR)) {
      const imgElem: HTMLImageElement = ((target: Object): HTMLImageElement);
      return serializeImageElement(imgElem, undefined, options);
    } else if ($target.is(CANVAS_SELECTOR)) {
      const canvasElem: HTMLCanvasElement = ((target: Object): HTMLCanvasElement);
      return serializeCanvasElement(canvasElem, options);
    } else if ($target.is(FRAME_SELECTOR)) {
      const iframeTarget = ((target: any): HTMLIFrameElement);
      await this.frame.areChildrenDoneLoading(iframeTarget);

      const dims = { width: $(target).outerWidth(), height: $(target).outerHeight() };
      const capturedGraphic = await this.frame.captureFillGraphic(iframeTarget, dims);
      if (capturedGraphic) {
        this.recordedAdState = 'done';
        this.screenshotState = 'none';
        this.setStyle();

        throw new FWError('Captured in lower frame');
      }

      this.screenshotState = 'active';
      this.setStyle();

      let data = null;
      try {
        do {
          await this.ensureFrameInView(target);
          this.timeAtScreenshotRequest = new Date();
          data = await this.requestScreenshot(target);
        } while (this.timeAtScreenshotRequest && this.frame.lastScrollTime > this.timeAtScreenshotRequest);
      } finally {
        this.screenshotState = 'none';
        this.setStyle();
      }

      if (!data) throw new FWError('No Data!');
      return data;
    } else {
      throw new FWError('No way to capture this element!');
    }
  }

  async findBestCaptureTarget(options: CaptureOptions): Promise<?Element> {
    let bestChild: ?Element = findSelfOrChildBySize(this.el, GRAPHIC_SELECTOR, options.threshold);
    if (!bestChild && this.$el.is(FRAME_SELECTOR)) {
      bestChild = this.el;
    }

    return bestChild;
  }

  async capture(options: CaptureOptions = {}): Promise<string> {
    options = _.extend({
      threshold: CAPTURE_THRESHOLD
    }, options);

    // Load the element
    await this.ensureLoaded();

    // Find the best child
    const target: ?Element = await this.findBestCaptureTarget(options);

    log.info(this.localId, this.el, 'got a target', target);

    // Maybe we don't actually want to capture the target
    if (!target) {
      throw new FWError('No graphic element!');
    } else if (outerArea(target) < CAPTURE_THRESHOLD.area) {
      throw new FWError('Skipping graphic that is too small');
    }

    log.info(this.localId, this.el, 'ready to capture', target);

    // Capture that child
    return this.captureTarget(target, options);
  }

  setStyle() {
    if (this.screenshotState == 'active') {
      for (const cl of ALL_CLASSES) {
        this.el.classList.remove(cl);
      }
      return;
    }

    if (this.screenState == 'started') {
      this.$el.removeClass(CLASS_SCREEN_DONE);
      this.$el.addClass(CLASS_SCREEN_PROGRESS);
    } else if (this.screenState == 'done') {
      this.$el.removeClass(CLASS_SCREEN_PROGRESS);
      this.$el.addClass(CLASS_SCREEN_DONE);
    }

    if (this.isAd) {
      this.$el.removeClass(CLASS_NOTAD);
      this.$el.addClass(CLASS_ISAD);

      if (this.recordedAdState == 'done') {
        this.$el.removeClass(CLASS_NOTRECORDED);
        this.$el.addClass(CLASS_RECORDED);
      } else {
        this.$el.removeClass(CLASS_RECORDED);
        this.$el.addClass(CLASS_NOTRECORDED);
      }
    } else {
      this.$el.removeClass(CLASS_RECORDED);
      this.$el.removeClass(CLASS_NOTRECORDED);
      this.$el.removeClass(CLASS_ISAD);
      this.$el.addClass(CLASS_NOTAD);
    }
  }

  markRecorded() {
    this.recordedAdState = 'done';
    this.setStyle();
  }

  toApiJson() {
    return {
      localId: this.localId,
      topUrl: this.topUrl,
      html: this.adHtml,
      mediaType: this.mediaType,
      urls: this.urls
    };
  }
}
