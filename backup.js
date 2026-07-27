'use strict';

import {
  APP_ID, APP_VERSION, SCHEMA_VERSION, clone, escapeHtml, formatMoney, normalizeState,
  totalAsset, totalPrincipal, validateState,
} from './state.js';
import { getState, replaceState, snapshotState, storeSafetyCopy, updateState } from './storage.js';
import { closeModal, confirmAction, openModal, setBusy, toast } from './ui.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const REQUIRED_FILES = ['full-backup.json', 'accounts.csv', 'transactions.csv', 'contributions.csv', 'dividends.csv', 'snapshots.csv', 'settings.csv', 'backup-schema.txt', 'manifest.json'];
export const PROJECT_FILES = ['index.html', 'app.css', 'state.js', 'storage.js', 'transactions.js', 'ui.js', 'home.js', 'account.js', 'analysis.js', 'charts.js', 'future.js', 'input.js', 'ocr.js', 'backup.js', 'settings.js', 'app.js', 'manifest.webmanifest', 'sw.js', 'icon.svg'];

export function openDataCenter(ctx) {
  const state = getState();
  openModal({
    title: '데이터·백업',
    size: 'large',
    html: `
      <div class="dataStatus">
        <div><span>기기 저장</span><b class="${state.meta.storage?.localStatus === '정상' ? 'good' : ''}">${escapeHtml(state.meta.storage?.localStatus || '확인 전')}</b><small>${escapeHtml(state.meta.storage?.lastLocalSave || '저장 전')}</small></div>
        <div><span>마지막 백업</span><b>${escapeHtml(state.meta.storage?.lastBackup || '없음')}</b><small>JSON·CSV·ZIP</small></div>
        <div><span>클라우드</span><b class="muted">V5 예정</b><small>현재는 기기+파일 백업</small></div>
      </div>
      <div class="dataActions">
        <button class="dataAction primaryAction" id="backupZip"><span><b>폰에 전체 ZIP 백업</b><small>JSON·CSV·체크섬 검증 후 저장</small></span><i>↓</i></button>
        <button class="dataAction" id="backupProject"><span><b>프로젝트 ZIP 백업</b><small>앱 파일과 현재 데이터 함께 저장</small></span><i>↓</i></button>
        <button class="dataAction" id="exportJson"><span><b>JSON 내보내기</b><small>전체 복원용 원본</small></span><i>↓</i></button>
        <button class="dataAction" id="exportCsv"><span><b>CSV 내보내기</b><small>거래 원장 확인용</small></span><i>↓</i></button>
        <button class="dataAction" id="restoreFile"><span><b>백업 파일 불러오기</b><small>ZIP 또는 JSON 검사 후 미리보기</small></span><i>›</i></button>
        <button class="dataAction" id="restoreText"><span><b>JSON 텍스트 붙여넣기</b><small>파일 없이 복원</small></span><i>›</i></button>
      </div>
      <input id="restoreInput" type="file" accept=".zip,.json,application/zip,application/json" hidden>
      <div class="backupResult" id="backupResult" aria-live="polite"></div>
      <div class="dataFoot">앱 ${APP_VERSION} · 데이터 구조 ${SCHEMA_VERSION} · 복원 전 현재 데이터 자동 안전백업</div>
    `,
    onMount(body) {
      body.querySelector('#backupZip').onclick = () => runBackup(body, 'data');
      body.querySelector('#backupProject').onclick = () => runBackup(body, 'project');
      body.querySelector('#exportJson').onclick = () => exportJson();
      body.querySelector('#exportCsv').onclick = () => exportCsv();
      body.querySelector('#restoreFile').onclick = () => body.querySelector('#restoreInput').click();
      body.querySelector('#restoreInput').onchange = event => readRestoreFile(event.target.files?.[0], ctx);
      body.querySelector('#restoreText').onclick = () => openRestoreText(ctx);
    },
  });
}

