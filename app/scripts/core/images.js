// @flow

import $ from 'jquery';

export async function serializeImageElement(
  img: HTMLImageElement,
  area: { top: number, left: number, width: number, height: number }
    = { top: 0, left: 0, width: $(img).width(), height: $(img).height() }
): Promise<string> {
  let data: ?string = null;
  let err: ?Error = null;

  try {
    const canvas: HTMLCanvasElement = document.createElement('canvas');
    canvas.width = area.width;
    canvas.height = area.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Problem creating canvas.');

    ctx.drawImage(img, area.left, area.top, area.width, area.height, 0, 0, area.width, area.height);
    data = await serializeCanvasElement(canvas);

    const image = new Image();
    image.src = data;
    document.body.appendChild(image);
  } catch (e) {
    err = e;
  }

  if (!data || err) {
    try {
      const src = $(img).prop('src');
      data = await fetchImageData(src);
    } catch (e) {
      err = e;
    }
  }

  if (!data) {
    if (err) {
      throw err;
    } else {
      return '';
    }
  }

  return data;
}

export function serializeCanvasElement(canvas: HTMLCanvasElement): Promise<string> {
  try {
    const dataUrl = canvas.toDataURL('image/png');
    if (dataUrl) {
      return Promise.resolve(dataUrl);
    } else {
      throw new Error('No data!');
    }
  } catch (e) { // cross-origin error
    return Promise.reject(e);
  }
}

export async function fetchImageData(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Bad network response!');
  }

  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = function() {
      URL.revokeObjectURL(blobUrl);

      const canvas: HTMLCanvasElement = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return reject(new Error('Problem creating canvas.'));
      }

      ctx.drawImage(img, 0, 0);
      resolve(serializeCanvasElement(canvas));
    }
    img.src = blobUrl;
  });
}
