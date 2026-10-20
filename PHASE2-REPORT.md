# Phase 2 Report — app rebuilt on the new database (overnight, 2026-10-20/21)

All 11 tasks are done and committed locally (12 commits including this report). Nothing was pushed or deployed, and Supabase was not touched: no CLI, no SQL, no deploys. The app only talked to the live backend the way the browser normally does, through your logged-in session and the public functions.

Screenshots (temp folder, copy what you want to keep):
`C:\Users\zidye\AppData\Local\Temp\claude\C--Users-zidye-Documents-GitHub-Quote-Chase\838b6553-1c7a-4c36-85c1-2c2c12e4cb31\scratchpad\shots2\`
- 375px: `m375-dashboard.png`, `m375-quotes.png`, `m375-quotes-modal.png`, `m375-new-quote.png`, `m375-settings.png`, `m375-invoices.png`, `m375-admin.png`, `m375-public-quote.png`
- Homepage: `m375-home.png`, `m320-home.png`
- Desktop: `desktop-dashboard.png`

## How I tested
- **Session:**
  - At the start of the night, localStorage on localhost:5173 was empty and there was no session.
  - By the time I finished Task 1 your session was there again (owner of "Dave & davetech Roofing", trial, admin).
  - Every task was then tested against the **real backend** on localhost:5173.
- **Mock backend (for cases the real account can't show):**
  - Used for a Team member view, a Solo plan, a 402 limit error, the offline/network error state, decline, the booking link, remove member/revoke invite, `?paid=1` success, and XSS test strings.
  - It's a test-only fake of `js/supabase.js` with fixture data, served on `127.0.0.1:5175` from my scratch folder.
  - It is not in the repo and never contacts Supabase.
- **Screenshots:** the Chrome extension's screenshot call keeps timing out, so screenshots come from DOM snapshots (scripts stripped) rendered by headless Chrome at 375px.
- **Stale cache during testing:** the old `qc-v1` service worker served stale JS on 5173, so I unregistered it before test runs. Task 10 replaces it with a network-first worker.

---

## Task 1 — Shared JS foundation — PASS
- **`js/dashboard.js`:**
  - `getContext()` returns `{ user, member, business, limits }`: one `members` query (explicit columns), one `businesses` query and one `plan_limits` RPC. With no member row it shows the existing "couldn't load your account" message and throws.
  - Kept `sanitize`, `formatMoney(amount, currencyOrCountry)` (accepts GBP/USD or GB/US) and `renderSidebar`.
  - Added shared helpers used on several pages: `formatDate`, `hasAccess` (UI only), `trialDaysLeft`, `planLabel`, `showNoAccessBanner`, `statusBadge`, `eventText` (readable activity text), `timeAgo`, `checkoutUrl` (Task 2), and `QUIET_ERRORS`.
- **Paywall:** the overlay, `css/paywall.css` and all its `<link>`s are gone. With no access, an inline banner appears ("Your trial has ended — choose a plan to keep chasing quotes." + **Choose a plan** → Settings → Billing), and the Send quote button is disabled.
- **Sidebar:**
  - Links: Dashboard, Quotes, New quote, Invoices (only if `limits.invoicing`), Settings, and Admin (added only when `is_admin()` returns true).
  - Footer: name, "Owner/Team member · Business", and the plan label.
- **`js/tracker.js`:**
  - One fire-and-forget `fetch(track, { method:'POST', keepalive:true })`, skipped when `localStorage.qc_admin` is set (try/catch).
  - It doesn't import supabase-js, so public pages stay light; the project URL is repeated in this one file.
  - Called on index, privacy and terms (newly added), and on the auth pages. Removed from every dashboard page.
- **Removed:** every reference to profiles, site_visits, send-message, default_followup_message, quote_limit, quotes_used_this_month, followup_N_sent and customer_replied. Confirmed by grep in Task 11.
- **Account deletion:** settings used to delete the account from the browser, which the new backend doesn't allow. It's replaced with "To delete your account, email hello@getquotechase.com".
- **Test:** every dashboard page loads with your account, console clean. The track function returned 204 when called directly; its first in-page call got one 503, which looked like a cold start.

## Task 2 — Auth pages — PASS (signup not submitted, as instructed)
- **Signup:**
  - Fields: Business name, Your name, Email, Password.
  - Calls `signUp` with `{ business_name, full_name }`. With a session it goes to onboarding; without one it shows the "check your inbox" message.
- **Invite mode (`?invite=<token>`):**
  - Hides Business name, sets the title to "Join your team on QuoteChase" and the button to "Join team".
  - Sends `{ full_name, invite_token }` and goes to the dashboard.
  - A bad invite surfaces as Supabase's generic "Database error…", so in invite mode that becomes "This invite link is invalid or has expired…".
- **Friendly errors:** new `friendlyAuthError()` in `js/auth.js`, used by signup, login, forgot and reset. Raw server text is never shown.
- **Onboarding:**
  - Real features: Solo — 40 quotes/month, follow-ups, email + SMS, 1 user. Crew — 150/month, up to 10 team members. Pro — unlimited quotes and team, invoicing.
  - Buttons link to Dodo with `metadata[business_id]`, `checkout[email]` and `redirect_url=<origin>/dashboard/settings.html?paid=1` (existing product IDs kept).
  - Non-owners are redirected to the dashboard.
- **Test:**
  - Signup in both modes rendered correctly (checked on the mock origin while logged out; on 5173 you're logged in, so it redirects as it should).
  - All three onboarding links contain your real business id, your email and the redirect URL. I inspected the hrefs; nothing was opened.
  - Login and signup redirect to the dashboard when logged in; forgot and reset load clean.

## Task 3 — Dashboard home — PASS
- **Stat cards:**
  - Open quote value (sent/replied, not archived).
  - Won this month (sum and job count, by `closed_at`).
  - Win rate (won ÷ (won+lost), "—" if none).
  - Quotes this month ("X / limit", or "X" when unlimited).
  - 2 columns on mobile.
- **Needs attention:** replied quotes, plus open quotes viewed in the last 48h. Each links to the quote detail.
- **Recent activity:** last 15 `quote_events` in readable text ("TEST Quote B accepted £4,200", "Day-5 follow-up sent to …").
- **Recent quotes:** cards on mobile, table on desktop, with Won/Lost/Replied. Actions re-load the data without a page reload.
- **Test (mock):** £8,200 / £3,000 / 33% / 4 matched hand-calculated values. Marking Won updated the cards to £4,000 / £7,200 / 50% without a reload.
- **Test (real):** after Tasks 4–6 it showed £1,800 open, £4,200 won this month, 100%, "2 / 40", the replied quote under Needs attention, and all events.
- **Note:** the real trial plan's `plan_limits` returns 40 monthly quotes, so trials show "x / 40".

## Task 4 — New quote — PASS
- Kept the form, `toE164()`, £/$ by `business.country`, and the sticky mobile submit.
- Submits through `supabase.functions.invoke('send-quote')`.
- On success it shows "✓ Quote sent", plus whether the SMS was sent, failed or skipped, with **Send another** (clears the form) and **View quotes**.
- On failure it shows the server's `{error}` text via `error.context.json()`, with a fallback message.
- The button is disabled and a flag blocks double submits.
- **Test (real):**
  - An invalid phone "12345" was blocked client-side with no function call.
  - **TEST Quote A** (no phone): 200, `sms: skipped`.
  - **TEST Quote B** (+447700900123): 200, `sms: sent`.
  - Send another cleared every field.
- **Test (mock):** the 402 limit error showed the friendly server message, and a double click sent once.

## Task 5 — Quotes page + detail — PASS
- **List:** search (name/email/job), filters (All, Following up, Replied, Won, Lost, Archived), cards on mobile.
- **Follow-up progress:** 4 dots by `followup_step`, "Next: <date>", a Paused badge, and a "Viewed N×" chip.
- **Detail modal:**
  - Customer, job, amount, status, last opened, follow-ups, and a timeline (oldest first).
  - Actions: Won, Lost, Replied, Pause/Resume, Copy customer link (`/quote/?t=…`), Archive/Unarchive, and Delete (owner only, with an in-page confirm).
  - "Create invoice" appears for won quotes (Task 8).
  - Opens directly from `?id=`.
- Event delegation only, no globals.
- Every update/delete uses `.select('id')`, so a silent RLS no-op is reported as a failure.
- **Test (real):**
  - Quote A: pause → resume → copy → archive (hidden from All, shown under Archived) → unarchive → replied. Each showed a success message and the timeline updated.
  - **TEST Quote C** was created, marked Won from the list, then **deleted** through the in-page confirm.
  - Search and filters returned the right counts.
- **Test (mock):** Lost.
- **Copy link fallback:** clipboard writes hang when the window isn't focused, so after 1s the link is shown in the message instead.

## Task 6 — Public customer quote page — PASS
- Rebuilt with a light card on a soft background, orange accent, and DM Sans.
- **No supabase-js, no analytics, no tracker.** Plain `fetch` POST to `quote-public`.
- `<meta name="robots" content="noindex,nofollow">` and `<meta name="referrer" content="no-referrer">`.
- **Shows:** business name, "Quote for <customer>", job, amount formatted by currency, and sent date.
- **Buttons:**
  - Accept.
  - Ask a question (textarea with a 1000-character counter).
  - Book a call (only for an `https://` booking_url).
  - Decline (small link with an in-page "Are you sure?").
