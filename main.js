// main.js — Enterprise User & Group Management  UI v1.0.0
'use strict';

// ── Utilities ────────────────────────────────────────────────────────────────
const escHtml = s => s
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

function showToast(msg, duration = 2200) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

// ── Scroll reveal ─────────────────────────────────────────────────────────────
function initReveal() {
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'));
    return;
  }
  const io = new IntersectionObserver(
    entries => entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); }
    }),
    { threshold: 0.12 }
  );
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));
}

// ── Install tabs ──────────────────────────────────────────────────────────────
function initInstallTabs() {
  document.querySelectorAll('.install-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.install-tab').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      document.querySelectorAll('[role="tabpanel"]').forEach(p => { p.hidden = true; });
      const panel = document.getElementById('tab-' + tab);
      if (panel) panel.hidden = false;
    });
  });
}

// ── Copy helper ───────────────────────────────────────────────────────────────
async function copyText(text, btn, label) {
  try {
    await navigator.clipboard.writeText(text);
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 2000);
    }
    showToast(label || 'Copied to clipboard');
  } catch (_) {
    showToast('Copy failed — use Ctrl+C');
  }
}

function initCopyButtons() {
  const copyInstall = document.getElementById('copy-install-btn');
  if (copyInstall) {
    copyInstall.addEventListener('click', () => {
      const code = document.getElementById('install-code-block');
      if (code) copyText(code.innerText, copyInstall, 'Install commands copied');
    });
  }
  const copyCode = document.getElementById('copy-code-btn');
  if (copyCode) {
    copyCode.addEventListener('click', () => {
      const pre = document.getElementById('code-display');
      if (pre) copyText(pre.innerText, copyCode, 'Script copied');
    });
  }
}

// ── Syntax highlighter — line-by-line tokenizer ───────────────────────────────
const BASH_KEYWORDS = new Set([
  'if','then','else','elif','fi','for','while','do','done','case','esac','in',
  'function','return','local','readonly','export','source','set','trap',
  'continue','break','shift','exit','unset','declare','typeset','true','false'
]);

