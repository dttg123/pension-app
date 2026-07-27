'use strict';

import { assetClassById, escapeHtml, formatMoney, guessAssetClass, num, parseMoney } from './state.js';
import { applySnapshot } from './transactions.js';
import { closeModal, openModal, setBusy, toast } from './ui.js';

let objectUrl = null;
let tesseractPromise = null;

export function parseHoldingText(text) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return lines.map((line, index) => {
    const parts = line.includes('|') ? line.split('|').map(part => part.trim()) : line.split(/\t+/).map(part => part.trim());
    if (parts.length < 3) return { error: `${index + 1}번째 줄 형식이 부족합니다.` };
    const [name, qty, value, cost, className] = parts;
    const parsed = {
      name: String(name || '').trim(), qty: parseNumber(qty), value: parseMoney(value),
      cost: cost === undefined || cost === '' ? parseMoney(value) : parseMoney(cost),
      classId: normalizeClass(className, name),
    };
    if (!parsed.name || parsed.qty < 0 || parsed.value < 0 || parsed.cost < 0) parsed.error = `${index + 1}번째 줄을 확인하세요.`;
    return parsed;
  });
}

export function parseBrokerOcr(text) {
  const lines = String(text || '').split(/\r?\n/).map(cleanLine).filter(Boolean);
  const rows = [];
  let buffer = [];
  let pending = null;
  for (const line of lines) {
    if (isNoiseLine(line)) {
      if (!pending) buffer = [];
      continue;
    }
    const tokens = numericTokens(line);
    const hasPercent = /%/.test(line);
    if (!pending && !hasPercent && tokens.length >= 3) {
      const last = tokens.slice(-3);
      const profit = last[0].value;
      const qty = last[1].value;
      const average = last[2].value;
      const prefix = line.slice(0, last[0].index).trim();
      const name = normalizeFundName([...buffer, prefix].join(' '));
      if (name && qty >= 0 && qty < 10000000 && Math.abs(profit) < 100000000000 && average >= 0) {
        pending = { name, profit, qty, average };
        buffer = [];
        continue;
      }
    }
    if (pending && (hasPercent || /현금/.test(line)) && tokens.length >= 2) {
      const last = tokens.slice(-2);
      const value = last[0].value;
      const current = last[1].value;
      const cost = value - pending.profit;
      if (value >= 0 && current >= 0 && cost >= 0) rows.push({ name: pending.name, qty: pending.qty, value, cost, classId: guessAssetClass(pending.name) });
      pending = null;
      buffer = [];
      continue;
    }
    if (!pending && !hasPercent && !/현금/.test(line) && tokens.length < 3 && /[A-Za-z가-힣]/.test(line)) buffer.push(line);
  }
  const unique = [];
  for (const row of rows) if (!unique.some(item => item.name === row.name && item.value === row.value)) unique.push(row);
  return unique;
}

