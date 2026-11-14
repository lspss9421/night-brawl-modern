import { CHARACTER_IDS } from './core/characters';
import { createGame, step } from './core/game';
import type { GameState } from './core/types';
import { DUMMY_LABEL, DUMMY_ORDER, dummyInput, type DummyMode } from './client/dummy';
import { audio } from './client/audio';
import { Keyboard, P1_KEYS, P2_KEYS } from './client/keyboard';
import { ACTIONS, keyLabel, keysOf, loadSettings, rebind, resetAudio, resetKeys, RESERVED_KEYS, saveSettings, type Action } from './client/settings';
import { Renderer } from './client/renderer';
import { loadAllSprites } from './client/sprites';
import { OnlineGame } from './net/online';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
loadSettings(); // 先讀玩家存的音量和按鍵
const kb = new Keyboard([P1_KEYS, P2_KEYS]);

type Screen = 'title' | 'select' | 'fight' | 'online';
let screen: Screen = 'title';
let online: OnlineGame | null = null;
let game: GameState | null = null;
// 測試網站（npm run dev）：顯示判定框、F1 切換、可選時間無限和無限能量
// 發佈版像一般遊戲：不顯示判定框、回合固定 99 秒、沒有測試選項
let showBoxes = import.meta.env.DEV;
let p2Mode: DummyMode = 'human';
const cursor: [number, number] = [0, Math.min(1, CHARACTER_IDS.length - 1)];
const ready: [boolean, boolean] = [false, false];
let picks: [string, string] = ['sawa', 'mio'];
let assetsReady = false;
const timeLimitOn = () => (document.getElementById('timeLimit') as HTMLInputElement | null)?.checked ?? false;
// 測試用：能量一直是滿的（只在本機測試網址出現，發佈版會隱藏而且不會生效）
const infiniteMeterOn = () => import.meta.env.DEV && ((document.getElementById('infiniteMeter') as HTMLInputElement | null)?.checked ?? false);
// 讀取角色素材（沒有素材的角色會用色塊）；讀完前不能開始對戰
const assetsPromise = loadAllSprites().then((ids) => {
  assetsReady = true;
  if (ids.length) console.info('已載入角色素材：', ids.join(', '));
});

/** 雙方都確定後的倒數（影格）；0 = 沒有在倒數 */
const LOCK_COUNTDOWN = 180;
let countdown = 0;

function lockIn(p: 0 | 1): void {
  ready[p] = true;
  audio.play('confirm');
  if (CHARACTER_IDS[cursor[p]] === 'mio') audio.play('mio_select');
}

function updateSelect(): void {
  // 倒數中：Esc 取消雙方的確定，回到選角；否則照常倒數，數完開打
  if (countdown > 0) {
    if (kb.consume('Escape')) {
      countdown = 0;
      ready[0] = false;
      ready[1] = p2Mode !== 'human';
      audio.stopVoice();
      audio.play('menu');
      return;
    }
    countdown--;
    if (countdown % 60 === 0 && countdown > 0) audio.play('menu'); // 每秒「嗶」一聲
    if (countdown === 0) startLocalMatch();
    return;
  }
  if (kb.consume('Escape')) { // 打電腦時回到難度選擇，雙人對戰回主選單
    const toCpu = p2Mode !== 'human';
    showTitle();
    if (toCpu) { menu.hidden = true; cpuMenu.hidden = false; }
    return;
  }
  if (kb.consume('F2')) {
    p2Mode = DUMMY_ORDER[(DUMMY_ORDER.indexOf(p2Mode) + 1) % DUMMY_ORDER.length];
    if (p2Mode !== 'human') ready[1] = true;
    else ready[1] = false;
  }
  const n = CHARACTER_IDS.length;
  // 左右選擇用各自設定的按鍵；Enter 確定（先 P1、再 P2）；輕攻擊取消
  if (!ready[0]) {
    if (kb.consumeAny(P1_KEYS.LEFT)) { cursor[0] = (cursor[0] + n - 1) % n; audio.play('menu'); }
    if (kb.consumeAny(P1_KEYS.RIGHT)) { cursor[0] = (cursor[0] + 1) % n; audio.play('menu'); }
  } else if (kb.consumeAny(P1_KEYS.L)) ready[0] = false;
  // 電腦／假人模式時由 P1 一起幫 P2 選角（上／下切換）
  if (p2Mode !== 'human') {
    if (kb.consumeAny(P1_KEYS.UP) || kb.consumeAny(P1_KEYS.DOWN)) { cursor[1] = (cursor[1] + 1) % n; audio.play('menu'); }
  } else if (!ready[1]) {
    if (kb.consumeAny(P2_KEYS.LEFT)) { cursor[1] = (cursor[1] + n - 1) % n; audio.play('menu'); }
    if (kb.consumeAny(P2_KEYS.RIGHT)) { cursor[1] = (cursor[1] + 1) % n; audio.play('menu'); }
  } else if (kb.consumeAny(P2_KEYS.L)) ready[1] = false;
  if (kb.consume('Enter')) {
    if (!ready[0]) lockIn(0);
    else if (p2Mode === 'human' && !ready[1]) lockIn(1);
  }

  if (ready[0] && ready[1] && assetsReady) countdown = LOCK_COUNTDOWN;
}

