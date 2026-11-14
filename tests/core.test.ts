import { describe, expect, it } from 'vitest';
import { BACKDASH_COOLDOWN, cloneState, createGame, DRIVE_BAR, DRIVE_MAX, METER_MAX, moveHitbox, step } from '../src/core/game';
import { getChar } from '../src/core/characters';
import { Btn } from '../src/core/input';
import type { GameState } from '../src/core/types';
import { FP } from '../src/core/types';

const { UP, DOWN, LEFT, RIGHT, L, M, H, SP, DRIVE } = Btn;

/** 跳過開場，回到可以操作的狀態，並把兩人擺到指定位置（像素）。 */
function ready(p1: string, p2: string, x1 = 600, x2 = 680): GameState {
  const s = createGame(p1, p2);
  while (s.phase !== 'fight') step(s, [0, 0]);
  s.fighters[0].x = x1 * FP;
  s.fighters[1].x = x2 * FP;
  step(s, [0, 0]);
  return s;
}

function run(s: GameState, frames: number, i1 = 0, i2 = 0): void {
  for (let k = 0; k < frames; k++) step(s, [i1, i2]);
}

/** P1（面向右）搓招再按鍵：方向用數字鍵盤表示（2 = 下、3 = 右下、6 = 右…） */
const DIR: Record<number, number> = { 1: DOWN | LEFT, 2: DOWN, 3: DOWN | RIGHT, 4: LEFT, 5: 0, 6: RIGHT };
function motion(s: GameState, dirs: number[], btn: number): void {
  for (const d of dirs) step(s, [DIR[d], 0]);
  step(s, [DIR[dirs[dirs.length - 1]] | btn, 0]);
  step(s, [0, 0]);
}

/** 按一下（按住 1 格後放開）。 */
function tap(s: GameState, bits: number, i2 = 0, hold = 0): void {
  step(s, [bits, i2]);
  run(s, 1, hold, i2);
}

function lcg(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x;
  };
}

describe('可決定性（rollback 的前提）', () => {
  it('相同輸入跑兩次，結果完全一樣', () => {
    const play = () => {
      const s = createGame('sawa', 'mio');
      const r = lcg(42);
      for (let k = 0; k < 4000; k++) step(s, [r() & 0x7ff, r() & 0x7ff]);
      return JSON.stringify(s);
    };
    expect(play()).toEqual(play());
  });

  it('從中途存檔重播，結果和不中斷一樣', () => {
    const r = lcg(7);
    const inputs = Array.from({ length: 3000 }, () => [r() & 0x7ff, r() & 0x7ff] as [number, number]);
    const a = createGame('mio', 'sawa');
    let snap: GameState | null = null;
    inputs.forEach((inp, k) => {
      if (k === 1500) snap = cloneState(a);
      step(a, inp);
    });
    const b = snap!;
    inputs.slice(1500).forEach((inp) => step(b, inp));
    expect(JSON.stringify(b)).toEqual(JSON.stringify(a));
  });
});