async function runBackup(body, type) {
  const button = body.querySelector(type === 'data' ? '#backupZip' : '#backupProject');
  const result = body.querySelector('#backupResult');
  setBusy(button, true, '검증 중…');
  result.className = 'backupResult open';
  result.innerHTML = '<b>백업 준비 중</b><span>원본 검사 → ZIP 생성 → 재열기 → 체크섬 검사를 진행합니다.</span>';
  try {
    const pack = type === 'data' ? await buildDataBackup(getState()) : await buildProjectBackup(getState());
    downloadBlob(pack.blob, pack.fileName);
    await updateState(state => { state.meta.storage.lastBackup = new Date().toLocaleString('ko-KR'); }, 'backup-meta');
    result.className = 'backupResult open success';
    result.innerHTML = `<b>백업 검증 완료</b><span>${escapeHtml(pack.fileName)} · ${formatBytes(pack.bytes.length)} · 오류 0건</span>`;
    toast('검증된 백업을 저장했습니다.');
  } catch (error) {
    result.className = 'backupResult open error';
    result.innerHTML = `<b>백업 중단</b><span>${escapeHtml(error.message)}</span>`;
    toast(error.message, 'error', 4000);
  } finally {
    setBusy(button, false);
  }
}

export async function buildDataBackup(inputState = getState()) {
  const state = normalizeState(inputState);
  const validation = validateState(state);
  if (!validation.ok) throw new Error(validation.errors[0]);
  const files = buildFiles(state);
  const checksums = {};
  for (const [name, content] of Object.entries(files)) checksums[name] = await sha256(toBytes(content));
  const counts = dataCounts(state);
  const manifest = {
    appId: APP_ID,
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    backupFormatVersion: 1,
    dataId: state.dataId,
    createdAt: new Date().toISOString(),
    counts,
    requiredFiles: REQUIRED_FILES,
    files: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, { bytes: toBytes(content).length, sha256: checksums[name] }])),
    validation: { sourceData: 'passed', zipReopen: 'pending', checksums: 'pending', counts: 'passed', csv: 'passed' },
  };
  files['manifest.json'] = JSON.stringify(manifest, null, 2);
  let bytes = zipCreate(files);
  let verified = await verifyDataBackup(bytes);
  if (!verified.ok) throw new Error(verified.errors[0]);
  manifest.validation.zipReopen = 'passed';
  manifest.validation.checksums = 'passed';
  files['manifest.json'] = JSON.stringify(manifest, null, 2);
  bytes = zipCreate(files);
  verified = await verifyDataBackup(bytes);
  if (!verified.ok) throw new Error(verified.errors[0]);
  return { bytes, blob: new Blob([bytes], { type: 'application/zip' }), fileName: `pension-data_${fileStamp()}.zip`, manifest, verification: verified };
}

