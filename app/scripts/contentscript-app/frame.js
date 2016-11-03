// @flow

// import * as _ from 'lodash';
import $ from 'jquery';
import MutationSummary from 'mutation-summary';
import * as _ from 'lodash';

import {AdElement} from './ad';

import {ensureFrameLoaded} from '../core/dom';
import {ELEMENT_SELECTOR_FRAMES, ELEMENT_SELECTOR_NO_FRAMES} from '../core/constants';
import {FWError, promiseTimeout, tryRepeat, generateUUID, TimeoutError} from '../core/util';

type MutationElementResponse = {
  added: Array<Element>;
  removed: Array<Element>;
  reparented: Array<Element>;
  attributeChanged?: { [key: string]: Array<Element> };
  getOldAttribute?: (e: Element) => string;
  getOldParentNode?: (e: Element) => Element;
};

type WindowRequestType = 'setRegistered' | 'ping' | 'childrenDoneLoading' | 'startScreen';

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
  done: boolean
};

export type StartScreenRequestPayload = {};
export type StartScreenResponsePayload = {
  done: true
};

type WindowRequestPayload =
  WindowSetRegisteredRequestPayload
  | PingRequestPayload
  | OuterAreasRequestPayload
  | ChildrenDoneLoadingRequestPayload
  | StartScreenRequestPayload;

type WindowResponsePayload =
  WindowSetRegisteredResponsePayload
  | PingResponsePayload
  | OuterAreasResponsePayload
  | ChildrenDoneLoadingResponsePayload
  | StartScreenResponsePayload;

type WindowRequestOptions = {
  timeout?: number;
  nRetries?: number;
  retryDelay?: number;
};

export class Frame {
  id: string;

  view: WindowProxy;
  doc: Document;
  topUrl: string;

  isTop: boolean;
  safeToScreen: boolean;
  lastScrollTime: Date;

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

    this.lastScrollTime = new Date();
    this.view.addEventListener('scroll', () => this.lastScrollTime = new Date());

    this.doc.addEventListener('readystatechange', () => {
      console.log('frame', this.id, 'readystatechange', this.doc.readyState);
    });

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

  async screenElement(el: Element, topUrl: string): Promise<boolean> {
    let isAd = false;
    const adEl: AdElement = new AdElement(this, el, topUrl);

    try {
      isAd = await adEl.screen(this);
    } catch (e) {
      console.error('error screening', el, e);
    }

    if (isAd) {
      try {
        const data = await adEl.capture();
        adEl.markRecorded();
        console.log('Captured!', el, data.length);

        this.sendMessageToBackground('capturedAd', {
          adData: adEl.toApiJson(),
          imgData: data
        });
      } catch (e) {
        console.error('error capturing', el, e);
      }
    }

    return isAd;
  }

  async screenFrame(el: HTMLIFrameElement, topUrl: string) {

    const isAd = await this.screenElement(el, topUrl);

    // Propagate down the screen if it's an iframe
    if (!isAd) {
      console.log(this.id, 'decided it was not an ad', el);

      // const loadedState = el.readyState
      // $FlowIssue: contentWindow is valid
      const win: WindowProxy = el.contentWindow;
      this.notifyChildToScreen(win);
    } else {
      console.log(this.id, 'decided it was an ad', el);
    }
  }

  async handleIFrameMutation(el: Element) {
    // Cast
    const iframe = ((el: any): HTMLIFrameElement);

    // Register frame first
    try {
      console.log(this.id, 'going to register iframe', iframe);
      const registered = await this.registerChild(el);
      console.log(this.id, 'did register', iframe);
    } catch (e) {
      console.error(this.id, 'error registering iframe', el, e);
    }

    if (this.safeToScreen) {
      // If we're okay to screen, do it.
      try {
        console.log(this.id, 'going to screen iframe', iframe);
        await this.screenFrame(iframe, this.topUrl);
        console.log(this.id, 'did screen iframe', iframe);
      } catch (e) {
        console.error(this.id, 'error screening iframe', el, e);
      }
    } else {
      console.log(this.id, 'not ready to screen iframe', iframe);
    }
  }

  async handleElementMutation(el: Element) {
    try {
      const isAd = await this.screenElement(el, this.topUrl);
    } catch (e) {
      console.error(this.id, 'error screening', el);
    }
  }

  startFrameMutationObserver() {
    console.log(this.id, 'STARTING FRAME MUTATION');

    const observer = new MutationSummary({
      callback: (a: MutationElementResponse[]) => {
        console.log('GOT IFRAME MUTATION', a);

        const addedRes: MutationElementResponse = a[0];
        const changedRes: ?MutationElementResponse = a[0];
        // const handled: Set<Element> = new Set();

        // Start pinging new visible iframes
        for (const el of addedRes.added) {
          // handled.add(el);
          // TODO: can we skip some invisible elements here?
          this.handleIFrameMutation(el);
        }

        // Wait for past invisible iframes to be made visible
        // if (changedRes && changedRes.attributeChanged && changedRes.attributeChanged['display'] && changedRes.getOldAttribute) {
        //   for (const el of changedRes.attributeChanged['display']) {
        //     if (!handled.has(el) && $(el).is(':visible')) {
        //       console.log(this.id, el, 'was made a visible iframe');
        //       this.handleIFrameMutation(el);
        //     }
        //   }
        //   console.log('changed was indeed what we wanted', changedRes, a);
        // } else {
        //   console.log('changed was not what we wanted', changedRes, a);
        // }
      },

      // TODO: listen for changes that involve frames becoming visible
      queries: [{ element: ELEMENT_SELECTOR_FRAMES }]
    });
  }