describe('基本攻防', () => {
  it('站輕拳打中會扣血', () => {
    const s = ready('sawa', 'mio');
    tap(s, L);
    run(s, 20);
    expect(s.fighters[1].hp).toBe(1000 - 25);
  });

  it('按住後方向可以防禦', () => {
    const s = ready('sawa', 'mio');
    step(s, [L, RIGHT]);
    let blocked = false;
    for (let k = 0; k < 20; k++) {
      step(s, [0, RIGHT]);
      if (s.fighters[1].action === 'blockstun') blocked = true;
    }
    expect(blocked).toBe(true);
    expect(s.fighters[1].hp).toBe(1000);
  });

  it('下段攻擊：站防擋不住、蹲防擋得住', () => {
    const s1 = ready('sawa', 'mio');
    step(s1, [DOWN | L, RIGHT]);
    run(s1, 20, DOWN, RIGHT);
    expect(s1.fighters[1].hp).toBeLessThan(1000);

    const s2 = ready('sawa', 'mio');
    step(s2, [DOWN | L, RIGHT | DOWN]);
    run(s2, 20, DOWN, RIGHT | DOWN);
    expect(s2.fighters[1].hp).toBe(1000);
  });

  it('輕攻擊打中可以取消成重攻擊（連段）', () => {
    const s = ready('mio', 'sawa');
    step(s, [L, 0]);
    for (let k = 0; k < 8; k++) step(s, [k >= 4 ? H : 0, 0]);
    run(s, 40);
    expect(s.fighters[1].hp).toBe(900 - 30 - 80);
  });

  it('投技：近身 → + 重拳 + 重腳，第 5 格抓到，對手被摔倒', () => {
    const s = ready('mio', 'sawa', 600, 680);
    step(s, [RIGHT | L | M, 0]);
    expect(s.fighters[0].action).toBe('attack'); // 還在出手
    run(s, 6);
    expect(s.fighters[0].action).toBe('throwing');
    run(s, 100);
    expect(s.fighters[1].hp).toBe(900 - 120);
  });

  it('投技：對手被往身後丟出去約半個舞台，落地時才扣血、摔倒再爬起來', () => {
    const s = ready('mio', 'sawa', 900, 980);
    step(s, [RIGHT | L | M, 0]);
    run(s, 6);
    expect(s.fighters[1].action).toBe('thrown');
    // 丟出去的瞬間還沒扣血
    for (let k = 0; k < 60 && s.fighters[1].action === 'thrown'; k++) step(s, [0, 0]);
    expect(s.fighters[1].action).toBe('airHit');
    expect(s.fighters[1].hp).toBe(900);
    // 落地才扣血並倒地
    for (let k = 0; k < 60 && s.fighters[1].action === 'airHit'; k++) step(s, [0, 0]);
    expect(s.fighters[1].hp).toBe(900 - 120);
    expect(s.fighters[1].action).toBe('knockdown');
    expect(s.fighters[1].x).toBeLessThan(s.fighters[0].x); // 被丟到投技方的另一邊
    expect(s.fighters[0].x - s.fighters[1].x).toBeGreaterThan(500 * FP); // 飛了約半個舞台
    // 爬起來後可以行動
    for (let k = 0; k < 80 && s.fighters[1].action !== 'idle'; k++) step(s, [0, 0]);
    expect(s.fighters[1].action).toBe('idle');
  });

  it('攻擊克制投技：投技出手中被輕拳打中就抓不到', () => {
    const s = ready('mio', 'sawa', 600, 680);
    step(s, [RIGHT | L | M, L]);
    run(s, 40);
    expect(s.fighters[0].hp).toBeLessThan(1000);
    expect(s.fighters[1].hp).toBe(900);
  });

  it('拆投：被抓後馬上也按投技，雙方彈開不扣血', () => {
    const s = ready('mio', 'sawa', 600, 680);
    step(s, [RIGHT | L | M, 0]);
    run(s, 6);
    expect(s.fighters[1].action).toBe('thrown');
    step(s, [0, L | M]);
    run(s, 40);
    expect(s.fighters[1].hp).toBe(900);
    expect(s.fighters[0].hp).toBe(1000);
  });

  it('投技抓空收招很大', () => {
    const s = ready('mio', 'sawa', 300, 900);
    step(s, [RIGHT | L | M, 0]);
    run(s, 15);
    expect(s.fighters[0].action).toBe('attack');
  });

  it('投技不能防禦', () => {
    const s = ready('mio', 'sawa', 600, 680);
    step(s, [RIGHT | L | M, RIGHT]);
    run(s, 100, 0, RIGHT);
    expect(s.fighters[1].hp).toBe(900 - 120);
  });

  it('連按兩下前 = 衝刺', () => {
    const s = ready('sawa', 'mio', 300, 900);
    step(s, [RIGHT, 0]);
    step(s, [0, 0]);
    step(s, [RIGHT, 0]);
    expect(s.fighters[0].action).toBe('dashF');
  });

  it('後撤完要等一下才能再後撤', () => {
    const s = ready('sawa', 'mio', 600, 900);
    const backdash = () => { step(s, [LEFT, 0]); step(s, [0, 0]); step(s, [LEFT, 0]); };
    backdash();
    expect(s.fighters[0].action).toBe('dashB');
    while (s.fighters[0].action === 'dashB') step(s, [0, 0]);
    backdash(); // 剛結束馬上再按：冷卻中，不會後撤
    expect(s.fighters[0].action).not.toBe('dashB');
    run(s, BACKDASH_COOLDOWN);
    backdash();
    expect(s.fighters[0].action).toBe('dashB');
  });

  it('空中按特殊技不會讓角色卡在空中（兩位角色）', () => {
    for (const ch of ['sawa', 'mio']) {
      const s = ready(ch, ch === 'sawa' ? 'mio' : 'sawa', 300, 900);
      step(s, [UP, 0]);
      run(s, 12);
      expect(s.fighters[0].y).toBeGreaterThan(0);
      tap(s, SP);
      run(s, 80);
      expect(s.fighters[0].y, ch).toBe(0);
      expect(s.fighters[0].action, ch).not.toBe('attack');
    }
  });

  it('空中按特殊技＋重腳（必殺技指令）也不會卡在空中', () => {
    const s = ready('mio', 'sawa', 300, 900);
    s.fighters[0].meter = METER_MAX;
    step(s, [UP, 0]);
    run(s, 12);
    tap(s, SP | H);
    run(s, 120);
    expect(s.fighters[0].y).toBe(0);
  });

  it('蹲重拳打中會把對手打飛到空中再倒地', () => {
    const s = ready('sawa', 'mio', 600, 660);
    step(s, [DOWN | M, 0]);
    let maxY = 0;
    for (let k = 0; k < 60; k++) { step(s, [DOWN, 0]); maxY = Math.max(maxY, s.fighters[1].y); }
    expect(maxY).toBeGreaterThan(80 * FP);
    for (let k = 0; k < 60 && s.fighters[1].action !== 'knockdown'; k++) step(s, [0, 0]);
    expect(s.fighters[1].action).toBe('knockdown');
  });

  it('空中輕中重是三種不同的招', () => {
    const ids: string[] = [];
    for (const btn of [L, M, H]) {
      const s = ready('sawa', 'mio', 300, 900);
      step(s, [UP, 0]);
      run(s, 8);
      step(s, [btn, 0]);
      ids.push(s.fighters[0].moveId ?? '');
    }
    expect(ids).toEqual(['jLP', 'jLK', 'jHK']);
  });

  it('跳躍會離地再落地', () => {
    const s = ready('sawa', 'mio', 300, 900);
    step(s, [UP, 0]);
    run(s, 10);
    expect(s.fighters[0].y).toBeGreaterThan(0);
    run(s, 60);
    expect(s.fighters[0].y).toBe(0);
  });
});

