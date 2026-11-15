// 電腦對手：只用和玩家一樣的按鍵輸入（不直接改遊戲狀態），難度只影響判斷的機率和連段長度。
// 只在本機對戰使用（連線對戰不會有電腦），所以可以用自己的亂數。
import { currentMove, DRIVE_BAR, formStats, METER_MAX, movePhase, moveHitbox } from '../core/game';
import { getChar } from '../core/characters';
import { Btn, type InputBits } from '../core/input';
import type { FighterState, GameState } from '../core/types';
import { FP } from '../core/types';

export type CpuLevel = 'easy' | 'normal' | 'hard';

interface CpuParams {
  /** 對手出招時防禦的機率 */
  block: number;
  /** 防禦時猜對上下段的機率 */
  guardRight: number;
  /** 對手跳過來時用蹲重拳對空的機率 */
  antiAir: number;
  /** 對手招式收招時反擊的機率 */
  punish: number;
  /** 連段長度：0 = 單發、1 = 輕 → 重、2 = 輕 → 重 → 特殊技 */
  combo: 0 | 1 | 2;
  /** 主動進攻的程度（0～1） */
  aggression: number;
  /** 被抓時拆投的機率 */
  tech: number;
  /** 防禦中用鬥氣反擊的機率 */
  reversal: number;
  /** 多久重新想一次要做什麼（影格） */
  think: number;
}

const PARAMS: Record<CpuLevel, CpuParams> = {
  // 第二版：三種難度都往上提一級（簡單 ≈ 原本普通、普通 ≈ 原本困難、困難更強）
  easy: { block: 0.45, guardRight: 0.82, antiAir: 0.4, punish: 0.45, combo: 1, aggression: 0.5, tech: 0.3, reversal: 0.05, think: 18 },
  normal: { block: 0.8, guardRight: 0.94, antiAir: 0.78, punish: 0.82, combo: 2, aggression: 0.68, tech: 0.65, reversal: 0.18, think: 11 },
  hard: { block: 0.95, guardRight: 0.99, antiAir: 0.95, punish: 0.97, combo: 2, aggression: 0.8, tech: 0.9, reversal: 0.3, think: 6 },
};

interface Step { bits: InputBits; frames: number }

export class CpuPlayer {
  private p: CpuParams;
  private seed: number;
  /** 接下來幾格要按的鍵 */
  private plan: Step[] = [];
  /** 連段還沒按的鍵（每個是一組要同時按的鍵） */
  private combo: InputBits[] = [];
  private comboHold = 0;
  private nextThink = 0;
  /** 已經決定過的事件（同一招、同一次跳躍只判斷一次） */
  private decided = new Map<string, boolean>();

  constructor(readonly level: CpuLevel, seed = 12345) {
    this.p = PARAMS[level];
    this.seed = seed;
  }