- **States:** won/lost quotes show their outcome without buttons. Not found (404/no token), rate limit (429) and network error each get their own message, with Retry.
- **Test (real):**
  - A fake token got the "couldn't find" state (real 404).
  - Asked a question on Quote A (200, thank-you shown).
  - Accepted Quote B (200, "Thanks! … has been told"). On reload it showed "You've accepted this quote".
  - The dashboard timeline showed *opened*, *asked: "TEST question…"* and *accepted £4,200 / marked won*.
- **Test (mock):** decline with confirm and cancel, the closed state, the booking button, and the network-error state.
- **Conflict in the brief:** Task 1 said to track the quote page; Task 6 said no tracker there. I followed Task 6.

## Task 7 — Settings — PASS
- **Business** (owner): name, trade (free text plus `<datalist>`), country, reply-to email (validated), and booking link (`https://` only).
- **Follow-up messages** (owner):
  - Four textareas with the defaults you specified when empty, and a "Reset to default" per box.
  - Placeholders `{{name}} {{amount}} {{business}} {{link}}` are documented on the page.
  - Saved to `followup_templates`.
- **My details:** full name and "Email me when a customer opens, replies to or accepts a quote" (`notify_email`).
- **Team** (owner):
  - Members with Remove (in-page confirm → `remove_member`).
  - "X of Y seats".
  - Pending invites (explicit columns, unexpired only) with Revoke.
  - "Invite team member" shows "coming in the next update".
