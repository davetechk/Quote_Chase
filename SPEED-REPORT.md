# QuoteChase speed report — 21 Oct 2026

Measure → fix → measure, on `http://localhost:5173` (`npx serve`) in Chrome, signed in.
Nothing was deployed and Supabase was not touched.

## Method

- **Cold** = hard reload (Ctrl+Shift+R: no HTTP cache, no service worker) and, on dashboard
  pages, the session cache cleared too. That's the first dashboard load right after login.
- **Warm** = normal reload (F5) with everything cached.
- Numbers come from `performance.getEntriesByType('navigation' | 'resource' | 'paint')`.
  Each figure is the **median of 3 runs**. Before and after were measured the same way,
  one straight after the other. "Before" is commit `fe9dcb5`, checked out temporarily.
- **First content** = first-contentful-paint. The sign-in card fades in from opacity 0, so
  Chrome never records an FCP there; first-paint is used instead.
- **Usable** = on dashboard pages, when the last `quotes` response arrives (they render
  synchronously). On other pages it's the load event, which mostly waits on Google Analytics.
- **KB** = bytes transferred as the browser reports them. Supabase API responses and
  Google Analytics report 0 (no `Timing-Allow-Origin`), so KB here means static files.
- The sign-in page was measured on `127.0.0.1:5173`, where there's no session; on
  `localhost` it redirects straight to the dashboard.
- The test account had **0 quotes**, so data payloads were tiny. With real data, trimming
  columns saves more than shown here.

## Results (median of 3)

| Page | Mode | Requests | KB | First content | Usable | API rounds before quotes |
|---|---|---|---|---|---|---|
| **Dashboard** | cold | 25 → **18** | 102 → **79** | 232 → 240 ms | 1780 → **961 ms** | 4 → **2** |
| | warm | 26 → **19** | 13 → 14 | 128 → 132 ms | 1012 → **500 ms** | 4 → **1** |
| **Quotes** | cold | 24 → **15** | 105 → **82** | 228 → 224 ms | 1600 → **863 ms** | 4 → **2** |
| | warm | 25 → **16** | 21 → 21 | 116 → 108 ms | 1084 → **337 ms** | 4 → **1** |
| **Sign in** | cold | 21 → **13** | 93 → **69** | 768 → **336 ms** | 782 → 798 ms* | — |
| | warm | 22 → **14** | 5 → 5 | 196 → **164 ms** | 166 → 141 ms | — |
| **Home** (`index.html`) | cold | 9 → 9 | 86 → **29** | 284 → 340 ms | 773 → 834 ms* | — |
| | warm | 11 → 11 | 43 → 43 | 168 → 216 ms | 155 → 181 ms | — |

\* The load event on these pages waits on Google Analytics and the visitor tracker. The
sign-in form itself is ready at DOMContentLoaded: **765 → 316 ms** cold.

**Home page paint times didn't change.** The spread between runs (FCP 252–352 ms cold,
136–292 ms warm) is bigger than the difference between before and after. On localhost,
`main.css` arrives in about 1 ms, so removing the font `@import` chain saves nothing here.
On a real connection it saves one round trip before text can render.

### Slowest and largest requests before (Step 1, cold, single run)

- **Dashboard, slowest:**
  - `members` 968 ms (first connection to Supabase)
  - supabase-js `+esm` 450 ms
  - storage-js 337 ms
  - `quotes` 332 ms
  - auth-js 329 ms
- **Dashboard, largest:**
  - `icon-192.png` 45.5 KB (Chrome fetching the manifest icon; not render-blocking)
  - auth-js 25.9 KB
  - storage-js 13 KB
  - realtime-js 10.5 KB
  - phoenix 8.3 KB
- **Sign in, slowest:**
  - gtag 637 ms
  - `track` 576 ms
  - supabase-js 550 ms
  - Google Fonts CSS 244 ms
  - auth-js 178 ms
- **Home, slowest:**
  - gtag 734 ms
  - `icon.png` 185 ms / 67 KB
  - Google Fonts CSS 126 ms

### The login → dashboard path (the main complaint)

Request rounds (each round waits for the one before it):

| | Round 1 | Round 2 | Round 3 | Round 4 |
|---|---|---|---|---|
| **Before** | members | businesses | plan_limits | is_admin · **quotes** · quote_events (+ a 5th round for the latest-event lookup when replied quotes exist) |
| **After, first load** | members+business (one query) · is_admin | plan_limits · **quotes** ×3 · quote_events | | |
| **After, repeat load** | is_admin · members+business · **quotes** ×3 · quote_events | plan_limits | | |

- **Sign-in submit:** I couldn't time the submit itself because I don't type passwords. The
  code goes from a successful `signIn` straight to `/dashboard/index.html` with no extra
  hop, so the first dashboard load after login is the "cold" row above. Locally,
  `npx serve` adds one redirect (`/dashboard/index.html` → `/dashboard`); Vercel without
  `cleanUrls` doesn't.