function startLocalMatch(): void {
  picks = [CHARACTER_IDS[cursor[0]], CHARACTER_IDS[cursor[1]]];
  game = createGame(picks[0], picks[1], { timeLimit: timeLimitOn(), infiniteMeter: infiniteMeterOn() });
  screen = 'fight';
  ready[0] = false;
  ready[1] = p2Mode !== 'human';
  audio.stopVoice(); // 選角的語音不要延續到對戰
}

function updateFight(): void {
  if (!game) return;
  if (kb.consume('F1') && import.meta.env.DEV) showBoxes = !showBoxes;
  if (kb.consume('F2')) p2Mode = DUMMY_ORDER[(DUMMY_ORDER.indexOf(p2Mode) + 1) % DUMMY_ORDER.length];
  if (kb.consume('Escape')) { screen = 'select'; game = null; return; }
  if (game.phase === 'matchEnd' && kb.consume('Enter')) {
    game = createGame(picks[0], picks[1], { timeLimit: timeLimitOn(), infiniteMeter: infiniteMeterOn() });
    return;
  }
  const i1 = kb.read(P1_KEYS);
  const i2 = p2Mode === 'human' ? kb.read(P2_KEYS) : dummyInput(game, 1, p2Mode);
  step(game, [i1, i2]);
  audio.onStep(game);
}

// 固定 60 影格 / 秒的邏輯更新；畫面依瀏覽器刷新率繪製。
const STEP_MS = 1000 / 60;
let last = performance.now();
let acc = 0;

function frame(now: number): void {
  acc += Math.min(250, now - last);
  last = now;
  let steps = 0;
  while (acc >= STEP_MS && steps < 5) {
    if (screen === 'select') updateSelect();
    else if (screen === 'fight') updateFight();
    else if (screen === 'online') updateOnline();
    else kb.clearPressed();
    acc -= STEP_MS;
    steps++;
  }
  if (screen === 'title') renderer.drawMessage(['']);
  else if (screen === 'online') online?.draw(renderer, showBoxes);
  else if (screen === 'select') renderer.drawSelect(CHARACTER_IDS, cursor, ready, `玩家 2 模式：${DUMMY_LABEL[p2Mode]}`, selectHint(), undefined, countdown / 60);
  else if (game) renderer.draw(game, { showBoxes, p2Label: p2Mode === 'human' ? '' : DUMMY_LABEL[p2Mode] });
  // 背景音樂：對戰中播緊張的對戰音樂，主選單、選角、連線等待播輕快的主選單音樂
  const inMatch = screen === 'fight' || (screen === 'online' && online?.status === 'match');
  audio.setBgm(bgmPreview !== null ? 'battle' : inMatch ? 'battle' : 'menu');
  requestAnimationFrame(frame);
}

