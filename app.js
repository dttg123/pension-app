'use strict';

import { APP_VERSION, SCHEMA_VERSION, compactMoney, escapeHtml, formatMoney, num, validateState } from './state.js';
import { applyTheme, getState, loadState, subscribe, updateView } from './storage.js';
import { renderHome } from './home.js';
import { renderAccount } from './account.js';
import { renderAnalysis } from './analysis.js';
import { renderFuture } from './future.js';
import { createInputController } from './input.js';
import { openSettings } from './settings.js';
import { buildDataBackup, buildProjectBackup, verifyDataBackup } from './backup.js';
import { closeModal, openModal, toast } from './ui.js';

const screens = {
  home: document.getElementById('home'),
  account: document.getElementById('account'),
  analysis: document.getElementById('analysis'),
  future: document.getElementById('future'),
};

const ctx = {
  state: getState,
  refresh: renderAll,
  navigate,
  setAccount,
  setAnalysisPanel,
  openAnnualDetail,
  input: null,
};
ctx.input = createInputController(ctx);

await loadState();
setupNavigation();
setupFab();
setupThemeListener();
subscribe(() => renderAll());
renderAll();
registerServiceWorker();

function renderAll() {
  const state = getState();
  document.body.dataset.screen = state.ui.screen;
  document.getElementById('headerSub').textContent = `${state.profile.age}세 · ${state.profile.retirementAge}세 연금 개시`;
  renderHome(screens.home, ctx);
  renderAccount(screens.account, ctx);
  renderAnalysis(screens.analysis, ctx);
  renderFuture(screens.future, ctx);
  for (const [name, section] of Object.entries(screens)) section.classList.toggle('active', name === state.ui.screen);
  document.querySelectorAll('.nav button[data-screen]').forEach(button => {
    const active = button.dataset.screen === state.ui.screen;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  document.title = `개인연금 V${APP_VERSION}`;
}

function navigate(screen, accountKey = null) {
  if (!screens[screen]) return;
  updateView(ui => {
    ui.screen = screen;
    if (accountKey && ['pension', 'irp'].includes(accountKey)) ui.accountView = accountKey;
  }, 'navigate');
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function setAccount(accountKey) {
  if (!['pension', 'irp'].includes(accountKey)) return;
  updateView(ui => { ui.accountView = accountKey; }, 'account-view');
}

function setAnalysisPanel(panel) {
  if (!['performance', 'cashflow', 'annual', 'ai'].includes(panel)) return;
  updateView(ui => { ui.analysisPanel = panel; }, 'analysis-panel');
}

function setupNavigation() {
  document.querySelectorAll('.nav button[data-screen]').forEach(button => {
    button.onclick = () => navigate(button.dataset.screen);
  });
  document.getElementById('settingsBtn').onclick = () => openSettings(ctx);
  document.getElementById('versionBadge').onclick = () => {
    openModal({
      title: '버전 정보',
      size: 'compact',
      html: `<div class="statusRows"><div><span>앱 버전</span><b>V${APP_VERSION}</b></div><div><span>데이터 구조</span><b>${SCHEMA_VERSION}</b></div><div><span>코드 구조</span><b>ES 모듈 · 패치 덧씌우기 없음</b></div></div>`,
    });
  };
  window.addEventListener('popstate', () => closeModal());
}

function setupFab() {
  const fab = document.getElementById('fab');
  let timer = null;
  let longPressed = false;
  const start = event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    longPressed = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
      longPressed = true;
      fab.classList.add('hiddenByUser');
      fab.setAttribute('aria-hidden', 'true');
      toast('플러스 버튼을 숨겼습니다. 앱을 다시 열면 나타납니다.');
      navigator.vibrate?.(35);
    }, 720);
  };
  const cancel = () => clearTimeout(timer);
  fab.addEventListener('pointerdown', start);
  fab.addEventListener('pointerup', cancel);
  fab.addEventListener('pointercancel', cancel);
  fab.addEventListener('pointerleave', cancel);
  fab.onclick = event => {
    if (longPressed) {
      event.preventDefault();
      longPressed = false;
      return;
    }
    ctx.input.open('menu');
  };
}

function setupThemeListener() {
  const media = matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener?.('change', () => {
    if (getState().settings.theme === 'auto') applyTheme('auto');
  });
}

function openAnnualDetail(year) {
  const row = getState().years?.[year];
  if (!row) return;
  openModal({
    title: `${year}년 상세`,
    html: `
      <div class="detailGrid">
        <div><small>연초 자산</small><b>${formatMoney(row.start)}</b></div>
        <div><small>연말 자산</small><b>${formatMoney(row.end)}</b></div>
        <div><small>납입</small><b>${formatMoney(row.contribution)}</b></div>
        <div><small>운용손익</small><b class="${num(row.operating) >= 0 ? 'good' : 'bad'}">${num(row.operating) >= 0 ? '+' : ''}${formatMoney(row.operating)}</b></div>
        <div><small>분배금</small><b>${formatMoney(row.dividend)}</b></div>
        <div><small>수익률</small><b class="${num(row.return) >= 0 ? 'good' : 'bad'}">${num(row.return) >= 0 ? '+' : ''}${num(row.return).toFixed(1)}%</b></div>
      </div>
      <div class="monthlyDividend"><b>월별 분배금</b>${(row.monthly || []).map((value, index) => `<div><span>${index + 1}월</span><i style="width:${Math.max(1, Math.min(100, num(row.dividend) ? num(value) / num(row.dividend) * 100 : 0))}%"></i><em>${compactMoney(value)}</em></div>`).join('')}</div>
    `,
  });
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  try {
    const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) toast('새 버전을 받았습니다. 다시 열면 적용됩니다.', 'normal', 4000);
      });
    });
  } catch (error) {
    console.warn('Service worker registration failed', error);
  }
}

window.PensionV4 = Object.freeze({
  version: APP_VERSION,
  schemaVersion: SCHEMA_VERSION,
  state: () => JSON.parse(JSON.stringify(getState())),
  validate: () => validateState(getState()),
  buildDataBackup: () => buildDataBackup(getState()),
  verifyDataBackup,
  buildProjectBackup: () => buildProjectBackup(getState()),
  refresh: renderAll,
});
