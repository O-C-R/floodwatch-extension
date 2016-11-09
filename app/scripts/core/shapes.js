// @flow

import $ from 'jquery';

import {MIN_ELEM_AREA} from './constants';

type JQElem = JQuery | Element;

export type RectSize = {
  width: number;
  height: number;
}

export type Threshold = {
  ratio: number;
  area: number;
};

export function outerArea(el: JQElem) {
  const $el = $(el);
  return $el.outerWidth() * $el.outerHeight();
}

export function elementSize(el: JQElem) {
  return {
    width: $(el).outerWidth(),
    height: $(el).outerHeight()
  }
}

function sizeAbsDiff(el: Element, sizeTarget: RectSize) {
  return Math.sqrt(
    Math.pow(el.clientWidth - sizeTarget.width, 2)
    + Math.pow(el.clientHeight - sizeTarget.height, 2)
  );
}

function filterBySizeAbsDiff(sizeTarget: RectSize, threshold: number): (a: Element) => boolean {
  return function(a: Element,): boolean {
    return sizeAbsDiff(a, sizeTarget) < threshold;
  }
}

function sortBySizeAbsDiff(sizeTarget: RectSize): (a: Element, b: Element) => number {
  return function(a: Element, b: Element): number {
    return sizeAbsDiff(a, sizeTarget) - sizeAbsDiff(b, sizeTarget);
  }
}

export function findElementBySize(elements: Element[], sizeTarget: RectSize, threshold?: Threshold): ?Element {
  const sorted = elements.filter(filterBySizeAbsDiff(sizeTarget, 5)).sort(sortBySizeAbsDiff(sizeTarget));
  return sorted[sorted.length - 1];
}

export function findSelfOrChildBySize(el: Element, selector: string, threshold?: Threshold): ?Element {
  const $el = $(el);
  let found: ?Element = null;

  if ($el.is(selector)) {
    // if $el matches the selector, just return el
    found = el;
  // } else if (outerArea(el) < MIN_ELEM_AREA) {
  //   // if it's really small, just find the biggest element matching the selector
  //   const sorted = $el.find(selector).toArray().sort(outerAreaDiff);
  //   found = sorted[sorted.length - 1];
  } else {
    // otherwise, find the element whose area is closest to el
    found = findElementBySize($el.find(selector).toArray(), elementSize(el), threshold);
  }

  // If it's not above the threshold, then ignore it.
  // if (found != null && threshold && !passesThreshold(found, el, threshold)) {
  //   found = null;
  // }

  return found;
}

export class Offset {
  top: number;
  left: number;

  constructor(other?: Offset | { top: number, left: number }) {
    other = other || { top: 0, left: 0 };

    this.top  = other.top;
    this.left = other.left;
  }

  static forWindowScroll(win: WindowProxy | JQuery): Offset {
    const winP: WindowProxy = win instanceof $ ? win[0] : win;
    return new Offset({ top: winP.pageYOffset, left: winP.pageXOffset });
  }

  add(other: Offset): Offset {
    return new Offset({ top: this.top + other.top, left: this.left + other.left });
  }

  subtract(other: Offset): Offset {
    return this.add(other.inverted());
  }

  inverted(): Offset {
    return new Offset({ top: - this.top, left: - this.left });
  }

  scaled(s: number): Offset {
    return new Offset({ top: this.top * s, left: this.left * s });
  }
}

export class Rect {
  width: number;
  height: number;
  top: number;
  left: number;

  window: ?WindowProxy;

  constructor({ width, height, top, left }: { width: number, height: number, top: number, left: number }, win?: WindowProxy) {
    this.width = width;
    this.height = height;
    this.top = top;
    this.left = left;

    this.window = win || null;
  }

  static fromRect(other: Rect): Rect {
    return new Rect({
      width: other.width,
      height: other.height,
      top: other.top,
      left: other.left
    }, other.window);
  }

  static forElement(el: Element): ElementRect {
    const doc = el.ownerDocument;
    const win = doc.defaultView;
    const scroll = Offset.forWindowScroll(win);

    return ElementRect.fromClientRect(el.getBoundingClientRect(), scroll, win);
  }

  static forWindow(win: WindowProxy): WindowRect {
    return WindowRect.create({
      width:  win.innerWidth,
      height: win.innerHeight,
      top:    0,
      left:   0
    }, Offset.forWindowScroll(win), win);
  }

  get bottom(): number {
    return this.top + this.height;
  }

  get right(): number {
    return this.left + this.width;
  }

  get isAbsolute(): boolean {
    return this.window != null && this.window === this.window.top;
  }

  contains(other: Rect): boolean {
    return other.right   >= this.left  && other.right  <= this.right   &&
           other.left    >= this.left  && other.left   <= this.right   &&
           other.top     >= this.top   && other.top    <= this.bottom  &&
           other.bottom  >= this.top   && other.bottom <= this.bottom;
  }

  equals(other: Rect): boolean {
    return this.top === other.top &&
           this.right === other.right &&
           this.bottom === other.bottom &&
           this.left === other.left;
  }

  baked() {
    return {
      width:  this.width,
      height: this.height,
      top:    this.top,
      bottom: this.bottom,
      left:   this.left,
      right:  this.right
    };
  }

  toJSON() {
    return this.baked();
  }
}

export class ElementRect extends Rect {
  offset: Offset;

  static create(rectParams: { width: number, height: number, top: number, left: number }, offset: Offset, win?: WindowProxy): ElementRect {
    const r = new ElementRect(rectParams, win);
    r.offset = offset;
    return r;
  }

  static fromElementRect(other: ElementRect): ElementRect {
    const r = ElementRect.create({
      width: other.width,
      height: other.height,
      top: other.top,
      left: other.left
    }, new Offset(other.offset), other.window);
    return r;
  }

  static fromClientRect(cr: ClientRect, offset: Offset, win?: WindowProxy): ElementRect {
    const r = ElementRect.create(cr, offset);
    r.window = win;
    return r;
  }

  offsetted(offset: Offset): ElementRect {
    var r = ElementRect.fromElementRect(this);
    r.offset = new Offset(offset);
    return r;
  }

  // This is a simplification of the true case. In reality, scroll and offset
  // should be applied separately. Furthermore, scroll within a subdocument
  // should be kept separate from scroll in the top document, since scrolling
  // the top does not scroll the subdocument. However, this is probably
  // sufficient for how this method is actually used in the code.
  relativeToElement(el: Element): ElementRect {
    const other = Rect.forElement(el);
    return this.offsetted(other.offset);
  }

  relativeToCurrentViewport(): WindowRect {
    const scroll = Offset.forWindowScroll(this.window);
    return WindowRect.create(this, scroll.inverted(), this.window);
  }
}

export class WindowRect extends Rect {
  scroll: Offset;

  static create(rectParams: { width: number, height: number, top: number, left: number }, scroll: Offset, win?: WindowProxy): WindowRect {
    const r = new WindowRect(rectParams, win);
    r.scroll = scroll;
    return r;
  }

  static fromWindowRect(other: WindowRect): WindowRect {
    const r = new WindowRect({
      width: other.width,
      height: other.height,
      top: other.top,
      left: other.left
    }, new Offset(other.scroll), other.window);
    return r;
  }

  scrolled(scroll: Offset) {
    var r = WindowRect.fromWindowRect(this);
    r.scroll = new Offset(scroll);
    return r;
  }

  scaled(s: number): WindowRect {
    return WindowRect.create({
      width:  this.width   * s,
      height: this.height  * s,
      top:    this.top     * s,
      left:   this.left    * s
    }, this.scroll.scaled(s), this.window);
  }
}