- **Sign-up → onboarding → dashboard:** onboarding now needs 2 rounds (was 3). It also
  leaves the session cache behind, so the dashboard opened from it gets quotes in round 1.
- **The auth check** already used `getSession()` (local, no network), not `getUser()`.
  Nothing to change.

## What each fix changed

| Fix | Commit | Effect |
|---|---|---|
| **0 + b + c — request rounds** | `e0954ec` | `getContext()` reads member + business in **one embedded query**, with `is_admin` in parallel. `plan_limits` then runs **alongside the page's own queries** (a new `load` option). Repeat loads draw the sidebar from `sessionStorage` and start the page queries straight away. Dashboard: stats query selects only `status, amount, currency, closed_at, created_at, archived`; recent quotes limited to 10 (all the table shows); "needs attention" is filtered on the server and carries its latest event in the same query, folding the extra round from the reply feature in. Activity gets its quote's name/amount by embedding (no join over all quotes). Business columns are listed explicitly (no `select('*')`, and no Dodo IDs or inbound token in the browser cache). The admin gate uses the same `is_admin` call. **Dashboard/Quotes: 4 → 2 rounds cold, 1 warm; usable ~2× faster cold, ~2–3× warm.** |
| **a — supabase-js** | `8d852e9` | jsDelivr `+esm` pulled **12 module files**. 2.118.0 has no self-contained ESM build (`dist/index.mjs` still imports the sub-packages), so per the brief the **UMD file** is saved unmodified as `/js/vendor/supabase.js` (218 KB raw, 55 KB gzipped). It loads via `<script defer>` before each page's module script, and `js/supabase.js` reads `window.supabase`. **−8 to −9 requests per app page. Sign-in page ready at 316 ms instead of 765 ms cold.** |
| **d — images** | `471b306` | Home page logo: the 67 KB `icon.png` shown at 36px is now `/icons/logo-72.png` (10 KB, sharp on 2× screens). The footer copy is `loading="lazy"`. All `<img>` tags already had width/height. `Quotechase_logo.png` isn't used by any page, so nothing changed there. **Home cold: 86 → 29 KB.** |
| **e — fonts** | `436420e` | The Google Fonts `@import` inside `main.css` (HTML → CSS → font CSS → font file) is replaced by `preconnect` (fonts.googleapis.com + fonts.gstatic.com) and a `<link>` in every page head, so it loads alongside `main.css`. Only the weights used are requested: **400/600/700/800**. 500 and DM Mono were never used. `display=swap` kept. All four weights confirmed loaded. |
| **f — scripts** | — | Skipped: nothing to fix. GA was already `async` everywhere, and all app code is `type="module"` (deferred). No blocking scripts found. |
| **g — caching** | `4eb0413` | New `vercel.json` (there wasn't one). `/css/*`, `/js/*` (except vendor), `/icons/*` → `public, max-age=86400, stale-while-revalidate=604800`. `/js/vendor/*` → `public, max-age=31536000, immutable`. HTML keeps Vercel's default, and `cleanUrls` is **not** set. Only takes effect once deployed, so local numbers don't show it. |
| **h — service worker** | `14ff1fe` | `/js/vendor/supabase.js` precached; cache bumped to `qc-v3`. Confirmed: only `qc-v3` exists afterwards and the vendor file is in it. |

## Nothing looks or behaves differently

- **Same rendered text:** on the scratch mock backend (seeded with data, including HTML in
  names), the dashboard and quotes page render the **same text** before and after
  (`diff` of the rendered text: identical).
- **Reply rule still works:** a replied quote whose latest non-view event is your reply
  still drops out of "Needs attention", even after the customer views it again.
- **Console clean** on all 16 pages: home, privacy, terms, offline, every dashboard page,
  admin, onboarding, and the signed-out login, signup, forgot and reset pages.
- **Signed-out access:** a signed-out visit to the dashboard still goes to sign-in.

## Notes

- **Session cache is display-only.** `sessionStorage` key `qc_ctx` holds the last context
  (name, role, business display fields, plan limits, admin flag). It only draws the sidebar
  and gives page queries a head start. RLS and the functions still check everything, and
  the admin page gates on a fresh `is_admin`. It's ignored if the signed-in user changes,
  and cleared on sign-out.
- **Upgrading supabase-js:** `/js/vendor/` is cached as immutable for a year. Use a new
  file name (e.g. `supabase-2.119.0.js`) when upgrading.
- **Quotes page loads every quote, as before.** Search and the status filter run in the
  browser over the full list, so a limit would change behaviour.
- **Before and after use the same sample size.** The "before" figures in this report are
  medians of 3, not the single runs from Step 1, so both sides were measured the same way.
