// Cloudflare Turnstile bot check on the sign-in, sign-up and forgot-password forms.
// Each page loads https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit
// (async defer) itself. Supabase only checks the token once CAPTCHA is enabled in its dashboard.
// TODO: replace with the real site key. This is Cloudflare's always-pass test key.
const SITE_KEY = '1x00000000000000000000AA';

export const CAPTCHA_ERROR = 'Please complete the security check and try again.';

// Renders the widget into `el` and keeps `button` disabled until it has a token.
// Tokens are single-use: call reset() after every failed submit.
export function captcha(el, button) {
  let token = '';
  let widgetId;
  button.disabled = true;

  const set = t => { token = t; button.disabled = !t; };
  const render = () => {
    widgetId = window.turnstile.render(el, {
      sitekey: SITE_KEY,
      theme: 'dark',
      size: 'flexible',
      callback: set,
      'expired-callback': () => set(''),
      'error-callback': () => set(''),
    });
  };

  if (window.turnstile) render();
  else document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]').addEventListener('load', render);

  return {
    token: () => token,
    reset() {
      set('');
      if (widgetId !== undefined) window.turnstile.reset(widgetId);
    },
  };
}
