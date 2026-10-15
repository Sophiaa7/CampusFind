/**
 * CampusFind – Smart Lost & Found Platform for University Communities
 * Frontend talks to the Python backend API (SQLite).
 * Falls back to localStorage if the API is unreachable (offline demo).
 */

const API = window.location.origin + '/api';

// ─── State ───────────────────────────────────────────────────────────────────
let state = {
  lost: [],
  found: [],
  recovered: [],
  currentMatch: null,
  useApi: true,
};

// ─── API helpers ─────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function loadFromApi() {
  try {
    const [lost, found, stats] = await Promise.all([
      api('GET', '/lost'),
      api('GET', '/found'),
      api('GET', '/stats'),
    ]);
    state.lost = lost;
    state.found = found;
    state.useApi = true;
    return stats;
  } catch (e) {
    console.warn('API unavailable, falling back to localStorage', e);
    state.useApi = false;
    loadLocal();
    return null;
  }
}

// ─── localStorage fallback ───────────────────────────────────────────────────
const STORAGE_KEY = 'campusfind_data_v1';

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state.lost = parsed.lost || [];
      state.found = parsed.found || [];
      state.recovered = parsed.recovered || [];
    }
  } catch (e) { /* ignore */ }
}

function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    lost: state.lost,
    found: state.found,
    recovered: state.recovered,
  }));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function daysBetween(d1, d2) {
  const a = new Date(d1);
  const b = new Date(d2);
  return Math.abs(Math.round((a - b) / 86400000));
}

function toast(msg, duration = 2800) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), duration);
}

