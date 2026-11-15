// 線上對戰流程：等待對手 → 連線 → 選角 → 對戰（rollback）→ 再戰 / 離開。
import { CHARACTER_IDS } from '../core/characters';
import { createGame } from '../core/game';
import type { Keyboard } from '../client/keyboard';
import { audio } from '../client/audio';
import { P1_KEYS, P2_KEYS } from '../client/keyboard';
import type { Renderer } from '../client/renderer';
import { createLink, type Link } from './peer';
import { hashState, RollbackSession, type SessionMsg } from './rollback';

type Status = 'waiting' | 'connecting' | 'select' | 'match' | 'ended';

type CtrlMsg =
  | { k: 'pick'; cursor: number; ready: boolean }
  | { k: 'start'; id: number; chars: [string, string]; timeLimit?: boolean }
  | { k: 'rematch' }
  | { k: 'bye' };

type GameMsg = (SessionMsg & { m: number }) | { k: 'ping'; t: number } | { k: 'pong'; t: number };

const DISCONNECT_MS = 10_000;

export class OnlineGame {
  status: Status = 'connecting';
  code: string | null = null;
  endReason = '';
  private link: Link;
  private me: 0 | 1 = 0;
  private cursor: [number, number] = [0, Math.min(1, CHARACTER_IDS.length - 1)];
  private ready: [boolean, boolean] = [false, false];
  /** 雙方都確定後的倒數（影格）；0 = 沒在倒數。數完由房主開打 */
  countdown = 0;
  private session: RollbackSession | null = null;
  private matchId = 0;
  private chars: [string, string] = ['sawa', 'mio'];
  private early: (SessionMsg & { m: number })[] = [];
  private rematch: [boolean, boolean] = [false, false];
  private rttMs = 0;
  private lastHeard = performance.now();
  private tick = 0;

  constructor(mode: 'create' | 'join', code: string, private delay: number, private timeLimit: boolean, private onChange: () => void) {
    this.link = createLink({
      onServer: (msg) => {
        if (msg.t === 'created') { this.code = msg.code; this.status = 'waiting'; }
        if (msg.t === 'joined') { this.code = msg.code; this.status = 'connecting'; }
        if (msg.t === 'peer-joined') this.status = 'connecting';
        this.onChange();
      },
      onOpen: () => {
        this.me = this.link.host ? 0 : 1;
        this.status = 'select';
        this.lastHeard = performance.now();
        this.sendPick();
        this.onChange();
      },
      onGame: (msg) => this.onGame(msg as GameMsg),
      onCtrl: (msg) => this.onCtrl(msg as CtrlMsg),
      onClose: (reason) => this.end(reason),
    });
    if (mode === 'create') this.link.create();
    else this.link.join(code);
  }

  /** 開發測試用：目前連線與同步狀態。 */
  debugInfo() {
    const s = this.session;
    if (!s) return { status: this.status };
    const confirmed = Math.min(s.confirmedFrame, s.frame - 1);
    const at = s.stateBefore(confirmed + 1);
    return {
      status: this.status, me: this.me, frame: s.frame, confirmed, rollbacks: s.rollbacks, maxRollback: s.maxRollbackDepth,
      desync: s.desyncFrame, rtt: Math.round(this.rttMs), confirmedHash: at ? hashState(at) : null,
      hp: s.state.fighters.map((f) => f.hp), x: s.state.fighters.map((f) => Math.round(f.x / 100)),
    };
  }

  get inviteLink(): string {
    return this.code ? `${location.origin}${location.pathname}?room=${this.code}` : '';
  }

  leave(): void {
    this.link.close();
    this.status = 'ended';
  }

  private end(reason: string): void {
    if (this.status === 'ended') return;
    this.status = 'ended';
    this.endReason = reason;
    this.link.close();
    this.onChange();
  }

