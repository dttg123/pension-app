'use strict';

import { compactMoney, escapeHtml, num } from './state.js';

const W = 640;
const H = 270;
const PAD = { left: 58, right: 18, top: 18, bottom: 38 };

export function lineChart({ id, labels, series, selectedIndex = labels.length - 1, includeZero = true, ariaLabel = '추이 그래프' }) {
  const cleanSeries = series.map(item => ({ ...item, values: labels.map((_, index) => num(item.values?.[index])) }));
  const values = cleanSeries.flatMap(item => item.values);
  const scale = axisScale(values, includeZero);
  const x = index => labels.length <= 1 ? (PAD.left + (W - PAD.right)) / 2 : PAD.left + index * (W - PAD.left - PAD.right) / (labels.length - 1);
  const y = value => PAD.top + (scale.max - value) / Math.max(1e-9, scale.max - scale.min) * (H - PAD.top - PAD.bottom);
  const chosen = clampIndex(selectedIndex, labels.length);
  const grid = scale.ticks.map(value => {
    const py = y(value);
    return `<g><line class="chartGrid" x1="${PAD.left}" x2="${W - PAD.right}" y1="${py.toFixed(2)}" y2="${py.toFixed(2)}"></line><text class="chartAxis" x="${PAD.left - 8}" y="${(py + 4).toFixed(2)}" text-anchor="end">${escapeHtml(axisMoney(value))}</text></g>`;
  }).join('');
  const paths = cleanSeries.map((item, sIndex) => {
    const points = item.values.map((value, index) => ({ x: x(index), y: y(value), value, index }));
    const path = smoothPath(points);
    const area = item.area ? `${path} L ${points.at(-1)?.x || 0} ${y(scale.min)} L ${points[0]?.x || 0} ${y(scale.min)} Z` : '';
    return `${area ? `<path class="chartArea" d="${area}" style="--series:${item.color}"></path>` : ''}<path class="chartPath ${item.dashed ? 'dashed' : ''}" d="${path}" style="--series:${item.color}"></path>${points.map(point => `<circle class="chartPoint ${point.index === chosen ? 'selected' : ''}" data-chart-point="${point.index}" data-series="${sIndex}" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${point.index === chosen ? 5 : 3}" style="--series:${item.color}"></circle>`).join('')}`;
  }).join('');
  const labelIndices = pickLabelIndices(labels.length);
  const xLabels = labelIndices.map(index => `<text class="chartAxis x" x="${x(index).toFixed(2)}" y="${H - 10}" text-anchor="middle">${escapeHtml(labels[index])}</text>`).join('');
  const selector = `<line class="chartSelector" data-selector-line x1="${x(chosen)}" x2="${x(chosen)}" y1="${PAD.top}" y2="${H - PAD.bottom}"></line>`;
  const html = `<div class="interactiveChart" id="${escapeHtml(id)}" tabindex="0" role="application" aria-label="${escapeHtml(ariaLabel)}" data-count="${labels.length}"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${grid}${paths}${selector}${xLabels}<rect class="chartHit" x="${PAD.left}" y="${PAD.top}" width="${W - PAD.left - PAD.right}" height="${H - PAD.top - PAD.bottom}"></rect></svg><small class="chartHelp">그래프를 누르거나 좌우로 밀어 상세 확인</small></div>`;
  return { html, model: { id, labels, series: cleanSeries, x, selectedIndex: chosen } };
}

export function barChart({ id, labels, values, selectedIndex = labels.length - 1, color = '#0ea5e9', ariaLabel = '막대 그래프' }) {
  const clean = labels.map((_, index) => num(values?.[index]));
  const scale = axisScale(clean, true);
  const innerW = W - PAD.left - PAD.right;
  const band = labels.length ? innerW / labels.length : innerW;
  const barW = Math.max(9, Math.min(42, band * .58));
  const y = value => PAD.top + (scale.max - value) / Math.max(1e-9, scale.max - scale.min) * (H - PAD.top - PAD.bottom);
  const xCenter = index => PAD.left + band * index + band / 2;
  const chosen = clampIndex(selectedIndex, labels.length);
  const grid = scale.ticks.map(value => {
    const py = y(value);
    return `<g><line class="chartGrid" x1="${PAD.left}" x2="${W - PAD.right}" y1="${py.toFixed(2)}" y2="${py.toFixed(2)}"></line><text class="chartAxis" x="${PAD.left - 8}" y="${(py + 4).toFixed(2)}" text-anchor="end">${escapeHtml(axisMoney(value))}</text></g>`;
  }).join('');
  const zeroY = y(0);
  const bars = clean.map((value, index) => {
    const valueY = y(value);
    const top = Math.min(zeroY, valueY);
    const height = Math.max(2, Math.abs(zeroY - valueY));
    return `<rect class="chartBar ${value < 0 ? 'negative' : ''} ${index === chosen ? 'selected' : ''}" data-chart-point="${index}" x="${(xCenter(index) - barW / 2).toFixed(2)}" y="${top.toFixed(2)}" width="${barW.toFixed(2)}" height="${height.toFixed(2)}" rx="8" style="--series:${value < 0 ? '#d33f49' : color}"></rect>`;
  }).join('');
  const labelIndices = pickLabelIndices(labels.length, 7);
  const xLabels = labelIndices.map(index => `<text class="chartAxis x" x="${xCenter(index).toFixed(2)}" y="${H - 10}" text-anchor="middle">${escapeHtml(labels[index])}</text>`).join('');
  const selector = labels.length ? `<line class="chartSelector" data-selector-line x1="${xCenter(chosen)}" x2="${xCenter(chosen)}" y1="${PAD.top}" y2="${H - PAD.bottom}"></line>` : '';
  const html = `<div class="interactiveChart" id="${escapeHtml(id)}" tabindex="0" role="application" aria-label="${escapeHtml(ariaLabel)}" data-count="${labels.length}"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${grid}${bars}${selector}${xLabels}<rect class="chartHit" x="${PAD.left}" y="${PAD.top}" width="${innerW}" height="${H - PAD.top - PAD.bottom}"></rect></svg><small class="chartHelp">막대를 누르거나 좌우로 밀어 상세 확인</small></div>`;
  return { html, model: { id, labels, values: clean, x: xCenter, selectedIndex: chosen } };
}

