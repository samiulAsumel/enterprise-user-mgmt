// playground.js — Enterprise User & Group Management  Interactive Playground  v1.0.0
'use strict';

(function () {

// ── Sample users for status dashboard ────────────────────────────────────────
const SAMPLE_USERS = [
  { name: 'alice',  state: 'active',  info: 'uid=1101 · developers · sudo', aging: 72, max: 90 },
  { name: 'carol',  state: 'active',  info: 'uid=1103 · ops_team · sudo',   aging: 45, max: 60 },
  { name: 'frank',  state: 'warning', info: 'uid=1106 · contractors',       aging: 28, max: 30 },
  { name: 'bob',    state: 'active',  info: 'uid=1102 · developers',        aging: 55, max: 90 },
  { name: 'dave',   state: 'active',  info: 'uid=1104 · ops_team',          aging: 12, max: 60 },
  { name: 'eve',    state: 'locked',  info: 'uid=1105 · auditors · LOCKED', aging: 0,  max: 365 }
];

// ── Build status dashboard ────────────────────────────────────────────────────
function buildStatusGrid() {
  const grid = document.getElementById('pg-status-grid');
  if (!grid) return;

  grid.innerHTML = SAMPLE_USERS.map(u => {
    const stateClass = u.state;
    const stateLabel = u.state === 'active' ? 'Active' : u.state === 'locked' ? 'Locked' : 'Expiring';
    const ssClass    = u.state === 'active' ? 'ss-active' : u.state === 'locked' ? 'ss-locked' : 'ss-warning';
    return `
    <div class="status-card ${stateClass}" role="article" aria-label="Account status for ${u.name}">
      <div>
        <span class="sc-state ${ssClass}" aria-label="Status: ${stateLabel}">${stateLabel}</span>
        <div class="sc-name">${u.name}</div>
      </div>
      <div class="sc-info">${u.info}</div>
    </div>`;
  }).join('');
}

// ── Range slider live values ──────────────────────────────────────────────────
function initRanges() {
  const ranges = [
    { input: 'pg-maxdays',      label: 'max-val'      },
    { input: 'pg-mindays',      label: 'min-val'      },
    { input: 'pg-warndays',     label: 'warn-val'     },
    { input: 'pg-inactivedays', label: 'inactive-val' }
  ];
  ranges.forEach(({ input, label }) => {
    const el = document.getElementById(input);
    const lb = document.getElementById(label);
    if (!el || !lb) return;
    el.addEventListener('input', () => {
      lb.textContent = el.value;
      updateAgingBar();
    });
  });
}

// ── Aging bar update ──────────────────────────────────────────────────────────
function updateAgingBar() {
  const maxEl  = document.getElementById('pg-maxdays');
  const warnEl = document.getElementById('pg-warndays');
  const fill   = document.getElementById('aging-bar-fill');
  const pct    = document.getElementById('aging-bar-pct');
  const warnMk = document.getElementById('warn-marker');
  if (!maxEl || !fill) return;

  const max  = parseInt(maxEl.value)  || 90;
  const warn = parseInt(warnEl?.value)|| 14;

  // Simulate: assume password is ~60% through its life
  const simDay  = Math.round(max * 0.6);
  const percent = Math.min(100, Math.round((simDay / max) * 100));

  fill.style.width = percent + '%';
  if (pct) pct.textContent = percent + '%';

  // Color
  fill.className = 'chage-bar-fill';
  const daysLeft = max - simDay;
  if (daysLeft <= warn) {
    fill.classList.add(daysLeft <= 0 ? 'expired' : 'warning');
  } else {
    fill.classList.add('good');
  }

  if (warnMk) {
    const warnPct = Math.round(((max - warn) / max) * 100);
    warnMk.style.marginLeft = `calc(${warnPct}% - 36px)`;
  }
}

// ── Generate commands ─────────────────────────────────────────────────────────
function generateCommands() {
  const username    = (document.getElementById('pg-username')?.value     || 'jsmith').trim();
  const uid         = (document.getElementById('pg-uid')?.value          || '').trim();
  const group       = (document.getElementById('pg-group')?.value        || 'developers').trim();
  const shell       = (document.getElementById('pg-shell')?.value        || '/bin/bash').trim();
  const comment     = (document.getElementById('pg-comment')?.value      || '').trim();
  const secGroups   = (document.getElementById('pg-secgroups')?.value    || '').trim();
  const maxDays     = document.getElementById('pg-maxdays')?.value       || '90';
  const minDays     = document.getElementById('pg-mindays')?.value       || '1';
  const warnDays    = document.getElementById('pg-warndays')?.value      || '14';
  const inactiveDays= document.getElementById('pg-inactivedays')?.value  || '30';
  const expireDate  = (document.getElementById('pg-expire')?.value       || '').trim();
  const lockAction  = document.getElementById('pg-lock-action')?.value   || 'none';

  const lines = [];

  // ── useradd command ────────────────────────────────────────────────────────
  const ua = ['useradd'];
  ua.push('-m');
  if (uid)     ua.push(`-u ${uid}`);
  ua.push(`-g ${group}`);
  if (secGroups) ua.push(`-G ${secGroups.replace(/\s*,\s*/g, ',')}`);
  ua.push(`-s ${shell}`);
  if (comment) ua.push(`-c "${comment}"`);
  ua.push(username);

  lines.push('<span class="out-head">── User Creation ────────────────────────</span>');
  lines.push(`<span class="out-cmd">$ sudo ${ua.join(' \\\n      ')}</span>`);
  lines.push('');

  // Lock until admin sets password
  lines.push(`<span class="out-info"># Lock account until admin sets password</span>`);
  lines.push(`<span class="out-cmd">$ sudo passwd -l ${username}</span>`);
  lines.push('');

  // ── chage command ──────────────────────────────────────────────────────────
  lines.push('<span class="out-head">── Password Aging ───────────────────────</span>');
  let chage = `sudo chage -M ${maxDays} -m ${minDays} -W ${warnDays} -I ${inactiveDays}`;
  if (expireDate) chage += ` -E ${expireDate}`;
  chage += ` ${username}`;
  lines.push(`<span class="out-cmd">$ ${chage}</span>`);
  lines.push('');

  lines.push(`<span class="out-info"># Verify aging settings</span>`);
  lines.push(`<span class="out-cmd">$ sudo chage -l ${username}</span>`);
  lines.push('');

  // ── Aging summary ──────────────────────────────────────────────────────────
  lines.push(`<span class="out-info">  Maximum number of days between password change : ${maxDays}</span>`);
  lines.push(`<span class="out-info">  Minimum number of days between password change : ${minDays}</span>`);
  lines.push(`<span class="out-info">  Number of days of warning before password expires : ${warnDays}</span>`);
  lines.push(`<span class="out-info">  Password inactive after expiry (days) : ${inactiveDays}</span>`);
  if (expireDate) {
    lines.push(`<span class="out-info">  Account expires : ${expireDate}</span>`);
  } else {
    lines.push(`<span class="out-info">  Account expires : never</span>`);
  }
  lines.push('');

  // ── Account action ─────────────────────────────────────────────────────────
  if (lockAction !== 'none') {
    lines.push('<span class="out-head">── Account Action ───────────────────────</span>');
    switch (lockAction) {
      case 'lock':
        lines.push(`<span class="out-cmd">$ sudo passwd -l ${username}</span>`);
        lines.push(`<span class="out-warn">  ⚠  Account locked — user cannot log in</span>`);
        lines.push(`<span class="out-info"># Verify: passwd -S ${username} → shows LK</span>`);
        break;
      case 'unlock':
        lines.push(`<span class="out-cmd">$ sudo passwd -u ${username}</span>`);
        lines.push(`<span class="out-cmd">$ sudo faillock --user ${username} --reset</span>`);
        lines.push(`<span class="out-ok">  ✔ Account unlocked and faillock counters cleared</span>`);
        break;
      case 'reset':
        lines.push(`<span class="out-cmd">$ sudo faillock --user ${username} --reset</span>`);
        lines.push(`<span class="out-ok">  ✔ Failed login counter reset for ${username}</span>`);
        lines.push(`<span class="out-info"># View current faillock status:</span>`);
        lines.push(`<span class="out-cmd">$ sudo faillock --user ${username}</span>`);
        break;
    }
    lines.push('');
  }

  // ── Verification ──────────────────────────────────────────────────────────
  lines.push('<span class="out-head">── Verification ─────────────────────────</span>');
  lines.push(`<span class="out-cmd">$ id ${username}</span>`);
  lines.push(`<span class="out-info">  uid=<span class="out-ok">${uid || '(auto)'}</span>(${username}) gid=(${group}) groups=(${group})${secGroups ? ',' + secGroups : ''}</span>`);
  lines.push(`<span class="out-cmd">$ passwd -S ${username}</span>`);
  lines.push(`<span class="out-info">  ${username} LK (locked / password not set)</span>`);

  // ── Summary ───────────────────────────────────────────────────────────────
  const daysLeft = parseInt(maxDays) - Math.round(parseInt(maxDays) * 0.6);
  const statusColor = daysLeft <= parseInt(warnDays) ? 'out-warn' : 'out-ok';
  lines.push('');
  lines.push(`<span class="${statusColor}">  Password expires in ~${daysLeft} days (warn at ${warnDays} days remaining)</span>`);

  const output = document.getElementById('pg-output');
  if (output) output.innerHTML = lines.join('\n');

  updateAgingBar();
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  buildStatusGrid();
  initRanges();
  updateAgingBar();
  generateCommands();

  const btn = document.getElementById('pg-generate');
  if (btn) btn.addEventListener('click', generateCommands);

  // Live re-generate as user types
  ['pg-username','pg-uid','pg-group','pg-comment','pg-secgroups','pg-expire'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', generateCommands);
  });
  ['pg-shell','pg-lock-action'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', generateCommands);
  });
});

})();
