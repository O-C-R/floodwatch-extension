// @flow

import log from 'loglevel';

import type {ApiAdPayload} from '../core/types';
import {FWError} from '../core/util';
import {FW_API_HOST} from '../core/constants';

const NUM_ADS_PER_BATCH = 10;

export type AdResponse = {
  ads: Array<{
    localId: string;
    id?: string;
    category?: string;
    error?: string;
  }>;
};

export type PersonResponse = {
  username: string;
}

export class FWAuthenticationError extends FWError { constructor(m: string = 'AuthenticationError') { super(m); } }

export class APIClient {
  baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async post(path: string, body?: FormData | string): Promise<Response> {
    const url = new URL(path, this.baseUrl);

    log.info('POST', path, body, body);

    let res;
    try {
      res = await fetch(url.toString(), {
        method: 'POST',
        credentials: 'include',
        body
      });
    } catch (e) {
      log.error(e);
      log.error('Threw while POSTing', url.toString());
      throw new FWError('HTTP error');
    }

    if (res.status == 401) {
      log.error('Bad auth while POSTing', url.toString(), await res.text());
      throw new FWAuthenticationError();
    } else if (!res.ok) {
      log.error('Non-OK response while POSTing', url.toString(), await res.text());
      throw new FWError('HTTP error');
    }

    return res;
  }

  async get(path: string, params?: Object): Promise<Response> {
    const url = new URL(path, this.baseUrl);

    if (params) {
      for (const key in params) {
        url.searchParams.set(key, params[key]);
      }
    }

    log.info('GET', path, params);

    let res;
    try {
      res = await fetch(url.toString(), {
        method: 'GET',
        credentials: 'include'
      });
    } catch (e) {
      log.error(e);
      log.error('Threw while GETing', url.toString());
      throw new FWError('HTTP error');
    }

    if (res.status == 401) {
      log.error('Bad auth while GETing', url.toString(), await res.text());
      throw new FWAuthenticationError();
    } else if (!res.ok) {
      log.error('Non-OK response while GETing', url.toString(), await res.text());
      throw new FWError('HTTP error');
    }

    return res;
  }

  async postForm(path: string, body?: Object): Promise<string> {
    const data = new FormData();

    if (body) {
      for (const key in body) {
        data.append(key, body[key]);
      }
    }

    const res = await this.post(path, data);
    return res.text();
  }

  async postJSON(path: string, body?: Object): Promise<any> {
    const res = await this.post(path, JSON.stringify(body));
    return res.json();
  }

  async getText(path: string, params?: Object): Promise<string> {
    const res = await this.get(path, params);
    return res.text();
  }

  async getJSON(path: string, params?: Object): Promise<any> {
    const res = await this.get(path, params);
    return res.json();
  }
}

let fwApiClient: ?FWApiClient = null;
export class FWApiClient extends APIClient {
  username: ?string;
  adQueue: ApiAdPayload[];
  unauthorizedHandler: () => void;

  constructor(baseUrl: string, unauthorizedHandler: () => void) {
    super(baseUrl);

    this.username = null;
    this.adQueue = [];
    this.unauthorizedHandler = unauthorizedHandler;
  }

  onAuthError(e: FWAuthenticationError) {
    if (this.username != null) {
      this.unauthorizedHandler();
      this.username = null;
    }
  }

  async post(path: string, body?: FormData | string): Promise<any> {
    try {
      return super.post(path, body);
    } catch (e) {
      if (e instanceof FWAuthenticationError) {
        this.onAuthError(e);
      }

      throw e;
    }
  }

  async get(path: string, params?: Object): Promise<any> {
    try {
      return super.get(path, params);
    } catch (e) {
      if (e instanceof FWAuthenticationError) {
        this.onAuthError(e);
      }

      throw e;
    }
  }

  addAd(ad: ApiAdPayload) {
    if (this.username) {
      this.adQueue.push(ad);
    }
  }

  async sendAds(force: boolean = false): Promise<?AdResponse> {
    if (this.adQueue.length < NUM_ADS_PER_BATCH && !force) {
      return null;
    }

    const adSlice = this.adQueue.slice(0, NUM_ADS_PER_BATCH);
    this.adQueue = this.adQueue.slice(NUM_ADS_PER_BATCH);

    // Simulate empty for an empty set, we're done.
    if (adSlice.length == 0) {
      return { ads: [] };
    }

    try {
      return this.postJSON('/api/ads', { ads: adSlice });
    } catch (e) {
      if (e instanceof FWAuthenticationError) {
        this.username = null;
      }

      throw e;
    }
  }

  // TODO: implement when the server implements it
  // getAdStatus(adIds: string[]): Promise<AdResponse> {
  //   return this.postJSON('/api/ads/status', { adIds });
  // }

  async getCurrentPerson(): Promise<PersonResponse> {
    try {
      // response has no content, so any non-error means success
      const res: PersonResponse = await this.getJSON('/api/person/current');
      this.username = res.username;
      return res;
    } catch (e) {
      this.username = null;
      throw e;
    }
  }

  async login(username: string, password: string): Promise<void> {
    try {
      // response has no content, so any non-error means success
      await this.postForm('/api/login', { username, password });
      await this.getCurrentPerson();
    } catch (e) {
      log.error('Error logging in:', e);
      this.username = null;
      throw e;
    }
  }

  async logout(): Promise<void> {
    await this.postForm('/api/logout');
    this.username = null;
  }
}
