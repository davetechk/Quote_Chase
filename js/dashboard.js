import { supabase } from './supabase.js';
import { getSession, signOut } from './auth.js';

// ─── Sanitize user content before innerHTML ──────────────────────────────────
export function sanitize(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ─── Require auth — redirect to login if no session ─────────────────────────
export async function requireAuth() {
  const session = await getSession();
  if (!session) {
    window.location.href = '/auth/login.html';
    throw new Error('no session');
  }
  return session;
}

// ─── Load who's signed in: { user, member, business, limits } ───────────────
export async function getContext() {
  const { user } = await requireAuth();
  const { data: member, error } = await supabase
    .from('members')
    .select('user_id, business_id, role, full_name, email, notify_email, notify_push')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  if (!member) {
    document.body.innerHTML = `<p style="padding:24px">We couldn't load your account. Please contact <a href="mailto:hello@getquotechase.com">hello@getquotechase.com</a></p>`;
    throw new Error('no profile');
  }
  const { data: business, error: bizError } = await supabase
    .from('businesses').select('*').eq('id', member.business_id).single();
  if (bizError) throw bizError;
  const { data: limits } = await supabase.rpc('plan_limits', { p_plan: business.plan });
  return { user, member, business, limits: limits?.[0] || { monthly_quotes: null, seats: null, invoicing: false } };
}

// Errors init() can end with on purpose (after a redirect or a shown message)
export const QUIET_ERRORS = ['no session', 'no profile', 'not admin'];

// ─── Money (accepts a currency 'GBP'/'USD' or a country 'GB'/'US') ──────────
export function formatMoney(amount, currencyOrCountry) {
  const usd = currencyOrCountry === 'USD' || currencyOrCountry === 'US';
  return new Intl.NumberFormat(usd ? 'en-US' : 'en-GB', {
    style: 'currency', currency: usd ? 'USD' : 'GBP', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(Number(amount) || 0);
}

export function formatDate(iso, withYear) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(withYear && { year: 'numeric' }) });
}

// ─── Access (UI only — the server enforces the real rules) ──────────────────
export function hasAccess(business) {
  if (['active', 'past_due'].includes(business.status)) return true;
  return business.status === 'trialing' && new Date() < new Date(business.trial_ends_at);
}

export function trialDaysLeft(business) {
  return Math.max(0, Math.ceil((new Date(business.trial_ends_at) - new Date()) / 864e5));
}

const PLAN_NAMES = { trial: 'Free trial', solo: 'Solo', crew: 'Crew', pro: 'Pro' };
export function planLabel(business) {
  if (business.plan === 'trial') return hasAccess(business) ? `Trial — ${trialDaysLeft(business)}d left` : 'Trial ended';
  const name = PLAN_NAMES[business.plan] || 'Plan';
  return { active: name, past_due: `${name} — payment due`, cancelled: `${name} — cancelled`, expired: `${name} — expired` }[business.status] || name;
}

// Inline banner at the top of the page when the trial/plan has lapsed
export function showNoAccessBanner() {
  const banner = document.createElement('div');
  banner.className = 'alert alert--info visible no-access';
  banner.innerHTML = `<span>Your trial has ended — choose a plan to keep chasing quotes.</span>
    <a href="/dashboard/settings.html#billing" class="btn btn--primary btn--sm">Choose a plan</a>`;
  document.querySelector('.dashboard-body')?.prepend(banner);
}

// ─── Quote status + activity text (dashboard, quotes) ───────────────────────
export function statusBadge(q) {
  const label = { sent: 'Following up', replied: 'Replied', won: 'Won', lost: 'Lost' }[q.status] || q.status;
  const cls = { sent: 'followup', replied: 'replied', won: 'won', lost: 'lost' }[q.status] || 'sent';
  return `<span class="badge badge--${cls}">${sanitize(label)}</span>` +
    (q.paused && q.status === 'sent' ? ' <span class="badge badge--sent">Paused</span>' : '');
}

const FOLLOWUP_DAYS = [2, 5, 10, 20];
// Plain-text sentence for a quote_events row (caller escapes/uses textContent)
export function eventText(ev, quote) {
  const who = quote?.customer_name || 'The customer';
  const amount = quote ? formatMoney(quote.amount, quote.currency) : '';
  const d = ev.detail || {};
  switch (ev.type) {
    case 'sent':          return `Quote sent to ${who}`;
    case 'followup_sent': return `Day-${d.day || FOLLOWUP_DAYS[(d.step || 1) - 1] || '?'} follow-up sent to ${who}`;
    case 'viewed':        return `${who} opened your quote`;
    case 'replied':       return `${who} replied`;
    case 'accepted':      return `${who} accepted ${amount}`;
    case 'declined':      return `${who} declined the quote`;
    case 'question':      return `${who} asked: “${d.message || ''}”`;
    case 'status_changed':return `Marked ${d.to || 'updated'}${d.from ? ` (was ${d.from})` : ''}`;
    case 'send_failed':   return `Couldn't send to ${who}${d.channel ? ` by ${d.channel}` : ''}${d.error ? ` — ${d.error}` : ''}`;
    default:              return ev.type;
  }
}

