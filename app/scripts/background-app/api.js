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

export class APIClient {
  baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async post(path: string, body?: Object): Promise<any> {
    const url = new URL(path, this.baseUrl);
    const data = new FormData();

    if (body) {
      for (const key in body) {
        data.append(key, body[key]);
      }
    }

    log.info('POST', path, body, data);

    let res;
    try {
      res = await fetch(url.toString(), {
        method: 'POST',
        credentials: 'include',
        body: data
      });
    } catch (e) {
      console.error('Error POSTing', url.toString(), e);
      throw new FWError('HTTP error');
    }

    if (!res.ok) {
      console.error('Error POSTing', url.toString(), await res.text());
      throw new FWError('HTTP error');
    }

    return res.text();
  }

  async postJSON(path: string, body?: Object): Promise<any> {
    const url = new URL(path, this.baseUrl);

    log.info('POST JSON', path, body);

    let res;
    try {
      res = await fetch(url.toString(), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
    } catch (e) {
      console.error('Error POSTing', url.toString(), e);
      throw new FWError('HTTP error');
    }

    if (!res.ok) {
      console.error('Error POSTing', url.toString(), await res.text());
      throw new FWError('HTTP error');
    }

    return res.json();
  }

  async getJSON(path: string, params?: Object): Promise<any> {
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
      console.error('Error GETing', url.toString(), e);
      throw new FWError('HTTP error');
    }

    if (!res.ok) {
      console.error('Error GETing', url.toString(), await res.text());
      throw new FWError('HTTP error');
    }

    return res.json();
  }
}

let fwApiClient: ?FWApiClient = null;
export class FWApiClient extends APIClient {
  username: ?string;
  adQueue: ApiAdPayload[];

  constructor(baseUrl: string) {
    super(baseUrl);

    this.username = null;
    this.adQueue = [];
  }

  static get(): FWApiClient {
    if (!fwApiClient) {
      fwApiClient = new FWApiClient(FW_API_HOST);
    }

    return fwApiClient;
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

    return this.postJSON('/api/ads', { ads: adSlice });
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
      await this.post('/api/login', { username, password });
      await this.getCurrentPerson();
    } catch (e) {
      console.error('Error logging in:', e);
      this.username = null;
      throw e;
    }
  }

  async logout(): Promise<void> {
    await this.post('/api/logout');
    this.username = null;
  }
}
