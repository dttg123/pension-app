'use strict';

import { escapeHtml } from './state.js';

let closeHandler = null;
let previousFocus = null;

export function toast(message, type = 'normal', duration = 2200) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.dataset.type = type;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), duration);
}

export function openModal({ title, html, onMount, size = 'normal', closeable = true }) {
  const overlay = document.getElementById('modal');
  const sheet = overlay.querySelector('.modalSheet');
  const titleEl = overlay.querySelector('.modalTitle');
  const body = overlay.querySelector('.modalBody');
  const close = overlay.querySelector('.modalClose');
  previousFocus = document.activeElement;
  titleEl.textContent = title || '';
  body.innerHTML = html || '';
  sheet.dataset.size = size;
  close.hidden = !closeable;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  closeHandler = () => closeModal();
  close.onclick = closeHandler;
  overlay.onclick = event => {
    if (event.target === overlay && closeable) closeModal();
  };
  document.addEventListener('keydown', modalKeydown);
  requestAnimationFrame(() => {
    const first = body.querySelector('input,select,textarea,button,[tabindex]:not([tabindex="-1"])');
    (first || close)?.focus();
    onMount?.(body, { close: closeModal });
  });
  return body;
}

export function closeModal() {
  const overlay = document.getElementById('modal');
  if (!overlay?.classList.contains('open')) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  overlay.querySelector('.modalBody').innerHTML = '';
  closeHandler = null;
  document.removeEventListener('keydown', modalKeydown);
  previousFocus?.focus?.();
  previousFocus = null;
}

function modalKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeModal();
    return;
  }
  if (event.key !== 'Tab') return;
  const overlay = document.getElementById('modal');
  const focusables = [...overlay.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(el => el.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function confirmAction({ title = '확인', message, confirmText = '확인', danger = false }) {
  return new Promise(resolve => {
    openModal({
      title,
      html: `<div class="confirmMessage">${escapeHtml(message)}</div><div class="modalActions"><button class="btn" id="confirmCancel">취소</button><button class="btn ${danger ? 'danger' : 'primary'}" id="confirmOk">${escapeHtml(confirmText)}</button></div>`,
      onMount(body) {
        body.querySelector('#confirmCancel').onclick = () => { closeModal(); resolve(false); };
        body.querySelector('#confirmOk').onclick = () => { closeModal(); resolve(true); };
      },
    });
  });
}

export function bindMoneyInput(input) {
  if (!input || input.dataset.moneyBound === 'true') return;
  input.dataset.moneyBound = 'true';
  input.addEventListener('focus', () => {
    // 기본 계획금액이 들어 있어도 새 입력이 뒤에 붙지 않도록 전체 선택합니다.
    // 값 자체는 바꾸지 않아 모바일 키보드·자동화 입력의 focus 순서가 꼬이지 않게 합니다.
    setTimeout(() => input.select(), 0);
  });
  input.addEventListener('blur', () => {
    const number = Number(input.value.replace(/[^0-9.-]/g, ''));
    input.value = Number.isFinite(number) && number !== 0 ? Math.round(number).toLocaleString('ko-KR') : '';
  });
}

export function fieldError(target, message) {
  const field = target.closest('.field');
  let error = field?.querySelector('.fieldError');
  if (!field) return;
  if (!error) {
    error = document.createElement('div');
    error.className = 'fieldError';
    field.appendChild(error);
  }
  error.textContent = message;
  target.setAttribute('aria-invalid', message ? 'true' : 'false');
}

export function clearFieldErrors(container) {
  container.querySelectorAll('.fieldError').forEach(el => el.remove());
  container.querySelectorAll('[aria-invalid="true"]').forEach(el => el.removeAttribute('aria-invalid'));
}

export function setBusy(button, busy, label = '처리 중…') {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

export function svgLine(values, width = 320, height = 120) {
  if (!values.length) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const points = values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : index / (values.length - 1) * width;
    const y = height - 10 - ((value - min) / range) * (height - 20);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="miniChart" viewBox="0 0 ${width} ${height}" role="img" aria-label="추이 그래프"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline></svg>`;
}
