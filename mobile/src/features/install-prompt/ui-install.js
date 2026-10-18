// mobile/features/install-prompt/ui-install.js — one-time landing screen
// shown the first time this PWA is opened in a normal browser tab, letting
// staff choose between installing it (adds a home-screen icon, opens
// full-screen like a native app) or just continuing to use it as a regular
// browser tab. Skips itself automatically once already installed/running
// standalone, or after the choice has been made once on this device — this
// replaces the old "download the .zip" flow on the Admin Hub, since the
// actual install has to happen on the phone's own browser anyway.
const STORAGE_KEY = 'assettrack_install_choice_made';

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function alreadyChosen() {
  return localStorage.getItem(STORAGE_KEY) === '1';
}

function markChosen() {
  localStorage.setItem(STORAGE_KEY, '1');
}

function shouldShowInstallChoice() {
  return !isStandalone() && !alreadyChosen();
}

// `getDeferredPrompt` is a () => BeforeInstallPromptEvent|null getter — the
// event has to be captured at the very top of app.js, before this screen
// even renders, because the browser only fires 'beforeinstallprompt' once,
// early in the page's life, and there's no way to ask for it again later
// on demand.
function renderInstallChoice(getDeferredPrompt, onContinue) {
  const el = document.createElement('div');
  el.className = 'm-screen m-install-choice';

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

  el.innerHTML = `
    <div class="m-panel">
      <div class="m-header">GET ASSETTRACK SCANNER</div>
      <p class="m-status">
        Install it once for a full-screen app icon on your home screen, or just continue in the browser —
        both work identically, this only changes how you launch it next time.
      </p>
      <button class="m-btn" id="m-install-btn">⬇ INSTALL APP</button>
      <button class="m-btn m-btn-secondary" id="m-continue-btn">🌐 CONTINUE IN BROWSER</button>
      <p id="m-install-note" class="m-status" style="display:none; margin-top: 12px;"></p>
    </div>
  `;

  el.querySelector('#m-continue-btn').addEventListener('click', () => {
    markChosen();
    onContinue();
  });

  el.querySelector('#m-install-btn').addEventListener('click', async () => {
    const deferredPrompt = getDeferredPrompt();
    const note = el.querySelector('#m-install-note');

    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      markChosen();
      onContinue();
      return;
    }

    if (isIos) {
      note.style.display = 'block';
      note.innerHTML = 'On iPhone/iPad: tap the <strong>Share</strong> icon in Safari\'s toolbar, then <strong>"Add to Home Screen."</strong> Come back to this tab afterward, or just continue below.';
      return;
    }

    markChosen();
    onContinue();
  });

  return el;
}

export { shouldShowInstallChoice, renderInstallChoice, markChosen };