function statusBadge(status) {
  const map = {
    lost: 'bg-red-100 text-red-700',
    found: 'bg-emerald-100 text-emerald-700',
    match: 'bg-amber-100 text-amber-800',
    pending: 'bg-blue-100 text-blue-700',
    recovered: 'bg-purple-100 text-purple-700',
  };
  const cls = map[status] || 'bg-slate-100 text-slate-600';
  return `<span class="status-badge ${cls}">${status}</span>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Client-side matching (used only in offline/localStorage mode) ───────────
function matchScore(lost, found) {
  let score = 0;
  if (lost.category && found.category &&
      lost.category.toLowerCase() === found.category.toLowerCase()) score += 35;
  if (lost.location && found.location &&
      lost.location.toLowerCase() === found.location.toLowerCase()) score += 25;
  const dayDiff = daysBetween(lost.date, found.date);
  if (dayDiff === 0) score += 20;
  else if (dayDiff <= 3) score += 15;
  else if (dayDiff <= 7) score += 10;
  else if (dayDiff <= 14) score += 5;
  const lostText = `${lost.name || ''} ${lost.description || ''}`.toLowerCase();
  const foundText = (found.description || '').toLowerCase();
  const stop = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'is', 'was', 'my', 'i']);
  const lostWords = lostText.split(/\W+/).filter(w => w.length > 2 && !stop.has(w));
  const foundWords = new Set(foundText.split(/\W+/).filter(w => w.length > 2));
  let hits = 0;
  lostWords.forEach(w => { if (foundWords.has(w)) hits++; });
  if (hits >= 3) score += 20;
  else if (hits === 2) score += 12;
  else if (hits === 1) score += 6;
  return Math.min(100, score);
}

function getLocalMatches() {
  const matches = [];
  state.lost.forEach(lost => {
    if (lost.status === 'recovered') return;
    state.found.forEach(found => {
      if (found.status === 'recovered') return;
      const already = state.recovered.some(r => r.lostId === lost.id && r.foundId === found.id);
      if (already) return;
      const score = matchScore(lost, found);
      if (score >= 45) matches.push({ lost, found, score });
    });
  });
  matches.sort((a, b) => b.score - a.score);
  return matches;
}

// ─── Stats & UI ──────────────────────────────────────────────────────────────
async function updateStats() {
  if (state.useApi) {
    try {
      const s = await api('GET', '/stats');
      document.getElementById('stat-lost').textContent = s.lost;
      document.getElementById('stat-found').textContent = s.found;
      document.getElementById('stat-matches').textContent = s.matches;
      document.getElementById('stat-recovered').textContent = s.recovered;
      const badge = document.getElementById('match-count');
      if (s.matches > 0) {
        badge.textContent = s.matches;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
      return;
    } catch (e) {
      state.useApi = false;
    }
  }
  // Local fallback
  const matches = getLocalMatches();
  document.getElementById('stat-lost').textContent = state.lost.filter(i => i.status !== 'recovered').length;
  document.getElementById('stat-found').textContent = state.found.filter(i => i.status !== 'recovered').length;
  document.getElementById('stat-matches').textContent = matches.length;
  document.getElementById('stat-recovered').textContent = state.recovered.length;
  const badge = document.getElementById('match-count');
  if (matches.length > 0) {
    badge.textContent = matches.length;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// ─── Navigation ──────────────────────────────────────────────────────────────
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  const el = document.getElementById('page-' + pageId);
  if (el) {
    el.classList.remove('hidden');
    el.classList.add('fade-in');
  }
  if (pageId === 'search') renderSearch();
  if (pageId === 'matches') renderMatches();
  if (pageId === 'home') updateStats();
  const mm = document.getElementById('mobile-menu');
  if (mm && !mm.classList.contains('hidden')) mm.classList.add('hidden');
}

function toggleMobileMenu() {
  document.getElementById('mobile-menu').classList.toggle('hidden');
}

// ─── Forms ───────────────────────────────────────────────────────────────────
async function submitLost(e) {
  e.preventDefault();
  const f = e.target;
  const payload = {
    name: f.name.value.trim(),
    category: f.category.value,
    date: f.date.value,
    location: f.location.value,
    description: f.description.value.trim(),
    secret: f.secret.value.trim(),
    contact: f.contact.value.trim(),
  };

  if (state.useApi) {
    try {
      await api('POST', '/lost', payload);
      toast('Lost report submitted successfully!');
      f.reset();
      await loadFromApi();
      updateStats();
      showPage('home');
      return;
    } catch (err) {
      toast('API error: ' + err.message);
      return;
    }
  }

  // Local fallback
  const item = { id: uid(), type: 'lost', ...payload, status: 'lost', createdAt: new Date().toISOString() };
  state.lost.push(item);
  saveLocal();
  updateStats();
  f.reset();
  toast('Lost report submitted (offline mode)!');
  showPage('home');
}

async function submitFound(e) {
  e.preventDefault();
  const f = e.target;
  const payload = {
    category: f.category.value,
    date: f.date.value,
    location: f.location.value,
    description: f.description.value.trim(),
    deposit: f.deposit.value.trim(),
    contact: f.contact.value.trim(),
  };

  if (state.useApi) {
    try {
      await api('POST', '/found', payload);
      toast('Found report submitted – thank you!');
      f.reset();
      await loadFromApi();
      updateStats();
      showPage('home');
      return;
    } catch (err) {
      toast('API error: ' + err.message);
      return;
    }
  }

  const item = { id: uid(), type: 'found', ...payload, status: 'found', createdAt: new Date().toISOString() };
  state.found.push(item);
  saveLocal();
  updateStats();
  f.reset();
  toast('Found report submitted (offline mode)!');
  showPage('home');
}

// ─── Search ──────────────────────────────────────────────────────────────────
function renderSearch() {
  const q = (document.getElementById('search-input').value || '').toLowerCase().trim();
  const filter = document.getElementById('search-filter').value;
  const container = document.getElementById('search-results');

  let items = [];
  if (filter === 'all' || filter === 'lost') {
    items = items.concat(state.lost.map(i => ({ ...i, _type: 'lost' })));
  }
  if (filter === 'all' || filter === 'found') {
    items = items.concat(state.found.map(i => ({ ...i, _type: 'found' })));
  }

  if (q) {
    items = items.filter(i => {
      const hay = `${i.name || ''} ${i.category} ${i.location} ${i.description}`.toLowerCase();
      return hay.includes(q);
    });
  }

  items.sort((a, b) => new Date(b.created_at || b.createdAt || 0) - new Date(a.created_at || a.createdAt || 0));

  if (items.length === 0) {
    container.innerHTML = `
      <div class="text-center py-12 text-slate-500">
        <i class="fas fa-search text-3xl mb-3 opacity-40"></i>
        <p>No items match your search.</p>
      </div>`;
    return;
  }

  container.innerHTML = items.map(item => {
    const isLost = item._type === 'lost';
    const title = isLost ? (item.name || 'Unnamed item') : (item.category + ' item');
    return `
      <div class="bg-white rounded-xl border border-slate-200 p-5 card-hover transition">
        <div class="flex flex-wrap items-start justify-between gap-2 mb-2">
          <h3 class="font-semibold text-lg">${escapeHtml(title)}</h3>
          ${statusBadge(item.status === 'recovered' ? 'recovered' : item._type)}
        </div>
        <div class="text-sm text-slate-600 space-y-1">
          <p><i class="fas fa-tag w-4 text-slate-400"></i> ${escapeHtml(item.category)}</p>
          <p><i class="fas fa-map-marker-alt w-4 text-slate-400"></i> ${escapeHtml(item.location)}</p>
          <p><i class="fas fa-calendar w-4 text-slate-400"></i> ${item.date}</p>
          <p class="mt-2">${escapeHtml(item.description)}</p>
          ${!isLost && item.deposit ? `<p class="text-xs text-slate-500 mt-1"><i class="fas fa-box"></i> Kept at: ${escapeHtml(item.deposit)}</p>` : ''}
        </div>
      </div>`;
  }).join('');
}

// ─── Matches ─────────────────────────────────────────────────────────────────
async function renderMatches() {
  const container = document.getElementById('matches-list');
  let matches = [];

  if (state.useApi) {
    try {
      matches = await api('GET', '/matches');
    } catch (e) {
      state.useApi = false;
      matches = getLocalMatches();
    }
  } else {
    matches = getLocalMatches();
  }

  if (matches.length === 0) {
    container.innerHTML = `
      <div class="text-center py-16 text-slate-500">
        <i class="fas fa-link text-4xl mb-4 opacity-30"></i>
        <p class="text-lg font-medium">No possible matches yet</p>
        <p class="text-sm mt-1">Submit both lost and found reports with similar details to see matches appear here.</p>
      </div>`;
    return;
  }

  container.innerHTML = matches.map(m => {
    const pct = m.score;
    const barColor = pct >= 70 ? 'bg-emerald-500' : pct >= 55 ? 'bg-amber-500' : 'bg-orange-400';
    const lostId = m.lost.id;
    const foundId = m.found.id;
    return `
      <div class="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-sm">
        <div class="flex items-center justify-between mb-4">
          <span class="text-sm font-medium text-slate-500">Match confidence</span>
          <span class="font-bold text-brand-700">${pct}%</span>
        </div>
        <div class="w-full bg-slate-100 rounded-full h-2 mb-5">
          <div class="${barColor} h-2 rounded-full transition-all" style="width:${pct}%"></div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="bg-red-50 rounded-xl p-4 border border-red-100">
            <div class="text-xs font-semibold text-red-600 uppercase tracking-wide mb-2">Lost Report</div>
            <h4 class="font-bold">${escapeHtml(m.lost.name)}</h4>
            <p class="text-sm text-slate-600 mt-1">${escapeHtml(m.lost.category)} · ${escapeHtml(m.lost.location)}</p>
            <p class="text-sm text-slate-500">${m.lost.date}</p>
            <p class="text-sm mt-2 line-clamp-2">${escapeHtml(m.lost.description)}</p>
          </div>
          <div class="bg-emerald-50 rounded-xl p-4 border border-emerald-100">
            <div class="text-xs font-semibold text-emerald-600 uppercase tracking-wide mb-2">Found Report</div>
            <h4 class="font-bold">${escapeHtml(m.found.category)}</h4>
            <p class="text-sm text-slate-600 mt-1">${escapeHtml(m.found.location)}</p>
            <p class="text-sm text-slate-500">${m.found.date}</p>
            <p class="text-sm mt-2 line-clamp-2">${escapeHtml(m.found.description)}</p>
            <p class="text-xs text-slate-500 mt-1">Kept: ${escapeHtml(m.found.deposit)}</p>
          </div>
        </div>
        <div class="mt-5 flex flex-wrap gap-3">
          <button onclick="startVerification('${lostId}','${foundId}')"
            class="bg-brand-600 hover:bg-brand-700 text-white font-semibold px-5 py-2.5 rounded-xl transition text-sm">
            <i class="fas fa-user-check mr-1"></i> Verify Ownership
          </button>
        </div>
      </div>`;
  }).join('');
}

// ─── Verification ────────────────────────────────────────────────────────────
function startVerification(lostId, foundId) {
  state.currentMatch = { lostId, foundId };
  document.getElementById('verify-input').value = '';
  document.getElementById('verify-error').classList.add('hidden');
  document.getElementById('verify-modal').classList.remove('hidden');
}

function closeVerifyModal() {
  document.getElementById('verify-modal').classList.add('hidden');
  state.currentMatch = null;
}

async function confirmVerification() {
  if (!state.currentMatch) return;
  const { lostId, foundId } = state.currentMatch;
  const secret = document.getElementById('verify-input').value.trim();

  if (state.useApi) {
    try {
      await api('POST', '/verify', { lostId, foundId, secret });
      closeVerifyModal();
      toast('Ownership verified! Item marked as Recovered.');
      await loadFromApi();
      updateStats();
      renderMatches();
      return;
    } catch (err) {
      document.getElementById('verify-error').textContent = err.message || 'Incorrect detail. Please try again.';
      document.getElementById('verify-error').classList.remove('hidden');
      return;
    }
  }

  // Local fallback
  const lost = state.lost.find(i => i.id === lostId);
  const found = state.found.find(i => i.id === foundId);
  if (!lost || !found) { closeVerifyModal(); return; }
  const input = secret.toLowerCase();
  const stored = (lost.secret || '').trim().toLowerCase();
  const ok = stored === '' ? input.length > 0 : input === stored;
  if (!ok) {
    document.getElementById('verify-error').classList.remove('hidden');
    return;
  }
  lost.status = 'recovered';
  found.status = 'recovered';
  state.recovered.push({ id: uid(), lostId, foundId, recoveredAt: new Date().toISOString(), itemName: lost.name });
  saveLocal();
  updateStats();
  closeVerifyModal();
  toast('Ownership verified! Item marked as Recovered.');
  renderMatches();
}

// ─── Demo data ───────────────────────────────────────────────────────────────
async function loadDemoData() {
  if (state.useApi) {
    if (!confirm('This will replace existing server data with sample reports. Continue?')) return;
    try {
      await api('POST', '/seed');
      toast('Demo data loaded – try the Matches page!');
      await loadFromApi();
      updateStats();
      showPage('home');
      return;
    } catch (err) {
      toast('Could not seed: ' + err.message);
      return;
    }
  }

  if (state.lost.length || state.found.length) {
    if (!confirm('This will replace existing data with sample reports. Continue?')) return;
  }
  state.lost = [
    { id: uid(), type: 'lost', name: 'iPhone 13 (Blue case)', category: 'Electronics', date: '2025-10-08', location: 'Library',
      description: 'Black iPhone 13 with a matte blue silicone case and a cracked screen protector. Last seen near the reading tables.',
      secret: 'blue case', contact: '0803XXXXXXX', status: 'lost', createdAt: new Date().toISOString() },
    { id: uid(), type: 'lost', name: 'Student ID Card – CS 2021', category: 'Identification cards', date: '2025-10-10', location: 'Lecture theatre',
      description: 'Student ID card, Computer Science, matric number ending 2147. Blue lanyard attached.',
      secret: '2147', contact: 'you@student.edu.ng', status: 'lost', createdAt: new Date().toISOString() },
    { id: uid(), type: 'lost', name: 'Black leather wallet', category: 'Wallets', date: '2025-10-05', location: 'Cafeteria',
      description: 'Black bifold leather wallet containing ATM cards and a few receipts. No cash left.',
      secret: 'ATM card ends 8891', contact: '0706XXXXXXX', status: 'lost', createdAt: new Date().toISOString() },
  ];
  state.found = [
    { id: uid(), type: 'found', category: 'Electronics', date: '2025-10-09', location: 'Library',
      description: 'Found a black smartphone with a blue case near the second-floor reading area. Screen has a protector that looks cracked.',
      deposit: 'Library Front Desk', contact: 'library@campus.edu.ng', status: 'found', createdAt: new Date().toISOString() },
    { id: uid(), type: 'found', category: 'Identification cards', date: '2025-10-10', location: 'Lecture theatre',
      description: 'Picked up a student ID card with a blue lanyard after the morning lecture in LT1.',
      deposit: 'With me – contact to arrange pickup', contact: '0812XXXXXXX', status: 'found', createdAt: new Date().toISOString() },
    { id: uid(), type: 'found', category: 'Keys', date: '2025-10-11', location: 'Hostel',
      description: 'Set of three keys on a metal ring with a small red plastic tag.',
      deposit: 'Hostel porter desk', contact: 'porter@hostel.edu.ng', status: 'found', createdAt: new Date().toISOString() },
  ];
  state.recovered = [];
  saveLocal();
  updateStats();
  toast('Demo data loaded – try the Matches page!');
  showPage('home');
}

// ─── Boot ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadFromApi();
  updateStats();
  showPage('home');
});
