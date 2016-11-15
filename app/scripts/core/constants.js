// @flow

export const TYPE_MAP = {
  'img':      'image',
  'input':    'image',
  'picture':  'image',
  'audio':    'media',
  'video':    'media',
  'frame':    'subdocument',
  'iframe':   'subdocument',
  'object':   'object',
  'embed':    'object',
  'style':    'stylesheet',
  'script':   'script'
};

// export const ELEMENT_SELECTOR = Object.keys(TYPE_MAP).join(',');
export const ELEMENT_SELECTOR = ['img', 'picture', 'audio', 'video', 'frame', 'iframe', 'object', 'embed'].join(',');
export const ELEMENT_SELECTOR_FRAMES = ['frame', 'iframe'].join(',');
export const ELEMENT_SELECTOR_NO_FRAMES = ['img', 'object', 'embed'].join(',');

export const CAPTURE_ERROR_MARGIN_PX = 4;
export const CAPTURE_THRESHOLD = { ratio: 0.5, area: 512 };
export const MIN_ELEM_AREA = 4;

export const SCROLL_WAIT_TIME = 50;
export const FRAME_LOAD_WAIT_TIME = 200;

export const FORCE_AD_SEND_TIMEOUT = 5000;

export const ABP_FILTER_RELOAD_TIME_MINUTES = 60 * 24; // 1 day
export const ABP_FILTER_RETRY_DELAY_MS = 5 * 60 * 1000; // 5 minutes

export const FW_API_HOST = 'http://floodwatch.me';
