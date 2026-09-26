/* 麦版正赛阵容取名册 —— 前端逻辑 */
'use strict';

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

const CLEAN = { '缠': '草', '盏': '金', '花': '金', '晶': '若', '钻': '若', '胖': '坚', '竹': '奶' };
const EXTRA = { '水': '草', '豌': '狙' };

// 搜索归一化：与后端一致（清洗 + 同字替换 + 去标点）
function norm(s) {
  return [...String(s)].map(ch => EXTRA[CLEAN[ch] || ch] || CLEAN[ch] || ch)
    .join('').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
}

const state = {
  lineups: [],
  names: [],
  namesByKey: new Map(),
  me: { user: null, admin: false },
  seasons: new Set(['S4', 'S5', 'S6', 'S7']),
  championOnly: false,
  number: '',
  keyword: '',
  sort: 'key',
  activeView: 'browse',
  modalKey: null,
};

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw new Error((data && data.error) || `请求失败(${res.status})`);
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2200);
}

function fmtTime(iso) {
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- 数据加载 ----------
async function loadAll() {
  try {
    const [l, n, m] = await Promise.all([api('/api/lineups'), api('/api/names'), api('/api/me')]);
    state.lineups = l.lineups;
    state.names = n.names;
    state.me = m;
    buildIndex();
    updateUserBar();
    render();
  } catch (e) {
    toast(e.message);
  }
}

function buildIndex() {
  state.namesByKey = new Map();
  for (const nm of state.names) {
    if (!state.namesByKey.has(nm.lineupKey)) state.namesByKey.set(nm.lineupKey, []);
    state.namesByKey.get(nm.lineupKey).push(nm);
  }
}

// ---------- 过滤 ----------
function filterLineups() {
  const num = state.number.trim();
  const kw = norm(state.keyword.trim());
  return state.lineups.filter(l => {
    if (!state.seasons.has(l.season)) return false;
    if (state.championOnly && !l.isChampion) return false;
    if (num && !String(l.row).includes(num)) return false;
    if (kw && !l.search.includes(kw)) return false;
    return true;
  });
}

// ---------- 渲染 ----------
function render() {
  if (state.activeView === 'browse') renderBrowse();
  else renderRanks();
}

function cardHtml(l) {
  const names = state.namesByKey.get(l.key) || [];
  const badges = (l.isChampion ? '<span class="badge champ">冠</span>' : '') +
    (l.isShoubai ? '<span class="badge sb">败</span>' : '');
  const ncount = names.length;
  return `<div class="card ${l.isChampion ? 'champ' : ''}" data-key="${l.key}">
    <div class="card-head"><span class="card-key">${l.key}</span>${badges}</div>
    <div class="card-text">${escapeHtml(l.text)}</div>
    <div class="card-names ${ncount ? 'has' : ''}">${ncount ? `已有 ${ncount} 个名字` : '还没有名字'}</div>
  </div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderBrowse() {
  const list = filterLineups();
  const grid = $('#grid');
  grid.innerHTML = list.map(cardHtml).join('');
  $('#empty').classList.toggle('hidden', list.length > 0);
  grid.querySelectorAll('.card').forEach(el => {
    el.addEventListener('click', () => openModal(el.dataset.key));
  });
}

function renderRanks() {
  const list = filterLineups().filter(l => (state.namesByKey.get(l.key) || []).length > 0);
  if (state.sort === 'likes-desc') {
    list.sort((a, b) => likesOf(b.key) - likesOf(a.key) || a.key.localeCompare(b.key));
  } else if (state.sort === 'likes-asc') {
    list.sort((a, b) => likesOf(a.key) - likesOf(b.key) || a.key.localeCompare(b.key));
  } else {
    list.sort((a, b) => a.row - b.row || a.col - b.col);
  }
  const wrap = $('#rankList');
  if (!list.length) { wrap.innerHTML = ''; $('#rankEmpty').classList.remove('hidden'); return; }
  $('#rankEmpty').classList.add('hidden');
  wrap.innerHTML = list.map(l => {
    const names = state.namesByKey.get(l.key) || [];
    const badges = (l.isChampion ? '<span class="badge champ">冠</span>' : '') +
      (l.isShoubai ? '<span class="badge sb">败</span>' : '');
    return `<div class="rank-item" data-key="${l.key}">
      <div class="rank-side" data-open="${l.key}">
        <div class="rank-key">${l.key} ${badges}</div>
        <div class="rank-text">${escapeHtml(l.text)}</div>
      </div>
      <div class="rank-names">${names.map(n => nameItemHtml(n)).join('')}</div>
    </div>`;
  }).join('');
  wrap.querySelectorAll('[data-open]').forEach(el => {
    el.addEventListener('click', () => openModal(el.dataset.open));
  });
  bindNameActions(wrap);
}

function likesOf(key) {
  return (state.namesByKey.get(key) || []).reduce((s, n) => s + n.likes, 0);
}

// ---------- 名字条目 ----------
function nameItemHtml(n) {
  const me = state.me;
  const editable = me.admin || (me.user && n.authorId === me.user.id);
  const originHtml = n.origin
    ? `<div class="origin">${escapeHtml(n.origin)}</div>
       <button class="origin-toggle">展开</button>`
    : '';
  return `<div class="name-item" data-id="${n.id}" data-key="${n.lineupKey}">
    <div class="nm-row">
      <span class="nm-name">${escapeHtml(n.name)}</span>
      <span class="nm-meta">by ${escapeHtml(n.author || '（管理员）')} · ${fmtTime(n.createdAt)}</span>
      ${editable ? `<span class="nm-actions">
        <button class="btn small act-edit">编辑</button>
        <button class="btn small danger act-del">删除</button>
      </span>` : ''}
      <button class="like-btn ${n.likedByMe ? 'liked' : ''}" data-id="${n.id}">赞 <span class="cnt">${n.likes}</span></button>
    </div>
    ${originHtml}
  </div>`;
}

function bindNameActions(root) {
  root.querySelectorAll('.like-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleLike(Number(btn.dataset.id), btn);
    });
  });
  root.querySelectorAll('.origin-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const origin = btn.previousElementSibling;
      origin.classList.toggle('open');
      btn.textContent = origin.classList.contains('open') ? '收起' : '展开';
    });
  });
  root.querySelectorAll('.act-edit').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      startEdit(btn.closest('.name-item'));
    });
  });
  root.querySelectorAll('.act-del').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      delName(btn.closest('.name-item'));
    });
  });
}

async function toggleLike(id, btn) {
  if (!state.me.user) { openAuth(); return; }
  try {
    const r = await api(`/api/names/${id}/like`, { method: 'POST' });
    btn.classList.toggle('liked', r.liked);
    btn.querySelector('.cnt').textContent = r.likes;
    updateNameState(id, r.likes, r.liked);
  } catch (e) { toast(e.message); }
}

function updateNameState(id, likes, liked) {
  const n = state.names.find(x => x.id === id);
  if (n) { n.likes = likes; n.likedByMe = liked; }
  const r = $(`#rankList .name-item[data-id="${id}"] .cnt`);
  if (r) r.textContent = likes;
  const lk = $(`#mNames .name-item[data-id="${id}"] .like-btn`);
  if (lk) { lk.classList.toggle('liked', liked); lk.querySelector('.cnt').textContent = likes; }
  if (state.activeView === 'ranks') {
    // 点赞可能影响排序，简单重排
    renderRanks();
  }
}

async function delName(item) {
  const id = Number(item.dataset.id);
  if (!confirm('确定删除这个名字？')) return;
  try {
    await api(`/api/names/${id}`, { method: 'DELETE' });
    state.names = state.names.filter(x => x.id !== id);
    buildIndex();
    toast('已删除');
    refreshViews();
  } catch (e) { toast(e.message); }
}

function startEdit(item) {
  const id = Number(item.dataset.id);
  const n = state.names.find(x => x.id === id);
  const originEl = item.querySelector('.origin');
  item.innerHTML = `<div class="nm-row" style="flex-wrap:wrap">
      <input class="inp" style="flex:1;min-width:160px" value="${escapeHtml(n.name)}">
    </div>
    <textarea class="inp" rows="2" placeholder="由来">${escapeHtml(n.origin || '')}</textarea>
    <div style="display:flex;gap:8px">
      <button class="btn small primary act-save">保存</button>
      <button class="btn small act-cancel">取消</button>
    </div>`;
  item.querySelector('.act-save').addEventListener('click', async () => {
    const name = item.querySelector('input').value.trim();
    const origin = item.querySelector('textarea').value.trim();
    if (!name) { toast('名字不能为空'); return; }
    try {
      await api(`/api/names/${id}`, { method: 'PUT', body: { name, origin } });
      const target = state.names.find(x => x.id === id);
      target.name = name; target.origin = origin;
      toast('已保存');
      refreshViews();
    } catch (e) { toast(e.message); }
  });
  item.querySelector('.act-cancel').addEventListener('click', () => refreshViews());
}

// ---------- 详情弹窗 ----------
function openModal(key) {
  const l = state.lineups.find(x => x.key === key);
  if (!l) return;
  state.modalKey = key;
  $('#mKey').innerHTML = `${l.key} ${l.isChampion ? '<span class="badge champ">冠军</span>' : ''}${l.isShoubai ? ' <span class="badge sb">首败</span>' : ''}`;
  $('#mText').textContent = l.text;
  renderModalNames();
  $('#modal').classList.remove('hidden');
}

function renderModalNames() {
  const key = state.modalKey;
  const names = state.namesByKey.get(key) || [];
  $('#mCount').textContent = names.length;
  $('#mNames').innerHTML = names.length
    ? names.map(nameItemHtml).join('')
    : '<div class="needlogin">这个阵容还没有名字，来贡献第一个吧！</div>';
  bindNameActions($('#mNames'));
  // 登录状态决定取名表单
  const needLogin = !state.me.user;
  $('#mNeedLogin').classList.toggle('hidden', !needLogin);
  $('#mAddForm').classList.toggle('hidden', needLogin);
  if (!needLogin) { $('#mNameInput').value = ''; $('#mOriginInput').value = ''; }
}

function refreshViews() {
  buildIndex();
  render();
  if (state.modalKey && $('#modal') && !$('#modal').classList.contains('hidden')) renderModalNames();
}

function closeModal() {
  $('#modal').classList.add('hidden');
  state.modalKey = null;
}

// ---------- 顶栏与账号 ----------
function updateUserBar() {
  const me = state.me;
  $('#userInfo').textContent = me.admin ? '（管理员）' : (me.user ? `你好，${me.user.nickname}` : '');
  $('#btnLogin').classList.toggle('hidden', !!(me.user || me.admin));
  $('#btnLogout').classList.toggle('hidden', !(me.user || me.admin));
  $('#btnAdmin').classList.toggle('hidden', me.admin);
  $('#mAddForm').classList.toggle('hidden', !me.user);
  $('#mNeedLogin').classList.toggle('hidden', !!me.user || !state.modalKey);
  if (state.modalKey) renderModalNames();
}

function openAuth() {
  $('#authMsg').textContent = '';
  $('#authModal').classList.remove('hidden');
}
function closeAuth() { $('#authModal').classList.add('hidden'); }

async function doAuth(mode) {
  const nickname = $('#aNick').value.trim();
  const password = $('#aPass').value;
  try {
    const r = await api(mode === 'login' ? '/api/login' : '/api/register', {
      method: 'POST', body: { nickname, password },
    });
    state.me = { user: r.user, admin: false };
    closeAuth();
    updateUserBar();
    toast(mode === 'login' ? '登录成功' : '注册成功');
    refreshViews();
  } catch (e) { $('#authMsg').textContent = e.message; }
}

// ---------- 管理 ----------
function openAdmin() {
  $('#amMsg').textContent = '';
  $('#ampMsg').textContent = '';
  const isAdmin = state.me.admin;
  $('#adminLoginForm').classList.toggle('hidden', isAdmin);
  $('#adminPassForm').classList.toggle('hidden', !isAdmin);
  $('#adminModal').classList.remove('hidden');
}

// ---------- 事件绑定 ----------
function bindEvents() {
  $$('.tab').forEach(t => t.addEventListener('click', () => {
    state.activeView = t.dataset.view;
    $$('.tab').forEach(x => x.classList.toggle('active', x === t));
    $('#view-browse').classList.toggle('hidden', state.activeView !== 'browse');
    $('#view-ranks').classList.toggle('hidden', state.activeView !== 'ranks');
    $('#fSort').classList.toggle('hidden', state.activeView !== 'ranks');
    render();
  }));

  $$('[data-season]').forEach(cb => cb.addEventListener('change', () => {
    if (cb.checked) state.seasons.add(cb.dataset.season);
    else state.seasons.delete(cb.dataset.season);
    render();
  }));
  $('#fChampion').addEventListener('change', e => { state.championOnly = e.target.checked; render(); });
  $('#fNumber').addEventListener('input', e => { state.number = e.target.value; render(); });
  $('#fKeyword').addEventListener('input', e => { state.keyword = e.target.value; render(); });
  $('#fSort').addEventListener('change', e => { state.sort = e.target.value; render(); });

  $('#mClose').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  $('#mLoginLink').addEventListener('click', e => { e.preventDefault(); closeModal(); openAuth(); });

  $('#mAddForm').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('#mNameInput').value.trim();
    const origin = $('#mOriginInput').value.trim();
    if (!name) { toast('名字不能为空'); return; }
    try {
      const r = await api('/api/names', { method: 'POST', body: { lineupKey: state.modalKey, name, origin } });
      state.names.push(r.name);
      buildIndex();
      $('#mNameInput').value = '';
      $('#mOriginInput').value = '';
      renderModalNames();
      render();
      toast('名字已贡献');
    } catch (err) { toast(err.message); }
  });

  $('#btnLogin').addEventListener('click', openAuth);
  $('#aClose').addEventListener('click', closeAuth);
  $('#authModal').addEventListener('click', e => { if (e.target.id === 'authModal') closeAuth(); });
  $('#aSubmitLogin').addEventListener('click', () => doAuth('login'));
  $('#aSubmitReg').addEventListener('click', () => doAuth('register'));

  $('#btnLogout').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    state.me = { user: null, admin: false };
    updateUserBar();
    toast('已退出');
    refreshViews();
  });

  $('#btnAdmin').addEventListener('click', openAdmin);
  $('#amClose').addEventListener('click', () => $('#adminModal').classList.add('hidden'));
  $('#adminModal').addEventListener('click', e => { if (e.target.id === 'adminModal') $('#adminModal').classList.add('hidden'); });
  $('#adminLoginForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api('/api/admin/login', { method: 'POST', body: { password: $('#amPass').value } });
      state.me = { user: null, admin: true };
      $('#adminModal').classList.add('hidden');
      updateUserBar();
      toast('已进入管理模式');
      refreshViews();
    } catch (err) { $('#amMsg').textContent = err.message; }
  });
  $('#adminPassForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api('/api/admin/password', { method: 'POST', body: { old: $('#ampOld').value, next: $('#ampNew').value } });
      toast('管理员密码已修改');
      $('#ampOld').value = ''; $('#ampNew').value = '';
    } catch (err) { $('#ampMsg').textContent = err.message; }
  });
}

bindEvents();
loadAll();
