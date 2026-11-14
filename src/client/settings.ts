// 玩家設定：音量和按鍵配置，存在瀏覽器（localStorage），下次開啟還在。
import { audio, type AudioSettings } from './audio';
import { P1_KEYS, P2_KEYS, type KeyMap } from './keyboard';

const STORAGE_KEY = 'nightbrawl-modern-settings-v1'; // 和經典操作版分開存（同一個網域）

export type Action = keyof KeyMap;

/** 設定畫面顯示的順序和名稱 */
export const ACTIONS: [Action, string][] = [
  ['UP', '上（跳）'],
  ['DOWN', '下（蹲）'],
  ['LEFT', '左'],
  ['RIGHT', '右'],
  ['L', '輕攻擊'],
  ['M', '中攻擊'],
  ['H', '重攻擊'],
  ['SP', '特殊技'],
  ['DRIVE', '鬥氣'],
  ['TAUNT', '挑釁'],
];

const clone = (m: KeyMap): KeyMap => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v]])) as KeyMap;
const DEFAULT_P1 = clone(P1_KEYS);
const DEFAULT_P2 = clone(P2_KEYS);
const DEFAULT_AUDIO: AudioSettings = { bgm: 0.5, sfx: 0.8 };

interface Saved { audio?: Partial<AudioSettings>; p1?: Partial<KeyMap>; p2?: Partial<KeyMap> }

/** 換掉 map 裡的內容（保留同一個物件，遊戲其他地方拿到的參考會跟著變） */
function assign(target: KeyMap, src: Partial<KeyMap>): void {
  for (const [a] of ACTIONS) {
    const v = src[a];
    if (Array.isArray(v) && v.length && v.every((c) => typeof c === 'string')) target[a] = [...v];
  }
}

export function loadSettings(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw) as Saved;
    if (s.audio) audio.setVolume({ ...DEFAULT_AUDIO, ...s.audio });
    if (s.p1) assign(P1_KEYS, s.p1);
    if (s.p2) assign(P2_KEYS, s.p2);
  } catch {
    // 設定壞掉就用預設值
  }
}

export function saveSettings(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ audio: audio.settings, p1: P1_KEYS, p2: P2_KEYS }));
  } catch {
    // 無痕模式等存不了就算了
  }
}

export function resetKeys(): void {
  assign(P1_KEYS, DEFAULT_P1);
  assign(P2_KEYS, DEFAULT_P2);
}

export function resetAudio(): void {
  audio.setVolume(DEFAULT_AUDIO);
}

/** 把某個動作改成新按鍵；如果這個鍵已經被別的動作（任一玩家）用了，就把兩邊對調。 */
export function rebind(player: 1 | 2, action: Action, code: string): void {
  const map = player === 1 ? P1_KEYS : P2_KEYS;
  const old = map[action][0];
  for (const [m] of [[P1_KEYS], [P2_KEYS]] as [KeyMap][]) {
    for (const [a] of ACTIONS) {
      if (m === map && a === action) continue;
      const i = m[a].indexOf(code);
      if (i < 0) continue;
      if (old) m[a][i] = old;
      else m[a].splice(i, 1);
      if (!m[a].length) m[a] = [old];
    }
  }
  map[action] = [code];
}

const NAMES: Record<string, string> = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
  Minus: '-', Equal: '=', Backquote: '`', Space: '空白鍵', Enter: 'Enter', Tab: 'Tab',
  ShiftLeft: '左 Shift', ShiftRight: '右 Shift', ControlLeft: '左 Ctrl', ControlRight: '右 Ctrl', AltLeft: '左 Alt', AltRight: '右 Alt',
  MetaLeft: '左 ⌘', MetaRight: '右 ⌘', CapsLock: 'Caps', Backspace: '退格',
};

/** 按鍵代碼 → 給人看的名字（KeyW → W、Numpad4 → 數字鍵 4） */
export function keyLabel(code: string): string {
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `數字鍵 ${code.slice(6)}`;
  return code;
}

/** 目前某個動作的按鍵名稱（有多個就用「／」隔開） */
export function keysOf(player: 1 | 2, action: Action): string {
  return (player === 1 ? P1_KEYS : P2_KEYS)[action].map(keyLabel).join('／');
}

/** 不能拿來綁定的鍵（選單和除錯用） */
export const RESERVED_KEYS = new Set(['Escape', 'F1', 'F2', 'Enter']);