  startElementMutationObserver() {
    console.log(this.id, 'STARTING ELEMENT MUTATION');
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
    console.log(this.id, 'STARTING SCREEN');

    const promises = [];
    const topUrl: string = this.doc.defaultView.location.href;

    const elems = $(ELEMENT_SELECTOR_NO_FRAMES);
    elems.toArray().map((el) => promises.push(this.screenElement(el, topUrl)));

    const frames = $(ELEMENT_SELECTOR_FRAMES);
    console.log(this.id, 'has child frames', frames.toArray());
    frames.toArray().map((el) => promises.push(this.screenFrame(el, topUrl)));

    return Promise.all(promises);
  }

  // registerWithParent(): Promise<boolean> {
  //   if (this.registeredWithParent) {
  //     return Promise.resolve(true);
  //   }
  //
  //   const payload: WindowRegistrationRequestPayload = { id: this.id };
  //   console.log('Registering', this.id, 'with parent', this.view.parent, 'for view', this.view);
  //
  //   return this.requestWindow(this.view.parent, 'registerWithParent', payload)
  //     .then((req: WindowRequest) => {
  //       if (req.error) throw new Error(req.error);
  //
  //       if (req.payload && req.payload.registered) {
  //         this.registeredWithParent = true;
  //         return true;
  //       } else {
  //         throw new FWError('Could not register with parent!');
  //       }
  //     });
  // }
  //
  // registerWithParentHandler(req: WindowRequest): Promise<WindowRegistrationResponsePayload> {
  //   // First, see if it's already registered
  //   const attr = `[data-fw-frame-id="${req.srcFrameId}"]`;
  //   const frame: JQuery = $(this.doc).find(`iframe${attr},frame${attr}`);
  //   if (frame.length > 0) {
  //     // You're already registered with that id.
  //     console.log(req.srcFrameId, 'already registered');
  //     return Promise.resolve({ registered: true });
  //   }
  //
  //   // Otherwise, try to find a frame that will verify the frameId
  //   const selector = 'iframe:not([data-fw-frame-id]),frame:not([data-fw-frame-id])';
  //   const promises = [];
  //   let verified = false;
  //   $(this.doc).find(selector).each((i: number, el: Element) => {
  //     // FlowIssue: chrome responds to contentWindow
  //     const win: WindowProxy = el.contentWindow;
  //     // console.log(this.id, 'sending ping to el', el);
  //     const p = this.ping(win)
  //       .then(function(pingResponse: WindowRequest) {
  //         if (pingResponse.srcFrameId === req.srcFrameId) {
  //           $(el).attr('data-fw-frame-id', req.srcFrameId);
  //           verified = true;
  //           return;
  //         }
  //         return new Promise(function(){});
  //       }).catch(function() { return new Promise(function(){}); });
  //     promises.push(p);
  //   });
  //
  //   return Promise.race(promises).then(function() { return { registered: verified } });
  // }

