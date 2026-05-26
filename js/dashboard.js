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

// ─── Get profile for current user ───────────────────────────────────────────
export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error) throw error;
  return data;
}

// ─── Access check (trial or active subscription) ────────────────────────────
export function hasAccess(profile) {
  if (!profile) return false;
  if (profile.subscription_status === 'active') return true;
  if (
    profile.subscription_status === 'trial' &&
    new Date() < new Date(profile.trial_ends_at)
  ) return true;
  return false;
}

// ─── Plan label for UI display ───────────────────────────────────────────────
export function getPlanLabel(profile) {
  if (!profile) return 'No Plan';
  if (profile.subscription_status === 'active') {
    const planNames = { solo: 'Solo', crew: 'Crew', pro: 'Pro' };
    return planNames[profile.plan] || 'Active';
  }
  if (profile.subscription_status === 'trial') {
    const trialEnd = new Date(profile.trial_ends_at);
    const now = new Date();
    if (now < trialEnd) {
      const daysLeft = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
      return `Trial — ${daysLeft}d left`;
    }
    return 'Trial Expired';
  }
  if (profile.subscription_status === 'expired') return 'Expired';
  if (profile.subscription_status === 'cancelled') return 'Cancelled';
  return 'Free';
}

// ─── Show paywall overlay (all dashboard pages except settings) ──────────────
export function showPaywall() {
  // Remove existing if any
  const existing = document.getElementById('qc-paywall');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'qc-paywall';
  overlay.innerHTML = `
    <div class="paywall-box">
      <div class="paywall-icon">🔒</div>
      <h2>Your trial has ended</h2>
      <p>Choose a plan to keep winning jobs from your quotes.</p>
      <div class="paywall-plans">
        <a href="/dashboard/settings.html#billing" class="paywall-btn paywall-btn--primary">
          View Plans &amp; Upgrade
        </a>
      </div>
      <p class="paywall-sub">Questions? Email <a href="mailto:hello@quotechase.io">hello@quotechase.io</a></p>
    </div>
  `;
  document.body.appendChild(overlay);
}

// ─── Render sidebar ──────────────────────────────────────────────────────────
export function renderSidebar(profile, activePage) {
  const label = getPlanLabel(profile);
  const name = sanitize(profile?.owner_name || profile?.business_name || 'Account');

  const nav = [
    { id: 'dashboard', label: 'Dashboard',   icon: '▦',  href: '/dashboard/index.html' },
    { id: 'new-quote', label: 'New Quote',    icon: '+',  href: '/dashboard/new-quote.html' },
    { id: 'quotes',    label: 'All Quotes',   icon: '≡',  href: '/dashboard/quotes.html' },
    { id: 'settings',  label: 'Settings',     icon: '⚙',  href: '/dashboard/settings.html' },
  ];

  const navHTML = nav.map(item => `
    <a href="${item.href}" class="sidebar-link${activePage === item.id ? ' sidebar-link--active' : ''}">
      <span class="sidebar-link__icon">${item.icon}</span>
      <span class="sidebar-link__label">${item.label}</span>
    </a>
  `).join('');

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
      <nav class="sidebar-nav">
        ${navHTML}
      </nav>
      <div class="sidebar-footer">
        <div class="sidebar-user">
          <div class="sidebar-user__name">${name}</div>
          <div class="sidebar-user__plan">${sanitize(label)}</div>
        </div>
        <button class="sidebar-signout" id="signout-btn" type="button">Sign out</button>
      </div>
    </aside>
    <button class="sidebar-toggle" id="sidebar-toggle" type="button" aria-label="Toggle menu">
      <span></span><span></span><span></span>
    </button>
    <div class="sidebar-backdrop" id="sidebar-backdrop"></div>
  `;

  const container = document.getElementById('sidebar-container');
  if (container) {
    container.innerHTML = sidebarHTML;
  } else {
    // Insert before first child of body
    const div = document.createElement('div');
    div.innerHTML = sidebarHTML;
    document.body.insertBefore(div, document.body.firstChild);
  }

  // Sign out button
  document.getElementById('signout-btn')?.addEventListener('click', () => signOut());

  // Mobile toggle
  const toggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');

  toggle?.addEventListener('click', () => {
    sidebar?.classList.toggle('sidebar--open');
    backdrop?.classList.toggle('backdrop--visible');
  });
  backdrop?.addEventListener('click', () => {
    sidebar?.classList.remove('sidebar--open');
    backdrop?.classList.remove('backdrop--visible');
  });
}
