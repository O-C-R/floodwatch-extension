// @flow

export type MediaType = 'image' | 'media' | 'subdocument' | 'object';
export type CaptureType = 'image' | 'screenshot';

export type ApiAd = {
  localId: string;
  topUrl: string;
  adUrls: string[];
  mediaType: MediaType;
  html?: string;
};

export type ApiCapture = {
  image: string;
  captureType: CaptureType;
}

export type ApiAdPayload = {
  ad: ApiAd;
  capture: ApiCapture;
};