- **Billing:**
  - Plan, status, and trial days left or renewal date.
  - Plan cards with the same checkout links (owner only).
  - `?paid=1` → "Confirming your payment…", polling every 3s for up to 30s.
  - Manage/cancel and account deletion → mailto.
- **Hidden for members:** owner-only sections.
- **Test (real):**
  - Bad booking link and bad email were rejected.
  - Saved trade + booking link, a day-5 message, and notify off. Reloaded: all persisted.
  - **Restored everything:** trade and booking link empty, day-5 reset to default, notify on.
  - Note: `followup_templates` now holds the four defaults explicitly (it was `{}`).
- **Test (mock):** remove member (confirm and cancel), revoke invite, `?paid=1` → "You're on Solo", and member view (only My details + Billing, no plan buttons).

## Task 8 — Invoices — PASS
- New `dashboard/invoices.html`, linked from the sidebar only when `limits.invoicing`. Otherwise it shows "Invoicing is on the Pro plan" with a link to plans.
- **List:** INV-0001 style numbers (the database returns the integer 1, formatted in the browser), customer, total (with pence), status, due date.
- **Editor:**
  - Customer, address, line items (add/remove), tax %, due date (default +14 days), notes.
  - Live preview of the totals.
  - **After saving, the row is re-read**, so the totals shown are the database's.
- **Create invoice:** button on won quotes → `invoices.html?from_quote=<id>`, pre-filling customer + one line item from the quote.
- **Drafts:** edit, delete (in-page confirm). **Any open invoice:** Mark paid, Void. "Send to customer" → "coming next update".
- **Print / PDF:** a print stylesheet that shows only a clean invoice.
- **Test (real):**
  - Created a draft from Quote B with 20% tax. The database returned subtotal 4200, tax 840, total 5040, matching the preview.
  - Edited it: added "TEST scaffolding hire" 2 × £150.50. Preview and database both gave £4,501.00 + £900.20 = **£5,401.20**.
  - Marked paid.
  - Print view rendered correctly (`window.print` stubbed so no dialog opened).