describe('鬥氣（Drive）', () => {
  it('開局鬥氣全滿；特殊技扣 2 格，OD 版扣 3 格', () => {
    for (const ch of ['sawa', 'mio']) {
      const s = ready(ch, ch === 'sawa' ? 'mio' : 'sawa', 300, 900);
      expect(s.fighters[0].drive).toBe(DRIVE_MAX);
      tap(s, SP);
      expect(s.fighters[0].moveId, ch).toBe('sp');
      expect(s.fighters[0].drive, ch).toBeLessThan(DRIVE_MAX - 2 * DRIVE_BAR + 200);
      expect(s.fighters[0].drive, ch).toBeGreaterThan(DRIVE_MAX - 2 * DRIVE_BAR - 200);
      const t = ready(ch, ch === 'sawa' ? 'mio' : 'sawa', 300, 900);
      motion(t, [2, 3, 6], M | H);
      expect(t.fighters[0].moveId, ch).toBe('spOD');
      expect(t.fighters[0].drive, ch).toBeLessThan(DRIVE_MAX - 3 * DRIVE_BAR + 200);
      expect(t.fighters[0].drive, ch).toBeGreaterThan(DRIVE_MAX - 3 * DRIVE_BAR - 200);
    }
  });

  it('鬥氣不到 3 格時 OD 會變成一般版；不到 2 格放不出特殊技', () => {
    for (const ch of ['sawa', 'mio']) {
      const s = ready(ch, ch === 'sawa' ? 'mio' : 'sawa', 300, 900);
      s.fighters[0].drive = DRIVE_BAR * 2.5;
      motion(s, [2, 3, 6], M | H);
      expect(s.fighters[0].moveId, ch).toBe('sp');
      const t = ready(ch, ch === 'sawa' ? 'mio' : 'sawa', 300, 900);
      t.fighters[0].drive = DRIVE_BAR * 1.5;
      tap(t, SP);
      run(t, 20);
      expect(t.fighters[0].moveId, ch).not.toBe('sp');
      expect(t.projectiles.length).toBe(0);
    }
  });

  it('兩個拳差 1～2 格才按到，也會變成 OD（只扣 OD 的 3 格）', () => {
    for (const gap of [1, 2]) {
      const s = ready('sawa', 'mio', 300, 900);
      motion(s, [2, 3, 6], M);
      expect(s.fighters[0].moveId).toBe('sp');
      run(s, gap - 1, RIGHT | M);
      step(s, [RIGHT | M | H, 0]);
      expect(s.fighters[0].moveId, `gap ${gap}`).toBe('spOD');
      expect(s.fighters[0].drive).toBeLessThan(DRIVE_MAX - 3 * DRIVE_BAR + 300);
      expect(s.fighters[0].drive).toBeGreaterThan(DRIVE_MAX - 3 * DRIVE_BAR - 300);
    }
  });

  it('特殊鍵 + 重拳 = 簡易操作的 OD', () => {
    const s = ready('sawa', 'mio', 300, 900);
    step(s, [SP | M, 0]);
    expect(s.fighters[0].moveId).toBe('spOD');
  });

  it('一般攻擊打中回復鬥氣', () => {
    const s = ready('sawa', 'mio');
    s.fighters[0].drive = 2 * DRIVE_BAR;
    tap(s, H);
    run(s, 15);
    expect(s.fighters[0].drive).toBeGreaterThanOrEqual(2 * DRIVE_BAR + DRIVE_BAR / 2);
  });

  it('隨時間回復：平常約 20 秒從 0 回滿', () => {
    const s = ready('sawa', 'mio', 300, 900);
    s.fighters[0].drive = 1;
    run(s, 1150);
    expect(s.fighters[0].drive).toBeLessThan(DRIVE_MAX);
    expect(s.fighters[0].burnout).toBe(false); // 只是很少，不是用光
    run(s, 100);
    expect(s.fighters[0].drive).toBe(DRIVE_MAX);
  });

  it('燃盡時回復加快：約 10 秒回滿並解除燃盡', () => {
    const s = ready('sawa', 'mio', 300, 900);
    s.fighters[0].drive = 0;
    s.fighters[0].burnout = true;
    run(s, 570);
    expect(s.fighters[0].burnout).toBe(true);
    run(s, 50);
    expect(s.fighters[0].burnout).toBe(false);
  });

  it('燃盡：不能放特殊技，防禦會被削血、硬直變長', () => {
    const s = ready('sawa', 'mio');
    s.fighters[1].drive = 0;
    s.fighters[1].burnout = true;
    step(s, [H, RIGHT]);
    run(s, 15, 0, RIGHT);
    expect(s.fighters[1].hp).toBe(1000 - Math.trunc(70 / 4)); // 站重 = 站重拳 70
  });

  it('檔架：按住鬥氣鍵擋下攻擊，不扣血、回復鬥氣', () => {
    const s = ready('sawa', 'mio');
    step(s, [0, DRIVE]);
    run(s, 5, 0, DRIVE); // 先檔架一陣子（不是完美檔架）
    const before = s.fighters[1].drive;
    step(s, [H, DRIVE]);
    run(s, 15, 0, DRIVE);
    expect(s.fighters[1].hp).toBe(1000);
    expect(s.fighters[0].action === 'parried').toBe(false);
    expect(s.fighters[1].drive).toBeGreaterThan(before - 25 * 100 - 1); // 擋下時有回半格
  });

  it('完美檔架：剛按下時擋到，攻擊方僵直、自己馬上能動', () => {
    const s = ready('sawa', 'mio');
    step(s, [H, 0]);
    run(s, 5); // 站重（重拳）第 8 格才打到
    step(s, [0, DRIVE]);
    let parried = false;
    for (let k = 0; k < 6; k++) { step(s, [0, DRIVE]); if (s.fighters[0].action === 'parried') parried = true; }
    expect(parried).toBe(true);
    expect(s.fighters[1].hp).toBe(1000);
  });

  it('檔架擋不住投技，而且被抓會多扣血', () => {
    const s = ready('mio', 'sawa', 600, 680);
    step(s, [0, DRIVE]);
    step(s, [RIGHT | L | M, DRIVE]);
    run(s, 100, 0, DRIVE);
    expect(s.fighters[1].hp).toBe(900 - 180);
  });

  it('鬥氣反擊：防禦中按鬥氣鍵，扣 2 格、打不死人、把對手推開', () => {
    const s = ready('sawa', 'mio');
    step(s, [H, RIGHT]);
    for (let k = 0; k < 30 && !(s.fighters[1].action === 'blockstun' && s.hitstop === 0); k++) step(s, [0, RIGHT]);
    expect(s.fighters[1].action).toBe('blockstun');
    s.fighters[0].hp = 10;
    const drive = s.fighters[1].drive;
    step(s, [0, DRIVE]);
    expect(s.fighters[1].moveId).toBe('reversal');
    expect(s.fighters[1].drive).toBeLessThan(drive - 2 * DRIVE_BAR + 200);
    run(s, 40);
    expect(s.fighters[0].hp).toBe(1); // 打不死人
  });

  it('燃盡時不能檔架、不能鬥氣反擊', () => {
    const s = ready('sawa', 'mio');
    s.fighters[1].drive = 0;
    s.fighters[1].burnout = true;
    step(s, [0, DRIVE]);
    expect(s.fighters[1].action).not.toBe('parry');
  });
});