export function openOcrInput(ctx) {
  const state = ctx.state();
  openModal({
    title: '사진·텍스트 자산 갱신',
    size: 'large',
    html: `
      <div class="sheetNotice">사진 원본은 저장하지 않습니다. 자동 인식 결과를 확인하고 수정한 뒤에만 반영합니다.</div>
      <div class="field"><label for="ocrAccount">계좌</label><select id="ocrAccount"><option value="pension">연금저축</option><option value="irp">IRP</option></select></div>
      <input id="ocrFile" type="file" accept="image/*" hidden>
      <button class="uploadBox" id="ocrChoose"><b>잔고 화면 사진 선택</b><span>첫 사진 인식 시 무료 OCR 모듈을 내려받을 수 있습니다.</span></button>
      <div class="ocrPreview" id="ocrPreview" hidden><img alt="선택한 잔고 화면"><div><b id="ocrFileName"></b><small>인식 중에만 메모리에 보관</small></div></div>
      <div class="progressBox" id="ocrProgress" hidden><div><b>사진 읽는 중</b><span id="ocrProgressText">0%</span></div><i><em id="ocrProgressBar"></em></i><small id="ocrProgressMessage"></small></div>
      <details class="manualDetails" open>
        <summary>텍스트 붙여넣기 또는 자동 인식 결과</summary>
        <textarea id="ocrText" rows="7" placeholder="종목명 | 수량 | 평가금액 | 매입금액 | 자산군"></textarea>
        <button class="btn full" id="ocrParse" type="button">내용 확인</button>
      </details>
      <div id="ocrRows"></div>
      <div class="field"><label for="ocrTotal">계좌 전체 총액(선택)</label><input id="ocrTotal" inputmode="numeric" placeholder="예수금이 없으면 비워두세요"><small>종목 합계와의 차이는 대기자금으로 반영합니다.</small></div>
      <button class="btn primary full" id="ocrApply" disabled>확인한 종목 반영</button>
    `,
    onMount(body) {
      const file = body.querySelector('#ocrFile');
      const choose = body.querySelector('#ocrChoose');
      const text = body.querySelector('#ocrText');
      const rowsHost = body.querySelector('#ocrRows');
      const apply = body.querySelector('#ocrApply');
      let currentRows = [];

      choose.onclick = () => file.click();
      file.onchange = async () => {
        const selected = file.files?.[0];
        if (!selected) return;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(selected);
        const preview = body.querySelector('#ocrPreview');
        preview.hidden = false;
        preview.querySelector('img').src = objectUrl;
        body.querySelector('#ocrFileName').textContent = selected.name || '잔고 화면';
        try {
          setProgress(body, 5, '이미지를 준비하고 있습니다.');
          const extracted = await recognizeImage(selected, progress => setProgress(body, 10 + progress * 80, `문자를 읽고 있습니다 · ${Math.round(progress * 100)}%`));
          text.value = extracted;
          setProgress(body, 95, '종목 행을 정리하고 있습니다.');
          currentRows = parseBrokerOcr(extracted);
          if (!currentRows.length) {
            toast('자동으로 종목 행을 찾지 못했습니다. 아래 텍스트를 수정해 확인하세요.', 'error', 3500);
          } else {
            paintRows(rowsHost, currentRows, state);
            body.querySelector('#ocrTotal').value = currentRows.reduce((sum, row) => sum + row.value, 0).toLocaleString('ko-KR');
            apply.disabled = false;
            toast(`${currentRows.length}개 종목을 찾았습니다. 숫자를 확인하세요.`);
          }
          setProgress(body, 100, '자동 인식이 끝났습니다.');
        } catch (error) {
          setProgress(body, 100, error.message || '사진 인식에 실패했습니다.', true);
          toast(error.message || '사진 인식에 실패했습니다.', 'error', 4000);
        }
      };

      body.querySelector('#ocrParse').onclick = () => {
        const parsed = parseHoldingText(text.value);
        const error = parsed.find(row => row.error);
        if (error) return toast(error.error, 'error');
        if (!parsed.length) return toast('붙여넣은 종목이 없습니다.', 'error');
        currentRows = parsed;
        paintRows(rowsHost, currentRows, state);
        body.querySelector('#ocrTotal').value = currentRows.reduce((sum, row) => sum + row.value, 0).toLocaleString('ko-KR');
        apply.disabled = false;
      };

      rowsHost.addEventListener('input', () => {
        currentRows = readRows(rowsHost);
        apply.disabled = !currentRows.length || currentRows.some(row => !row.name || row.qty < 0 || row.value < 0 || row.cost < 0);
      });

      apply.onclick = async () => {
        currentRows = readRows(rowsHost);
        if (!currentRows.length) return toast('확인할 종목이 없습니다.', 'error');
        const button = apply;
        setBusy(button, true, '반영 중…');
        try {
          const total = parseMoney(body.querySelector('#ocrTotal').value);
          await applySnapshot(body.querySelector('#ocrAccount').value, currentRows, total);
          closeModal();
          toast('검토한 자산현황을 반영했습니다.');
        } catch (error) {
          toast(error.message, 'error', 3500);
          setBusy(button, false);
        }
      };
    },
  });
}

function paintRows(host, rows, state) {
  host.innerHTML = `<div class="ocrRows">${rows.map((row, index) => `
    <div class="ocrRow" data-index="${index}">
      <div class="field"><label>종목명</label><input data-field="name" value="${escapeHtml(row.name)}"></div>
      <div class="threeFields">
        <div class="field"><label>수량</label><input data-field="qty" inputmode="decimal" value="${num(row.qty)}"></div>
        <div class="field"><label>평가금액</label><input data-field="value" inputmode="numeric" value="${Math.round(num(row.value)).toLocaleString('ko-KR')}"></div>
        <div class="field"><label>매입금액</label><input data-field="cost" inputmode="numeric" value="${Math.round(num(row.cost)).toLocaleString('ko-KR')}"></div>
      </div>
      <div class="field"><label>자산군</label><select data-field="classId">${state.settings.assetClasses.map(cls => `<option value="${cls.id}" ${cls.id === row.classId ? 'selected' : ''}>${escapeHtml(cls.name)}</option>`).join('')}</select></div>
    </div>`).join('')}</div>`;
}

