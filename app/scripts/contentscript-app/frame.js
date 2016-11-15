// @flow

// import * as _ from 'lodash';
import $ from 'jquery';
import MutationSummary from 'mutation-summary';
import * as _ from 'lodash';
import log from 'loglevel';

import {AdElement} from './ad';

import {ensureFrameLoaded} from '../core/dom';
import {ELEMENT_SELECTOR_FRAMES, ELEMENT_SELECTOR_NO_FRAMES, CAPTURE_ERROR_MARGIN_PX} from '../core/constants';
import {FWError, promiseTimeout, tryRepeat, generateUUID, TimeoutError} from '../core/util';
import {findElementBySize} from '../core/shapes';
import type {ApiAdPayload} from '../core/types';

type MutationElementResponse = {
  added: Array<Element>;
  removed: Array<Element>;
  reparented: Array<Element>;
  attributeChanged?: { [key: string]: Array<Element> };
  getOldAttribute?: (e: Element) => string;
  getOldParentNode?: (e: Element) => Element;
};

type WindowRequestType =
  'setRegistered'
  | 'ping'
  | 'childrenDoneLoading'
  | 'startScreen'
  | 'captureFillGraphic';

export type WindowRequest = {
  source: 'floodwatch';
  requestId: string;
  srcFrameId: string;
  isRequest: boolean;
  type: WindowRequestType;
  payload?: WindowRequestPayload | WindowResponsePayload;
  error?: any;
}

export type WindowSetRegisteredRequestPayload = {
  registered: true;
}
export type WindowSetRegisteredResponsePayload = {
  id: string;
}

export type PingRequestPayload = {
  ping: true;
}
export type PingResponsePayload = {
  pong: true;
}

export type OuterAreasRequestPayload = {
  selector: string;
}
export type OuterAreasResponsePayload = Object;

export type ChildrenDoneLoadingRequestPayload = {};
export type ChildrenDoneLoadingResponsePayload = {
  done: boolean;
};

export type StartScreenRequestPayload = {};
export type StartScreenResponsePayload = {
  done: true;
};

export type CaptureFillGraphicRequestPayload = {
  dimensions: {
    width: number;
    height: number;
  }
}
export type CaptureFillGraphicResponsePayload = {
  didCapture: boolean;
}

type WindowRequestPayload =
  WindowSetRegisteredRequestPayload
  | PingRequestPayload
  | OuterAreasRequestPayload
  | ChildrenDoneLoadingRequestPayload
  | StartScreenRequestPayload
  | CaptureFillGraphicRequestPayload;

type WindowResponsePayload =
  WindowSetRegisteredResponsePayload
  | PingResponsePayload
  | OuterAreasResponsePayload
  | ChildrenDoneLoadingResponsePayload
  | StartScreenResponsePayload
  | CaptureFillGraphicResponsePayload;

type WindowRequestOptions = {
  timeout?: number;
  nRetries?: number;
  retryDelay?: number;
};

type FrameChild = {
  element: HTMLIFrameElement;
  frameId?: string;
};

export class Frame {
  id: string;

  view: WindowProxy;
  doc: Document;
  topUrl: string;

  isTop: boolean;
  safeToScreen: boolean;
  lastScrollTime: Date;

  frameChildren: FrameChild[];

  registeredWithParent: boolean;
  registeredWithExtension: boolean;

  requestCallbacks: { [key: string]: { resolve: Function, reject: Function } };

  constructor(doc: Document) {
    this.id = generateUUID();

    this.view = doc.defaultView;
    this.doc = doc;
    this.topUrl = this.doc.defaultView.location.href;

    this.isTop = this.view.isTop || false;
    this.safeToScreen = false;

    this.frameChildren = [];

    this.lastScrollTime = new Date();
    this.view.addEventListener('scroll', () => this.lastScrollTime = new Date());

    if (log.getLevel() == log.levels.TRACE) {
      this.doc.addEventListener('readystatechange', () => {
        log.trace('frame', this.id, 'readystatechange', this.doc.readyState);
      });
    }

    this.registeredWithExtension = false;
    this.registeredWithParent = false;

    this.requestCallbacks = {};

    this.view.fwId = this.id;
  }

  // Use this to create a singleton
  static create(doc: Document): ?Frame {
    if (!doc.defaultView) return null;
    if (doc.defaultView.fwFrame) return doc.defaultView.fwFrame;

    const frame = new Frame(doc);
    doc.defaultView.fwFrame = frame;
    return frame;
  }

