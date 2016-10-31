// @flow

export type ApiAd = {
  timestamp: string;
  topUrl: string;
  htmlHash: string;
  imageData: ?string;
};

const NUM_ADS_PER_BATCH = 10;

export class APIClient {
  baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  postJSON(path: string, body?: Object): Promise<any> {
    const url = new URL(path, this.baseUrl);

    return fetch(url.toString(), {
      method: 'GET',
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

    return fetch(url.toString(), {
      method: 'GET'
    }).then((body) => body.json());
  }
}

export class FWApiClient extends APIClient {
  adQueue: ApiAd[];

  constructor(baseUrl: string) {
    super(baseUrl);

    this.adQueue = [];
  }

  addAd(ad: ApiAd) {
    this.adQueue.push(ad);
  }

  async sendAds(force: boolean = false): Promise<boolean> {
    if (this.adQueue.length < NUM_ADS_PER_BATCH && !force) {
      return false;
    }

    const adSlice = this.adQueue.slice(0, NUM_ADS_PER_BATCH);
    this.adQueue = this.adQueue.slice(NUM_ADS_PER_BATCH);

    const payload = {
      ads: adSlice
    };

    // TODO: actually send the ads
    console.log(JSON.stringify(payload));

    return true;
  }
}