describe('Sawa', () => {
  it('愛心波動會飛出去打中遠處的對手', () => {
    const s = ready('sawa', 'mio', 300, 900);
    tap(s, SP);
    run(s, 15);
    expect(s.projectiles.length).toBe(1);
    run(s, 120);
    expect(s.fighters[1].hp).toBe(1000 - 48); // 簡易操作（特殊鍵）傷害 8 成
    expect(s.projectiles.length).toBe(0);
  });

  it('一次只能有一發愛心波動', () => {
    const s = ready('sawa', 'mio', 100, 1200);
    tap(s, SP);
    run(s, 45);
    tap(s, SP);
    run(s, 15);
    expect(s.projectiles.length).toBe(1);
  });

  it('必殺技（L+K）全畫面多段攻擊，沒防禦會被打中', () => {
    const s = ready('sawa', 'mio', 200, 1100);
    s.fighters[0].meter = METER_MAX;
    step(s, [SP | H, 0]);
    expect(s.superFreeze).not.toBeNull();
    run(s, 200);
    expect(s.fighters[0].meter).toBe(0);
    expect(s.fighters[1].hp).toBeLessThan(1000 - 200);
  });

  it('必殺技可以被防禦擋下（不扣血）', () => {
    const s = ready('sawa', 'mio', 200, 1100);
    s.fighters[0].meter = METER_MAX;
    step(s, [SP | H, RIGHT]);
    run(s, 200, 0, RIGHT);
    expect(s.fighters[1].hp).toBe(1000);
  });

  it('能量不夠時 L+K 不會放必殺技', () => {
    const s = ready('sawa', 'mio', 200, 1100);
    step(s, [SP | H, 0]);
    expect(s.superFreeze).toBeNull();
  });
});

describe('Mio', () => {
  it('鞭擊比站重腳打得更遠（約 2 倍）', () => {
    const gap = 260;
    const s1 = ready('mio', 'sawa', 400, 400 + gap);
    tap(s1, H);
    run(s1, 40);
    expect(s1.fighters[1].hp).toBe(900);

    const s2 = ready('mio', 'sawa', 400, 400 + gap);
    motion(s2, [2, 3, 6], M);
    run(s2, 40);
    expect(s2.fighters[1].hp).toBe(900 - 90);
  });

  it('必殺技變身恐龍 20 秒：變慢、時間到變回來', () => {
    const s = ready('mio', 'sawa', 300, 900);
    s.fighters[0].meter = METER_MAX;
    step(s, [SP | H, 0]);
    run(s, 80 + 124 + 1); // 畫面暫停 80 + 變身動作 124（戴帽、邪惡力量爆發、怒吼）
    const m = s.fighters[0];
    expect(m.form).toBe('dino');

    const x0 = m.x;
    run(s, 10, RIGHT);
    const dinoWalk = m.x - x0;
    expect(dinoWalk).toBe(280 * 10);

    run(s, 1200);
    expect(m.form).toBe('normal');
  });

  it('恐龍形態的攻擊傷害 ×1.5', () => {
    const s = ready('mio', 'sawa', 300, 900);
    s.fighters[0].meter = METER_MAX;
    step(s, [SP | H, 0]);
    run(s, 80 + 124 + 5); // 等變身動作整段結束
    s.fighters[0].x = 600 * FP;
    s.fighters[1].x = 700 * FP;
    run(s, 2);
    tap(s, L); // 奶龍的輕 = 肚子撞（60）
    run(s, 30);
    expect(s.fighters[1].hp).toBe(900 - Math.trunc(60 * 1.5));
  });
});

