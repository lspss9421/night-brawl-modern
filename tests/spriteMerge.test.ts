import { describe, expect, it } from 'vitest';
import mioData from '../public/assets/characters/mio/data.json';
import sawaData from '../public/assets/characters/sawa/data.json';
import { getChar, registerCharacter } from '../src/core/characters';
import { createGame, step } from '../src/core/game';
import { Btn } from '../src/core/input';
import { applySpriteData } from '../src/core/spriteMerge';
import type { CharacterSpriteData } from '../src/shared/spriteFormat';
import { FP } from '../src/core/types';

const frame = (duration: number, hit: { x: number; y: number; w: number; h: number }[] = [], hurt = [{ x: -20, y: 0, w: 40, h: 100 }]) => ({
  sheet: { x: 0, y: 0, w: 10, h: 10 }, anchor: { x: 5, y: 10 }, duration, hurt, hit, push: { x: -12, y: 0, w: 24, h: 80 },
});

describe('applySpriteData：素材資料套進遊戲數值', () => {
  const data: CharacterSpriteData = {
    version: 1, characterId: 'sawa', scale: 2, sheet: { image: 'sheet.png', width: 10, height: 10 },
    animations: {
      idle: { loop: true, frames: [frame(6)] },
      sLP: { loop: false, frames: [frame(2), frame(3, [{ x: 10, y: 60, w: 30, h: 10 }]), frame(2)] },
      sp_projectile: { loop: true, frames: [frame(5, [{ x: -10, y: -10, w: 20, h: 20 }], [])] },
    },
    moves: { sLP: { damage: 33, guard: 'low' } },
  };
  const def = applySpriteData(getChar('sawa'), data);

  it('招式的發生／持續／收招與攻擊範圍來自動畫（乘上放大倍數）', () => {
    expect(def.moves.sLP).toMatchObject({ startup: 2, active: 3, recovery: 2 });
    expect(def.moves.sLP.hitbox).toEqual({ x: 20, y: 120, w: 60, h: 20 });
  });

  it('編輯器裡改的招式數值會覆蓋預設值', () => {
    expect(def.moves.sLP.damage).toBe(33);
    expect(def.moves.sLP.guard).toBe('low');
  });

  it('站立受擊範圍、推擠寬度、飛行道具判定來自素材', () => {
    expect(def.forms.normal.hurtStand).toEqual({ x: -40, y: 0, w: 80, h: 200 });
    expect(def.forms.normal.pushWidth).toBe(48);
    expect(def.moves.sp.projectile!.box).toEqual({ x: -20, y: -20, w: 40, h: 40 });
  });

  it('沒有動畫的招式維持原本數值，原始定義不被修改', () => {
    expect(def.moves.cHK).toEqual(getChar('sawa').moves.cHK);
    expect(getChar('sawa').moves.sLP.damage).toBe(25);
  });
});

describe('實際的 Sawa 素材', () => {
  const def = applySpriteData(getChar('sawa'), sawaData as CharacterSpriteData);

  it('攻擊招的時間和原本程式設定一致', () => {
    expect(def.moves.sLP).toMatchObject({ startup: 3, active: 2, recovery: 6 });
    expect(def.moves.sHP).toMatchObject({ startup: 7, active: 3, recovery: 15 });
    expect(def.moves.sLK).toMatchObject({ startup: 4, active: 3, recovery: 8 });
    expect(def.moves.sHK).toMatchObject({ startup: 9, active: 3, recovery: 16 });
  });

  it('角色高度合理（約 180～230 遊戲像素）', () => {
    const h = def.forms.normal.hurtStand.h;
    expect(h).toBeGreaterThan(180);
    expect(h).toBeLessThan(230);
  });

  it('套上素材後可以正常對打，而且結果可重現', () => {
    registerCharacter(def);
    const play = () => {
      const s = createGame('sawa', 'mio');
      while (s.phase !== 'fight') step(s, [0, 0]);
      s.fighters[0].x = 600 * FP;
      s.fighters[1].x = 680 * FP;
      step(s, [Btn.L, 0]);
      for (let k = 0; k < 30; k++) step(s, [0, 0]);
      let x = 7;
      for (let k = 0; k < 2000; k++) { x = (x * 1103515245 + 12345) & 0x7fffffff; step(s, [x & 0x3ff, (x >> 10) & 0x3ff]); }
      return s;
    };
    const a = play();
    expect(JSON.stringify(a)).toEqual(JSON.stringify(play()));
  });

  it('站輕拳仍然打得到近身的對手', () => {
    registerCharacter(def);
    const s = createGame('sawa', 'mio');
    while (s.phase !== 'fight') step(s, [0, 0]);
    s.fighters[0].x = 600 * FP;
    s.fighters[1].x = 680 * FP;
    step(s, [0, 0]);
    step(s, [Btn.L, 0]);
    for (let k = 0; k < 20; k++) step(s, [0, 0]);
    expect(s.fighters[1].hp).toBe(1000 - 25);
  });
});

