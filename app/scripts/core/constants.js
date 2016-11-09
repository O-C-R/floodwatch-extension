// @flow

export const TYPE_MAP = {
  'img':      'IMAGE',
  'input':    'IMAGE',
  'picture':  'IMAGE',
  'audio':    'MEDIA',
  'video':    'MEDIA',
  'frame':    'SUBDOCUMENT',
  'iframe':   'SUBDOCUMENT',
  'object':   'OBJECT',
  'embed':    'OBJECT',
  'style':    'STYLESHEET',
  'script':   'SCRIPT'
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