function selectHint(): string {
  const k = (p: 1 | 2, a: Action) => keysOf(p, a);
  const p2 = p2Mode === 'human'
    ? `P2：${k(2, 'LEFT')} / ${k(2, 'RIGHT')} 選擇`
    : `P2：${k(1, 'UP')} / ${k(1, 'DOWN')} 幫對手選角`;
  return `P1：${k(1, 'LEFT')} / ${k(1, 'RIGHT')} 選擇　${p2}　Enter 確定（先 P1 再 P2）　F2：切換玩家 2／電腦／假人`;
}

requestAnimationFrame(frame);

// ───── 主選單與線上對戰 ─────
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const menu = $<HTMLDivElement>('menu');
const invite = $<HTMLDivElement>('invite');
const menuError = $<HTMLDivElement>('menuError');

function showTitle(message = ''): void {
  countdown = 0;
  online?.leave();
  online = null;
  screen = 'title';
  game = null;
  menu.hidden = false;
  cpuMenu.hidden = true;
  invite.hidden = true;
  menuError.textContent = message;
  history.replaceState(null, '', location.pathname);
}

function startOnline(mode: 'create' | 'join', code = ''): void {
  if (!assetsReady) { menuError.textContent = '素材讀取中，請稍候再試'; return; }
  (document.activeElement as HTMLElement | null)?.blur();
  menu.hidden = true;
  screen = 'online';
  kb.clearPressed();
  const delay = Number($<HTMLSelectElement>('delay').value) || 0;
  online = new OnlineGame(mode, code, delay, timeLimitOn(), () => {
    const o = online;
    if (!o) return;
    invite.hidden = o.status !== 'waiting';
    $<HTMLInputElement>('inviteLink').value = o.inviteLink;
    $<HTMLInputElement>('inviteCode').value = o.code ?? '';
    if (o.code) history.replaceState(null, '', `?room=${o.code}`);
  });
}

function updateOnline(): void {
  if (kb.consume('F1') && import.meta.env.DEV) showBoxes = !showBoxes;
  if (kb.consume('Escape') && !online?.cancelLock()) { // 倒數中 Esc = 取消確定；其他時候 = 離開
    const reason = online?.status === 'ended' ? online.endReason : '';
    showTitle(reason);
    return;
  }
  online?.update(kb);
}

const cpuMenu = $<HTMLDivElement>('cpuMenu');
function goSelect(mode: DummyMode): void {
  (document.activeElement as HTMLElement | null)?.blur();
  p2Mode = mode;
  ready[0] = false;
  ready[1] = mode !== 'human';
  menu.hidden = true;
  cpuMenu.hidden = true;
  screen = 'select';
  kb.clearPressed();
}
$('btnLocal').onclick = () => goSelect('human');
// 電腦：先選難度（或假人）再進選角
$('btnCpu').onclick = () => { menu.hidden = true; cpuMenu.hidden = false; };
$('btnCpuBack').onclick = () => { cpuMenu.hidden = true; menu.hidden = false; };
cpuMenu.querySelectorAll<HTMLButtonElement>('button[data-cpu]').forEach((b) => {
  b.onclick = () => goSelect(b.dataset.cpu as DummyMode);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !cpuMenu.hidden) $('btnCpuBack').click(); });
$('btnCreate').onclick = () => startOnline('create');
$('btnJoin').onclick = () => {
  const code = $<HTMLInputElement>('roomCode').value.trim().toUpperCase();
  if (code.length !== 4) { menuError.textContent = '請輸入 4 個字的房號'; return; }
  startOnline('join', code);
};
$<HTMLInputElement>('roomCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoin').click(); });
// 複製房號／邀請連結（剪貼簿不能用時就幫忙選取起來）
function copyButton(btnId: string, inputId: string, label: string): void {
  const btn = $<HTMLButtonElement>(btnId);
  btn.onclick = async () => {
    const input = $<HTMLInputElement>(inputId);
    try { await navigator.clipboard.writeText(input.value); btn.textContent = '已複製'; setTimeout(() => (btn.textContent = label), 1500); }
    catch { input.select(); }
  };
}
copyButton('btnCopy', 'inviteLink', '複製連結');
copyButton('btnCopyCode', 'inviteCode', '複製房號');

