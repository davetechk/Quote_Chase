# QuoteChase Pre-Launch Audit

Scope: full repo (`C:\Users\zidye\Documents\GitHub\Quote_Chase`) plus live testing against `https://www.getquotechase.com` (production). No code was changed. Where I confirmed a bug by actually reproducing it in the browser, it's marked **[Live-verified]**. Where I could only reason from the code because the backend isn't in this repo, it's marked **[Static / unverified]**.

A hard limit on this audit: **there is no `supabase/` folder in this repository** — no `schema.sql`, no RLS policy definitions, and no Dodo webhook handler. `struc.txt` documents a `supabase/functions/` directory (`send-message`, `send-followups`) that has never once been committed to this repo (`git log --all -- "supabase/*"` returns nothing). That means large parts of sections 1 and 2 below can't be fully verified from code — I've flagged exactly what I could and couldn't confirm, and what I'd need from you to finish the job.

---

## CRITICAL

### 1. Sending a quote is completely broken in production right now
**File:** `dashboard/new-quote.html`, JS lines 160 (`smsConsentCheckbox = document.getElementById('sms-consent')`) and 229 (`if (!smsConsentCheckbox.checked)`)
**[Live-verified]** — reproduced on getquotechase.com with a fresh signup.

There is no element with `id="sms-consent"` anywhere in the HTML (it was removed in commit `1e6e310 Remove conscent checkbox`, but the JS reference to it wasn't). `getElementById` returns `null`, and `.checked` on `null` throws:

```
Cannot read properties of null (reading 'checked')
```

This is an **unhandled promise rejection** thrown before `setLoading(true)` and outside the function's `try/catch`. Clicking "Send quote & start follow-ups" does *nothing visible* — no spinner, no error text, no network request, no console output a normal user would ever see. I filled out the form and clicked the button four times during testing; every real Supabase insert never even fires.

**Cost if a real user hits this:** 100% of them will. This is the entire point of the product — enter a quote, it gets sent and followed up on. Right now that path is dead for every single user, silently. Nobody will report a bug; they'll just quietly leave and never come back. This has to be the very first thing fixed, before anything else on this list.

---

### 2. Any signed-up user — including a $0 trial account — can read every other business's customer data
**File:** `admin/index.html` lines 106–108 (`ADMIN_EMAILS` array), 135/142/145 (`supabase.rpc('get_all_profiles')`, `get_all_quotes`, `get_recent_visits`)
**[Live-verified]** — reproduced from a throwaway, non-admin trial account I created and then deleted.

The admin panel's "you must be `dave.tech.k@gmail.com`" check (`admin/index.html:219`) is **client-side only**. It gates whether the `<div id="admin-panel">` is shown — it does not gate the data. The three RPC calls it uses to populate the panel are called directly on `supabase`, and I called the exact same RPCs from a brand-new, non-admin account's browser console:

```js
await supabase.rpc('get_all_profiles')   // → returned all 3 profiles in prod
await supabase.rpc('get_all_quotes')     // → returned all 11 quotes in prod
await supabase.rpc('get_recent_visits')  // → returned all 88 visit rows in prod
```

All three succeeded with no error and no admin check. By contrast, direct table reads (`supabase.from('profiles').select()`, `.from('quotes').select()`) correctly returned 0 rows for my non-admin account — so the base-table RLS looks fine. The problem is specifically these three RPC functions, which almost certainly run as Postgres `SECURITY DEFINER` (bypassing RLS entirely) and never check the caller's identity against an admin list *inside the function itself*.

**Cost if a real user hits this:** any customer, or anyone who ever signs up for a free trial, can dump every other customer's business name, plan, subscription status, trial dates — and every one of their customers' names, emails, phone numbers, job descriptions and quote amounts — with three lines typed into devtools, for free, on day one. This is a full customer-data breach the moment you have a second real user. It leaves essentially no trace. This needs the RPC functions locked down (check `auth.uid()` against an admin table/claim inside the function, not just in the calling page) before you have anyone using this besides you.

I did not print the actual leaked row contents anywhere — only counts — to avoid handling real customer PII unnecessarily during this audit.

---

### 3. No webhook / payment-confirmation code exists anywhere in this repository — I cannot confirm entitlements ever get activated after payment
**Files:** none found. `grep -ri "webhook"` across the repo turns up only front-end references to the word; there is no signature verification, no raw-body handling, no idempotency table, no code that calls Dodo or receives a Dodo callback.
**[Static — needs your input]**

The payment flow that *is* in the repo (`auth/onboarding.html:280-292`, `dashboard/settings.html:221-233`) is entirely a redirect to a Dodo-hosted checkout link with `metadata[user_id]` attached, and a `redirect_url` back to `/dashboard/index.html`. Nothing in this codebase ever flips `profiles.subscription_status` to `'active'`. That has to happen somewhere — either:

- a Dodo webhook hits a Supabase Edge Function that exists in your Supabase project but was never committed to this git repo (in which case it's currently unreviewed, unversioned, and I can't audit it at all — including whether it verifies signatures on the raw body, re-verifies the amount server-side, is idempotent with a unique-constrained processed-event table, wraps the payment record + entitlement flip in one transaction, or logs raw payloads), or
- it genuinely doesn't exist, in which case **every customer who pays will complete checkout and land back on a dashboard that still shows the paywall**, because nothing ever set `subscription_status = 'active'`.

**Cost if (b) is true:** every paying customer's first experience after handing over a card number is hitting a paywall telling them to pay again. That's an instant refund/chargeback and a founder-reputation problem on day one. I need to know where this webhook code lives (or confirm it doesn't exist) before I can actually answer the seven payments/webhooks questions you asked — right now the honest answer to all seven is "unverifiable from this repo, and possibly the code doesn't exist at all."

---

### 4. The paywall is UI-only and likely bypassable with one devtools command
**Files:** `js/dashboard.js:69-90` (`showPaywall()`), `dashboard/new-quote.html:215-246` (`handleSubmit`), `dashboard/index.html:251-255`, `dashboard/quotes.html:334-337`, `css/paywall.css:1-15`
**[Static + partially live-verified — the write-side test was blocked by my own sandbox, see below]**

`showPaywall()` appends a `<div id="qc-paywall">` on top of the page (`z-index: 500`). It does not remove, disable, or re-render the page underneath — the form fields, the "Send quote" button and its click listener are all still live in the DOM, they're just visually covered. Deleting that one div (`document.getElementById('qc-paywall').remove()`) in devtools uncovers a fully working form.

Critically, `handleSubmit()` in `new-quote.html` (line 215) **never re-checks `hasAccess(currentProfile)`** before inserting a quote — it only checks the monthly quota:
```js
const limit = currentProfile.quote_limit || 0;
const used  = currentProfile.quotes_used_this_month || 0;
if (limit > 0 && used >= limit) { ... }
```
And `quote_limit` is hardcoded to `0` for every trial signup (`auth/signup.html:174`), so `limit > 0` is `false` and this check **never fires during the entire trial** — trial accounts have no quote cap at all, by design or by accident.

I attempted to confirm live whether an RLS policy on the `quotes` table independently blocks inserts for an expired/cancelled subscriber, but that write attempt was blocked by this session's own safety sandbox as "modifying a shared resource" (writing test data into your production DB), so I stopped rather than force it. Given finding #2 shows this app's server-side authorization is weaker than the client-side code implies, I'd treat this as **likely exploitable** until you or I can verify the RLS policy directly.

**Cost if a real user hits this:** anyone whose 14-day trial ends (or who cancels) can keep using the full product forever for free with a single line typed into their browser console.

---

### 5. A plaintext credential is staged in your working tree, one commit from being pushed
**File:** `struc.txt` (uncommitted change, not yet in `git log`)

Your current unstaged diff adds this line to the end of `struc.txt`:
```
Narrava: [REDACTED]
```
This is sitting in your working directory right now. I flagged this to you mid-audit and you hadn't responded yet at time of writing — it's still there. If this gets committed and pushed, it's permanently in git history (recoverable even if later "deleted") and exposed to anyone with read access to the repo.

**Cost:** depends entirely on what that credential unlocks. Treat it as compromised the moment it's pushed and rotate it regardless of what you decide to do with the file.

---

## HIGH

### 6. The public quote page can update (and possibly tamper with) any quote row, from anyone with the link
**File:** `quote/index.html` lines 296-358
**[Static]**

`/quote/index.html?id=<uuid>` is intentionally public (no auth) so customers can view and accept a quote. The "accept" button runs:
```js
await supabase.from('quotes').update({ status: 'won', customer_replied: true }).eq('id', quoteId);
```
using the public anon key, with **no proof the caller is the actual recipient** — just the UUID from the URL. That's fine for the intended use case (a customer clicking the link in their own email), but it means the `quotes` table's RLS must grant public `UPDATE` on that row to make this work at all. RLS in Supabase is row-level, not column-level: anyone who has ever seen that one link (forwarded in an email thread, screenshotted, shared with a partner) can call the REST API directly and rewrite *any* column on that row — not just `status`, since the column restriction here is only "whatever this one page happens to send," not something Supabase enforces. There's also no rate limiting, so a scraped or guessed ID could be spammed.

**Cost:** quote tampering (flip someone's lost quote to "won," or vice versa), or a competitor/prankster corrupting a live quote's amount or description mid-negotiation. UUIDs make blind guessing hard, but a forwarded/leaked link is all it takes.

### 7. The `profiles` table may be fully public-readable — same root cause as #2
**File:** `quote/index.html` lines 311-316
**[Static — needs schema check]**

The same public quote page also does an unauthenticated `select('business_name, owner_name')` from `profiles` by `business_id`, to show the business's name. For that single query to work, RLS on `profiles` has to allow anonymous `SELECT`. Depending on exactly how that policy is scoped, it's plausible the *entire* `profiles` table (business name, owner name, plan, subscription_status, trial dates) is dumpable with nothing but the public anon key — no login required at all, not even a trial signup like in finding #2. Given finding #2 shows this codebase already has an under-scoped access-control pattern, I'd verify this specifically before launch.

### 8. Every signup is hardcoded as a "roofer" regardless of actual trade
**File:** `auth/signup.html` line 169
**[Static]**

```js
const { error: profileError } = await supabase.from('profiles').insert({
  ...
  trade: 'roofer',
  ...
});
```
This is unconditional — there's no trade selector on the signup form. `settings.html` offers Roofer/Builder/Other, but every new user starts mislabeled until they manually go change it. Low security impact, but it'll quietly corrupt any trade-based segmentation, messaging, or reporting you build on top of this later, and it contradicts the "Broading niche" (sic) work already done on the landing copy to target service businesses generally, not just roofers.

---

## MEDIUM

### 9. Landing page testimonials look fabricated
**File:** `index.html`, testimonials section (`"They stopped losing clients to silence"`) and hero social-proof avatars (`JS`, `MR`, `PK`, lines ~559-561)
**[Live-verified — read directly off the production page]**

The three testimonials — "James S., Contracting Specialist, Manchester," "Mike R., Managing Consultant, Birmingham," "Paul K., Creative Director, Leeds" — have initials that exactly match the three placeholder avatar circles in the hero ("JS", "MR", "PK"). You told me this product hasn't been in front of real users yet. Presenting invented quotes as real customer testimonials is a real regulatory and reputational risk (ASA/FTC-style rules on testimonials) the moment actual users — plausibly people who know each other in small regional trade networks — start comparing notes. I'd pull these or clearly mark them as illustrative before real traffic arrives.

### 10. Error handling is inconsistent — some places leak raw backend errors, others hide the cause completely
**Files:** `auth/signup.html:182-188`, `dashboard/settings.html:350-351` and `377-378`, `dashboard/index.html:146`

- `signup.html` pattern-matches two known error strings and otherwise falls through to `showError(msg || 'Something went wrong...')` — this surfaces raw Supabase/Postgres error text (e.g. constraint names) directly to a non-technical contractor.
- `settings.html`'s `saveProfile()` and `saveMessages()` do the opposite: they swallow the real error entirely and always show "Failed to save. Please try again." — with the actual error never even logged to console. If saves start silently failing in production, you will have no way to know why from the browser side.
- `dashboard/index.html:146` uses a native `alert()` for a failed status update ("Won"/"Lost"/"Replied") — jarring compared to every other error path in the app, which uses inline alert banners.

**Cost:** confusing/scary raw errors for some failures, zero diagnostic signal for others (you'll get "it doesn't work" support emails you can't debug from your end).

### 11. Partial delivery failures (email sent, SMS failed, or vice versa) are invisible to both you and the user
**File:** `dashboard/new-quote.html` lines 276-303
**[Static — the actual `send-message` function isn't in this repo, so I can't confirm how it behaves]**

The client does one `fetch` to the `send-message` Edge Function and treats the response as all-or-nothing: `if (!res.ok) throw new Error(result.error || 'Failed to send quote.')`. If email succeeds but SMS fails (or the reverse), and the function still returns `200`, the user sees "Quote sent!" with no indication that half the delivery failed. I can't verify this from the client code alone since the function itself isn't in this repo — worth checking directly.

### 12. Mobile nav has no way to sign in
**File:** `css/main.css` lines 160-162
**[Static — window resize to 375px was blocked in my sandbox, but this CSS rule is unconditional and unambiguous]**

```css
@media (max-width: 600px) {
  .nav__links .btn--ghost { display: none; }
}
```
Both "Pricing" and "Sign in" use `.btn--ghost` (`index.html:523-525`) and are hidden below 600px, with no hamburger menu or any other way to reach `/auth/login.html`. Only "Start free trial" remains visible in the mobile nav. A returning contractor opening the marketing site on their phone — the primary device this product is built for, per its own "Mobile first" feature claim — has no visible way to sign in.

### 13. Trial expiry is computed against the visitor's own device clock, with no server-side backstop (ties to #4)
**File:** `js/dashboard.js`, `hasAccess()`
```js
if (profile.subscription_status === 'trial' && new Date() < new Date(profile.trial_ends_at)) return true;
```
`new Date()` here is the browser's local clock. Combined with finding #4 (no re-check at the point of the write), a user can extend their own trial indefinitely by turning back their system clock, if nothing server-side also gates on `trial_ends_at`.

---

## LOW / COPY

### 14. First-sentence clarity is decent but not trade-specific despite the DB assuming "roofer"
**File:** `index.html` lines 541-551

The eyebrow ("For Service Businesses & Independent Contractors") and hero sub-copy read as generic B2B SaaS language rather than something a roofer would say about their own job. Given `trade` still defaults to `'roofer'` for every signup (finding #8) and the original product was roofer-specific before the "Broading niche" commit, there's a mismatch between who the database still assumes you're selling to and how generically the copy now reads. Not vague or jargon-heavy exactly — just not concrete about the actual mechanism ("automatic email + text follow-ups") until you scroll past the fold.

### 15. Pass — no card required before value
**[Live-verified]** I completed a full signup → onboarding → dashboard flow with zero payment prompts. "14 days free. No card required." is accurate as tested.

---

## Section-by-section answers you asked for directly

**1. Payments & webhooks** — cannot be answered pass/fail; see Critical #3. No webhook code exists in this repository at all. I need to know where (or whether) it lives before I can check signature verification, idempotency, amount re-verification, or transactional entitlement flips.

**2. Auth & data access** — fail. See Critical #2 (any user can read all other users' data via RPC) and High #7 (possible fully-public `profiles` table). Base-table RLS on `quotes`/`profiles` for direct reads looked correctly scoped in my one live test. Expired-session mid-action: not tested live, but the code path (Supabase insert/update calls inside existing `try/catch`) would surface a raw "JWT expired"-style error via the generic error handlers in finding #10 rather than crash — confusing but not silent, except in `new-quote.html` where the SMS-consent crash (#1) happens first regardless of session state.

**3. Trial & onboarding flow** — landing → signup (4 fields: business name, your name, email, password) → onboarding ("pick a plan" screen, skippable) → dashboard = 2 pages, 4 form fields, 1 click to skip payment, before reaching the dashboard. That part is clean and fast. It falls apart immediately after: the very first action a new user takes on the dashboard (send a quote) is finding #1, a dead button. A non-technical contractor's dropout point is exactly there — first quote, first click, nothing happens, no error, no explanation. 14-day enforcement: soft-enforced client-side only (see #4, #13); I could not confirm server-side enforcement exists. No card requested before value — confirmed true (#15).

**4. Error states** — see findings #1, #10, #11.

**5. Mobile** — I could not get a live 375px screenshot (window resize was blocked in this sandbox), so this is CSS-only analysis. The dashboard/app side (sidebar, tables, forms) has real mobile breakpoints and looks deliberately handled. The marketing/nav side has the sign-in bug in #12. I'd recommend an actual on-device pass before launch to catch anything CSS analysis alone would miss (e.g. tap-target sizing, iOS input zoom on the 16px+ font check, sticky header overlap with the mobile sidebar toggle).

**6. Copy** — see #9 (fabricated testimonials, more of a trust issue than a clarity issue) and #14.

---

## What I need from you to close the gaps above

1. Where does the Dodo webhook handler actually live? (Critical #3 blocks a real answer to your entire "Payments and webhooks" section.)
2. Can you pull the actual RLS policies (`schema.sql` or Supabase dashboard → Database → Policies) for `profiles` and `quotes`, specifically the `UPDATE`/`INSERT` policies? That would let me confirm or rule out #4 and #7 without further live writes to production.
3. Do you want me to also pull and review the `send-message`/`send-followups` Edge Function source (if you can get it to me — it's not in this git repo)?

## Housekeeping from this audit

- I created one disposable test account (`hello+qcaudit1@reviewfilterglobal.com`) to verify the flows above, and deleted its `profiles` and `quotes` rows afterward. The Supabase **Auth** user record itself still exists (deleting it requires the service-role key, which I don't have) — you may want to remove it from Auth → Users.
- I did not modify any files except creating this report.
