// playground.js — Enterprise User & Group Management  Interactive Playground  v1.0.0
'use strict';

(function () {

// ── HTML escape — all user values go through this before innerHTML ─────────────
const esc = s => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// ── Sample users for status dashboard ────────────────────────────────────────
const SAMPLE_USERS = [
  { name: 'alice',  state: 'active',  info: 'uid=1101 · developers · sudo', aging: 72, max: 90  },
  { name: 'carol',  state: 'active',  info: 'uid=1103 · ops_team · sudo',   aging: 45, max: 60  },
  { name: 'frank',  state: 'warning', info: 'uid=1106 · contractors',       aging: 28, max: 30  },
  { name: 'bob',    state: 'active',  info: 'uid=1102 · developers',        aging: 55, max: 90  },
  { name: 'dave',   state: 'active',  info: 'uid=1104 · ops_team',          aging: 12, max: 60  },
  { name: 'eve',    state: 'locked',  info: 'uid=1105 · auditors · LOCKED', aging: 0,  max: 365 }
];

// ── Build status dashboard ────────────────────────────────────────────────────
function buildStatusGrid() {
  const grid = document.getElementById('pg-status-grid');
  if (!grid) return;
  grid.innerHTML = SAMPLE_USERS.map(u => {
    const stateLabel = u.state === 'active' ? 'Active' : u.state === 'locked' ? 'Locked' : 'Expiring';
    const ssClass    = u.state === 'active' ? 'ss-active' : u.state === 'locked' ? 'ss-locked' : 'ss-warning';
    return (
      `<div class="status-card ${esc(u.state)}" role="article" aria-label="Account status for ${esc(u.name)}">` +
        `<div>` +
          `<span class="sc-state ${ssClass}" aria-label="Status: ${esc(stateLabel)}">${esc(stateLabel)}</span>` +
          `<div class="sc-name">${esc(u.name)}</div>` +
        `</div>` +
        `<div class="sc-info">${esc(u.info)}</div>` +
      `</div>`
    );
  }).join('');
}

// ── Range slider live values ──────────────────────────────────────────────────
function initRanges() {
  [
    ['pg-maxdays', 'max-val'],
    ['pg-mindays', 'min-val'],
    ['pg-warndays', 'warn-val'],
    ['pg-inactivedays', 'inactive-val']
  ].forEach(([inputId, labelId]) => {
    const el = document.getElementById(inputId);
    const lb = document.getElementById(labelId);
    if (!el || !lb) return;
    el.addEventListener('input', () => { lb.textContent = el.value; updateAgingBar(); });
  });
}

// ── Aging bar — simulates 50% elapsed life by default ────────────────────────
function updateAgingBar() {
  const maxEl  = document.getElementById('pg-maxdays');
  const warnEl = document.getElementById('pg-warndays');
  const fill   = document.getElementById('aging-bar-fill');
  const pctEl  = document.getElementById('aging-bar-pct');
  const warnMk = document.getElementById('warn-marker');
  if (!maxEl || !fill) return;

  const max  = Math.max(1, parseInt(maxEl.value)  || 90);
  const warn = Math.max(0, parseInt(warnEl?.value) || 14);

  // Simulate: password is at 50% of its life
  const simDay  = Math.round(max * 0.5);
  const percent = Math.min(100, Math.round((simDay / max) * 100));
  const daysLeft = max - simDay;

  fill.style.width = percent + '%';
  if (pctEl) pctEl.textContent = percent + '%';

  fill.className = 'chage-bar-fill';
  if (daysLeft <= 0) {
    fill.classList.add('expired');
  } else if (daysLeft <= warn) {
    fill.classList.add('warning');
  } else {
    fill.classList.add('good');
  }

  if (warnMk) {
    const warnPct = max > 0 ? Math.round(((max - warn) / max) * 100) : 80;
    warnMk.style.setProperty('--warn-pct', warnPct + '%');
  }
}

// ── Generate commands ─────────────────────────────────────────────────────────
function generateCommands() {
  // Read — never trust raw values for HTML; always escape
  const raw = {
    username:     (document.getElementById('pg-username')?.value      || 'jsmith').trim(),
    uid:          (document.getElementById('pg-uid')?.value           || '').trim(),
    group:        (document.getElementById('pg-group')?.value         || 'developers').trim(),
    shell:        (document.getElementById('pg-shell')?.value         || '/bin/bash'),
    comment:      (document.getElementById('pg-comment')?.value       || '').trim(),
    secGroups:    (document.getElementById('pg-secgroups')?.value     || '').trim(),
    maxDays:      (document.getElementById('pg-maxdays')?.value       || '90'),
    minDays:      (document.getElementById('pg-mindays')?.value       || '1'),
    warnDays:     (document.getElementById('pg-warndays')?.value      || '14'),
    inactiveDays: (document.getElementById('pg-inactivedays')?.value  || '30'),
    expireDate:   (document.getElementById('pg-expire')?.value        || '').trim(),
    lockAction:   (document.getElementById('pg-lock-action')?.value   || 'none')
  };

  // Sanitise username to alphanumeric + underscore + hyphen (POSIX user name)
  const username = raw.username.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 32) || 'jsmith';
  const uid          = raw.uid.replace(/\D/g, '').slice(0, 6);
  const group        = raw.group.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'developers';
  const shell        = raw.shell;
  const comment      = raw.comment.slice(0, 80);
  const secGroups    = raw.secGroups.replace(/[^a-zA-Z0-9_,\- ]/g, '').replace(/\s*,\s*/g, ',').slice(0, 128);
  const maxDays      = String(Math.max(0, Math.min(99999, parseInt(raw.maxDays) || 90)));
  const minDays      = String(Math.max(0, Math.min(999,   parseInt(raw.minDays) || 1)));
  const warnDays     = String(Math.max(0, Math.min(999,   parseInt(raw.warnDays) || 14)));
  const inactiveDays = String(Math.max(0, Math.min(999,   parseInt(raw.inactiveDays) || 30)));
  const expireDate   = /^\d{4}-\d{2}-\d{2}$/.test(raw.expireDate) ? raw.expireDate : '';
  const lockAction   = raw.lockAction;

  // ── Build output lines (all user values escaped) ───────────────────────────
  const lines = [];
  const h = s => `<span class="out-head">${s}</span>`;
  const cmd = s => `<span class="out-cmd">$ ${esc(s)}</span>`;
  const info = s => `<span class="out-info">${esc(s)}</span>`;
  const ok   = s => `<span class="out-ok">${esc(s)}</span>`;
  const warn = s => `<span class="out-warn">${esc(s)}</span>`;

  // ── useradd ────────────────────────────────────────────────────────────────
  lines.push(h('── User Creation ────────────────────────'));
  const uaParts = ['useradd', '-m'];
  if (uid)       uaParts.push(`-u ${uid}`);
  uaParts.push(`-g ${group}`);
  if (secGroups) uaParts.push(`-G ${secGroups}`);
  uaParts.push(`-s ${shell}`);
  if (comment)   uaParts.push(`-c "${comment}"`);
  uaParts.push(username);
  lines.push(cmd('sudo ' + uaParts.join(' \\\n      ')));
  lines.push('');
  lines.push(info('# New accounts created with password locked'));
  lines.push(cmd(`sudo passwd -l ${username}`));
  lines.push('');

  // ── chage ─────────────────────────────────────────────────────────────────
  lines.push(h('── Password Aging ───────────────────────'));
  let chageCmd = `sudo chage -M ${maxDays} -m ${minDays} -W ${warnDays} -I ${inactiveDays}`;
  if (expireDate) chageCmd += ` -E ${expireDate}`;
  chageCmd += ` ${username}`;
  lines.push(cmd(chageCmd));
  lines.push('');
  lines.push(info('# Verify:'));
  lines.push(cmd(`sudo chage -l ${username}`));
  lines.push('');
  lines.push(info(`  Maximum number of days between password change : ${maxDays}`));
  lines.push(info(`  Minimum number of days between password change : ${minDays}`));
  lines.push(info(`  Number of days of warning before expiry        : ${warnDays}`));
  lines.push(info(`  Password inactive after expiry (days)          : ${inactiveDays}`));
  lines.push(info(`  Account expires : ${expireDate || 'never'}`));
  lines.push('');

  // ── Account action ─────────────────────────────────────────────────────────
  if (lockAction !== 'none') {
    lines.push(h('── Account Action ───────────────────────'));
    if (lockAction === 'lock') {
      lines.push(cmd(`sudo passwd -l ${username}`));
      lines.push(warn(`  ⚠  Account locked — user cannot log in`));
      lines.push(info(`  Verify: passwd -S ${username}  → shows LK`));
    } else if (lockAction === 'unlock') {
      lines.push(cmd(`sudo passwd -u ${username}`));
      lines.push(cmd(`sudo faillock --user ${username} --reset`));
      lines.push(ok(`  ✔ Account unlocked — faillock counters cleared`));
    } else if (lockAction === 'reset') {
      lines.push(cmd(`sudo faillock --user ${username} --reset`));
      lines.push(ok(`  ✔ Failed login counter reset for ${username}`));
      lines.push(cmd(`sudo faillock --user ${username}`));
    }
    lines.push('');
  }

  // ── Verification ──────────────────────────────────────────────────────────
  lines.push(h('── Verification ─────────────────────────'));
  lines.push(cmd(`id ${username}`));
  const secDisplay = secGroups ? `,${secGroups}` : '';
  lines.push(info(`  uid=${uid || '(auto)'}(${username}) gid=(${group}) groups=(${group})${secDisplay}`));
  lines.push(cmd(`passwd -S ${username}`));
  lines.push(info(`  ${username} LK (locked / password not set)`));
  lines.push('');

  // ── Summary ───────────────────────────────────────────────────────────────
  const daysLeft = Math.round(parseInt(maxDays) * 0.5);
  const expired  = daysLeft <= 0;
  const inWarn   = daysLeft <= parseInt(warnDays) && !expired;
  if (expired) {
    lines.push(warn(`  ⚠ Password would expire in ${daysLeft} days (within warn zone of ${warnDays} days)`));
  } else if (inWarn) {
    lines.push(warn(`  ⚠ Only ${daysLeft} days left — within the ${warnDays}-day warning window`));
  } else {
    lines.push(ok(`  ✔ ${daysLeft} days remaining before expiry (warn starts at ${warnDays} days)`));
  }

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

  const genBtn = document.getElementById('pg-generate');
  if (genBtn) genBtn.addEventListener('click', generateCommands);

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