declare const __APP_VERSION__: string;
const versionEl = document.getElementById('version');
if (versionEl) versionEl.textContent = `版本 ${__APP_VERSION__}`;

// 發佈版：預設開啟回合時間、隱藏開發用說明
if (!import.meta.env.DEV) {
  const tl = document.getElementById('timeLimit') as HTMLInputElement | null;
  if (tl) tl.checked = true;
  document.querySelectorAll<HTMLElement>('.dev-only').forEach((el) => (el.hidden = true));
}

// 開發模式：方便測試時讀取連線狀態
if (import.meta.env.DEV || import.meta.env.VITE_DEBUG_ONLINE) (window as unknown as { __online: () => unknown }).__online = () => online?.debugInfo();

// 用邀請連結打開時直接加入房間
const roomFromUrl = new URLSearchParams(location.search).get('room');
if (roomFromUrl) {
  void assetsPromise.then(() => startOnline('join', roomFromUrl.toUpperCase()));
}

// ───── 操作說明（依目前的按鍵配置產生） ─────
function renderHelp(): void {
  const k = (p: 1 | 2, a: Action) => `<kbd>${keysOf(p, a)}</kbd>`;
  const line = (p: 1 | 2) =>
    `<b>P${p}</b> ${k(p, 'UP')}${k(p, 'LEFT')}${k(p, 'DOWN')}${k(p, 'RIGHT')} 移動 · ${k(p, 'L')}/${k(p, 'M')}/${k(p, 'H')} 輕/中/重 · ` +
    `${k(p, 'SP')} 特殊（加↓／加前換招，加中 = OD，傷害 8 成） · ${k(p, 'SP')}+${k(p, 'H')} 必殺 · ${k(p, 'L')}+${k(p, 'M')} 投技 · ${k(p, 'DRIVE')} 鬥氣 · ${k(p, 'TAUNT')} 挑釁`;
  $('help').innerHTML = `${line(1)}<br />${line(2)}<br />` +
    '指令技：↓↘→、→↓↘、↓↙← ＋任一攻擊鍵（扣 2 格鬥氣；兩顆攻擊鍵一起按 = OD 強化版，扣 3 格） · ' +
    '前＋鬥氣 = 鬥氣衝擊（霸體，牆邊打中會撞牆） · 普通技打中後按鬥氣、檔架中連按兩下前 = 鬥氣衝刺 · ' +
    '按住「後」防禦、蹲著按住後 = 蹲防 · 按住鬥氣 = 檔架 · 防禦中按鬥氣 = 鬥氣反擊 · 被抓時按投技 = 拆投 · 連按兩下前/後 = 衝刺/後撤 · ' +
    (import.meta.env.DEV ? '<kbd>F1</kbd> 判定框 · ' : '') + '<kbd>F2</kbd> 切換玩家 2／電腦（簡單・普通・困難）／假人 · <kbd>Esc</kbd> 返回';
}
renderHelp();

// ───── 設定畫面：聲音、操作按鍵 ─────
const settingsEl = $<HTMLDivElement>('settings');
const volBgm = $<HTMLInputElement>('volBgm');
const volSfx = $<HTMLInputElement>('volSfx');
let waiting: { player: 1 | 2; action: Action; button: HTMLButtonElement } | null = null;
let bgmPreview: number | null = null;

