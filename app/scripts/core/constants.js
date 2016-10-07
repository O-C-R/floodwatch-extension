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

export const CAPTURE_THRESHOLD = { ratio: 0.5, area: 16 };