  removeChildByElement(el: Element): void {
    this.frameChildren = this.frameChildren.filter(c => c.element != el);
  }

  findChildByElement(el: Element): ?FrameChild {
    return this.frameChildren.find(c => c.element == el);
  }

  findChildByFrameId(frameId: string): ?FrameChild {
    return this.frameChildren.find(c => c.frameId == frameId);
  }

  async screenElement(el: Element): Promise<boolean> {
    let isAd = false;
    const adEl: AdElement = new AdElement(this, el, this.topUrl);

    try {
      isAd = await adEl.screen(this);
    } catch (e) {
      log.error('error screening', el, e);
    }

    if (isAd) {
      try {
        this.capture(adEl);
      } catch (e) {
        log.error('error capturing', el, e);
      }
    }

    return isAd;
  }

  async capture(adEl: AdElement): Promise<void> {
    let data;
    try {
      data = await adEl.capture();
      log.info(this.id, 'Captured!', adEl.el, data);
    } catch (e) {
      log.error('Error capturing', adEl, e);
      $(adEl.el).remove();
      return;
    }

    // There must have been an error
    if (!data.didCapture) {
      log.debug(this.id, 'did not capture', adEl.el)
      $(adEl.el).remove();
      return;
    }

    try {
      adEl.markRecorded();

      if (data.localCapture && data.localCapture.dataUrl) {
        const dataUrl: string = data.localCapture.dataUrl;

        const payload: ApiAdPayload = {
          ad: adEl.toApiJson(),
          capture: {
            image: dataUrl,
            captureType: 'image'
          }
        };
        this.sendMessageToBackground('capturedAd', payload);
      }
    } catch (e) {
      log.error('Error recording capture of', adEl, e);
    } finally {
      $(adEl.el).remove();
    }
  }

  async addFrameChild(el: Element) {
    // Cast
    const iframe = ((el: any): HTMLIFrameElement);

    if (this.findChildByElement(el)) {
      throw new FWError('Frame already added!');
    }

    const frameChild: FrameChild = {
      element: iframe
    };

    this.frameChildren.push(frameChild);

    // Register frame first
    try {
      log.trace(this.id, 'going to register iframe', iframe);
      const registered = await this.registerChild(iframe);
      log.debug(this.id, 'did register', iframe);
    } catch (e) {
      log.debug(this.id, 'error registering iframe', el, e);
    }

    if (this.safeToScreen) {
      // If we're okay to screen, do it.
      try {
        log.trace(this.id, 'going to screen iframe', iframe);
        await this.screenFrame(iframe, this.topUrl);
        log.debug(this.id, 'did screen iframe', iframe);
      } catch (e) {
        log.error(this.id, 'error screening iframe', el, e);
      }
    } else {
      log.debug(this.id, 'not ready to screen iframe', iframe);
    }

  }

  async screenFrame(el: HTMLIFrameElement) {

    const isAd = await this.screenElement(el, this.topUrl);

    // Propagate down the screen if it's an iframe
    if (!isAd) {
      log.debug(this.id, 'decided frame was not an ad', el);

      // const loadedState = el.readyState
      // $FlowIssue: contentWindow is valid
      const win: WindowProxy = el.contentWindow;
      this.notifyChildToScreen(win);
    } else {
      log.debug(this.id, 'decided frame was an ad', el);
    }
  }

  async handleIFrameMutation(el: Element) {
    // Cast
    const iframe = ((el: any): HTMLIFrameElement);

    // Register frame first
    try {
      log.trace(this.id, 'going to register iframe', iframe);
      const registered = await this.registerChild(iframe);
      log.debug(this.id, 'did register', iframe);
    } catch (e) {
      log.error(this.id, 'error registering iframe', el, e);
    }

    if (this.safeToScreen) {
      // If we're okay to screen, do it.
      try {
        log.trace(this.id, 'going to screen iframe', iframe);
        await this.screenFrame(iframe, this.topUrl);
        log.debug(this.id, 'did screen iframe', iframe);
      } catch (e) {
        log.error(this.id, 'error screening iframe', el, e);
      }
    } else {
      log.debug(this.id, 'not ready to screen iframe', iframe);
    }
  }

  async handleElementMutation(el: Element) {
    try {
      const isAd = await this.screenElement(el, this.topUrl);
    } catch (e) {
      log.error(this.id, 'error screening', el);
    }
  }