describe('回合流程', () => {
  it('預設時間無限：時間不會倒數', () => {
    const s = ready('sawa', 'mio');
    const t = s.timer;
    run(s, 600);
    expect(s.timer).toBe(t);
    expect(s.phase).toBe('fight');
  });

  it('KO 後拿下一回合，先拿兩回合的人贏', () => {
    const s = ready('sawa', 'mio');
    s.fighters[1].hp = 1;
    tap(s, L);
    run(s, 10);
    expect(s.phase).toBe('ko');
    expect(s.fighters[0].wins).toBe(1);
    while (s.phase !== 'fight') step(s, [0, 0]);
    expect(s.round).toBe(2);
    s.fighters[0].x = 600 * FP;
    s.fighters[1].x = 680 * FP;
    s.fighters[1].hp = 1;
    run(s, 1);
    tap(s, L);
    for (let k = 0; k < 400 && (s.phase as string) !== 'matchEnd'; k++) step(s, [0, 0]);
    expect(s.phase).toBe('matchEnd');
    expect(s.matchWinner).toBe(0);
  });

  it('能量槽會保留到下一回合（變身不保留）', () => {
    const s = ready('mio', 'sawa');
    s.fighters[0].meter = 700;
    s.fighters[0].form = 'dino';
    s.fighters[0].formTimer = 300;
    s.fighters[1].meter = METER_MAX;
    s.fighters[1].hp = 1;
    tap(s, L);
    while (s.phase !== 'intro') step(s, [0, 0]);
    expect(s.round).toBe(2);
    expect(s.fighters[0].meter).toBe(700);
    expect(s.fighters[0].form).toBe('normal');
    expect(s.fighters[1].meter).toBe(METER_MAX);
  });

  it('時間到時血量比例高的人贏', () => {
    const s = ready('sawa', 'mio');
    s.fighters[0].hp = 450; // 50%
    s.fighters[1].hp = 600; // 60%
    s.timeLimit = true;
    s.timer = 2;
    run(s, 3);
    expect(s.roundResult).toEqual({ winner: 1, reason: 'time' });
  });

  it('出場時角色頭上有對話框', () => {
    const s = createGame('sawa', 'mio');
    expect(s.fighters[0].bubble?.text).toBe('來吧！戰鬥吧！');
    expect(s.fighters[1].bubble?.text).toBe('好累喔～不想動');
  });

  it('挑釁會冒出對話框', () => {
    const s = ready('sawa', 'mio', 300, 900);
    tap(s, Btn.TAUNT);
    expect(s.fighters[0].bubble?.text).toBe('67～');
  });
});

void LEFT;

describe('攻擊範圍', () => {
  it('基本攻擊的攻擊框往前延伸，特殊技不變', async () => {
    const { NORMAL_REACH_BONUS } = await import('../src/core/game');
    const c = getChar('sawa');
    expect(moveHitbox(c.moves.sLP)!.w).toBe(c.moves.sLP.hitbox!.w + NORMAL_REACH_BONUS);
    expect(moveHitbox(c.moves.jHK)!.w).toBe(c.moves.jHK.hitbox!.w + NORMAL_REACH_BONUS);
    expect(moveHitbox(getChar('mio').moves.sp)).toEqual(getChar('mio').moves.sp.hitbox);
  });

  it('蹲重拳的攻擊框在蹲姿身體前緣的上方', () => {
    for (const id of ['sawa', 'mio']) {
      const c = getChar(id);
      const hb = c.moves.cHP.hitbox!;
      const body = c.forms.normal.hurtCrouch;
      expect(hb.x, id).toBeGreaterThanOrEqual(body.x + body.w - 20);
      expect(hb.y + hb.h, id).toBeGreaterThan(body.y + body.h);
    }
  });
});