export function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return formatDate(iso);
}

// ─── Install prompt (captured early; shown in the sidebar) ───────────────────
let installEvent = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installEvent = e;
  document.getElementById('install-btn')?.removeAttribute('hidden');
});

// ─── Render sidebar ──────────────────────────────────────────────────────────
export function renderSidebar({ member, business, limits }, activePage) {
  const nav = [
    { id: 'dashboard', label: 'Dashboard',  icon: '▦', href: '/dashboard/index.html' },
    { id: 'quotes',    label: 'Quotes',     icon: '≡', href: '/dashboard/quotes.html' },
    { id: 'new-quote', label: 'New quote',  icon: '+', href: '/dashboard/new-quote.html' },
    limits.invoicing && { id: 'invoices', label: 'Invoices', icon: '£', href: '/dashboard/invoices.html' },
    { id: 'settings',  label: 'Settings',   icon: '⚙', href: '/dashboard/settings.html' },
  ].filter(Boolean);

  const link = item => `
    <a href="${item.href}" class="sidebar-link${activePage === item.id ? ' sidebar-link--active' : ''}">
      <span class="sidebar-link__icon">${item.icon}</span>
      <span class="sidebar-link__label">${item.label}</span>
    </a>`;

  const sidebarHTML = `
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <a href="/dashboard/index.html" class="sidebar-logo">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 50" width="140" height="44">
            <g transform="translate(4,7)">
              <circle cx="18" cy="18" r="14" fill="none" stroke="#6B7280" stroke-width="3.5"/>
              <path d="M12 23 L32 3 M32 3 L22 3 M32 3 L32 13" stroke="#FF7A00" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
            </g>
            <text x="52" y="32" font-family="'DM Sans', sans-serif" font-size="20" font-weight="800" fill="#F8F9FA" letter-spacing="-0.5">Quote<tspan fill="#FF7A00" font-weight="400">Chase</tspan></text>
          </svg>
        </a>
      </div>
      <nav class="sidebar-nav" id="sidebar-nav">
        ${nav.map(link).join('')}
      </nav>
      <div class="sidebar-footer">
        <div class="sidebar-user">
          <div class="sidebar-user__name">${sanitize(member.full_name || business.name || 'Account')}</div>
          <div class="sidebar-user__role">${member.role === 'owner' ? 'Owner' : 'Team member'} · ${sanitize(business.name)}</div>
          <div class="sidebar-user__plan">${sanitize(planLabel(business))}</div>
        </div>
        <button class="sidebar-install" id="install-btn" type="button" hidden>Install app</button>
        <p class="sidebar-install-hint" id="install-hint" hidden>Install: tap Share → Add to Home Screen</p>
        <button class="sidebar-signout" id="signout-btn" type="button">Sign out</button>
      </div>
    </aside>
    <button class="sidebar-toggle" id="sidebar-toggle" type="button" aria-label="Toggle menu">
      <span></span><span></span><span></span>
    </button>
    <div class="sidebar-backdrop" id="sidebar-backdrop"></div>
  `;

  document.getElementById('sidebar-container').innerHTML = sidebarHTML;

  // Admin link only for admins (RPC returns false for everyone else)
  supabase.rpc('is_admin').then(({ data }) => {
    if (data === true) document.getElementById('sidebar-nav')
      .insertAdjacentHTML('beforeend', link({ id: 'admin', label: 'Admin', icon: '◆', href: '/admin/index.html' }));
  });

  document.getElementById('signout-btn').addEventListener('click', () => signOut());

  // Install app: Chrome/Android prompt, or a hint on iOS Safari; nothing once installed
  const installBtn = document.getElementById('install-btn');
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (installEvent && !standalone) installBtn.hidden = false;
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone) document.getElementById('install-hint').hidden = false;
  installBtn.addEventListener('click', async () => {
    installBtn.hidden = true;
    await installEvent?.prompt();
    installEvent = null;
  });

  // Mobile toggle
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  document.getElementById('sidebar-toggle').addEventListener('click', () => {
    sidebar.classList.toggle('sidebar--open');
    backdrop.classList.toggle('backdrop--visible');
  });
  backdrop.addEventListener('click', () => {
    sidebar.classList.remove('sidebar--open');
    backdrop.classList.remove('backdrop--visible');
  });
}
