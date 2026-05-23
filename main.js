// main.js — Enterprise User & Group Management  UI v1.0.0
'use strict';

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, duration = 2200) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

// ── Scroll reveal ─────────────────────────────────────────────────────────────
function initReveal() {
  const io = new IntersectionObserver(
    (entries) => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); } }),
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
      document.querySelectorAll('[role="tabpanel"]').forEach(p => p.hidden = true);
      const panel = document.getElementById(`tab-${tab}`);
      if (panel) panel.hidden = false;
    });
  });
}

// ── Copy buttons ──────────────────────────────────────────────────────────────
function initCopyButtons() {
  // Install code copy
  const copyInstall = document.getElementById('copy-install-btn');
  if (copyInstall) {
    copyInstall.addEventListener('click', () => {
      const code = document.getElementById('install-code-block');
      if (!code) return;
      navigator.clipboard.writeText(code.innerText).then(() => {
        copyInstall.textContent = 'Copied!';
        copyInstall.classList.add('copied');
        showToast('Copied to clipboard');
        setTimeout(() => { copyInstall.textContent = 'Copy'; copyInstall.classList.remove('copied'); }, 2000);
      });
    });
  }

  // Explorer copy
  const copyCode = document.getElementById('copy-code-btn');
  if (copyCode) {
    copyCode.addEventListener('click', () => {
      const pre = document.getElementById('code-display');
      if (!pre) return;
      navigator.clipboard.writeText(pre.innerText).then(() => {
        showToast('Script copied to clipboard');
      });
    });
  }
}

// ── Script Explorer ───────────────────────────────────────────────────────────
function highlightBash(code) {
  const escHtml = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  let html = escHtml(code);

  // Comments
  html = html.replace(/(#.*?)(\n|$)/g, '<span class="tk-comment">$1</span>$2');
  // Strings (double-quoted)
  html = html.replace(/"([^"\\]|\\.)*"/g, s => `<span class="tk-str">${s}</span>`);
  // Strings (single-quoted)
  html = html.replace(/'([^'\\]|\\.)*'/g, s => `<span class="tk-str">${s}</span>`);
  // Keywords
  const kws = ['if','then','else','elif','fi','for','while','do','done','case','esac','in','function','return','local','readonly','export','source','set','trap','continue','break','shift','exit'];
  const kwRe = new RegExp(`\\b(${kws.join('|')})\\b`, 'g');
  html = html.replace(kwRe, '<span class="tk-kw">$1</span>');
  // Flags/options
  html = html.replace(/(^|\s)(--?[a-zA-Z][a-zA-Z0-9_-]*)/g, '$1<span class="tk-flag">$2</span>');
  // Variables $VAR and ${VAR}
  html = html.replace(/(\$\{?[A-Za-z_][A-Za-z0-9_]*\}?)/g, '<span class="tk-var">$1</span>');
  // Numbers
  html = html.replace(/\b(\d+)\b/g, '<span class="tk-num">$1</span>');

  return html;
}

function badgeClass(badge) {
  const map = { core:'fb-core', module:'fb-module', config:'fb-config', install:'fb-install', test:'fb-test' };
  return map[badge] || 'fb-module';
}

function badgeLabel(badge) {
  const map = { core:'core', module:'module', config:'config', install:'install', test:'test' };
  return map[badge] || badge;
}

function fileIcon(badge) {
  const icons = { core:'⚙', module:'🔧', config:'⚡', install:'📦', test:'🧪' };
  return icons[badge] || '📄';
}

function initExplorer() {
  if (!window.SCRIPTS_DATA) return;
  const fileList   = document.getElementById('file-list');
  const codeDisplay= document.getElementById('code-display');
  const explorerFn = document.getElementById('explorer-filename');
  const explorerDesc=document.getElementById('explorer-desc');
  if (!fileList || !codeDisplay) return;

  function loadFile(script) {
    if (explorerFn) explorerFn.textContent = script.name;
    if (explorerDesc) explorerDesc.textContent = script.description;
    codeDisplay.innerHTML = highlightBash(script.code);

    fileList.querySelectorAll('.file-item').forEach(el => el.classList.remove('active'));
    const active = fileList.querySelector(`[data-id="${script.id}"]`);
    if (active) {
      active.classList.add('active');
      active.setAttribute('aria-selected', 'true');
    }
  }

  SCRIPTS_DATA.forEach((s, i) => {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.dataset.id = s.id;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    item.setAttribute('tabindex', '0');
    item.innerHTML = `
      <span class="file-item-icon" aria-hidden="true">${fileIcon(s.badge)}</span>
      <span>${s.name.replace('modules/', '')}</span>
      <span class="file-badge ${badgeClass(s.badge)}">${badgeLabel(s.badge)}</span>`;
    item.addEventListener('click', () => loadFile(s));
    item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); loadFile(s); } });
    fileList.appendChild(item);
  });

  // Load first file
  loadFile(SCRIPTS_DATA[0]);
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initReveal();
  initInstallTabs();
  initCopyButtons();
  initExplorer();

  // Smooth nav highlight
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.header-nav a');
  const io = new IntersectionObserver(
    entries => entries.forEach(e => {
      if (e.isIntersecting) {
        navLinks.forEach(a => a.classList.remove('active'));
        const active = document.querySelector(`.header-nav a[href="#${e.target.id}"]`);
        if (active) active.classList.add('active');
      }
    }),
    { rootMargin: '-40% 0px -55% 0px' }
  );
  sections.forEach(s => io.observe(s));
});