describe('Mio 恐龍形態（奶龍）', () => {
  const transform = (s: GameState) => {
    const m = s.fighters[1];
    m.meter = METER_MAX;
    tap(s, 0, SP | H);
    while (m.form !== 'dino' || m.action === 'attack') step(s, [0, 0]); // 變身後還有怒吼動作，等它結束
    run(s, 2);
  };

  it('變身持續 20 秒', () => {
    const s = ready('sawa', 'mio', 400, 700);
    transform(s);
    const m = s.fighters[1];
    expect(m.formTimer).toBeGreaterThan(20 * 60 - 70); // 怒吼動作約 1 秒也算在變身時間裡
    run(s, m.formTimer + 5);
    expect(m.form).toBe('normal');
  });

  it('恐龍形態比較耐打（受到的傷害較少）', () => {
    const hitMio = (dino: boolean) => {
      const s = ready('sawa', 'mio', 600, 680);
      if (dino) { transform(s); s.fighters[0].x = 600 * FP; s.fighters[1].x = 680 * FP; }
      const hp0 = s.fighters[1].hp;
      tap(s, H);
      run(s, 30);
      return hp0 - s.fighters[1].hp;
    };
    const normal = hitMio(false);
    const dino = hitMio(true);
    expect(normal).toBeGreaterThan(0);
    expect(dino).toBeLessThan(normal);
  });

  it('龍之吐息扣 3 格鬥氣、不夠就放不出來，可以連打 4 下', () => {
    const s = ready('sawa', 'mio', 500, 700);
    transform(s);
    const m = s.fighters[1];
    m.drive = 2 * DRIVE_BAR;
    tap(s, 0, SP);
    expect(m.moveId).not.toBe('dBreath');
    run(s, 10);
    m.drive = DRIVE_MAX;
    tap(s, 0, SP);
    expect(m.moveId).toBe('dBreath');
    expect(m.drive).toBeLessThanOrEqual(DRIVE_MAX - 3 * DRIVE_BAR + 200);
    s.fighters[0].x = m.x - 150 * FP;
    run(s, 70);
    expect(s.fighters[0].comboHits === 0 ? m.hitsDone : m.hitsDone).toBe(4);
  });
});

describe('測試選項', () => {
  it('能量一直是滿的：放完必殺技馬上又是滿的', () => {
    const s = createGame('sawa', 'mio', { infiniteMeter: true });
    while (s.phase !== 'fight') step(s, [0, 0]);
    step(s, [0, 0]);
    expect(s.fighters[0].meter).toBe(METER_MAX);
    step(s, [SP | H, 0]);
    run(s, 2);
    expect(s.fighters[0].moveId).toBe('super');
    expect(s.fighters[0].meter).toBe(METER_MAX);
  });
});

describe('指令技', () => {
  it('Sawa：↓↘→＋輕 = 舞步旋踢、↓↘→＋中／重 = 愛心波動、→↓↘ = 上勾拳', () => {
    const cases: [number[], number, string][] = [[[2, 3, 6], L, 'rush'], [[2, 3, 6], M, 'sp'], [[2, 3, 6], H, 'sp'], [[6, 2, 3], H, 'dp'], [[6, 2, 3], M | H, 'dpOD'], [[2, 3, 6], L | M, 'rushOD'], [[2, 3, 6], M | H, 'spOD']];
    for (const [dirs, btn, id] of cases) {
      const s = ready('sawa', 'mio', 300, 900);
      motion(s, dirs, btn);
      expect(s.fighters[0].moveId, id).toBe(id);
      expect(s.fighters[0].assisted, id).toBe(false);
    }
  });

  it('搓招打中是全傷害；特殊鍵簡易操作是 8 成', () => {
    const a = ready('sawa', 'mio', 300, 900);
    motion(a, [2, 3, 6], M);
    run(a, 120);
    expect(a.fighters[1].hp).toBe(1000 - 60);
  });

  it('Mio：↓↘→＋輕 = 貓咪突擊、↓↘→＋中／重 = 鞭擊、↓↙← 不再出貓咪', () => {
    const cases: [number[], number, string][] = [[[2, 3, 6], L, 'cat'], [[2, 3, 6], M, 'sp'], [[2, 3, 6], H, 'sp'], [[2, 3, 6], L | H, 'catOD'], [[2, 3, 6], M | H, 'spOD']];
    for (const [dirs, btn, id] of cases) {
      const s = ready('mio', 'sawa', 300, 900);
      motion(s, dirs, btn);
      expect(s.fighters[0].moveId, id).toBe(id);
    }
    const t = ready('mio', 'sawa', 300, 900);
    motion(t, [2, 1, 4], M);
    expect(t.fighters[0].moveId).not.toBe('cat');
    const u = ready('mio', 'sawa', 300, 900);
    tap(u, SP);
    expect(u.fighters[0].moveId).toBe('sp'); // 特殊鍵 = 鞭擊
  });

  it('Sawa 的 ↓↙← 不再是旋踢', () => {
    const s = ready('sawa', 'mio', 300, 900);
    motion(s, [2, 1, 4], M);
    expect(s.fighters[0].moveId).not.toBe('rush');
  });

  it('特殊鍵 + 方向：下 = 對空技、前 = 突進技', () => {
    for (const [ch, fwd] of [['sawa', 'rush'], ['mio', 'cat']] as const) {
      const s = ready(ch, 'sawa', 300, 900);
      step(s, [DOWN | SP, 0]);
      expect(s.fighters[0].moveId, ch).toBe('dp');
      const t = ready(ch, 'sawa', 300, 900);
      step(t, [RIGHT | SP, 0]);
      expect(t.fighters[0].moveId, ch).toBe(fwd);
    }
  });

  it('輕腳打中可以取消成指令技', () => {
    const s = ready('sawa', 'mio', 600, 690);
    step(s, [DOWN | L, 0]);
    let k = 0;
    while ((s.fighters[0].hitsDone === 0 || s.hitstop > 0) && k++ < 30) step(s, [DOWN, 0]);
    motion(s, [3, 6], M); // ↓ 已經按著：再 ↘→ + 中
    expect(s.fighters[0].moveId).toBe('sp');
  });
});

