// @flow

import log from 'loglevel';
import type {ApiAdPayload} from '../core/types';

const NUM_ADS_PER_BATCH = 10;

export type AdResponse = {
  ads: Array<{
    localId: string;
    id?: string;
    category?: string;
    error?: string;
  }>;
};

export class APIClient {
  baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async postJSON(path: string, body?: Object): Promise<any> {
    const url = new URL(path, this.baseUrl);

    log.info('POST', path, body);
    const res = await fetch(url.toString(), {
      method: 'POST',
      body: body
    });
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
    const res = await fetch(url.toString(), { method: 'GET' });
    return res.json();
  }
}

export class FWApiClient extends APIClient {
  adQueue: ApiAdPayload[];

  constructor(baseUrl: string) {
    super(baseUrl);

    this.adQueue = [];
  }

  addAd(ad: ApiAdPayload) {
    this.adQueue.push(ad);
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

  async login(username: string, password: string): Promise<boolean> {
    try {
      // response has no content, so any non-error means success
      await this.postJSON('/api/login', { username, password });
      return true;
    } catch (e) {
      console.error('Error logging in:', e);
      return false;
    }
  }

  logout(): Promise<void> {
    return this.postJSON('/api/logout');
  }
}
