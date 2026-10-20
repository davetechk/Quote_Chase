// Anonymous page-view ping for public pages. Kept free of supabase-js so it stays tiny.
// Same project URL as js/supabase.js. Skipped in the admin's own browser.
const TRACK_URL = 'https://bqqyiawsawnoikyvoxfj.supabase.co/functions/v1/track';

export function trackVisit() {
  try { if (localStorage.getItem('qc_admin')) return; } catch (_) {}
  fetch(TRACK_URL, { method: 'POST', keepalive: true }).catch(() => {});
}