describe('打康／確反康', () => {
  it('對手出招中被打中 = 打康：傷害 1.2 倍', () => {
    const s = ready('sawa', 'mio', 600, 690);
    step(s, [0, H]); // Mio 站重腳（發生比較慢）
    step(s, [L, 0]); // Sawa 輕拳先打到
    run(s, 10);
    expect(s.fighters[1].hp).toBe(1000 - 30);
    expect(s.sparks.some((sp) => sp.kind === 'counter') || s.fighters[1].action === 'hitstun').toBe(true);
  });

  it('對手收招中被打中 = 確反康：傷害 1.2 倍、對手鬥氣扣半格', () => {
    const s = ready('sawa', 'mio', 600, 690);
    step(s, [0, Btn.TAUNT]); // 挑釁整段都是收招
    run(s, 3);
    const drive = s.fighters[1].drive;
    step(s, [L, 0]);
    run(s, 6);
    expect(s.fighters[1].hp).toBe(1000 - 30);
    expect(s.fighters[1].drive).toBeLessThan(drive - DRIVE_BAR / 2 + 200);
  });
});

describe('鬥氣衝刺', () => {
  it('普通技打中後按鬥氣 = 衝刺取消（扣 3 格），衝刺中可以出招', () => {
    const s = ready('sawa', 'mio', 500, 590);
    step(s, [DOWN | L, 0]);
    let k = 0;
    while ((s.fighters[0].hitsDone === 0 || s.hitstop > 0) && k++ < 30) step(s, [DOWN, 0]);
    step(s, [DRIVE, 0]);
    expect(s.fighters[0].action).toBe('driveRush');
    expect(s.fighters[0].drive).toBeLessThan(DRIVE_MAX - 3 * DRIVE_BAR + 1000);
    const x0 = s.fighters[0].x;
    run(s, 8);
    expect(s.fighters[0].x).toBeGreaterThan(x0 + 50 * FP);
    step(s, [H, 0]);
    expect(s.fighters[0].moveId).toBe('sHP');
    expect(s.fighters[0].rushBonus).toBe(true);
  });

  it('檔架中連按兩下前 = 衝刺（扣 1 格）', () => {
    const s = ready('sawa', 'mio', 300, 900);
    step(s, [DRIVE, 0]);
    run(s, 3, DRIVE);
    expect(s.fighters[0].action).toBe('parry');
    step(s, [DRIVE | RIGHT, 0]);
    step(s, [DRIVE, 0]);
    step(s, [DRIVE | RIGHT, 0]);
    expect(s.fighters[0].action).toBe('driveRush');
  });
});

describe('鬥氣衝擊', () => {
  it('前 + 鬥氣 = 鬥氣衝擊；有霸體，可以硬吃對手的輕拳', () => {
    const s = ready('sawa', 'mio', 600, 680);
    step(s, [RIGHT | DRIVE, 0]);
    expect(s.fighters[0].moveId).toBe('impact');
    run(s, 4);
    step(s, [0, L]);
    run(s, 8);
    expect(s.fighters[0].moveId).toBe('impact');
    expect(s.fighters[0].armorUsed).toBe(1);
    run(s, 25);
    expect(s.fighters[1].hp).toBeLessThan(1000 - 50);
  });

  it('對手在牆邊被打中 = 撞牆（可以追打）', () => {
    const s = ready('sawa', 'mio', 1000, 1090);
    step(s, [RIGHT | DRIVE, 0]);
    run(s, 30);
    expect(s.fighters[1].action).toBe('crumple');
    expect(s.fighters[1].wallSplat).toBe(true);
  });

  it('燃盡的對手在牆邊防禦 = 暈眩', () => {
    const s = ready('sawa', 'mio', 1110, 1200);
    s.fighters[1].drive = 0;
    s.fighters[1].burnout = true;
    step(s, [RIGHT | DRIVE, RIGHT]);
    run(s, 30, 0, RIGHT);
    expect(s.fighters[1].action).toBe('crumple');
  });
});

describe('上勾拳打中的慢動作', () => {
  it('Sawa 上勾拳打中：大停頓後進入慢動作（1/3 速度）', () => {
    const s = ready('sawa', 'mio', 600, 690);
    motion(s, [6, 2, 3], H);
    expect(s.fighters[0].moveId).toBe('dp');
    let maxSlow = 0;
    for (let k = 0; k < 40; k++) { step(s, [0, 0]); maxSlow = Math.max(maxSlow, s.slowmo ?? 0); }
    expect(s.fighters[1].hp).toBeLessThan(1000);
    expect(maxSlow).toBeGreaterThan(20);
    expect(maxSlow).toBeLessThanOrEqual(30); // 約 0.5 秒
  });
});

