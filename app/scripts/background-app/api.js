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

  postJSON(path: string, body?: Object): Promise<any> {
    const url = new URL(path, this.baseUrl);

    log.info('POST', path, body);
    return fetch(url.toString(), {
      method: 'POST',
      body: body
    }).then((body) => body.json());
  }

  getJSON(path: string, params?: Object): Promise<any> {
    const url = new URL(path, this.baseUrl);

    if (params) {
      for (const key in params) {
        url.searchParams.set(key, params[key]);
      }
    }

    log.info('GET', path, params);
    return fetch(url.toString(), {
      method: 'GET'
    }).then((body) => body.json());
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

    if (adSlice.length == 0) {
      return null;
    }

    const payload = {
      ads: adSlice
    };
    console.log(JSON.stringify(payload));

    return this.postJSON('/api/ads', payload);
  }

  getAdStatus(adIds: string[]): Promise<AdResponse> {
    return this.postJSON('/api/ads/status', { adIds });
  }
}