  // ───── 訊息 ─────
  private onCtrl(msg: CtrlMsg): void {
    this.lastHeard = performance.now();
    const them = this.me === 0 ? 1 : 0;
    if (msg.k === 'pick') {
      this.cursor[them] = Math.max(0, Math.min(CHARACTER_IDS.length, msg.cursor));
      this.ready[them] = msg.ready && this.cursor[them] < CHARACTER_IDS.length;
      this.updateCountdown();
    } else if (msg.k === 'start') {
      this.timeLimit = msg.timeLimit ?? false; // 以房主的設定為準
      this.startMatch(msg.id, msg.chars);
    } else if (msg.k === 'rematch') {
      this.rematch[them] = true;
      this.maybeRematch();
    } else if (msg.k === 'bye') {
      this.end('對手已離開');
    }
  }

  private onGame(msg: GameMsg): void {
    this.lastHeard = performance.now();
    if (msg.k === 'ping') { this.link.sendGame({ k: 'pong', t: msg.t }); return; }
    if (msg.k === 'pong') { this.rttMs = performance.now() - msg.t; return; }
    if (msg.m === this.matchId && this.session) this.session.receive(msg);
    else if (msg.m > this.matchId) this.early.push(msg); // 對方先開始了，先存起來
  }

  private sendPick(): void {
    this.link.sendCtrl({ k: 'pick', cursor: this.cursor[this.me], ready: this.ready[this.me] });
  }

  /** 雙方都確定 → 開始 3 秒倒數；有人取消 → 停止倒數 */
  private updateCountdown(): void {
    if (this.status !== 'select') return;
    if (this.ready[0] && this.ready[1]) { if (this.countdown === 0) this.countdown = 180; }
    else this.countdown = 0;
  }

  /** 倒數中按 Esc：取消自己的確定（對方也會跟著停止倒數）。回傳是否有處理 */
  cancelLock(): boolean {
    if (this.status !== 'select' || this.countdown === 0) return false;
    this.ready[this.me] = false;
    this.countdown = 0;
    audio.stopVoice();
    audio.play('menu');
    this.sendPick();
    return true;
  }

  private maybeStart(): void {
    // 由房主決定開始，避免雙方各自開局；倒數結束才開
    if (this.me !== 0 || this.status !== 'select' || !this.ready[0] || !this.ready[1]) return;
    const chars: [string, string] = [CHARACTER_IDS[this.cursor[0]], CHARACTER_IDS[this.cursor[1]]];
    const id = this.matchId + 1;
    this.link.sendCtrl({ k: 'start', id, chars, timeLimit: this.timeLimit });
    this.startMatch(id, chars);
  }

  private maybeRematch(): void {
    if (this.me !== 0 || !this.rematch[0] || !this.rematch[1]) return;
    const id = this.matchId + 1;
    this.link.sendCtrl({ k: 'start', id, chars: this.chars, timeLimit: this.timeLimit });
    this.startMatch(id, this.chars);
  }

  private startMatch(id: number, chars: [string, string]): void {
    this.matchId = id;
    this.chars = chars;
    this.rematch = [false, false];
    this.session = new RollbackSession(createGame(chars[0], chars[1], { timeLimit: this.timeLimit }), {
      local: this.me,
      delay: this.delay,
      send: (m) => this.link.sendGame({ ...m, m: id }),
    });
    for (const m of this.early.splice(0)) if (m.m === id) this.session.receive(m);
    this.status = 'match';
    this.countdown = 0;
    audio.stopVoice(); // 選角的語音不要延續到對戰
    this.lastHeard = performance.now();
    this.onChange();
  }

  // ───── 每格更新 ─────
  update(kb: Keyboard): void {
    this.tick++;
    if (this.status === 'select') this.updateSelect(kb);
    else if (this.status === 'match') this.updateMatch(kb);
    if ((this.status === 'select' || this.status === 'match') && this.tick % 60 === 0) {
      this.link.sendGame({ k: 'ping', t: performance.now() });
    }
    if ((this.status === 'select' || this.status === 'match') && performance.now() - this.lastHeard > DISCONNECT_MS) {
      this.end('對手斷線（超過 10 秒沒有回應）');
    }
  }