function readRows(host) {
  return [...host.querySelectorAll('.ocrRow')].map(row => ({
    name: row.querySelector('[data-field="name"]').value.trim(),
    qty: parseNumber(row.querySelector('[data-field="qty"]').value),
    value: parseMoney(row.querySelector('[data-field="value"]').value),
    cost: parseMoney(row.querySelector('[data-field="cost"]').value),
    classId: row.querySelector('[data-field="classId"]').value,
  }));
}

function parseNumber(value) {
  const n = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function normalizeClass(value, name) {
  const text = String(value || '').trim().toLowerCase();
  const map = { 성장: 'growth', 성장주: 'growth', growth: 'growth', 배당: 'dividend', 배당주: 'dividend', dividend: 'dividend', 채권: 'bond', bond: 'bond', 현금: 'cash', 현금성: 'cash', cash: 'cash', 금: 'alternative', 대체재: 'alternative', alternative: 'alternative', gold: 'alternative' };
  return map[text] || guessAssetClass(name);
}

function setProgress(body, percent, message, error = false) {
  const box = body.querySelector('#ocrProgress');
  box.hidden = false;
  box.classList.toggle('error', error);
  body.querySelector('#ocrProgressText').textContent = error ? '확인 필요' : `${Math.round(percent)}%`;
  body.querySelector('#ocrProgressBar').style.width = `${Math.max(0, Math.min(100, percent))}%`;
  body.querySelector('#ocrProgressMessage').textContent = message;
}

async function recognizeImage(file, onProgress) {
  if (window.__PENSION_OCR_TEST_TEXT) return window.__PENSION_OCR_TEST_TEXT;
  if ('TextDetector' in window) {
    try {
      const bitmap = await createImageBitmap(file);
      const items = await new TextDetector().detect(bitmap);
      bitmap.close?.();
      if (items.length) return items.sort((a, b) => (a.boundingBox?.y || 0) - (b.boundingBox?.y || 0) || (a.boundingBox?.x || 0) - (b.boundingBox?.x || 0)).map(item => item.rawValue || '').join('\n');
    } catch (_) {}
  }
  const Tesseract = await loadTesseract();
  const result = await Tesseract.recognize(file, 'kor+eng', {
    logger(message) {
      if (message.status === 'recognizing text') onProgress(message.progress || 0);
    },
  });
  return result.data?.text || '';
}

function loadTesseract() {
  if (globalThis.Tesseract) return Promise.resolve(globalThis.Tesseract);
  if (tesseractPromise) return tesseractPromise;
  tesseractPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
    script.onload = () => globalThis.Tesseract ? resolve(globalThis.Tesseract) : reject(new Error('OCR 모듈을 불러오지 못했습니다.'));
    script.onerror = () => reject(new Error('OCR 모듈 연결에 실패했습니다. 인터넷 상태를 확인하세요.'));
    document.head.appendChild(script);
  });
  return tesseractPromise;
}

function cleanLine(value) {
  return String(value || '').replace(/[·•ㆍ]/g, ' ').replace(/[“”‘’]/g, '').replace(/\s+/g, ' ').trim();
}

function numericTokens(line) {
  const out = [];
  const regex = /[-+]?\d[\d,]*(?:\.\d+)?%?/g;
  for (const match of line.matchAll(regex)) out.push({ raw: match[0], value: Number(match[0].replace(/[%+,\s]/g, '')) || 0, index: match.index });
  return out;
}

function normalizeFundName(raw) {
  let name = cleanLine(raw).replace(/^[^A-Za-z가-힣0-9]+/, '').replace(/\b현금\b/g, '').trim();
  name = name.replace(/^K[0O]D[E3]X/i, 'KODEX').replace(/^R[|I1]SE/i, 'RISE').replace(/^A[C0]E/i, 'ACE');
  return name.replace(/\s+/g, ' ').trim().slice(0, 80);
}

function isNoiseLine(line) {
  return /종목명|평가손익|수익률|평가금액|매입단가|현재가|실시간|매매구분|보유잔고|주식 잔고|메뉴|주문|이체|구분/.test(line);
}
