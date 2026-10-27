// Cloudflare Turnstile bot check on the sign-in, sign-up and forgot-password forms.
// Each page loads https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit
// (async defer) itself. Supabase only checks the token once CAPTCHA is enabled in its dashboard.
const SITE_KEY = '0x4AAAAAAFotJ5YkanHz0_4i';

export const CAPTCHA_WAIT = 'Please wait for the security check to finish.';

// Renders the widget into `el`; token() is '' until the check has finished.
// Tokens are single-use: call reset() after every submit, success or error.
export function captcha(el) {
  let token = '';
  let widgetId;

  const set = t => { token = t; };
  const render = () => {
    widgetId = window.turnstile.render(el, {
      sitekey: SITE_KEY,
      theme: 'dark',
      size: el.clientWidth < 300 ? 'compact' : 'flexible',
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