  startFrameMutationObserver() {
    log.trace(this.id, 'STARTING FRAME MUTATION');

    const observer = new MutationSummary({
      callback: (a: MutationElementResponse[]) => {
        log.trace('GOT IFRAME MUTATION', a);

        const addedRes: MutationElementResponse = a[0];
        const changedRes: ?MutationElementResponse = a[0];
        // const handled: Set<Element> = new Set();

        // Start pinging new visible iframes
        for (const el of addedRes.added) {
          // handled.add(el);
          // TODO: can we skip some invisible elements here?
          this.handleIFrameMutation(el);
        }
      },
      // TODO: listen for changes that involve frames becoming visible
      queries: [{ element: ELEMENT_SELECTOR_FRAMES }]
    });
  }

  startElementMutationObserver() {
    log.trace(this.id, 'STARTING ELEMENT MUTATION');
    const observer = new MutationSummary({
      callback: (a) => {
        const res: MutationElementResponse = a[0];
        for (const el of res.added) {
          this.handleElementMutation(el);
        }
      },
      queries: [
        { element: ELEMENT_SELECTOR_NO_FRAMES }
      ]
    });
  }

  async startScreen(): Promise<void> {
    // Let iframes be screened
    this.safeToScreen = true;

    // Let non-iframes be screened on creation
    this.startElementMutationObserver();

    // Do a one-time pass on all current elements
    await this.screenAll();
  }

  screenAll() {
    log.debug(this.id, 'STARTING SCREEN');

    const promises = [];

    const elems = $(ELEMENT_SELECTOR_NO_FRAMES);
    log.debug(this.id, 'has child images', elems.toArray());
    elems.toArray().map((el: Element) => {
      const p = this.screenElement(el).catch((e) => {});
      promises.push(p);
    });

    const frames = $(ELEMENT_SELECTOR_FRAMES);
    log.debug(this.id, 'has child frames', frames.toArray());
    frames.toArray().map((el: HTMLIFrameElement) => {
      const p = this.screenFrame(el).catch((e) => {});
      promises.push(p);
    });

    return Promise.all(promises);
  }

  async registerChild(el: HTMLIFrameElement): Promise<?string> {
    let lastError, overallError;
    let childFrameId: ?string = null;

    const register = async (): Promise<?string> => {
      // $FlowIssue: chrome responds to contentWindow
      let win: WindowProxy = el.contentWindow;
      if (!win) {
        return null;
      }

      const childFrameId: ?string = $(el).attr('data-fw-frame-id');
      if (childFrameId) {
        log.debug(this.id, 'DONE REGISTERING (back)', win);
        return childFrameId;
      }

      try {
        log.trace(this.id, 'trying to ping', el, win);
        const pingResponse: WindowRequest = await this.ping(win, { timeout: 10000 });
        const childFrameId = pingResponse.srcFrameId;

        log.trace(this.id, 'setting id')
        $(el).attr('data-fw-frame-id', childFrameId);
        log.debug(this.id, 'has child', win, 'with id', childFrameId);
        return childFrameId;
      } catch (e) {
        lastError = e;
        return null;
      }
    }

    try {
      childFrameId = await tryRepeat(register, 5, 1000);

      if (childFrameId != null) {
        // $FlowIssue: chrome responds to contentWindow
        let win: WindowProxy = el.contentWindow;
        log.trace(this.id, 'setting registered', el, childFrameId);
        await this.setRegistered(win);
        log.trace(this.id, 'done setting registered', el, childFrameId);
        return childFrameId;
      }
    } catch (e) {
      overallError = e;
    }

    log.debug(this.id, 'could not register', el, lastError, overallError);
    return null;
  }

  registerChildren(): Promise<Array<?string>> {
    const selector = 'iframe:not([data-fw-frame-id]),frame:not([data-fw-frame-id])';

    const promises = ($(this.doc).find(selector).toArray(): HTMLIFrameElement[])
      .map((el: Element) => { (async () => {
        const iframeElement = ((el: any): HTMLIFrameElement);
        try {
          return this.registerChild(iframeElement);
        } catch (e) {
          // Ignore
        }
      })(); });

    return Promise.all(promises);
  }

  setRegistered(win: WindowProxy, options: WindowRequestOptions = {}): Promise<WindowRequest> {
    return this.requestWindow(win, 'setRegistered', { registered: true }, options);
  }