function refreshSettings(): void {
  volBgm.value = String(Math.round(audio.settings.bgm * 100));
  volSfx.value = String(Math.round(audio.settings.sfx * 100));
  $('volBgmVal').textContent = `${volBgm.value}%`;
  $('volSfxVal').textContent = `${volSfx.value}%`;
  const rows = $('keyRows');
  rows.innerHTML = '';
  for (const [action, name] of ACTIONS) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${name}</td>`;
    for (const player of [1, 2] as const) {
      const td = document.createElement('td');
      const b = document.createElement('button');
      b.textContent = keysOf(player, action);
      b.onclick = () => startRebind(player, action, b);
      td.appendChild(b);
      tr.appendChild(td);
    }
    rows.appendChild(tr);
  }
  renderHelp();
}

function startRebind(player: 1 | 2, action: Action, button: HTMLButtonElement): void {
  if (waiting) waiting.button.classList.remove('wait');
  waiting = { player, action, button };
  button.classList.add('wait');
  button.textContent = '請按新按鍵…';
  kb.suspended = true;
}

window.addEventListener('keydown', (e) => {
  if (!waiting) return;
  e.preventDefault();
  e.stopPropagation();
  const w = waiting;
  waiting = null;
  kb.suspended = false;
  if (e.code !== 'Escape') {
    if (RESERVED_KEYS.has(e.code)) {
      menuError.textContent = '';
      w.button.textContent = `${keyLabel(e.code)} 是保留鍵`;
      setTimeout(refreshSettings, 900);
      return;
    }
    rebind(w.player, w.action, e.code);
    saveSettings();
    audio.play('confirm');
  }
  refreshSettings();
}, true);

function stopBgmPreview(): void {
  if (bgmPreview !== null) { clearTimeout(bgmPreview); bgmPreview = null; $('btnTestBgm').textContent = '試聽對戰音樂'; }
}

$('btnSettings').onclick = () => {
  menu.hidden = true;
  settingsEl.hidden = false;
  refreshSettings();
};
$('btnCloseSettings').onclick = () => {
  stopBgmPreview();
  if (waiting) { waiting = null; kb.suspended = false; }
  settingsEl.hidden = true;
  menu.hidden = false;
  saveSettings();
};
$('btnResetSettings').onclick = () => {
  const keysTab = !$('tabKeys').hidden;
  if (keysTab) resetKeys();
  else resetAudio();
  saveSettings();
  refreshSettings();
};
for (const b of settingsEl.querySelectorAll<HTMLButtonElement>('.tabs button')) {
  b.onclick = () => {
    for (const o of settingsEl.querySelectorAll('.tabs button')) o.classList.toggle('on', o === b);
    $('tabSound').hidden = b.dataset.tab !== 'sound';
    $('tabKeys').hidden = b.dataset.tab !== 'keys';
  };
}
volBgm.oninput = () => { audio.setVolume({ bgm: Number(volBgm.value) / 100 }); $('volBgmVal').textContent = `${volBgm.value}%`; };
volSfx.oninput = () => { audio.setVolume({ sfx: Number(volSfx.value) / 100 }); $('volSfxVal').textContent = `${volSfx.value}%`; };
volBgm.onchange = volSfx.onchange = () => saveSettings();
$('btnTestSfx').onclick = () => {
  (['hit_light', 'hit_heavy', 'block', 'parry'] as const).forEach((n, i) => setTimeout(() => audio.play(n), i * 280));
};
$('btnTestBgm').onclick = () => {
  if (bgmPreview !== null) { stopBgmPreview(); return; }
  // 設定畫面本身在播主選單音樂，這個按鈕試聽對戰音樂（主迴圈會依 bgmPreview 切換）
  $('btnTestBgm').textContent = '停止試聽';
  bgmPreview = window.setTimeout(stopBgmPreview, 12000);
};

// ───── 按鈕音效：滑鼠移到按鈕上播一次、按下再播一次 ─────
// 用整頁的事件代理，設定畫面裡動態產生的按鍵按鈕也適用
const uiButton = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLButtonElement>('.menu button, .settings button, .invite button') : null);
document.addEventListener('mouseover', (e) => {
  const b = uiButton(e.target);
  // 只在「從按鈕外面移進來」時播，在按鈕裡的文字上移動不重複播
  if (b && !b.disabled && !b.contains(e.relatedTarget as Node | null)) audio.play('hover');
});
document.addEventListener('click', (e) => {
  const b = uiButton(e.target);
  if (b && !b.disabled) audio.play('confirm');
});
