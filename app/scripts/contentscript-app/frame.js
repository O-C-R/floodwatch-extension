// @flow

// import * as _ from 'lodash';
import $ from 'jquery';
import MutationSummary from 'mutation-summary';

import {AdElement} from './ad';
import {capture} from './capture';

import {ELEMENT_SELECTOR} from '../core/constants';
import {FWError, promiseTimeout, generateUUID} from '../core/util';

type MutationElementResponse = {
  added: Array<Element>;
  removed: Array<Element>;
  reparented: Array<Element>;
};

type WindowRequestType = 'registerWithParent' | 'ping';

export type WindowRequest = {
  source: 'floodwatch';
  requestId: string;
  srcFrameId: string;
  isRequest: boolean;
  type: WindowRequestType;
  payload?: WindowRequestPayload | WindowResponsePayload;
  error?: any;
}

export type WindowRegistrationRequestPayload = {
  id: string;
}

export type WindowRegistrationResponsePayload = {
  registered: boolean;
}

export type PingRequestPayload = {
  ping: true;
}

export type PingResponsePayload = {
  pong: true;
}

type WindowRequestPayload = WindowRegistrationRequestPayload | PingRequestPayload;
type WindowResponsePayload = WindowRegistrationResponsePayload | PingResponsePayload;

type WindowRequestOptions = {
  timeout?: number;
};

export class Frame {
  id: string;

  view: WindowProxy;
  doc: Document;

  isTop: boolean;

  registeredWithParent: boolean;
  registeredWithExtension: boolean;

  requestCallbacks: { [key: string]: { resolve: Function, reject: Function } };

  constructor(doc: Document) {
    this.id = generateUUID();

    this.view = doc.defaultView;
    this.doc = doc;

    this.isTop = this.view.isTop || false;

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

  register(): Promise<boolean> {
    if (this.isTop) {
      return Promise.resolve(true);
    }

    return this.registerWithParent();
  }

  async _doScreen(el: Element, topUrl: string): Promise<void> {
    try {
      const $el = $(el);
      const adEl: AdElement = new AdElement($el, topUrl);
      // console.log('Screening ad', adEl);
      const isAd = await adEl.screen();
      if (isAd) {
        const data = await capture(this, $el, {});
        adEl.markRecorded();
        console.log('Captured!', el, data.length);
      }
      // console.log(adEl, 'is an ad:', isAd);
    } catch (e) {
      console.error('error screening', el, e);
    }
  }

  handleMutations(mutationResponse: MutationElementResponse) {
    const topUrl: string = this.doc.defaultView.location.href;
    for (const elem of mutationResponse.added) {
      this._doScreen(elem, topUrl);
    }
  }

  screenAll(): Promise<void> {
    console.log('STARTING SCREEN', this.id);

    const observer = new MutationSummary({
      callback: (a) => this.handleMutations(a[0]),
      queries: [{ element: ELEMENT_SELECTOR }]
    });

    const topUrl: string = this.doc.defaultView.location.href;
    const elems = $(ELEMENT_SELECTOR);
    elems.each((i, el) => this._doScreen(el, topUrl));

    return Promise.resolve();
  }

  registerWithParent(): Promise<boolean> {
    if (this.registeredWithParent) {
      return Promise.resolve(true);
    }

    const payload: WindowRegistrationRequestPayload = { id: this.id };
    console.log('Registering', this.id, 'with parent', this.view.parent, 'for view', this.view);

    return this.requestWindow(this.view.parent, 'registerWithParent', payload)
      .then((req: WindowRequest) => {
        if (req.error) throw new Error(req.error);

        if (req.payload && req.payload.registered) {
          this.registeredWithParent = true;
          return true;
        } else {
          throw new FWError('Could not register with parent!');
        }
      });
  }

  registerWithParentHandler(req: WindowRequest): Promise<WindowRegistrationResponsePayload> {
    // First, see if it's already registered
    const attr = `[data-fw-frame-id="${req.srcFrameId}"]`;
    const frame: JQuery = $(this.doc).find(`iframe${attr},frame${attr}`);
    if (frame.length > 0) {
      // You're already registered with that id.
      console.log(req.srcFrameId, 'already registered');
      return Promise.resolve({ registered: true });
    }

    // Otherwise, try to find a frame that will verify the frameId
    const selector = 'iframe:not([data-fw-frame-id]),frame:not([data-fw-frame-id])';
    const promises = [];
    let verified = false;
    $(this.doc).find(selector).each((i: number, el: Element) => {
      // $FlowIssue: chrome responds to contentWindow
      const win: WindowProxy = el.contentWindow;
      console.log(this.id, 'sending ping to el', el);
      const p = this.ping(win)
        .then(function(pingResponse: WindowRequest) {
          if (pingResponse.srcFrameId === req.srcFrameId) {
            $(el).attr('data-fw-frame-id', req.srcFrameId);
            verified = true;
            return;
          }
          return new Promise(function(){});
        }).catch(function() { return new Promise(function(){}); });
      promises.push(p);
    });

    return Promise.race(promises).then(function() { return { registered: verified } });
  }

  ping(win: WindowProxy, options: WindowRequestOptions = {}): Promise<WindowRequest> {
    console.log(this.id, 'sending ping to win', win);
    return this.requestWindow(win, 'ping', { ping: true }, options);
  }

  pingHandler(req: WindowRequest): Promise<PingResponsePayload> {
    console.log(this.id, 'sending pong for req', req.requestId);
    return Promise.resolve({ pong: true });
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

    console.log(this.id, 'sending req', req, 'to', win);
    win.postMessage(req, '*');

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

    console.log(this.id, 'got FW windowMessage', event);

    const message: WindowRequest = ((event.data: any): WindowRequest);
    if (message.isRequest) {
      this.onRequestMessage(event, message);
    } else if (message.type) {
      this.onResponseMessage(event, message);
    }
  }

  onRequestMessage(event: MessageEvent, request: WindowRequest) {
    const handlers: { [key: WindowRequestType]: (r: WindowRequest) => Promise<WindowResponsePayload> } = {
      'registerWithParent': this.registerWithParentHandler,
      'ping': this.pingHandler
    };

    if (!handlers[request.type]) {
      console.log(`No handler for request type ${request.type}`, request);
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
      console.log('No callbacks for requestId', response.requestId);
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
}
