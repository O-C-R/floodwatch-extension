// @flow weak
// Portions adapted from adblockplus: https://github.com/adblockplus/adblockpluschrome/blob/master/include.preload.js


import $ from 'jquery';
import {MD5} from 'crypto-js';

import {Frame} from './frame';
import {TYPE_MAP, ELEMENT_SELECTOR, CAPTURE_THRESHOLD} from '../core/constants';
import {pollUntil, generateUUID, FWError} from '../core/util';

const CLASS_SCREEN_PROGRESS = 'floodwatch-screen-inprogress';
const CLASS_SCREEN_DONE = 'floodwatch-screen-done';
const CLASS_NOTAD = 'floodwatch-notad';
const CLASS_ISAD = 'floodwatch-isad';
const CLASS_RECORDED = 'floodwatch-recorded';
const CLASS_NOTRECORDED = 'floodwatch-notrecorded';

// export class Ad {
//   $el: JQuery; // jQuery element
//
//   id: string;
//   timestamp: Date;
//   adAnchor: ?string;
//   src: ?string;
//   url: string;
//   pageTitle: string;
//
//   adAnchor: ?string;
//   w: number;
//   h: number;
//
//   elementId: ?string;
//   tagType: string;
//
//   adPosition: number[];
//
//   constructor($el: Object) {
//     this.$el = $el;
//
//     //The basics
//     this.id = generateUUID();
//     this.timestamp = new Date();
//     this.src = $el.attr('src');
//     this.url = window.location.href;
//     this.pageTitle = document.title;
//
//     // Store anchor
//     if ($el.parent().is('a')) {
//       this.adAnchor = $el.parent().attr('href');
//     } else {
//       this.adAnchor = null;
//     }
//
//     // If src is null, it's likely a .SWF embedded in an object tag,
//     // so let's get the .SWF path from that.
//     if (this.src === undefined) {
//       for (const el of $el.find('param')) {
//         if (el.attr('name') == 'movie') {
//           this.src = el.attr('value');
//           break;
//         }
//       }
//     }
//
//     // Size
//     this.w = $el.width();
//     this.h = $el.height();
//
//     //The in-page context
//     this.elementId = $el.attr('id');
//     this.tagType = $el.tagName;
//
//     // Figure out the position of the ad
//     let currLeft = 0, currTop = 0;
//     let currElem = $el[0];
//
//     if (currElem && currElem.offsetParent) {
//       while (currElem) {
//         currLeft += currElem.offsetLeft;
//         currTop += currElem.offsetTop;
//
//         currElem = currElem.offsetParent
//       }
//     }
//     this.adPosition = [currLeft, currTop];
//   }
// }

export class AdElement {
  id: string;
  $el: JQuery;
  topUrl: string;
  urls: string[];
  tag: string;
  mediaType: string;
  isAd: boolean;
  screenState: 'none' | 'started' | 'done';
  recordedAd: boolean;
  adHtml: string;

  constructor($el: JQuery, topUrl: string) {
    this.$el = $el;
    this.topUrl = topUrl;
    this.urls = AdElement.getURLsFromElement(this.$el[0]);
    this.tag = this.$el[0].localName;
    this.mediaType = TYPE_MAP[this.tag];
    this.adHtml = $el.prop('outerHTML');
    this.id = MD5(this.adHtml).toString();

    this.isAd = false;
    this.screenState = 'none';
    this.recordedAd = false;
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
    this.$el.attr('data-fw-id', this.id);
    this.$el.attr('data-fw-topurl', this.topUrl);

    this.screenState = 'started';
    this.setStyle();

    console.log('Screening in background...', this.$el);
    this.isAd = await this.screenInBackground(frame);
    this.screenState = 'done';
    this.setStyle();
    console.log('Done screening in background.');

    return this.isAd;
  }

  screenInBackground(frame: Frame): Promise<boolean> {
    return new Promise((resolve, reject) => {
      frame.sendMessageToBackground('screenElement', this.toApiJson(), (response) => {
        if (response.error) {
          console.error('Response contained error!', response);
          return reject(response.error);
        }

        this.isAd = response.isAd;
        resolve(this.isAd);
      });
    });
  }

  setStyle() {
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

      if (this.recordedAd) {
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
    this.recordedAd = true;
    this.setStyle();
  }

  toApiJson() {
    return {
      id: this.id,
      topUrl: this.topUrl,
      html: this.adHtml,
      mediaType: this.mediaType,
      urls: this.urls
    };
  }
}
