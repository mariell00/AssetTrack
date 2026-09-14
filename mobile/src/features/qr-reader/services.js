// mobile/features/qr-reader/services.js — reads asset QR codes using the
// phone's rear camera. Uses the native BarcodeDetector API where the browser
// supports it (fast, no download); falls back to the jsQR decoder (loaded
// on demand from esm.sh) on browsers that don't implement BarcodeDetector
// yet, e.g. iOS Safari. Unlike Web NFC, this works in any modern mobile
// browser and needs no special hardware, so staff aren't locked to Chrome
// on Android.

async function getDetector() {
  if ('BarcodeDetector' in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (formats.includes('qr_code')) {
        return new window.BarcodeDetector({ formats: ['qr_code'] });
      }
    } catch (_) {
      // fall through to the jsQR fallback below
    }
  }

  const { default: jsQR } = await import('https://esm.sh/jsqr@1.4.0');
  return {
    async detect(canvas) {
      const ctx = canvas.getContext('2d');
      const { width, height } = canvas;
      const imageData = ctx.getImageData(0, 0, width, height);
      const code = jsQR(imageData.data, width, height);
      return code ? [{ rawValue: code.data }] : [];
    }
  };
}

async function startQrScan(videoEl, onCodeRead, onError) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    onError('Camera access needs a secure (https://) connection. Open this app using the https tunnel link from QR Distribution on the Admin Hub, not a plain http:// address.');
    return null;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
  } catch (err) {
    onError('Camera permission denied or unavailable: ' + err.message);
    return null;
  }

  videoEl.srcObject = stream;
  await videoEl.play();

  let detector;
  try {
    detector = await getDetector();
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    onError('Could not load the QR decoder: ' + err.message);
    return null;
  }

  const canvas = document.createElement('canvas');
  let stopped = false;
  let lastValue = null;
  let lastReadAt = 0;

  async function tick() {
    if (stopped) return;
    if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      canvas.getContext('2d').drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      try {
        const codes = await detector.detect(canvas);
        if (codes.length > 0) {
          const value = codes[0].rawValue;
          const now = Date.now();
          if (value !== lastValue || now - lastReadAt > 2000) {
            lastValue = value;
            lastReadAt = now;
            onCodeRead(value);
          }
        }
      } catch (_) {
        // Bad frame — just try again next tick.
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return {
    stop() {
      stopped = true;
      stream.getTracks().forEach((t) => t.stop());
    }
  };
}

export { startQrScan };