describe('實際的 Mio 素材', () => {
  const def = applySpriteData(getChar('mio'), mioData as CharacterSpriteData);

  it('攻擊招的時間和原本程式設定一致', () => {
    expect(def.moves.sLP).toMatchObject({ startup: 4, active: 2, recovery: 7 });
    expect(def.moves.sHP).toMatchObject({ startup: 8, active: 3, recovery: 16 });
    expect(def.moves.sLK).toMatchObject({ startup: 5, active: 3, recovery: 9 });
    expect(def.moves.sHK).toMatchObject({ startup: 10, active: 3, recovery: 18 });
    expect(def.moves.sp).toMatchObject({ startup: 14, active: 4, recovery: 24 });
  });

  it('鞭擊打得比站重腳遠很多（2 倍以上），而且近身也打得到', () => {
    const whip = def.moves.sp.hitbox!;
    const kick = def.moves.sHK.hitbox!;
    expect(whip.x + whip.w).toBeGreaterThan(2 * (kick.x + kick.w));
    expect(whip.x).toBeLessThan(60);
  });

  it('角色高度和 Sawa 相近', () => {
    const h = def.forms.normal.hurtStand.h;
    expect(h).toBeGreaterThan(170);
    expect(h).toBeLessThan(240);
  });
});

describe('第二批動畫：蹲攻擊、空中攻擊時間和程式設定一致，而且都有攻擊範圍', () => {
  for (const [id, data] of [['sawa', sawaData], ['mio', mioData]] as const) {
    it(id, () => {
      const base = getChar(id);
      const def = applySpriteData(base, data as CharacterSpriteData);
      for (const m of ['cLP', 'cHP', 'cLK', 'cHK', 'jLP', 'jHP', 'jLK', 'jHK']) {
        const a = def.moves[m];
        const b = base.moves[m];
        expect([a.startup, a.active, a.recovery], `${id}.${m}`).toEqual([b.startup, b.active, b.recovery]);
        expect(a.hitbox!.w, `${id}.${m} 攻擊範圍寬度`).toBeGreaterThanOrEqual(40);
      }
      const tauntAnim = (data as CharacterSpriteData).animations.taunt.frames.reduce((n, f) => n + f.duration, 0);
      const t = base.moves.taunt;
      expect(tauntAnim, `${id} 挑釁動畫不會被截掉`).toBeLessThanOrEqual(t.startup + t.active + t.recovery);
      for (const k of ['intro', 'win', 'lose', 'taunt', 'throwing', 'dashF', 'dashB']) {
        expect((data as CharacterSpriteData).animations[k]?.frames.length, `${id}.${k}`).toBeGreaterThan(0);
      }
    });
  }
});

describe('鬥氣反擊、檔架等動畫', () => {
  for (const [id, data] of [['sawa', sawaData], ['mio', mioData]] as const) {
    it(`${id}：蹲重拳保留程式設定的攻擊範圍`, () => {
      const def = applySpriteData(getChar(id), data as CharacterSpriteData);
      expect(def.moves.cHP.hitbox).toEqual(getChar(id).moves.cHP.hitbox);
    });

    it(`${id}：有動畫，鬥氣反擊時間不變、攻擊範圍保留程式設定`, () => {
      const base = getChar(id);
      const def = applySpriteData(base, data as CharacterSpriteData);
      for (const k of ['reversal', 'parry', 'parryEnd', 'blockAir', 'hitCrouch', 'thrown']) {
        expect((data as CharacterSpriteData).animations[k]?.frames.length, `${id}.${k}`).toBeGreaterThan(0);
      }
      const r = def.moves.reversal;
      expect([r.startup, r.active, r.recovery]).toEqual([base.moves.reversal.startup, base.moves.reversal.active, base.moves.reversal.recovery]);
      expect(r.hitbox).toEqual(base.moves.reversal.hitbox);
    });
  }
});