function highlightLine(raw) {
  const w = (cls, s) => `<span class="${cls}">${s}</span>`;
  let out = '', i = 0;
  const len = raw.length;

  while (i < len) {
    const ch = raw[i];

    // Comment — # at line start or after a non-word/assignment char
    if (ch === '#' && (i === 0 || /[\s=(:,;{|&!]/.test(raw[i - 1]))) {
      out += w('tk-comment', escHtml(raw.slice(i)));
      break;
    }

    // Double-quoted string (handles escaped quotes)
    if (ch === '"') {
      let j = i + 1;
      while (j < len && !(raw[j] === '"' && raw[j - 1] !== '\\')) j++;
      if (j < len) j++;
      out += w('tk-str', escHtml(raw.slice(i, j)));
      i = j; continue;
    }

    // Single-quoted string (no escaping inside)
    if (ch === "'") {
      let j = i + 1;
      while (j < len && raw[j] !== "'") j++;
      if (j < len) j++;
      out += w('tk-str', escHtml(raw.slice(i, j)));
      i = j; continue;
    }

    // Backtick command substitution
    if (ch === '`') {
      let j = i + 1;
      while (j < len && raw[j] !== '`') j++;
      if (j < len) j++;
      out += w('tk-fn', escHtml(raw.slice(i, j)));
      i = j; continue;
    }

    // Variable: ${VAR}, $VAR, $1, $@, $# etc.
    if (ch === '$') {
      if (raw[i + 1] === '{') {
        let j = i + 2, depth = 1;
        while (j < len && depth > 0) {
          if (raw[j] === '{') depth++;
          else if (raw[j] === '}') depth--;
          j++;
        }
        out += w('tk-var', escHtml(raw.slice(i, j)));
        i = j; continue;
      }
      // $() — command substitution, don't colour the whole expression
      if (raw[i + 1] === '(') { out += escHtml(ch); i++; continue; }
      // $VAR or special vars ($@, $#, $?, $!, $$, $-)
      let j = i + 1;
      if (j < len && /[A-Za-z_0-9@#?!*$\-]/.test(raw[j])) {
        while (j < len && /[A-Za-z0-9_]/.test(raw[j])) j++;
        out += w('tk-var', escHtml(raw.slice(i, j)));
        i = j; continue;
      }
    }

    // Flag: --flag or -f (only after whitespace / start of line)
    if (ch === '-' && (i === 0 || /\s/.test(raw[i - 1]))) {
      if (raw[i + 1] === '-') {
        let j = i + 2;
        while (j < len && /[a-zA-Z0-9_-]/.test(raw[j])) j++;
        if (j > i + 2) { out += w('tk-flag', escHtml(raw.slice(i, j))); i = j; continue; }
      } else if (/[a-zA-Z]/.test(raw[i + 1])) {
        let j = i + 2;
        while (j < len && /[a-zA-Z0-9]/.test(raw[j])) j++;
        out += w('tk-flag', escHtml(raw.slice(i, j))); i = j; continue;
      }
    }

    // Identifier / keyword
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < len && /[a-zA-Z0-9_]/.test(raw[j])) j++;
      const word = raw.slice(i, j);
      out += BASH_KEYWORDS.has(word) ? w('tk-kw', escHtml(word)) : escHtml(word);
      i = j; continue;
    }

    // Standalone integer (after space / operator)
    if (/[0-9]/.test(ch) && (i === 0 || /[\s=(:,|&]/.test(raw[i - 1]))) {
      let j = i;
      while (j < len && /[0-9]/.test(raw[j])) j++;
      out += w('tk-num', escHtml(raw.slice(i, j)));
      i = j; continue;
    }

    out += escHtml(ch);
    i++;
  }
  return out;
}

function highlightBash(rawCode) {
  const lines = rawCode.split('\n');
  return lines.map((line, idx) => {
    const num = `<span class="ln" aria-hidden="true">${String(idx + 1).padStart(4)}</span>`;
    return `<span class="code-line">${num}<span class="code-text">${highlightLine(line)}</span></span>`;
  }).join('\n');
}

// ── Explorer — badge helpers ──────────────────────────────────────────────────
const BADGE_CLASS = { core:'fb-core', module:'fb-module', config:'fb-config', install:'fb-install', test:'fb-test', data:'fb-data' };
const BADGE_LABEL = { core:'core', module:'module', config:'config', install:'install', test:'test', data:'csv' };
const FILE_ICON   = { core:'⚙', module:'🔧', config:'⚡', install:'📦', test:'🧪', data:'📄' };

// Group membership: maps script id → folder key
const SCRIPT_GROUPS = {
  master:'root', config:'root', install:'root',
  'create-users':'modules', 'create-groups':'modules', 'sudo-config':'modules',
  'password-policy':'modules', 'password-aging':'modules',
  'account-locking':'modules', 'audit-report':'modules',
  'users-csv':'data', 'groups-csv':'data', 'aging-csv':'data', 'locks-csv':'data',
  test:'tests'
};

const FOLDER_ORDER = ['root', 'modules', 'data', 'tests'];
const FOLDER_LABELS = { root: null, modules: 'modules/', data: 'data/', tests: 'tests/' };

// ── Script Explorer ────────────────────────────────────────────────────────────
function initExplorer() {
  if (typeof SCRIPTS_DATA === 'undefined' || !SCRIPTS_DATA || !SCRIPTS_DATA.length) return;

  const fileList    = document.getElementById('file-list');
  const codeDisplay = document.getElementById('code-display');
  const explorerFn  = document.getElementById('explorer-filename');
  const explorerDesc= document.getElementById('explorer-desc');
  const mobileSelect= document.getElementById('mobile-file-select');
  const copyCodeBtn = document.getElementById('copy-code-btn');

  if (!fileList || !codeDisplay) return;

  let activeScript = null;

  // ── Load a script into the viewer ─────────────────────────────────────────
  function loadFile(script) {
    activeScript = script;
    if (explorerFn)   explorerFn.textContent  = script.name;
    if (explorerDesc) explorerDesc.textContent = script.description;
    codeDisplay.innerHTML = highlightBash(script.code);

    // Update sidebar active state
    fileList.querySelectorAll('.file-item').forEach(el => {
      const isActive = el.dataset.id === script.id;
      el.classList.toggle('active', isActive);
      el.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    // Sync mobile select
    if (mobileSelect) mobileSelect.value = script.id;
  }

  // ── Build grouped sidebar ─────────────────────────────────────────────────
  const grouped = {};
  FOLDER_ORDER.forEach(k => { grouped[k] = []; });
  SCRIPTS_DATA.forEach(s => {
    const grp = SCRIPT_GROUPS[s.id] || 'root';
    if (!grouped[grp]) grouped[grp] = [];
    grouped[grp].push(s);
  });

  function makeFileItem(s, nested) {
    const item = document.createElement('div');
    item.className = 'file-item' + (nested ? ' file-item-nested' : '');
    item.dataset.id = s.id;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', 'false');
    item.setAttribute('tabindex', '0');

    const displayName = s.name
      .replace(/^modules\//, '')
      .replace(/^data\//, '')
      .replace(/^tests\//, '');

    const badgeCls = BADGE_CLASS[s.badge] || 'fb-module';
    const badgeLbl = BADGE_LABEL[s.badge] || s.badge;
    const icon     = FILE_ICON[s.badge]   || '📄';

    item.innerHTML =
      `<span class="file-item-icon" aria-hidden="true">${icon}</span>` +
      `<span class="file-item-name">${escHtml(displayName)}</span>` +
      `<span class="file-badge ${badgeCls}">${escHtml(badgeLbl)}</span>`;

    item.addEventListener('click', () => loadFile(s));
    item.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); loadFile(s); }
    });
    return item;
  }

  FOLDER_ORDER.forEach(key => {
    const items = grouped[key];
    if (!items || !items.length) return;

    const folderLabel = FOLDER_LABELS[key];
    if (folderLabel) {
      const hdr = document.createElement('div');
      hdr.className = 'sidebar-folder-header';
      hdr.setAttribute('aria-hidden', 'true');
      hdr.innerHTML =
        `<svg class="folder-chevron" width="10" height="10" viewBox="0 0 24 24" ` +
        `fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">` +
        `<polyline points="9 18 15 12 9 6"/></svg>` +
        `<span class="folder-icon">📂</span>` +
        `<span>${escHtml(folderLabel)}</span>`;
      fileList.appendChild(hdr);
    }

    items.forEach(s => fileList.appendChild(makeFileItem(s, !!folderLabel)));
  });

  // ── Populate mobile select ─────────────────────────────────────────────────
  if (mobileSelect) {
    FOLDER_ORDER.forEach(key => {
      const items = grouped[key];
      if (!items || !items.length) return;
      const folderLabel = FOLDER_LABELS[key];
      if (folderLabel) {
        const og = document.createElement('optgroup');
        og.label = folderLabel;
        items.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = s.name.replace(/^(modules|data|tests)\//, '');
          og.appendChild(opt);
        });
        mobileSelect.appendChild(og);
      } else {
        items.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = s.name;
          mobileSelect.appendChild(opt);
        });
      }
    });
    mobileSelect.addEventListener('change', () => {
      const s = SCRIPTS_DATA.find(x => x.id === mobileSelect.value);
      if (s) loadFile(s);
    });
  }

  // ── Copy code button ───────────────────────────────────────────────────────
  if (copyCodeBtn) {
    copyCodeBtn.addEventListener('click', () => {
      if (activeScript) copyText(activeScript.code, copyCodeBtn, 'Script copied');
    });
  }

  // Load first file
  if (SCRIPTS_DATA[0]) loadFile(SCRIPTS_DATA[0]);
}

// ── Active nav link on scroll ─────────────────────────────────────────────────
function initNavHighlight() {
  if (!('IntersectionObserver' in window)) return;
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.header-nav a[href^="#"]');
  const io = new IntersectionObserver(
    entries => entries.forEach(e => {
      if (e.isIntersecting) {
        navLinks.forEach(a => a.classList.remove('active'));
        const lnk = document.querySelector(`.header-nav a[href="#${e.target.id}"]`);
        if (lnk) lnk.classList.add('active');
      }
    }),
    { rootMargin: '-40% 0px -55% 0px' }
  );
  sections.forEach(s => io.observe(s));
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initReveal();
  initInstallTabs();
  initCopyButtons();
  initExplorer();
  initNavHighlight();
});