  async registerChild(el: Element): Promise<boolean> {

    // // FlowIssue: chrome responds to contentDocument
    // const doc: ?Document = el.contentDocument || win.document;
    //
    // let p = Promise.resolve();
    // if (!doc) {
    //   console.error('no document for', win);
    //   return;
    // }
    //
    // if (doc.readyState == 'loading') {
    //   console.error('readystate is loading for', win);
    //   p = pollUntil(function() {
    //     return doc.readyState == 'interactive' || doc.readyState == 'complete';
    //   }, 100, 5000);
    // }

    // FlowIssue: chrome responds to contentWindow
    // let win: WindowProxy = el.contentWindow;
    // // if (!win) {
    // //   console.log(this.id, 'waiting to load', el);
    // //   await new Promise(function(resolve) {
    // //     $(el).on('load', resolve);
    // //   });
    // //   console.log(this.id, 'got load of', el);
    // //
    // //   // FlowIssue: chrome responds to contentWindow
    // //   win = el.contentWindow;
    // // }
    //
    // if (!win) {
    //   console.error(el, 'did not get a window quickly');
    //   return false;
    // }
    //
    // let doc: Document = win.document;
    // if (!doc || !doc.readyState) {
    //   console.log(this.id, 'waiting for doc to load', el);
    //   await new Promise(function(resolve) {
    //     $(el).on('load', resolve);
    //   });
    //   doc = win.document;
    // }
    // if (!doc) {
    //   console.error(el, 'did not get a document quickly');
    //   return false;
    // }
    //
    // console.log(this.id, 'ready to ping', el, win, doc, doc.readyState);

    let lastError, overallError;
    let childFrameId = null;
    let i = 0;

    try {
      const registered = await tryRepeat(async () => {
        ++i;

        // $FlowIssue: chrome responds to contentWindow
        let win: WindowProxy = el.contentWindow;
        if (!win) {
          return false;
        }

        if ($(el).attr('data-fw-frame-id')) {
          console.log(this.id, 'DONE REGISTERING (back)', win, i);
          return Promise.resolve(true);
        }

        try {
          console.log(this.id, 'trying to ping', el, win);
          const pingResponse: WindowRequest = await this.ping(win, { timeout: 10000 });
          childFrameId = pingResponse.srcFrameId;

          console.log(this.id, 'setting id')
          $(el).attr('data-fw-frame-id', childFrameId);
          console.log(this.id, 'has child', win, 'with id', pingResponse.srcFrameId);

          console.log(this.id, 'DONE REGISTERING', el, i);
          return true;
        } catch (e) {
          lastError = e;
        }
      }, 5, 1000);

      if (registered) {
        // $FlowIssue: chrome responds to contentWindow
        let win: WindowProxy = el.contentWindow;
        console.log(this.id, 'setting registered', el, childFrameId);
        await this.setRegistered(win);
        console.log(this.id, 'done setting registered', el, childFrameId);
        return true;
      }
    } catch (e) {
      overallError = e;
    }

    console.error(this.id, 'could not register', el, lastError, overallError, i);
    return false;
  }

  registerChildren(): Promise<boolean[]> {
    const selector = 'iframe:not([data-fw-frame-id]),frame:not([data-fw-frame-id])';

    const promises = [];
    $(this.doc).find(selector).each((i: number, el: Element) => {
      const p = this.registerChild(el);
      promises.push(p);
    });

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
    // console.log(this.id, 'sending ping to win', win);
    return this.requestWindow(win, 'ping', { ping: true }, options);
  }

  pingHandler(req: WindowRequest): Promise<PingResponsePayload> {
    // console.log(this.id, 'sending pong for req', req.requestId);
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

  areChildrenDoneLoading(el: HTMLIFrameElement, options: WindowRequestOptions = {}): Promise<WindowRequest> {
    if (!$(el).data('fw-frame-id')) {
      return Promise.reject('IFrame not registered.');
    }

    console.log(this.id, 'finding out if', el, 'has loaded children');
    console.log(this.id, $(el).html());

    // $FlowIssue: contentWindow is valid
    const win: WindowProxy = el.contentWindow;
    return this.requestWindow(win, 'childrenDoneLoading', {}, options);
  }

  async areChildrenDoneLoadingHandler(req: WindowRequest): Promise<ChildrenDoneLoadingResponsePayload> {
    const children: HTMLIFrameElement[] = $(ELEMENT_SELECTOR_FRAMES).toArray();

    console.log(this.id, 'going to wait for', children, 'to load');

    // Block until all the frames are loaded
    const accessible = await Promise.all(children.map(c => ensureFrameLoaded(c)));
    const crossOriginChildren = children.filter((c, i) => !accessible[i]);

    console.log(this.id, 'going to try to ping', crossOriginChildren);

    const crossOriginPromises = crossOriginChildren
      .map(c => {
        // $FlowIssue: contentwindow1!!!
        return this.ping(c.contentWindow)
          .catch(() => { console.error(this.id, 'error pinging', c)})
          .then(() => { console.log(this.id, 'success pinging', c)})
      });

    await Promise.all(crossOriginPromises);

    // Only ping registered children
    const registered = children.filter(el => $(el).data('fw-frame-id') != null);

    console.log(this.id, 'has children with attrs',
      children,
      children.map(c => $(c).data('fw-frame-id')),
      children.map(c => c.outerHTML),
      children.map(c => c.innerHTML)
    )

    console.log(this.id, 'going to ping registered children', registered);

    // Wait for children to respond to ping
    await Promise.all(registered.map(c => this.areChildrenDoneLoading(c)));

    console.log(this.id, 'all done with registered children', registered);

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
    let resolve: Function = function(){}, reject: Function = function(){};
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

    if (!win || !win.postMessage) {
      console.error('doomed', this.id, 'sending req', req, 'to', win);
    }
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

    console.log(this.id, 'sending res', res, 'to', win);
    win.postMessage(res, '*');
  }

  onWindowMessage(event: MessageEvent): void {
    if (!event.data) return;
    if (!event.data.source || event.data.source != 'floodwatch') return;

    console.log(this.id, this.doc, 'got FW windowMessage', event);

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
      'childrenDoneLoading': this.areChildrenDoneLoadingHandler
    };

    if (!handlers[request.type]) {
      console.error(`No handler for request type ${request.type}`, request);
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
      console.error('No callbacks for requestId', response.requestId);
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