  private updateSelect(kb: Keyboard): void {
    const n = CHARACTER_IDS.length + 1; // 多一格「？ 即將登場」，不能確定
    const me = this.me;
    let changed = false;
    if (!this.ready[me]) {
      // 選角用玩家設定的按鍵（P1、P2 的按鍵都可以）
      if (kb.consumeAny([...P1_KEYS.LEFT, ...P2_KEYS.LEFT])) { this.cursor[me] = (this.cursor[me] + n - 1) % n; changed = true; audio.play('menu'); }
      if (kb.consumeAny([...P1_KEYS.RIGHT, ...P2_KEYS.RIGHT])) { this.cursor[me] = (this.cursor[me] + 1) % n; changed = true; audio.play('menu'); }
      if (kb.consume('Enter')) { // 確定一律用 Enter
        if (this.cursor[me] >= CHARACTER_IDS.length) audio.play('menu'); // 即將登場的角色還不能選
        else {
          this.ready[me] = true; changed = true; audio.play('confirm');
          if (CHARACTER_IDS[this.cursor[me]] === 'mio') audio.play('mio_select'); // 鎖定 Mio 播語音
        }
      }
    } else if (kb.consumeAny([...P1_KEYS.L, ...P2_KEYS.L])) { this.ready[me] = false; changed = true; }
    if (changed) { this.sendPick(); this.updateCountdown(); }
    // 倒數：每秒嗶一聲，數完房主開打
    if (this.countdown > 0) {
      this.countdown--;
      if (this.countdown % 60 === 0 && this.countdown > 0) audio.play('menu');
      if (this.countdown === 0) { this.countdown = 1; this.maybeStart(); }
    }
  }

  private updateMatch(kb: Keyboard): void {
    const s = this.session;
    if (!s) return;
    const input = kb.read(P1_KEYS) | kb.read(P2_KEYS);
    const oneWayFrames = this.rttMs / 2 / (1000 / 60);
    // 比對手快太多時偶爾停一格，讓雙方時間對齊（減少回滾）
    if (s.aheadOfRemote(oneWayFrames) && this.tick % 3 === 0) s.idle();
    else { s.advance(input); audio.onStep(s.state); }
    if (s.state.phase === 'matchEnd' && !this.rematch[this.me] && kb.consume('Enter')) {
      this.rematch[this.me] = true;
      this.link.sendCtrl({ k: 'rematch' });
      this.maybeRematch();
    }
  }

  // ───── 繪製 ─────
  draw(r: Renderer, showBoxes: boolean): void {
    const tags: [string, string] = this.me === 0 ? ['你', '對手'] : ['對手', '你'];
    switch (this.status) {
      case 'connecting':
        r.drawMessage(this.code ? ['連線中…', `房號 ${this.code}`] : ['連線中…']);
        break;
      case 'waiting':
        r.drawMessage([`房號 ${this.code ?? ''}`, '把房號或下方的邀請連結傳給朋友', '等待對手加入…']);
        break;
      case 'select':
        r.drawSelect(CHARACTER_IDS, this.cursor, this.ready, this.ready[0] && this.ready[1] ? '開始！' : '雙方都按 Enter 確定就開始',
          '← / → 選擇、Enter 確定、輕攻擊取消　　Esc：離開房間', tags, this.countdown / 60);
        break;
      case 'match': {
        const s = this.session!;
        r.draw(s.state, { showBoxes, p2Label: '' });
        const side = this.me === 0 ? '左邊（1P）' : '右邊（2P）';
        let info = `你是${side}　ping ${Math.round(this.rttMs)} ms　輸入延遲 ${this.delay} 格　回滾 ${s.rollbacks} 次`;
        if (s.state.phase === 'matchEnd') info += this.rematch[this.me] ? '　等待對手按 Enter…' : '　Enter：再戰';
        r.drawNetInfo(info, s.desyncFrame !== null ? `⚠ 雙方畫面不同步（第 ${s.desyncFrame} 格）` : undefined);
        break;
      }
      case 'ended':
        r.drawMessage(['連線結束', this.endReason || '已離開房間', '按 Esc 回到主選單']);
        break;
    }
  }
}
