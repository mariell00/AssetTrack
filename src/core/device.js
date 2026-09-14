// core/device.js — turns a raw User-Agent header into a short, human
// readable device label ("iPhone", "Android — Pixel 7", "Windows PC") so
// the Admin Hub's Manage Users and Mobile Check-in Log screens can show
// what phone/computer someone actually logged in or scanned from, instead
// of just a bare "mobile"/"desktop" tag.
function simplifyUserAgent(ua) {
  if (!ua) return null;
  if (/ipad/i.test(ua)) return 'iPad';
  if (/iphone/i.test(ua)) return 'iPhone';
  if (/android/i.test(ua)) {
    const m = ua.match(/;\s*([^;)]+?)\s*(?:Build\/|\))/);
    const model = m ? m[1].trim() : null;
    return model && model.toLowerCase() !== 'android' ? `Android — ${model}` : 'Android';
  }
  if (/windows/i.test(ua)) return 'Windows PC';
  if (/macintosh|mac os x/i.test(ua)) return 'Mac';
  if (/linux/i.test(ua)) return 'Linux PC';
  return null;
}

module.exports = { simplifyUserAgent };
