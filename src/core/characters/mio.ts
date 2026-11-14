import type { CharacterDef } from '../types';
import { commonMoves, move, toRecord } from './common';

/** 1 格鬥氣（和 game.ts 的 DRIVE_BAR 相同；角色檔不能反過來 import game.ts） */
const DRIVE_BAR_UNITS = 10000;
/** 特殊技扣 2 格鬥氣、OD 強化版扣 3 格 */
const SP_COST = 2 * DRIVE_BAR_UNITS;
const OD_COST = 3 * DRIVE_BAR_UNITS;

// Mio：一般型，數值都是標準值。特殊技鞭擊距離長；必殺技變身恐龍 10 秒。
// 數值見 docs/characters/mio/mio.md
const SPECIALS = ['sp', 'spOD', 'dp', 'dpOD', 'cat', 'catOD', 'super'];
// 現代操作的連段：輕 → 中 → 重 → 特殊技／必殺技
const L_CANCEL = ['sLK', 'sHP', 'cHP', 'cHK', ...SPECIALS];
const M_CANCEL = ['sHP', 'cHK', ...SPECIALS];
const H_CANCEL = SPECIALS;

export const mio: CharacterDef = {
  id: 'mio',
  name: 'Mio',
  color: '#ffd54f',
  accent: '#7e57c2',
  maxHp: 1000,
  dash: { frames: 14, speed: 900 },
  backdash: { frames: 18, speed: 700, invuln: 6 },
  throwDamage: 120,
  forms: {
    normal: {
      walkFwd: 400,
      walkBack: 320,
      jumpVel: 2000,
      gravity: 100,
      jumpH: 560, // 跳躍水平距離（加長）
      canDash: true,
      canCrouch: true,
      damagePct: 100,
      hurtStand: { x: -30, y: 0, w: 60, h: 200 },
      hurtCrouch: { x: -34, y: 0, w: 68, h: 120 },
      hurtAir: { x: -28, y: 20, w: 56, h: 160 },
      pushWidth: 50,
      // 現代操作：輕／中／重 → 站（輕拳／輕腳／重拳）、蹲（輕腳下段／重拳對空／重腳掃腿）、空中（輕拳／輕腳／重腳）
      moves: {
        sL: 'sLP', sM: 'sLK', sH: 'sHP',
        cL: 'cLK', cM: 'cHP', cH: 'cHK',
        jL: 'jLP', jM: 'jLK', jH: 'jHK', sp: 'sp',
      },
      cmds: [
        { motion: '623', move: 'dp', od: 'dpOD', sp: 'd' },
        { motion: '236', move: 'sp', od: 'spOD', sp: 'n' },
        { motion: '214', move: 'cat', od: 'catOD', sp: 'f' },
      ],
    },
    dino: {
      walkFwd: 280,
      walkBack: 224,
      jumpVel: 1600,
      gravity: 100,
      jumpH: 380,
      canDash: false,
      canCrouch: false,
      damagePct: 150, // 攻擊力 1.5 倍
      defensePct: 75, // 受到的傷害只有 75%
      hurtStand: { x: -45, y: 0, w: 90, h: 185 },
      hurtCrouch: { x: -45, y: 0, w: 90, h: 185 },
      hurtAir: { x: -42, y: 20, w: 84, h: 150 },
      pushWidth: 80,
      // 奶龍：輕 = 肚子撞、中 = 雙拳重擊、重 = 尾巴橫掃（現代操作版拿掉奶龍拳）
      moves: {
        sL: 'dLK', sM: 'dHP', sH: 'dHK',
        sp: 'dBreath',
      },
    },
  },
  super: 'super',
  transform: { duration: 1200, noMeterGain: true }, // 變身 20 秒
  moves: {
    ...commonMoves(),
    ...toRecord([
      move({ id: 'sLP', name: '站輕拳', startup: 4, active: 2, recovery: 7, damage: 30, hitstun: 13, blockstun: 9, hitstop: 6, hitbox: { x: 20, y: 140, w: 70, h: 30 }, cancel: L_CANCEL }),
      move({ id: 'sHP', name: '站重拳', startup: 8, active: 3, recovery: 16, damage: 80, hitstun: 20, blockstun: 15, hitstop: 9, pushback: 700, hitbox: { x: 20, y: 120, w: 95, h: 40 }, cancel: H_CANCEL }),
      move({ id: 'sLK', name: '站輕腳', startup: 5, active: 3, recovery: 9, damage: 35, hitstun: 13, blockstun: 9, hitstop: 6, hitbox: { x: 15, y: 60, w: 85, h: 30 }, cancel: M_CANCEL }),
      move({ id: 'sHK', name: '站重腳', startup: 10, active: 3, recovery: 18, damage: 90, hitstun: 21, blockstun: 15, hitstop: 10, pushback: 800, hitbox: { x: 20, y: 90, w: 115, h: 40 }, cancel: H_CANCEL }),
      move({ id: 'cLP', name: '蹲輕拳', stance: 'crouch', startup: 4, active: 2, recovery: 7, damage: 25, hitstun: 12, blockstun: 8, hitstop: 6, hitbox: { x: 20, y: 80, w: 70, h: 30 }, cancel: L_CANCEL }),
      move({ id: 'cHP', name: '蹲重拳（對空）', stance: 'crouch', startup: 7, active: 4, recovery: 18, damage: 75, hitstun: 20, blockstun: 14, hitstop: 9, knockdown: true, launch: { vx: 250, vy: 1600 }, // 從蹲姿身體前緣上方往前打（打對手臉的高度，也能對空）
        codeHitbox: true, hitbox: { x: 45, y: 150, w: 80, h: 115 }, cancel: M_CANCEL }),
      move({ id: 'cLK', name: '蹲輕腳', stance: 'crouch', guard: 'low', startup: 5, active: 2, recovery: 9, damage: 25, hitstun: 12, blockstun: 8, hitstop: 6, hitbox: { x: 15, y: 0, w: 90, h: 30 }, cancel: L_CANCEL }),
      move({ id: 'cHK', name: '蹲重腳（掃腿）', stance: 'crouch', guard: 'low', startup: 9, active: 3, recovery: 22, damage: 80, hitstun: 20, blockstun: 14, hitstop: 9, knockdown: true, hitbox: { x: 15, y: 0, w: 125, h: 30 } }),
      move({ id: 'jLP', name: '空中輕拳', stance: 'air', guard: 'high', startup: 5, active: 5, recovery: 5, damage: 40, hitstun: 16, blockstun: 11, hitstop: 6, hitbox: { x: 15, y: 70, w: 65, h: 35 } }),
      move({ id: 'jHP', name: '空中重拳', stance: 'air', guard: 'high', startup: 10, active: 5, recovery: 16, damage: 80, hitstun: 19, blockstun: 13, hitstop: 8, hitbox: { x: 10, y: 20, w: 85, h: 60 } }),
      move({ id: 'jLK', name: '空中輕腳', stance: 'air', guard: 'high', startup: 5, active: 6, recovery: 5, damage: 40, hitstun: 16, blockstun: 11, hitstop: 6, hitbox: { x: 10, y: 40, w: 60, h: 40 } }),
      move({ id: 'jHK', name: '空中重腳', stance: 'air', guard: 'high', startup: 10, active: 5, recovery: 16, damage: 85, hitstun: 19, blockstun: 13, hitstop: 8, hitbox: { x: 5, y: 10, w: 105, h: 45 } }),
      move({
        id: 'sp', name: '鞭擊', kind: 'special', driveCost: SP_COST, startup: 14, active: 4, recovery: 24,
        // ↓↘→ + 拳
        damage: 90, hitstun: 22, blockstun: 16, hitstop: 10, pushback: 900,
        // 鞭尖最遠打到 280 像素，約站重腳（135）的 2 倍
        hitbox: { x: 40, y: 115, w: 240, h: 30 },
      }),
      move({
        // OD：兩個拳一起按，扣 3 格鬥氣。打更遠、打中倒地
        id: 'spOD', name: '鞭擊 OD', kind: 'special', od: true, anim: 'sp', startup: 12, active: 5, recovery: 22,
        damage: 120, hitstun: 22, blockstun: 16, hitstop: 11, pushback: 1000, knockdown: true, driveCost: OD_COST,
        codeHitbox: true, hitbox: { x: 40, y: 110, w: 290, h: 40 },
      }),
      move({
        // →↓↘ + 拳：往上甩鞭的對空技
        id: 'dp', name: '昇天鞭', kind: 'special', driveCost: SP_COST, anim: 'cHP', startup: 6, active: 6, recovery: 30,
        damage: 95, hitstun: 20, blockstun: 12, hitstop: 9, pushback: 500, knockdown: true, launch: { vx: 300, vy: 1900 }, invuln: 4,
        hitbox: { x: 10, y: 100, w: 115, h: 190 },
      }),
      move({
        // OD：出招到攻擊結束全程無敵
        id: 'dpOD', name: '昇天鞭 OD', kind: 'special', od: true, anim: 'cHP', startup: 6, active: 8, recovery: 32,
        damage: 70, hitstun: 20, blockstun: 12, hitstop: 8, pushback: 500, knockdown: true, launch: { vx: 300, vy: 2100 }, invuln: 14,
        multiHit: { count: 2, interval: 4 }, driveCost: OD_COST,
        hitbox: { x: 10, y: 100, w: 120, h: 200 },
      }),
      move({
        // ↓↙← + 腳：召喚貓咪 → 用手指向對手 → 貓咪飛撲過去，撲到臉上連抓三下後消失；被防或沒撲到就消失
        id: 'cat', name: '貓咪突擊', kind: 'special', driveCost: SP_COST, startup: 16, active: 1, recovery: 26,
        damage: 25, hitstun: 20, blockstun: 14, hitstop: 6, pushback: 150,
        // 第 7 格貓咪出現在腳邊（舉手召喚），第 16 格 Mio 指向對手時飛撲出去
        projectile: { spawnFrame: 16, speed: 1100, box: { x: -30, y: -25, w: 60, h: 50 }, spawnX: 50, spawnY: 130, life: 36, summon: { frame: 7, x: 75, y: 39 } },
        latch: { hits: 3, interval: 12 },
      }),
      move({
        // OD：貓咪飛得快、飛得遠，每下抓比較痛，最後一下抓倒
        id: 'catOD', name: '貓咪突擊 OD', kind: 'special', od: true, driveCost: OD_COST, anim: 'cat', startup: 14, active: 1, recovery: 24,
        damage: 35, hitstun: 22, blockstun: 16, hitstop: 7, pushback: 150, knockdown: true,
        projectile: { spawnFrame: 14, speed: 1500, box: { x: -30, y: -25, w: 60, h: 50 }, spawnX: 50, spawnY: 130, life: 40, summon: { frame: 6, x: 75, y: 39 } },
        latch: { hits: 3, interval: 12 },
      }),
      move({
        // 戴上帽子 → 邪惡力量爆發（64 格後變身）→ 奶龍朝天怒吼 → 備戰；整段無敵
        id: 'super', name: '變身奶龍', kind: 'transform', startup: 64, active: 0, recovery: 60,
        invuln: 124, superFreeze: 80, meterGain: 0, // 橫幅停留 80 格（約 1.3 秒）
      }),
      // 挑釁：轉身搖尾巴兩輪，動畫比共用的長（130 格）
      move({ id: 'taunt', name: '挑釁', kind: 'taunt', startup: 0, active: 0, recovery: 130 }),
      // 恐龍形態（奶龍）：輕重拳腳各不同，特殊技是龍之吐息
      move({ id: 'dHP', name: '雙拳重擊', startup: 17, active: 5, recovery: 26, damage: 95, hitstun: 22, blockstun: 16, hitstop: 12, pushback: 1000, hitbox: { x: 30, y: 60, w: 100, h: 140 }, cancel: ['dBreath'] }),
      move({ id: 'dLK', name: '肚子撞', startup: 9, active: 4, recovery: 14, damage: 60, hitstun: 18, blockstun: 12, hitstop: 9, pushback: 900, advance: 300, hitbox: { x: 30, y: 30, w: 90, h: 110 }, cancel: ['dHP', 'dHK', 'dBreath'] }),
      move({ id: 'dHK', name: '尾巴橫掃', startup: 18, active: 5, recovery: 28, damage: 85, hitstun: 20, blockstun: 15, hitstop: 10, pushback: 900, knockdown: true,
        // 尾巴從身體前面一路掃到尾端（動畫上只有尾端伸出去，近身的對手也要掃得到）
        codeHitbox: true, hitbox: { x: 30, y: 10, w: 150, h: 42 }, cancel: ['dBreath'] }),
      move({ id: 'dBreath', name: '龍之吐息', kind: 'special', startup: 18, active: 24, recovery: 24, damage: 30, hitstun: 16, blockstun: 12, hitstop: 4, pushback: 300,
        // 從嘴巴往前噴火，連打 4 下；用一次扣 3 格鬥氣
        multiHit: { count: 4, interval: 6 }, driveCost: 3 * DRIVE_BAR_UNITS,
        codeHitbox: true, hitbox: { x: 60, y: 110, w: 250, h: 70 } }),
    ]),
  },
  texts: { intro: '好累喔～不想動', win: 'Ya～', lose: '嗚…我輸了…', taunt: '打我呀！笨蛋～♪', super: '我是奶龍公主～！！' },
};
