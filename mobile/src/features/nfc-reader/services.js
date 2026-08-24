// mobile/features/nfc-reader/services.js — reads passive NFC UIDs using the
// Web NFC API (Android Chrome only; must be served over HTTPS or localhost —
// on a LAN this typically needs a self-signed cert or Chrome's local-network flag).
async function startNfcScan(onTagRead, onError) {
  if (!('NDEFReader' in window)) {
    onError('Web NFC is not supported on this device/browser. Use Chrome on Android.');
    return null;
  }

  try {
    const reader = new window.NDEFReader();
    await reader.scan();
    reader.onreading = (event) => {
      // event.serialNumber is the tag UID, e.g. "04:a2:1e:.."
      onTagRead(event.serialNumber);
    };
    reader.onreadingerror = () => onError('Could not read tag. Try again.');
    return reader;
  } catch (err) {
    onError('NFC permission denied or unavailable: ' + err.message);
    return null;
  }
}

export { startNfcScan };
