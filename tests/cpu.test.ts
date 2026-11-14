import { describe, expect, it } from 'vitest';
import { CpuPlayer, type CpuLevel } from '../src/client/cpu';
import { createGame, step } from '../src/core/game';
import { Btn } from '../src/core/input';
import type { GameState } from '../src/core/types';
import { FP } from '../src/core/types';

/** 跑到比賽結束（或到上限），回傳最後狀態 */
function play(s: GameState, p1: (s: GameState) => number, p2: (s: GameState) => number, maxFrames = 60 * 60 * 6): GameState {
  for (let k = 0; k < maxFrames && s.phase !== 'matchEnd'; k++) step(s, [p1(s), p2(s)]);
  return s;
}

describe('電腦對手', () => {
  for (const level of ['easy', 'normal', 'hard'] as CpuLevel[]) {
    for (const [a, b] of [['sawa', 'mio'], ['mio', 'sawa']]) {
      it(`${level}（${b}）打得贏站著不動的 ${a}`, () => {
        const cpu = new CpuPlayer(level, 7);
        const s = play(createGame(a, b, { timeLimit: true }), () => 0, (st) => cpu.input(st, 1));
        expect(s.phase).toBe('matchEnd');
        expect(s.matchWinner).toBe(1);
      });
    }
  }

  it('電腦對電腦能正常打完一場（不會卡住）', () => {
    const c1 = new CpuPlayer('hard', 1);
    const c2 = new CpuPlayer('normal', 2);
    const s = play(createGame('sawa', 'mio', { timeLimit: true }), (st) => c1.input(st, 0), (st) => c2.input(st, 1));
    expect(s.phase).toBe('matchEnd');
  });

  it('困難比簡單更會防禦', () => {
    // 玩家 1 一直走近對手出站重腳，數電腦被打中和防住的次數
    const blockedRatio = (level: CpuLevel) => {
      let hit = 0, blocked = 0;
      for (let seed = 1; seed <= 8; seed++) {
        const cpu = new CpuPlayer(level, seed);
        const s = createGame('mio', 'sawa', { timeLimit: true }); // 電腦用 Sawa，避免 Mio 變身 20 秒影響防禦的測量
        let prevAct = '';
        for (let k = 0; k < 60 * 40 && s.phase !== 'matchEnd'; k++) {
          const me = s.fighters[0], foe = s.fighters[1];
          const fwd = foe.x > me.x ? Btn.RIGHT : Btn.LEFT;
          const near = Math.abs(foe.x - me.x) < 150 * FP;
          const p1 = near ? (k % 30 === 0 ? Btn.H : 0) : fwd;
          s.fighters[1].meter = 0; // 只測防禦：不讓電腦放必殺技
          step(s, [p1, cpu.input(s, 1)]);
          const act = s.fighters[1].action;
          if (act !== prevAct) { if (act === 'blockstun') blocked++; if (act === 'hitstun') hit++; }
          prevAct = act;
        }
      }
      return blocked / Math.max(1, hit + blocked);
    };
    const easy = blockedRatio('easy');
    const hard = blockedRatio('hard');
    expect(hard).toBeGreaterThan(easy + 0.05); // 實測約 62% 對 72%
  });
});
