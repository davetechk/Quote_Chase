# QuoteChase security hardening — 22 Oct 2026

Tested in Chrome on `http://localhost:5173` (`npx serve`). Nothing was deployed and Supabase
was not touched.

## 1. Security headers (`vercel.json`, commit `ce4fcdb`)

These go on every route (`/(.*)`). The existing cache headers are unchanged.

| Header | Value |
|---|---|
| Strict-Transport-Security | `max-age=63072000; includeSubDomains; preload` |
| X-Content-Type-Options | `nosniff` |
| X-Frame-Options | `DENY` |
| Referrer-Policy | `strict-origin-when-cross-origin` |
| Permissions-Policy | `camera=(), microphone=(), geolocation=(), payment=()` |
| Content-Security-Policy | as specified (see below) |

**CSP sources:**
- **Scripts:** self, inline, Google Tag Manager, Cloudflare challenges.
- **Styles:** self, inline, Google Fonts.
- **Fonts:** gstatic.
- **Images:** self, `data:`, Google Analytics, Google Tag Manager.
- **Connections:** the Supabase project (https + wss) and Google Analytics.
- **Frames:** Cloudflare challenges only.
- **Other directives:** `frame-ancestors 'none'`, `base-uri 'self'`, `object-src 'none'`, `upgrade-insecure-requests`.

**Dodo origin:** `checkoutUrl()` in `js/dashboard.js` uses `https://checkout.dodopayments.com`,
so `form-action` lists exactly that, not the test host. The checkout buttons are links, not
forms, so CSP doesn't restrict them either way.

### How the CSP was tested

`npx serve` ignores `vercel.json`. So the same policy went into each page temporarily, as a
`<meta http-equiv="Content-Security-Policy">` tag, together with an inline
`securitypolicyviolation` listener that logged every violation to the console. This was needed
because Chrome's own CSP messages don't reach the console reader. `frame-ancestors` was left out
of the meta tag, since browsers ignore it there and log a warning.

**Pages loaded with the policy (all 16):**
- Home, privacy, terms, offline.
- Sign-in, sign-up, sign-up with `?invite=`, forgot-password, reset-password, onboarding.
- Dashboard, quotes, invoices, new quote, settings.
- Admin.
- Public quote page, with a bad token and with a real one.

**What worked with the policy on:**
- Signed-in session.
- Dashboard and quotes data.
- **send-quote:** sent a TEST quote to the test address.
- **quote-public:** returned 200 for the real token and 404 for the bad one.
- Turnstile widget.
- All four DM Sans weights.
- gtag and GA collect requests.
- Dodo checkout links.

**Track:** the `track` call was skipped because this browser has the admin flag. It goes to the
same Supabase origin as quote-public, which passed.

**Cleanup:** the temporary meta tags and listeners were removed afterwards. No `http-equiv` CSP
remains in any page.

### Violations found and fixed

**None.** No page logged a CSP violation, so the policy is exactly as specified.

## 2. Cloudflare Turnstile (commit `721ad84`)

**Pages:** sign-in, sign-up (including `?invite=` team signups) and forgot-password. Only these
three load `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` (async defer).

**`js/turnstile.js`:**
- Renders one widget per form, with theme `dark` and size `flexible`.
- Keeps the submit button disabled until the widget returns a token.
- Disables the button again if the token expires or the widget errors.
- `reset()` gets a fresh token after every failed submit, and after a signup that needs
  email confirmation, because tokens are single-use.

**Tokens to Supabase (`js/auth.js`):**
- `signUp(..., { options: { data, captchaToken } })`
- `signInWithPassword(..., { options: { captchaToken } })`
- `resetPasswordForEmail(email, { redirectTo, captchaToken })`

**Errors:** any Supabase error mentioning "captcha" shows *"Please complete the security check
and try again."* Submitting with Enter before the check passes shows the same message.

**Layout:** the widget fills the form width. On narrow phones its 300px minimum overflows evenly
into the card padding instead of off the right edge.

### Test results (Cloudflare's always-pass test key `1x00000000000000000000AA`)

- **Widget and button:** each page shows the widget. The button starts disabled and enables once
  the widget passes.
- **Token sent:** I intercepted each request inside the page, so nothing reached Supabase and no
  password was typed. The `gotrue_meta_security.captcha_token` field was present on:
  - `/auth/v1/token?grant_type=password`
  - `/auth/v1/signup` (normal and invite)
  - `/auth/v1/recover`
- **After a failed submit:** the friendly message appears, the button disables, the widget resets,
  and the button re-enables when the widget passes again.
- **Invite signups:** a failed invite still shows the existing "invite link is invalid" message.
- **Real sign-in:** the owner signed in on localhost through the new widget, and it worked.
- **Console:** clean on all three pages.

## What you must do

1. **Put the real site key in `js/turnstile.js` (`SITE_KEY`).** The brief contained the
   placeholder `PASTE_SITE_KEY_HERE`, not a key, so the code ships with Cloudflare's always-pass
   **test** key, and the widget shows "For testing only".
2. **Cloudflare → Turnstile → your widget:** add `getquotechase.com` and `www.getquotechase.com`
   as hostnames. Add `localhost` too if you want the real key to work locally.
3. **Supabase → Authentication → Attack Protection → enable CAPTCHA:** choose Turnstile and paste
   the **secret** key. Do this only after step 1 is deployed: once it's on, sign-in, sign-up and
   password reset without a valid token are refused, and the test key's token is not valid
   against a real secret.
4. **HSTS preload:** `preload` with `includeSubDomains` means every subdomain must serve HTTPS. If
   you want the domain on the browser preload list, submit it at hstspreload.org. Removal takes
   months, so be sure first.
5. **After deploying:**
   - Check the live headers at securityheaders.com.
   - Click through the dashboard once with DevTools open to look for CSP errors. The local test
     used a meta tag, which behaves the same except for `frame-ancestors`.

## Notes

- **Test quote:** "TEST CSP check" (£123, test email) was created by the send-quote check. Archive
  it whenever you like.
- **Other password forms:** reset-password, settings and onboarding have no Turnstile, as the
  brief scoped. Reset-password requires the emailed link, and the others require a session.