  setRegisteredHandler(req: WindowRequest): Promise<WindowSetRegisteredResponsePayload> {
    this.registeredWithParent = true;
    return Promise.resolve({ id: this.id });
  }

  ping(win: WindowProxy, options: WindowRequestOptions = {}): Promise<WindowRequest> {
    log.trace(this.id, 'sending ping to win', win);
    return this.requestWindow(win, 'ping', { ping: true }, options);
  }

  pingHandler(req: WindowRequest): Promise<PingResponsePayload> {
    log.trace(this.id, 'sending pong for req', req.requestId);
    return Promise.resolve({ pong: true });
  }

  notifyChildToScreen(win: WindowProxy, options: WindowRequestOptions = {}) {
    return this.requestWindow(win, 'startScreen', {}, options);
  }

  async startScreenHandler(req: WindowRequest): Promise<StartScreenResponsePayload> {
    await this.startScreen();
    return { done: true };
  }

  // async queryOuterAreasOfElementsMatching(win: WindowProxy, selector: string, options: WindowRequestOptions = {}): Promise<{ areas: number[] }> {
  //   const res = await this.requestWindow(win, 'outerAreas', { selector }, options)
  //   const payload: OuterAreasResponsePayload = res.payload;
  //
  //   return payload.areas;
  // }

  async captureFillGraphic(el: HTMLIFrameElement, dimensions: { width: number, height: number }, options: WindowRequestOptions = {}): Promise<boolean> {
    // if (!$(el).data('fw-frame-id')) {
    //   return Promise.reject('IFrame not registered.');
    // }

    try {
      // $FlowIssue: contentWindow is valid
      const win: WindowProxy = el.contentWindow;
      const res = await this.requestWindow(win, 'captureFillGraphic', { dimensions }, options);

      const resCapture = ((res.payload: any): CaptureFillGraphicResponsePayload);
      return resCapture.didCapture;
    } catch (e) {
      return false;
    }
  }

  async captureFillGraphicHandler(req: WindowRequest): Promise<CaptureFillGraphicResponsePayload> {
    const dims = ((req.payload: any): CaptureFillGraphicRequestPayload).dimensions;

    log.debug(this.id, 'got req to find child of size', dims);

    const childElems = $(ELEMENT_SELECTOR_NO_FRAMES).toArray();
    const bestChildElem = findElementBySize(childElems, dims);

    if (bestChildElem) {
      log.debug(this.id, 'found a child of the right size');
      const adEl: AdElement = new AdElement(this, bestChildElem, this.topUrl);
      await this.capture(adEl);

      return { didCapture: true };
    }

    log.debug(this.id, 'has no graphics of the right size');

    const childFrames: HTMLIFrameElement[] = $(ELEMENT_SELECTOR_FRAMES).toArray();
    const registered = childFrames.filter(el => $(el).data('fw-frame-id') != null);

    for (const child of registered) {
      log.debug(this.id, 'trying to find a good child in', child);
      const didCapture = await this.captureFillGraphic(child, dims);
      if (didCapture) {
        return { didCapture: true };
      }
    }

    return { didCapture: false };
  }

  areChildrenDoneLoading(el: HTMLIFrameElement, options: WindowRequestOptions = {}): Promise<WindowRequest> {
    log.debug(this.id, 'finding out if', el, 'has loaded children', $(el).html());

    // $FlowIssue: contentWindow is valid
    const win: WindowProxy = el.contentWindow;
    return this.requestWindow(win, 'childrenDoneLoading', {}, options);
  }

  async areChildrenDoneLoadingHandler(req: WindowRequest): Promise<ChildrenDoneLoadingResponsePayload> {
    const children: HTMLIFrameElement[] = $(ELEMENT_SELECTOR_FRAMES).toArray();

    log.debug(this.id, 'going to wait for', children, 'to load');

    // Block until all the frames are loaded
    const accessible = await Promise.all(children.map(c => ensureFrameLoaded(c)));
    const crossOriginChildren = children.filter((c, i) => !accessible[i]);

    log.debug(this.id, 'going to try to ping', crossOriginChildren);

    const pingChild = async (c: HTMLIFrameElement): Promise<boolean> => {
      try {
        // $FlowIssue: contentwindow1!!!
        await this.ping(c.contentWindow);
        log.trace(this.id, 'success pinging', c)
        return true;
      } catch (e) {
        log.trace(this.id, 'error pinging', c);
      }
      return false;
    }

    const crossOriginPromises: Array<Promise<boolean>> = crossOriginChildren.map(pingChild);

    const responses = await Promise.all(crossOriginPromises);

    // Only ping registered children
    const respondingCrossOrigin = crossOriginChildren.filter((el, i) => responses[i]);
    const responding = children.filter(c => !crossOriginChildren.includes(c) || respondingCrossOrigin.includes(c));

    log.debug(this.id, 'has children with attrs',
      children,
      children.map(c => c.outerHTML),
      children.map(c => c.innerHTML)
    )

    log.debug(this.id, 'going to ping responding children', responding);

    // Wait for children to respond to ping
    await Promise.all(responding.map(c => {
      return this.areChildrenDoneLoading(c, { timeout: 1000 })
        .catch((e) => { /* ignore */ });
    }));

    log.debug(this.id, 'all done with responding children', responding);

    return { done: true };
  }

