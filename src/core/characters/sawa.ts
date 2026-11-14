import type { CharacterDef } from '../types';
import { commonMoves, move, toRecord } from './common';

/** 1 格鬥氣（和 game.ts 的 DRIVE_BAR 相同） */
const DRIVE_BAR_UNITS = 10000;
/** 特殊技扣 2 格鬥氣、OD 強化版扣 3 格 */
const SP_COST = 2 * DRIVE_BAR_UNITS;
const OD_COST = 3 * DRIVE_BAR_UNITS;

// 佐波 Sawa：速度型。出招快、移動快、距離短、血少。數值見 docs/characters/sawa/sawa.md
const SPECIALS = ['sp', 'spOD', 'dp', 'dpOD', 'rush', 'rushOD', 'super'];
// 現代操作的連段：輕 → 中 → 重 → 特殊技／必殺技
const L_CANCEL = ['sLK', 'sHP', 'cHP', 'cHK', ...SPECIALS];
const M_CANCEL = ['sHP', 'cHK', ...SPECIALS];
const H_CANCEL = SPECIALS;

export const sawa: CharacterDef = {
  id: 'sawa',
  name: '佐波 Sawa',
  color: '#f06292',
  accent: '#b71c4a',
  maxHp: 900,
  dash: { frames: 12, speed: 1100 },
  backdash: { frames: 14, speed: 800, invuln: 6 },
  throwDamage: 100,
  forms: {
    normal: {
      walkFwd: 520,
      walkBack: 420,
      jumpVel: 2100,
      gravity: 120,
      jumpH: 650, // 跳躍水平距離（加長）
      canDash: true,
      canCrouch: true,
      damagePct: 100,
      hurtStand: { x: -28, y: 0, w: 56, h: 190 },
      hurtCrouch: { x: -32, y: 0, w: 64, h: 115 },
      hurtAir: { x: -26, y: 20, w: 52, h: 150 },
      pushWidth: 48,
      // 現代操作：輕／中／重 → 站（輕拳／輕腳／重拳）、蹲（輕腳下段／重拳對空／重腳掃腿）、空中（輕拳／輕腳／重腳）
      moves: {
        sL: 'sLP', sM: 'sLK', sH: 'sHP',
        cL: 'cLK', cM: 'cHP', cH: 'cHK',
        jL: 'jLP', jM: 'jLK', jH: 'jHK', sp: 'sp',
      },
      cmds: [
        { motion: '623', move: 'dp', od: 'dpOD', sp: 'd' },
        { motion: '236', move: 'sp', od: 'spOD', sp: 'n' },
        { motion: '214', move: 'rush', od: 'rushOD', sp: 'f' },
      ],
    },
  },
  super: 'super',
  moves: {
    ...commonMoves(),
    ...toRecord([
      move({ id: 'sLP', name: '站輕拳', startup: 3, active: 2, recovery: 6, damage: 25, hitstun: 12, blockstun: 8, hitstop: 6, hitbox: { x: 18, y: 135, w: 60, h: 28 }, cancel: L_CANCEL }),
      move({ id: 'sHP', name: '站重拳', startup: 7, active: 3, recovery: 15, damage: 70, hitstun: 19, blockstun: 14, hitstop: 9, pushback: 700, hitbox: { x: 20, y: 115, w: 80, h: 38 }, cancel: H_CANCEL }),
      move({ id: 'sLK', name: '站輕腳', startup: 4, active: 3, recovery: 8, damage: 30, hitstun: 12, blockstun: 8, hitstop: 6, hitbox: { x: 15, y: 55, w: 72, h: 28 }, cancel: M_CANCEL }),
      move({ id: 'sHK', name: '站重腳', startup: 9, active: 3, recovery: 16, damage: 80, hitstun: 20, blockstun: 14, hitstop: 9, pushback: 800, hitbox: { x: 20, y: 85, w: 100, h: 38 }, cancel: H_CANCEL }),
      move({ id: 'cLP', name: '蹲輕拳', stance: 'crouch', startup: 3, active: 2, recovery: 6, damage: 22, hitstun: 12, blockstun: 8, hitstop: 6, hitbox: { x: 18, y: 75, w: 60, h: 28 }, cancel: L_CANCEL }),
      move({ id: 'cHP', name: '蹲重拳（對空）', stance: 'crouch', startup: 6, active: 4, recovery: 17, damage: 70, hitstun: 19, blockstun: 13, hitstop: 9, knockdown: true, launch: { vx: 250, vy: 1600 }, // 從蹲姿身體前緣上方往前打（打對手臉的高度，也能對空）
        codeHitbox: true, hitbox: { x: 40, y: 150, w: 75, h: 110 }, cancel: M_CANCEL }),
      move({ id: 'cLK', name: '蹲輕腳', stance: 'crouch', guard: 'low', startup: 4, active: 2, recovery: 8, damage: 22, hitstun: 11, blockstun: 8, hitstop: 6, hitbox: { x: 15, y: 0, w: 80, h: 28 }, cancel: L_CANCEL }),
      move({ id: 'cHK', name: '蹲重腳（掃腿）', stance: 'crouch', guard: 'low', startup: 8, active: 3, recovery: 21, damage: 75, hitstun: 20, blockstun: 13, hitstop: 9, knockdown: true, hitbox: { x: 15, y: 0, w: 105, h: 28 } }),
      move({ id: 'jLP', name: '空中輕拳', stance: 'air', guard: 'high', startup: 4, active: 5, recovery: 5, damage: 35, hitstun: 16, blockstun: 11, hitstop: 6, hitbox: { x: 15, y: 70, w: 60, h: 35 } }),
      move({ id: 'jHP', name: '空中重拳', stance: 'air', guard: 'high', startup: 9, active: 5, recovery: 14, damage: 70, hitstun: 19, blockstun: 13, hitstop: 8, hitbox: { x: 10, y: 20, w: 80, h: 60 } }),
      move({ id: 'jLK', name: '空中輕腳', stance: 'air', guard: 'high', startup: 4, active: 6, recovery: 5, damage: 35, hitstun: 16, blockstun: 11, hitstop: 6, hitbox: { x: 10, y: 40, w: 55, h: 40 } }),
      move({ id: 'jHK', name: '空中重腳', stance: 'air', guard: 'high', startup: 9, active: 5, recovery: 14, damage: 75, hitstun: 19, blockstun: 13, hitstop: 8, hitbox: { x: 5, y: 10, w: 100, h: 45 } }),
      move({
        id: 'sp', name: '愛心波動', kind: 'special', driveCost: SP_COST, startup: 13, active: 1, recovery: 26,
        // ↓↘→ + 拳
        damage: 60, hitstun: 18, blockstun: 12, hitstop: 8, pushback: 600,
        projectile: { spawnFrame: 13, speed: 800, box: { x: -24, y: -24, w: 48, h: 48 }, spawnX: 60, spawnY: 125 },
      }),
      move({
        // OD：兩個拳一起按，扣 3 格鬥氣。比較快、飛得快、傷害高
        id: 'spOD', name: '愛心波動 OD', kind: 'special', od: true, anim: 'sp', startup: 11, active: 1, recovery: 24,
        damage: 90, hitstun: 22, blockstun: 14, hitstop: 9, pushback: 700, driveCost: OD_COST,
        projectile: { spawnFrame: 11, speed: 1300, box: { x: -28, y: -28, w: 56, h: 56 }, spawnX: 60, spawnY: 125 },
      }),
      move({
        // →↓↘ + 拳：往上打的對空技（打中把對手打飛）；同一隻手蓄力再往上揮，拳頭旁冒愛心。打中時畫面慢動作
        id: 'dp', name: '星光上勾拳', kind: 'special', driveCost: SP_COST, startup: 7, active: 6, recovery: 38,
        damage: 90, hitstun: 20, blockstun: 12, hitstop: 9, pushback: 500, knockdown: true, launch: { vx: 300, vy: 1900 }, invuln: 4,
        hitbox: { x: 45, y: 90, w: 75, h: 180 }, slowmo: 30,
      }),
      move({
        // OD：出招到攻擊結束全程無敵，可以用來起身反擊
        id: 'dpOD', name: '星光上勾拳 OD', kind: 'special', od: true, anim: 'dp', startup: 7, active: 8, recovery: 36,
        damage: 65, hitstun: 20, blockstun: 12, hitstop: 8, pushback: 500, knockdown: true, launch: { vx: 300, vy: 2100 }, invuln: 13,
        multiHit: { count: 2, interval: 4 }, driveCost: OD_COST,
        hitbox: { x: 45, y: 90, w: 80, h: 190 }, slowmo: 30,
      }),
      move({
        // ↓↙← + 腳：像芭蕾舞一樣踮腳旋轉三圈、腿伸直掃出去，每圈踢一下（三段），被防 -4。
        // 動畫：踮腳準備 →（腿朝對手時踢中：第 16、28、40 格）→ 腿放下，共 61 格
        id: 'rush', name: '舞步旋踢', kind: 'special', driveCost: SP_COST, startup: 15, active: 27, recovery: 19,
        damage: 30, hitstun: 18, blockstun: 14, hitstop: 7, pushback: 250, advance: 350,
        multiHit: { count: 3, interval: 12 },
        hitbox: { x: 15, y: 70, w: 100, h: 50 },
      }),
      move({
        // OD：一樣三圈，傷害高、最後一下踢倒
        id: 'rushOD', name: '舞步旋踢 OD', kind: 'special', od: true, anim: 'rush', startup: 15, active: 27, recovery: 19,
        damage: 40, hitstun: 20, blockstun: 14, hitstop: 8, pushback: 250, advance: 450, knockdown: true,
        multiHit: { count: 3, interval: 12 }, driveCost: OD_COST,
        hitbox: { x: 15, y: 70, w: 105, h: 50 },
      }),
      move({
        // 聚光燈打在 Sawa 身上 → 拿起麥克風開唱（發生 30 格是燈光亮起的時間）
        id: 'super', name: '偶像演唱會', kind: 'super', startup: 30, active: 60, recovery: 30,
        damage: 55, hitstun: 30, blockstun: 14, hitstop: 4, pushback: 0,
        fullScreen: true, multiHit: { count: 5, interval: 12 }, knockdown: true,
        invuln: 90, superFreeze: 80, meterGain: 0, // 橫幅停留 80 格，和 Mio 一樣
      }),
    ]),
  },
  texts: { intro: '來吧！戰鬥吧！', win: 'Ya～', lose: '嗚…我輸了…', taunt: '67～', super: '來聽我唱歌吧！' },
};