  private rand(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  private chance(pr: number): boolean {
    return this.rand() < pr;
  }

  /** 同一個事件只擲一次骰子 */
  private once(key: string, pr: number): boolean {
    let v = this.decided.get(key);
    if (v === undefined) {
      v = this.chance(pr);
      this.decided.set(key, v);
      if (this.decided.size > 64) this.decided.delete(this.decided.keys().next().value!);
    }
    return v;
  }

  input(s: GameState, side: 0 | 1): InputBits {
    const me = s.fighters[side];
    const foe = s.fighters[1 - side];
    if (s.phase !== 'fight') { this.reset(); return 0; }
    const fwd = foe.x >= me.x ? Btn.RIGHT : Btn.LEFT;
    const back = fwd === Btn.RIGHT ? Btn.LEFT : Btn.RIGHT;
    const dist = Math.abs(foe.x - me.x) / FP;

    // 被抓：在拆投時間內按投技
    if (me.action === 'thrown') {
      this.reset();
      const key = `tech${s.frame - me.frame}`;
      return me.frame === 3 && this.once(key, this.p.tech) ? Btn.L | Btn.M : 0;
    }
    // 防禦中：繼續按住後（下段就蹲），偶爾用鬥氣反擊
    if (me.action === 'blockstun') {
      this.reset();
      const low = this.foeLow(foe);
      const key = `rev${s.frame - me.frame}`;
      const rev = me.frame === 2 && me.drive >= 2 * DRIVE_BAR && !me.burnout && this.once(key, this.p.reversal);
      return back | (low ? Btn.DOWN : 0) | (rev ? Btn.DRIVE : 0);
    }
    // 出招中：命中或被防就接下一招
    if (me.action === 'attack') {
      if (this.plan.length) return this.next();
      if (this.combo.length && me.hitsDone > 0 && movePhase(me) !== 'startup') {
        const bits = this.combo.shift()!;
        this.plan = [{ bits, frames: 2 }, { bits: bits & Btn.DOWN, frames: 1 }];
        return this.next();
      }
      if (movePhase(me) === 'recovery' && me.hitsDone === 0) this.combo = [];
      return this.comboHold;
    }
    // 鬥氣衝刺中：衝到一半接下一招
    if (me.action === 'driveRush') {
      if (this.plan.length) return this.next();
      if (me.frame >= 8 && this.combo.length) {
        const bits = this.combo.shift()!;
        this.plan = [{ bits, frames: 2 }];
        return this.next();
      }
      return 0;
    }
    if (!['idle', 'walkF', 'walkB', 'crouch', 'land', 'air', 'jumpSquat'].includes(me.action)) {
      this.reset();
      return 0;
    }
    if (me.action === 'air' || me.action === 'jumpSquat') {
      // 空中：靠近時出空中重腳
      if (me.action === 'air' && me.vy < 0 && dist < 170 && me.y < 220 * FP && this.once(`jatk${s.frame - me.frame}`, 0.4 + this.p.aggression * 0.4)) {
        return Btn.H;
      }
      return this.plan.length ? this.next() : 0;
    }

    // 對空：對手跳過來快落下時，蹲重拳
    if (foe.y > 0 && (foe.action === 'air' || (foe.action === 'attack' && currentMove(foe)?.stance === 'air'))) {
      const coming = dist < 230 && foe.y < 300 * FP && foe.vy < 0;
      if (coming) {
        // 同一次跳躍只判斷一次（以 45 格為一個時間窗）
        const key = `aa${Math.floor(s.frame / 45)}`;
        if (this.once(key, this.p.antiAir)) {
          // 普通、困難：一半用對空技（→↓↘ + 拳），其他用蹲重拳
          if (this.level !== 'easy' && me.form === 'normal' && me.drive >= 2 * DRIVE_BAR && !me.burnout && this.chance(0.5)) this.plan = this.motion623(fwd, Btn.H);
          else this.plan = [{ bits: Btn.DOWN | Btn.M, frames: 2 }]; // 蹲中 = 對空重拳
          return this.next();
        }
        if (dist < 180 && this.once(`aab${key}`, this.p.block)) return back;
      }
    }

    // 對手放鬥氣衝擊：困難電腦有時用鬥氣衝擊回擊（打康會跪倒）
    const fm = currentMove(foe);
    if (foe.action === 'attack' && fm?.kind === 'impact' && foe.frame < 12 && dist < 230 && this.level === 'hard'
      && me.form === 'normal' && me.drive >= DRIVE_BAR && !me.burnout && this.once(`di${s.frame - foe.frame}`, 0.5)) {
      this.plan = [{ bits: fwd | Btn.DRIVE, frames: 2 }];
      return this.next();
    }
    // 防禦：對手出招中、而且打得到這裡
    if (foe.action === 'attack' && fm && movePhase(foe) !== 'recovery' && (fm.damage ?? 0) > 0) {
      const reach = this.reach(foe);
      if (fm.fullScreen || dist < reach + 70) {
        const key = `blk${s.frame - foe.frame}`;
        if (this.once(key, this.p.block)) {
          this.plan = [];
          const right = this.once(`g${key}`, this.p.guardRight);
          const low = this.foeLow(foe);
          return back | ((right ? low : !low) ? Btn.DOWN : 0);
        }
      }
    }
    // 飛行道具：靠近時防禦或跳過去
    const shot = s.projectiles.find((pr) => pr.owner !== side && Math.abs(pr.x - me.x) / FP < 260 && Math.sign(me.x - pr.x) === Math.sign(pr.vx));
    if (shot) {
      const key = `prj${shot.moveId}${Math.floor(shot.x / (400 * FP))}`;
      if (this.once(key, this.p.block)) {
        if (this.once(`jmp${key}`, 0.3 * this.p.aggression)) { this.plan = [{ bits: Btn.UP | fwd, frames: 3 }]; return this.next(); }
        return back;
      }
    }

    // 反擊：對手招式收招中、而且在打得到的距離
    if (foe.action === 'attack' && fm && movePhase(foe) === 'recovery' && dist < this.reach(me) + 20) {
      if (this.once(`pun${s.frame - foe.frame}`, this.p.punish)) {
        this.startCombo(me, fwd, true);
        return this.next();
      }
    }

    if (this.plan.length) return this.next();
    if (s.frame < this.nextThink) return 0;
    this.nextThink = s.frame + this.p.think + Math.floor(this.rand() * this.p.think);
    this.think(s, me, dist, fwd, back);
    return this.plan.length ? this.next() : 0;
  }

  /** 中立狀態：依距離決定要做什麼 */
  private think(s: GameState, me: FighterState, dist: number, fwd: number, back: number): void {
    const p = this.p;
    const c = getChar(me.charId);
    const walk = (dir: number, frames: number) => { this.plan = [{ bits: dir, frames }]; };
    const press = (bits: InputBits) => { this.plan = [{ bits, frames: 2 }]; };
    // 特殊技要的鬥氣（一般特殊技 2 格、龍之吐息 3 格）
    const spCost = getChar(me.charId).moves[formStats(me).moves.sp ?? '']?.driveCost ?? 0;
    const hasDrive = me.drive >= spCost && !me.burnout;

    // 恐龍形態：一直往前打
    if (me.form === 'dino') {
      if (dist < 150) press([Btn.L, Btn.M, Btn.H, Btn.SP][Math.floor(this.rand() * 4)]);
      else walk(fwd, 20);
      return;
    }
    // 必殺技：能量滿、距離合適
    if (me.meter >= METER_MAX && this.chance(0.25 + p.aggression * 0.3)) {
      const sup = c.moves[c.super];
      if (sup?.fullScreen || sup?.kind === 'transform' || dist < 170) { press(Btn.SP | Btn.H); return; }
    }
    const sp = c.moves[formStats(me).moves.sp ?? ''];
    const spReach = sp?.projectile ? 9999 : sp ? (moveHitbox(sp)?.x ?? 0) + (moveHitbox(sp)?.w ?? 0) : 0;
    const r = this.rand();

    if (dist > 330) {
      if (sp?.projectile && hasDrive && !s.projectiles.some((pr) => pr.owner === s.fighters.indexOf(me)) && r < 0.3 + p.aggression * 0.2) {
        press(Btn.SP); // 愛心波動只能按特殊鍵
      }
      else if (r < 0.15 * p.aggression) this.plan = [{ bits: fwd, frames: 1 }, { bits: 0, frames: 1 }, { bits: fwd, frames: 6 }]; // 衝刺
      else walk(fwd, 18);
    } else if (dist > 200) {
      if (spReach >= dist - 20 && hasDrive && r < 0.35) press(Btn.SP); // 鞭擊等長距離特殊技
      else if (r < 0.12 * p.aggression) this.plan = [{ bits: Btn.UP | fwd, frames: 3 }]; // 跳進
      else if (r < 0.85) walk(fwd, 14);
      else walk(back, 10);
    } else if (dist > 125) {
      // 鬥氣衝擊：偶爾硬衝（困難比較常用）
      if (me.form === 'normal' && me.drive >= 3 * DRIVE_BAR && !me.burnout && this.level !== 'easy' && r < (this.level === 'hard' ? 0.06 : 0.03)) { press(fwd | Btn.DRIVE); return; }
      if (r < 0.45 * p.aggression) press(this.rand() < 0.5 ? Btn.H : Btn.DOWN | Btn.H); // 用最遠的招牽制
      else if (r < 0.75) walk(fwd, 10);
      else if (r < 0.9) walk(back, 10);
      else walk(back | Btn.DOWN, 12); // 蹲防等待
    } else {
      if (r < 0.12 + p.aggression * 0.08) press(fwd | Btn.L | Btn.M); // 投技
      else if (r < 0.2 + p.aggression * 0.55) this.startCombo(me, fwd, false);
      else if (r < 0.85) walk(back | (this.rand() < 0.5 ? Btn.DOWN : 0), 14); // 防禦
      else this.plan = [{ bits: back, frames: 1 }, { bits: 0, frames: 1 }, { bits: back, frames: 4 }]; // 後撤
    }
  }

  /** 開始一段連段（依難度決定長度） */
  private startCombo(me: FighterState, _fwd: number, punish: boolean): void {
    // 特殊技要的鬥氣（每招不同：愛心波動、鞭擊 2 格，龍之吐息 3 格）
    const spCost = getChar(me.charId).moves[formStats(me).moves.sp ?? '']?.driveCost ?? DRIVE_BAR;
    const hasDrive = me.drive >= spCost && !me.burnout;
    // 反擊用重攻擊起手（傷害高）；一般連段用輕攻擊起手
    const routes: InputBits[][] = punish
      ? this.p.combo === 0 ? [[Btn.H], [Btn.DOWN | Btn.H]] : [[Btn.H, Btn.SP], [Btn.DOWN | Btn.H]]
      : this.p.combo === 0
        ? [[Btn.L], [Btn.DOWN | Btn.L], [Btn.M]]
        : this.p.combo === 1
          ? [[Btn.L, Btn.H], [Btn.DOWN | Btn.L, Btn.DOWN | Btn.H], [Btn.L, Btn.M]]
          : [[Btn.L, Btn.M, Btn.H, Btn.SP], [Btn.DOWN | Btn.L, Btn.DOWN | Btn.H], [Btn.DOWN | Btn.L, Btn.H, Btn.SP]];
    // 困難：鬥氣夠的時候用鬥氣衝刺延長連段（重拳 → 衝刺 → 重拳 → 特殊技）
    if (this.level === 'hard' && me.form === 'normal' && me.drive >= 4 * DRIVE_BAR && !me.burnout && this.chance(0.35)) {
      routes.splice(0, routes.length, [Btn.H, Btn.DRIVE, Btn.H, Btn.SP]);
    }
    let route = routes[Math.floor(this.rand() * routes.length)];
    if (!hasDrive || this.p.combo < 2) route = route.filter((b) => b !== Btn.SP || this.p.combo >= 1 && hasDrive && punish);
    const [first, ...rest] = route;
    this.combo = rest;
    this.comboHold = first & Btn.DOWN;
    this.plan = [{ bits: first, frames: 2 }, { bits: first & Btn.DOWN, frames: 1 }];
  }


  /** →↓↘ + 按鍵 */
  private motion623(fwd: number, btn: number): Step[] {
    return [{ bits: fwd, frames: 1 }, { bits: Btn.DOWN, frames: 1 }, { bits: Btn.DOWN | fwd, frames: 1 }, { bits: Btn.DOWN | fwd | btn, frames: 2 }];
  }

  private next(): InputBits {
    const st = this.plan[0];
    st.frames--;
    if (st.frames <= 0) this.plan.shift();
    return st.bits;
  }

  private reset(): void {
    this.plan = [];
    this.combo = [];
    this.comboHold = 0;
  }

  /** 招式最遠打到哪裡（像素） */
  private reach(f: FighterState): number {
    const m = currentMove(f);
    if (!m) return 0;
    const hb = moveHitbox(m);
    if (hb) return hb.x + hb.w;
    // 還沒出招：用站重估計
    const k = getChar(f.charId).moves[formStats(f).moves.sH ?? ''];
    const kb = k && moveHitbox(k);
    return kb ? kb.x + kb.w : 120;
  }

  private foeLow(foe: FighterState): boolean {
    return currentMove(foe)?.guard === 'low';
  }
}
