// mobile/src/core/photo.js — turns a File from a camera/gallery <input>
// into a small base64 JPEG data URL, resized client-side before it's ever
// sent. Raw phone camera photos can be several MB; the desktop host's JSON
// body limit is 10mb (main.js) and every asset's photo rides along in the
// same buildings-map payload the Cluster Map screen re-fetches on every
// load (mapping/services.js buildingsForMap), so keeping each photo small
// matters a lot more here than on a one-off upload.
const MAX_DIMENSION = 800; // px, longest side
const JPEG_QUALITY = 0.7;

function compressImageFile(file, { maxDimension = MAX_DIMENSION, quality = JPEG_QUALITY } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width > height && width > maxDimension) {
        height = Math.round((height * maxDimension) / width);
        width = maxDimension;
      } else if (height > maxDimension) {
        width = Math.round((width * maxDimension) / height);
        height = maxDimension;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not read that image.'));
    };
    img.src = objectUrl;
  });
}

export { compressImageFile };