- **Test (mock):** validation, delete with confirm, void, and the Solo plan (no Invoices link, "Pro plan" message).
- **Bug found and fixed while testing:** `e.currentTarget` was null after an `await`. That first save had inserted the row but threw before refreshing.

## Task 9 — Admin — PASS
- **Gate:** `is_admin()` false → "Not found", then throws. Sets `localStorage.qc_admin = '1'` (try/catch) and adds `noindex`.
- **Cards:** Total users, Paid, Solo, Crew, Pro, Active trials, Expired trials, Past due, Cancelled, MRR (£), Quotes (30 days). Visitors: Today / 7 days / 30 days.
- **Chart:**
  - Hand-written inline SVG with three lines and points, y-axis ticks, three date labels, and an HTML legend.
  - Pointer and tap tooltips with the day's numbers plus a cursor line.
  - Redrawn to the card's width on resize.
- **Users table:** from `admin_users()` with All / Paid / Trialing / Expired / Cancelled chips; cards on mobile.
- **Test (real):**
  - Loads with your account. 30 points. The last point is **20 Oct**, because the server buckets days in UTC and it was just after midnight BST. That point shows 1 visitor / 6 views / 1 signup, and the tooltip showed the same.
  - No console errors.
- **Test (mock):** filters, an XSS business name rendering as text, and the non-admin "Not found" view.

## Task 10 — Landing nav, service worker, clean-up — PASS
- **Mobile nav** (`css/main.css`):
  - Below 420px: tighter gaps and padding, smaller buttons and logo.
  - Below 360px: icon-only logo.
  - Measured with no touching at 414, 375 and 320px.
- **Extra fix:** the 320px homepage also scrolled sideways (already true before tonight). The hero grid column (`1fr` → `minmax(0,1fr)`), large buttons and footer links can now wrap. The page is now 314px wide at 320.
- **`sw.js`:**
  - `qc-v2`, network-first for every same-origin GET with a cache fallback. Navigations fall back to cache, then `/offline.html`.
  - Other origins are never intercepted. Old caches are deleted.
  - Test on a temporary server at 127.0.0.1:5176: an old `qc-v1` cache was deleted, `qc-v2` activated with 12 precached files. With the server stopped, a visited page loaded from cache and an unvisited page showed the offline page.
- **Landing claims:**
  - "How it works" step 4 and the follow-ups card now say chasing stops when the customer accepts, declines or asks a question on the quote page, or you mark Won/Lost/Replied. There's no email-reply claim.
  - Pricing: Solo gets custom messages, view tracking and "1 user"; Crew "Up to 10 team members"; Pro "Unlimited team members" and "Invoicing".
  - "Early access to new features" was removed.
- **Dead code removed:** unused CSS (old calculator widget, testimonial, hero-proof, empty-state, yellow stat colour) and `getUser()` in `js/auth.js`.

## Task 11 — Final pass — PASS
- **Console sweep:** all 16 pages at 1280px and 375px (iframes, error and console.error hooks): **0 errors**, no horizontal overflow.
  - Pages: index, privacy, terms, login, signup, forgot, reset, onboarding, dashboard, quotes, new quote, settings, invoices, admin, quote page, offline.

### Security self-check
| Check | Result | Evidence |
|---|---|---|
| No profiles / site_visits / send-message / service_role / secret keys in client files | **PASS** | grep over all .html/.js/.css (excluding brag-output) found none. The only JWT is the anon key in `js/supabase.js:4` (decoded role claim: `anon`). |
| Every innerHTML with user data uses sanitize() | **PASS** | Script listed every `${…}` not wrapped in `sanitize()`. All are constants or numbers, already-sanitized helper output (`statusBadge`, `btn`, `followups`…), or plain text that goes to `sanitize()`/`textContent`. The public quote page and new-quote use `textContent` only. XSS fixtures (`<b>`, `<script>`, `<img onerror>`) rendered as text. |
| No inline event handlers, no window.__ globals | **PASS** | The last one (offline Retry `onclick`) was replaced in the final commit. grep for ` on…="` and `window.__` finds nothing. |
| Invites queries list columns explicitly | **PASS** | `settings.html`: `select('id, email, expires_at, accepted_at, created_at')`. The delete uses `.select('id')`. |
| Public quote page: no supabase-js, no analytics, noindex | **PASS** | Only one inline script (plain fetch); no gtag or tracker. `robots noindex,nofollow` + `referrer no-referrer`. |