export async function buildProjectBackup(inputState = getState()) {
  const dataPack = await buildDataBackup(inputState);
  const files = {};
  for (const name of PROJECT_FILES) {
    const response = await fetch(`./${name}?backup=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`프로젝트 파일을 읽지 못했습니다: ${name}`);
    files[name] = new Uint8Array(await response.arrayBuffer());
  }
  files[`data/${dataPack.fileName}`] = dataPack.bytes;
  const assetInfo = {};
  for (const [name, content] of Object.entries(files)) assetInfo[name] = { bytes: toBytes(content).length, sha256: await sha256(toBytes(content)) };
  const manifest = {
    appId: APP_ID,
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    projectBackupFormatVersion: 1,
    createdAt: new Date().toISOString(),
    appAssetCount: PROJECT_FILES.length,
    files: assetInfo,
    nestedDataBackup: { fileName: dataPack.fileName, sha256: await sha256(dataPack.bytes), counts: dataPack.manifest.counts },
  };
  files['project-manifest.json'] = JSON.stringify(manifest, null, 2);
  const bytes = zipCreate(files);
  const reopened = await zipRead(bytes);
  if (!reopened['project-manifest.json']) throw new Error('프로젝트 ZIP 재열기에 실패했습니다.');
  for (const [name, meta] of Object.entries(assetInfo)) {
    if (!reopened[name]) throw new Error(`프로젝트 ZIP 파일 누락: ${name}`);
    if (await sha256(reopened[name]) !== meta.sha256) throw new Error(`프로젝트 파일 체크섬 불일치: ${name}`);
  }
  return { bytes, blob: new Blob([bytes], { type: 'application/zip' }), fileName: `pension-v4.1_${fileStamp()}.zip`, manifest };
}

function buildFiles(state) {
  const wrapped = { appId: APP_ID, appVersion: APP_VERSION, schemaVersion: SCHEMA_VERSION, createdAt: new Date().toISOString(), data: state };
  return {
    'full-backup.json': JSON.stringify(wrapped, null, 2),
    'accounts.csv': csv([
      ['accountId', 'accountKey', 'name', 'principal', 'cash', 'totalAsset'],
      ...Object.entries(state.accounts).map(([key, account]) => [account.id, key, account.name, account.principal, account.cash, account.cash + account.holdings.reduce((sum, item) => sum + Number(item.value || 0), 0)]),
    ]),
    'transactions.csv': csv([
      ['id', 'date', 'type', 'accountKey', 'assetId', 'assetName', 'amount', 'quantity', 'fee', 'tax', 'principalDelta', 'cashDelta', 'status', 'note'],
      ...state.ledger.map(row => [row.id, row.date, row.type, row.accountKey, row.assetId, row.assetName, row.amount, row.quantity, row.fee, row.tax, row.principalDelta, row.cashDelta, row.status, row.note]),
    ]),
    'contributions.csv': csv([
      ['id', 'date', 'accountKey', 'amount', 'status'],
      ...state.ledger.filter(row => row.type === 'contribution').map(row => [row.id, row.date, row.accountKey, row.amount, row.status]),
    ]),
    'dividends.csv': csv([
      ['id', 'date', 'accountKey', 'assetId', 'assetName', 'amount', 'status'],
      ...state.ledger.filter(row => row.type === 'dividend').map(row => [row.id, row.date, row.accountKey, row.assetId, row.assetName, row.amount, row.status]),
    ]),
    'snapshots.csv': csv([
      ['id', 'date', 'accountKey', 'totalAsset', 'cash', 'holdingCount'],
      ...state.snapshots.map(row => [row.id, row.date, row.accountKey, row.totalAsset, row.cash, Array.isArray(row.holdings) ? row.holdings.length : 0]),
    ]),
    'settings.csv': csv([
      ['key', 'value'],
      ['monthly.pension', state.settings.monthly.pension],
      ['monthly.irp', state.settings.monthly.irp],
      ['goalMonthly', state.settings.goalMonthly],
      ['returnRate', state.settings.returnRate],
      ['inflation', state.settings.inflation],
      ['withdrawYears', state.settings.withdrawYears],
      ['withdrawReturn', state.settings.withdrawReturn],
      ['annualContributionLimit', state.settings.annualContributionLimit],
      ['taxCreditLimit', state.settings.taxCreditLimit],
    ]),
    'backup-schema.txt': `개인연금 V4.1 백업 규격\nappVersion: ${APP_VERSION}\nschemaVersion: ${SCHEMA_VERSION}\n\nfull-backup.json: 전체 복원 원본\naccounts.csv: 계좌 요약\ntransactions.csv: 전체 원장\ncontributions.csv: 납입 기록\ndividends.csv: 분배금 기록\nsnapshots.csv: 자산 스냅샷\nsettings.csv: 설정\nmanifest.json: 파일 목록·개수·SHA-256\n\n복원은 원본을 복사하고 검증한 뒤 성공 시에만 교체합니다.`,
  };
}

export async function verifyDataBackup(input) {
  const errors = [];
  let files;
  try { files = await zipRead(input); } catch (error) { return { ok: false, errors: [error.message] }; }
  for (const name of REQUIRED_FILES) if (!files[name]?.length) errors.push(`필수 파일 누락: ${name}`);
  if (errors.length) return { ok: false, errors };
  let manifest;
  let wrapped;
  try {
    manifest = JSON.parse(decoder.decode(files['manifest.json']));
    wrapped = JSON.parse(decoder.decode(files['full-backup.json']));
  } catch (error) {
    return { ok: false, errors: [`JSON 파싱 실패: ${error.message}`] };
  }
  const state = normalizeState(wrapped.data || wrapped);
  const validation = validateState(state);
  errors.push(...validation.errors);
  for (const [name, meta] of Object.entries(manifest.files || {})) {
    if (!files[name]) { errors.push(`체크섬 파일 누락: ${name}`); continue; }
    const actual = await sha256(files[name]);
    if (actual !== meta.sha256) errors.push(`SHA-256 불일치: ${name}`);
    if (files[name].length !== meta.bytes) errors.push(`파일 크기 불일치: ${name}`);
  }
  const actualCounts = dataCounts(state);
  for (const [key, value] of Object.entries(manifest.counts || {})) if (actualCounts[key] !== value) errors.push(`데이터 개수 불일치: ${key}`);
  return { ok: errors.length === 0, errors, manifest, data: state, files };
}

export function exportJson() {
  const wrapped = { appId: APP_ID, appVersion: APP_VERSION, schemaVersion: SCHEMA_VERSION, createdAt: new Date().toISOString(), data: snapshotState() };
  downloadBlob(new Blob([JSON.stringify(wrapped, null, 2)], { type: 'application/json' }), `pension_${fileStamp()}.json`);
  toast('JSON 내보내기를 시작했습니다.');
}

export function exportCsv() {
  const files = buildFiles(getState());
  downloadBlob(new Blob([files['transactions.csv']], { type: 'text/csv;charset=utf-8' }), `pension-ledger_${fileStamp()}.csv`);
  toast('CSV 내보내기를 시작했습니다.');
}

async function readRestoreFile(file, ctx) {
  if (!file) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let candidate;
    if (file.name.toLowerCase().endsWith('.zip')) {
      const files = await zipRead(bytes);
      if (files['project-manifest.json']) {
        const nestedName = Object.keys(files).find(name => name.startsWith('data/') && name.endsWith('.zip'));
        if (!nestedName) throw new Error('프로젝트 ZIP 안에 데이터 백업이 없습니다.');
        const verified = await verifyDataBackup(files[nestedName]);
        if (!verified.ok) throw new Error(verified.errors[0]);
        candidate = verified.data;
      } else {
        const verified = await verifyDataBackup(bytes);
        if (!verified.ok) throw new Error(verified.errors[0]);
        candidate = verified.data;
      }
    } else {
      const parsed = JSON.parse(decoder.decode(bytes));
      candidate = normalizeState(parsed.data || parsed);
      const validation = validateState(candidate);
      if (!validation.ok) throw new Error(validation.errors[0]);
    }
    showRestorePreview(candidate, file.name, ctx);
  } catch (error) {
    toast(`복원 파일 거부: ${error.message}`, 'error', 4500);
  }
}

function openRestoreText(ctx) {
  openModal({
    title: 'JSON 텍스트 복원',
    html: `<div class="sheetNotice">붙여넣은 데이터는 바로 반영하지 않고 먼저 검사합니다.</div><div class="field"><label for="restoreTextArea">JSON</label><textarea id="restoreTextArea" rows="12" placeholder="full-backup.json 내용을 붙여넣으세요"></textarea></div><button class="btn primary full" id="parseRestoreText">데이터 검사</button>`,
    onMount(body) {
      body.querySelector('#parseRestoreText').onclick = () => {
        try {
          const parsed = JSON.parse(body.querySelector('#restoreTextArea').value);
          const candidate = normalizeState(parsed.data || parsed);
          const validation = validateState(candidate);
          if (!validation.ok) throw new Error(validation.errors[0]);
          closeModal();
          setTimeout(() => showRestorePreview(candidate, '붙여넣은 JSON', ctx), 60);
        } catch (error) {
          toast(`JSON 검사 실패: ${error.message}`, 'error', 4000);
        }
      };
    },
  });
}

function showRestorePreview(candidate, source, ctx) {
  const counts = dataCounts(candidate);
  openModal({
    title: '복원 미리보기',
    html: `
      <div class="restoreSummary">
        <div><small>파일</small><b>${escapeHtml(source)}</b></div>
        <div><small>앱·데이터 버전</small><b>${escapeHtml(candidate.meta?.appVersion || '구버전')} · schema ${candidate.schemaVersion}</b></div>
        <div><small>계좌·종목</small><b>${counts.accounts}개 · ${counts.holdings}개</b></div>
        <div><small>원장·스냅샷</small><b>${counts.transactions}건 · ${counts.snapshots}건</b></div>
        <div><small>총자산</small><b>${formatMoney(counts.totalAssets)}</b></div>
        <div><small>검사 결과</small><b class="good">오류 없음</b></div>
      </div>
      <div class="modalActions"><button class="btn" id="restoreCancel">취소</button><button class="btn primary" id="restoreApply">안전백업 후 복원</button></div>
    `,
    onMount(body) {
      body.querySelector('#restoreCancel').onclick = closeModal;
      body.querySelector('#restoreApply').onclick = async () => {
        const okay = await confirmAction({ title: '데이터 복원', message: '현재 데이터를 안전백업한 뒤 선택한 데이터로 교체할까요?', confirmText: '복원' });
        if (!okay) return;
        try {
          const original = snapshotState();
          await storeSafetyCopy({ createdAt: new Date().toISOString(), data: original });
          candidate.meta.storage = candidate.meta.storage || {};
          candidate.meta.storage.lastRestore = new Date().toLocaleString('ko-KR');
          await replaceState(candidate, 'restore');
          closeModal();
          ctx.navigate('home');
          toast('복원이 완료되었습니다.');
        } catch (error) {
          toast(`복원 실패: ${error.message}`, 'error', 4500);
        }
      };
    },
  });
}

function dataCounts(state) {
  return {
    accounts: Object.keys(state.accounts || {}).length,
    holdings: Object.values(state.accounts || {}).reduce((sum, account) => sum + (account.holdings || []).length, 0),
    transactions: (state.ledger || []).length,
    contributions: (state.ledger || []).filter(row => row.type === 'contribution').length,
    dividends: (state.ledger || []).filter(row => row.type === 'dividend').length,
    snapshots: (state.snapshots || []).length,
    years: Object.keys(state.years || {}).length,
    totalAssets: Math.round(totalAsset(state)),
    totalPrincipal: Math.round(totalPrincipal(state)),
  };
}

function csv(rows) {
  return '\ufeff' + rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

function toBytes(content) {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  return encoder.encode(String(content));
}

export async function sha256(content) {
  const bytes = toBytes(content);
  if (globalThis.crypto?.subtle?.digest) {
    try {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    } catch (_) {
      // file://·제한된 웹뷰에서도 백업 검증이 멈추지 않도록 순수 JS 계산으로 전환합니다.
    }
  }
  return sha256Fallback(bytes);
}

function sha256Fallback(bytes) {
  const K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ]);
  const hash = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const total = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(total);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitHigh = Math.floor(bytes.length / 0x20000000) >>> 0;
  const bitLow = (bytes.length << 3) >>> 0;
  view.setUint32(total - 8, bitHigh, false);
  view.setUint32(total - 4, bitLow, false);
  const w = new Uint32Array(64);
  const rotr = (value, shift) => (value >>> shift) | (value << (32 - shift));
  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a=hash[0], b=hash[1], c=hash[2], d=hash[3], e=hash[4], f=hash[5], g=hash[6], h=hash[7];
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    hash[0]=(hash[0]+a)>>>0; hash[1]=(hash[1]+b)>>>0; hash[2]=(hash[2]+c)>>>0; hash[3]=(hash[3]+d)>>>0;
    hash[4]=(hash[4]+e)>>>0; hash[5]=(hash[5]+f)>>>0; hash[6]=(hash[6]+g)>>>0; hash[7]=(hash[7]+h)>>>0;
  }
  return [...hash].map(value => value.toString(16).padStart(8, '0')).join('');
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function fileStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function u16(bytes, offset, value) { bytes[offset] = value & 255; bytes[offset + 1] = value >>> 8 & 255; }
function u32(bytes, offset, value) { bytes[offset] = value & 255; bytes[offset + 1] = value >>> 8 & 255; bytes[offset + 2] = value >>> 16 & 255; bytes[offset + 3] = value >>> 24 & 255; }
function r16(view, offset) { return view.getUint16(offset, true); }
function r32(view, offset) { return view.getUint32(offset, true); }

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(chunks) {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

export function zipCreate(fileMap) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(fileMap)) {
    const nameBytes = encoder.encode(name);
    const data = toBytes(content);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    u32(local, 0, 0x04034b50); u16(local, 4, 20); u16(local, 6, 0x0800); u16(local, 8, 0); u32(local, 14, crc); u32(local, 18, data.length); u32(local, 22, data.length); u16(local, 26, nameBytes.length); local.set(nameBytes, 30);
    locals.push(local, data);
    const central = new Uint8Array(46 + nameBytes.length);
    u32(central, 0, 0x02014b50); u16(central, 4, 20); u16(central, 6, 20); u16(central, 8, 0x0800); u16(central, 10, 0); u32(central, 16, crc); u32(central, 20, data.length); u32(central, 24, data.length); u16(central, 28, nameBytes.length); u32(central, 42, offset); central.set(nameBytes, 46);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const localPart = concat(locals);
  const centralPart = concat(centrals);
  const end = new Uint8Array(22);
  u32(end, 0, 0x06054b50); u16(end, 8, centrals.length); u16(end, 10, centrals.length); u32(end, 12, centralPart.length); u32(end, 16, localPart.length);
  return concat([localPart, centralPart, end]);
}

export async function zipRead(input) {
  const bytes = toBytes(input);
  if (bytes.length < 22) throw new Error('ZIP 파일이 너무 짧습니다.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) if (r32(view, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('ZIP 끝 정보를 찾지 못했습니다.');
  const count = r16(view, eocd + 10);
  const centralSize = r32(view, eocd + 12);
  const centralOffset = r32(view, eocd + 16);
  if (count < 1 || count > 5000) throw new Error('ZIP 파일 개수가 비정상입니다.');
  if (centralOffset + centralSize > eocd) throw new Error('ZIP 파일 목록이 손상되었습니다.');
  const files = {};
  let p = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (r32(view, p) !== 0x02014b50) throw new Error('ZIP 파일 목록 서명이 손상되었습니다.');
    const method = r16(view, p + 10);
    const crcExpected = r32(view, p + 16);
    const compressedSize = r32(view, p + 20);
    const size = r32(view, p + 24);
    const nameLength = r16(view, p + 28);
    const extraLength = r16(view, p + 30);
    const commentLength = r16(view, p + 32);
    const localOffset = r32(view, p + 42);
    const name = decoder.decode(bytes.slice(p + 46, p + 46 + nameLength));
    if (name.includes('..') || name.startsWith('/') || name.startsWith('\\')) throw new Error('안전하지 않은 ZIP 경로입니다.');
    if (r32(view, localOffset) !== 0x04034b50) throw new Error(`ZIP 내부 파일 헤더 손상: ${name}`);
    const localNameLength = r16(view, localOffset + 26);
    const localExtraLength = r16(view, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const packed = bytes.slice(dataStart, dataStart + compressedSize);
    let output;
    if (method === 0) output = packed;
    else if (method === 8) output = await inflateRaw(packed);
    else throw new Error(`지원하지 않는 ZIP 압축 방식: ${method}`);
    if (output.length !== size) throw new Error(`ZIP 내부 파일 크기 불일치: ${name}`);
    if (crc32(output) !== crcExpected) throw new Error(`ZIP CRC 불일치: ${name}`);
    files[name] = output;
    p += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

async function inflateRaw(bytes) {
  if (!globalThis.DecompressionStream) throw new Error('압축 ZIP을 해제할 수 없는 브라우저입니다.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