export function bindChart(root, model, onSelect) {
  const host = root.querySelector(`#${cssEscape(model.id)}`);
  if (!host || !model.labels.length) return;
  let index = clampIndex(model.selectedIndex, model.labels.length);
  let activePointer = null;
  const update = next => {
    index = clampIndex(next, model.labels.length);
    host.querySelectorAll('[data-chart-point]').forEach(node => {
      const selected = Number(node.dataset.chartPoint) === index;
      node.classList.toggle('selected', selected);
      if (node.tagName === 'circle') node.setAttribute('r', selected ? '5' : '3');
    });
    const selector = host.querySelector('[data-selector-line]');
    if (selector) {
      const px = model.x(index);
      selector.setAttribute('x1', px);
      selector.setAttribute('x2', px);
    }
    onSelect?.(index);
  };
  const fromClientX = clientX => {
    const svg = host.querySelector('svg');
    const rect = svg.getBoundingClientRect();
    const left = rect.left + PAD.left / W * rect.width;
    const right = rect.left + (W - PAD.right) / W * rect.width;
    const ratio = Math.max(0, Math.min(1, (clientX - left) / Math.max(1, right - left)));
    return Math.round(ratio * Math.max(0, model.labels.length - 1));
  };
  host.addEventListener('pointerdown', event => {
    activePointer = event.pointerId;
    try { host.setPointerCapture(event.pointerId); } catch (_) {}
    update(fromClientX(event.clientX));
  });
  host.addEventListener('pointermove', event => {
    if (activePointer !== event.pointerId) return;
    if (event.cancelable) event.preventDefault();
    update(fromClientX(event.clientX));
  });
  const end = event => {
    if (activePointer !== event.pointerId) return;
    activePointer = null;
    try { host.releasePointerCapture(event.pointerId); } catch (_) {}
  };
  host.addEventListener('pointerup', end);
  host.addEventListener('pointercancel', end);
  host.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); update(index - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); update(index + 1); }
    if (event.key === 'Home') { event.preventDefault(); update(0); }
    if (event.key === 'End') { event.preventDefault(); update(model.labels.length - 1); }
  });
  update(index);
}

function axisScale(values, includeZero) {
  const finite = values.filter(Number.isFinite);
  let min = finite.length ? Math.min(...finite) : 0;
  let max = finite.length ? Math.max(...finite) : 1;
  if (includeZero) min = Math.min(0, min);
  if (includeZero) max = Math.max(0, max);
  if (min === max) max = min + Math.max(1, Math.abs(min) * .1);
  const span = max - min;
  const pad = span * .08;
  min = includeZero && min === 0 ? 0 : min - pad;
  max += pad;
  const step = niceStep((max - min) / 4);
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;
  const ticks = [];
  for (let value = min, guard = 0; value <= max + step * .1 && guard < 8; value += step, guard += 1) ticks.push(value);
  return { min, max, ticks };
}

function niceStep(raw) {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

function smoothPath(points) {
  if (!points.length) return '';
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  const d = [`M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`];
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midX = (current.x + next.x) / 2;
    d.push(`C ${midX.toFixed(2)} ${current.y.toFixed(2)}, ${midX.toFixed(2)} ${next.y.toFixed(2)}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`);
  }
  return d.join(' ');
}

function axisMoney(value) {
  return compactMoney(value).replace(/원$/, '');
}

function pickLabelIndices(length, max = 5) {
  if (length <= max) return Array.from({ length }, (_, index) => index);
  const result = new Set([0, length - 1]);
  const step = (length - 1) / (max - 1);
  for (let index = 1; index < max - 1; index += 1) result.add(Math.round(index * step));
  return [...result].sort((a, b) => a - b);
}

function clampIndex(value, length) {
  if (!length) return 0;
  return Math.max(0, Math.min(length - 1, Number.isFinite(Number(value)) ? Math.round(Number(value)) : length - 1));
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