---

## Test data created — please delete
**Quotes** (all `davedeetechnology+qctest@gmail.com`, each sent a real quote email):
| Name | ID | State |
|---|---|---|
| TEST Quote A | da7471c7-f289-471e-9a42-778179e423e1 | replied, asked a question, still has a public link |
| TEST Quote B (+447700900123, SMS "sent") | 104e3fb7-6b9f-42c4-ba90-b36e8f6261a4 | won (accepted on the quote page) |
| TEST Quote C | b0fcc144-9b91-4657-b705-10f5e235a4b6 | **already deleted** in the Task 5 test |

**Invoices:**
| Number | ID | State |
|---|---|---|
| INV-0001 (from Quote B) | 814a477e-f9e7-439a-85e6-1d46b8b78f15 | **paid**. Only drafts can be deleted from the app, so this needs a database delete. |

**Other changes to your real account:**
- `followup_templates` now stores the four default messages explicitly.
- `localStorage.qc_admin = '1'` is set on localhost:5173 (from opening /admin).
- My test page loads count as a few visitor/view events in the stats.

## Manual tests needed
1. **Signup:**
   - Normal: check the business + owner are created and you land on onboarding (or the "check your inbox" message if confirmation is on).
   - Invite: needs a real invite token once the invite function is live.
2. **Dodo checkout → `?paid=1`:** a real (test-mode) payment, to see the 30s confirmation flip to "You're on <plan>".
3. **Member view on the real backend:** sign in as a team member and check owner-only sections are hidden and delete is refused.
4. **Trial-ended state on the real backend:** banner shows and Send is disabled.
5. **Print to PDF:** use the real browser dialog on an invoice.
6. **PWA on phones:** install, offline fallback, safe areas (unchanged from Phase 1, but the service worker changed).
7. **Links with query strings:** `npx serve` drops the query string when it redirects `/x.html?...` to `/x`, so locally `quotes.html?id=` and `invoices.html?from_quote=` only work as `/dashboard/quotes?id=…`. On Vercel the `.html` URLs are served directly, but check once after deploy.

## Choices and notes
- `hasAccess()` treats `past_due` as still having access (grace period). It's UI only; the server enforces the real rules.
- Quote status labels: `sent` shows as **Following up**, with a separate Paused badge.
- Invoice money shows pence (dashboard figures stay rounded).
- Admin "Paid" filter = non-trial plans with status active or past_due. "Expired" includes trials past `trial_ends_at`.
- `struc.txt` still describes the old backend. I left it alone since it's documentation and isn't deployed.
- Mock harness, snapshots and screenshots are in the scratchpad only, none in the repo.

## Tonight's commits (`git log --oneline`)
```
3aa683a Task 11: replace last inline handler (offline Retry) with a listener
fd9e48c Task 10: small-phone nav + no sideways scroll at 320px, network-first service worker (qc-v2), honest landing claims, remove dead CSS and getUser
35c15c0 Task 9: admin — is_admin gate, overview cards, visitors, hand-written SVG chart with tooltips, users table with filter chips
cfd4717 Task 8: invoices page — list, editor with line items + live preview, create from won quote, server totals re-read, mark paid/void/delete draft, printable view
0286aff Task 7: settings — business, follow-up templates with defaults/reset, my details, team + invites, billing with checkout links and ?paid=1 confirmation
b05e333 Task 6: public quote page rebuilt — plain fetch to quote-public, accept/question/decline/book, light theme, noindex + no-referrer, no analytics
01a106d Task 5: quotes page — search/filters incl. archived, follow-up dots + next date, viewed chip, detail modal with timeline, pause/resume, copy link, archive, owner delete with in-page confirm
7e032a1 Task 4: new quote via send-quote — sent panel with SMS outcome, send another, friendly server errors, no double submit
ca51b6f Task 3: dashboard home — open value, won this month, win rate, monthly usage, needs attention, activity feed, recent quotes
5b3baaf Task 2: signup with business_name/full_name + invite mode, friendly auth errors, onboarding plans and business-id checkout links
da981c2 Task 1: getContext on members/businesses/plan_limits, drop paywall, tracker via track function, remove profiles/send-message refs from app pages
```
(plus the commit adding this report)