  requestWindow(win: WindowProxy, type: WindowRequestType, payload: WindowRequestPayload, { timeout }: WindowRequestOptions = {}): Promise<WindowRequest> {
    const requestId = generateUUID();

    const req: WindowRequest = {
      source: 'floodwatch',
      requestId,
      srcFrameId: this.id,
      isRequest: true,
      type,
      payload
    };

    // TODO: don't allow empty fn
    let resolve: Function = function(){};
    let reject: Function = function(){};
    const promise = new Promise((resolveFn, rejectFn) => {
      resolve = resolveFn;
      reject = rejectFn;
    });
    const timedPromise = promiseTimeout(promise, timeout)
      .then((res) => {
        delete this.requestCallbacks[requestId];
        return res;
      }).catch((e) => {
        delete this.requestCallbacks[requestId];
        throw e;
      });

    this.requestCallbacks[requestId] = { resolve, reject };

    log.trace(this.id, 'sending req to', win, req);
    try {
      win.postMessage(req, '*');
    } catch (e) {
      delete this.requestCallbacks[requestId];
      return Promise.reject(e);
    }

    return timedPromise;
  }

  respondWindow(win: WindowProxy, request: WindowRequest, payload?: WindowResponsePayload, error?: Object) {
    const res: WindowRequest = {
      source: 'floodwatch',
      requestId: request.requestId,
      srcFrameId: this.id,
      isRequest: false,
      type: request.type,
      payload, error
    };

    log.trace(this.id, 'sending res', res, 'to', win);
    win.postMessage(res, '*');
  }

  onWindowMessage(event: MessageEvent): void {
    if (!event.data) return;
    if (!event.data.source || event.data.source != 'floodwatch') return;

    log.trace(this.id, this.doc, 'got FW windowMessage', event);
    const message: WindowRequest = ((event.data: any): WindowRequest);
    if (message.isRequest) {
      this.onRequestMessage(event, message);
    } else if (message.type) {
      this.onResponseMessage(event, message);
    }
  }

  onRequestMessage(event: MessageEvent, request: WindowRequest) {
    const handlers: { [key: WindowRequestType]: (r: WindowRequest) => Promise<WindowResponsePayload> } = {
      'setRegistered': this.setRegisteredHandler,
      'ping': this.pingHandler,
      'startScreen': this.startScreenHandler,
      'childrenDoneLoading': this.areChildrenDoneLoadingHandler,
      'captureFillGraphic': this.captureFillGraphicHandler
    };

    if (!handlers[request.type]) {
      log.error(`No handler for request type ${request.type}`, request);
      return;
    }

    const srcWin: WindowProxy = event.source;
    // TODO: verify

    handlers[request.type].call(this, request)
    .then((payload: Object) => {
      this.respondWindow(srcWin, request, payload);
    }).catch((e) => {
      this.respondWindow(srcWin, request, undefined, e);
    });
  }

  onResponseMessage(event: MessageEvent, response: WindowRequest) {
    const callbacks = this.requestCallbacks[response.requestId];

    if (!callbacks) {
      log.error('No callbacks for requestId', response.requestId);
      return;
    }

    if (!response.payload || response.error) {
      callbacks.reject(response);
    } else {
      callbacks.resolve(response);
    }
  }

  getFrameByFWID(fwId: string): JQuery {
    var attr = `[data-fwid="${fwId}"]`;
    return $(this.doc).find(`iframe${attr},frame${attr}`);
  }

  sendMessageToBackground(type: string, payload: mixed, callback?: Function) {
    chrome.runtime.sendMessage({ type, payload }, callback);
  }
}