describe('舞步旋踢', () => {
  it('轉三圈、三段傷害', () => {
    const s = ready('sawa', 'mio', 500, 600);
    motion(s, [2, 3, 6], L);
    expect(s.fighters[0].moveId).toBe('rush');
    let hits = 0, last = 1000;
    for (let k = 0; k < 90; k++) {
      step(s, [0, 0]);
      if (s.fighters[1].hp < last) { hits++; last = s.fighters[1].hp; }
    }
    expect(hits).toBe(3);
  });
});

describe('Mio 貓咪突擊', () => {
  it('貓咪撲中：黏在臉上抓三下，抓完消失', () => {
    const s = ready('mio', 'sawa', 400, 650);
    motion(s, [2, 3, 6], L);
    expect(s.fighters[0].moveId).toBe('cat');
    let hits = 0, last = s.fighters[1].hp, latched = false;
    for (let k = 0; k < 120; k++) {
      step(s, [0, 0]);
      if (s.fighters[1].hp < last) { hits++; last = s.fighters[1].hp; }
      if (s.projectiles.some((p) => p.latch)) latched = true;
    }
    expect(latched).toBe(true);
    expect(hits).toBe(3);
    expect(s.projectiles.length).toBe(0);
  });

  it('貓咪先出現在 Mio 腳邊等著，Mio 指向對手時才飛出去', () => {
    const s = ready('mio', 'sawa', 400, 900);
    motion(s, [2, 3, 6], L);
    let k = 0;
    while (!s.projectiles.length && k++ < 20) step(s, [0, 0]);
    const p = s.projectiles[0];
    expect(p.wait).toBeGreaterThan(0);
    const x0 = p.x;
    expect(p.y).toBeLessThan(40 * FP); // 在腳邊
    run(s, 3);
    expect(s.projectiles[0].x).toBe(x0); // 等待中不動
    run(s, 15);
    expect(s.projectiles[0].x).toBeGreaterThan(x0); // 飛出去了
    expect(s.projectiles[0].y).toBeGreaterThan(80 * FP); // 往臉的高度飛
  });

  it('Mio 召喚時被打斷：貓咪消失', () => {
    const s = ready('mio', 'sawa', 400, 490);
    motion(s, [2, 3, 6], L);
    let k = 0;
    while (!s.projectiles.length && k++ < 20) step(s, [0, 0]);
    expect(s.projectiles.length).toBe(1);
    step(s, [0, L]); // Sawa 輕拳打斷
    run(s, 20);
    expect(s.fighters[0].action).not.toBe('attack');
    expect(s.projectiles.length).toBe(0);
  });

  it('被防住：不會黏上去，直接消失', () => {
    const s = ready('mio', 'sawa', 400, 650);
    motion(s, [2, 3, 6], L);
    let hits = 0;
    const hp = s.fighters[1].hp;
    for (let k = 0; k < 120; k++) { step(s, [0, RIGHT]); if (s.projectiles.some((p) => p.latch)) hits++; }
    expect(hits).toBe(0);
    expect(s.fighters[1].hp).toBe(hp);
    expect(s.projectiles.length).toBe(0);
  });

  it('沒撲到（太遠）：飛一段後消失', () => {
    const s = ready('mio', 'sawa', 100, 1200);
    motion(s, [2, 3, 6], L);
    run(s, 20);
    expect(s.projectiles.length).toBe(1);
    run(s, 60);
    expect(s.projectiles.length).toBe(0);
    expect(s.fighters[1].hp).toBe(900);
  });
});

describe('現代操作（輕中重）', () => {
  it('站／蹲對應的招', () => {
    const want: [number, string][] = [[L, 'sLP'], [M, 'sLK'], [H, 'sHP'], [DOWN | L, 'cLK'], [DOWN | M, 'cHP'], [DOWN | H, 'cHK']];
    for (const [btn, id] of want) {
      const s = ready('sawa', 'mio', 300, 900);
      step(s, [btn, 0]);
      expect(s.fighters[0].moveId, id).toBe(id);
    }
  });

  it('連段：輕 → 中 → 重', () => {
    const s = ready('sawa', 'mio', 600, 680);
    step(s, [L, 0]);
    let k = 0;
    while ((s.fighters[0].hitsDone === 0 || s.hitstop > 0) && k++ < 30) step(s, [0, 0]);
    step(s, [M, 0]);
    expect(s.fighters[0].moveId).toBe('sLK');
    k = 0;
    while ((s.fighters[0].hitsDone === 0 || s.hitstop > 0) && k++ < 30) step(s, [0, 0]);
    step(s, [H, 0]);
    expect(s.fighters[0].moveId).toBe('sHP');
  });

  it('奶龍：輕 = 肚子撞、中 = 雙拳重擊、重 = 尾巴橫掃，沒有奶龍拳', () => {
    const want: [number, string][] = [[L, 'dLK'], [M, 'dHP'], [H, 'dHK']];
    for (const [btn, id] of want) {
      const s = ready('mio', 'sawa', 300, 900);
      s.fighters[0].form = 'dino';
      s.fighters[0].formTimer = 999;
      step(s, [btn, 0]);
      expect(s.fighters[0].moveId, id).toBe(id);
    }
    expect(getChar('mio').moves.dLP).toBeUndefined();
  });

  it('輕 + 中 = 投技', () => {
    const s = ready('sawa', 'mio', 600, 680);
    step(s, [L | M, 0]);
    expect(s.fighters[0].moveId).toBe('throwWhiff');
  });
});
