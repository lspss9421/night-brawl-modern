// M1 色塊渲染器（Canvas 2D）。只讀取遊戲狀態，不改變它。
// M3 接入 Sprite Sheet 時會換成正式的角色圖。
import { getChar } from '../core/characters';
import {
  METER_MAX,
  ROUND_FRAMES,
  SCREEN_H,
  SCREEN_W,
  WINS_TO_MATCH,
  DRIVE_BAR,
  activeHitbox,
  currentMove,
  formStats,
  hurtboxes,
  movePhase,
  projBox,
  toWorld,
} from '../core/game';
import type { Box, FighterState, GameState } from '../core/types';
import type { SpriteFrame } from '../shared/spriteFormat';
import { pickAnim } from './animSelect';
import { frameAt, sprites, type SpriteSet } from './sprites';
import { FP } from '../core/types';

const GROUND_Y = 640;
const FONT = '"PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif';

const ACTION_LABEL: Record<string, string> = {
  idle: '', walkF: '前進', walkB: '後退', crouch: '蹲', jumpSquat: '起跳', air: '', land: '著地',
  dashF: '前衝', dashB: '後撤', blockstun: '防禦！', hitstun: '受擊', airHit: '擊飛', knockdown: '倒地',
  getup: '起身', throwing: '投技', thrown: '被投', taunt: '挑釁', win: '勝利', lose: '戰敗',
  parry: '檔架', parryEnd: '檔架收招', parried: '破綻',
};

export interface RenderOptions {
  showBoxes: boolean;
  p2Label: string;
}

// 背景圖：對戰＝西門町、主選單＝霓虹長街、選角＝霓虹街角（讀不到圖時改畫漸層）
const loadImage = (file: string) => { const im = new Image(); im.src = `${import.meta.env.BASE_URL}assets/stages/${file}`; return im; };
const stageImage = loadImage('ximending.webp');
const menuImage = loadImage('menu.jpg');
const selectImage = loadImage('select.jpg');

// 介面框美術（血量／鬥氣／能量）：圖和中間空格的位置（圖片座標）
interface HudPart { name: string; w: number; h: number; slots: Box[] }
interface HudArt { hp: HudPart; drive: HudPart; meter: HudPart }
let hudArt: HudArt | null = null;
const hudImages: Record<string, HTMLImageElement> = {};
// 能量滿時的火焰動畫（影片轉成的 18 格、每秒 15 格；黑底，用「相加」畫上去黑色就看不見）
const meterFire = new Image();
meterFire.src = `${import.meta.env.BASE_URL}assets/ui/meter_fire.jpg`;
const FIRE = { frames: 18, w: 344, h: 97, slotX: 26.9, slotY: 57.5, slotW: 289, slotH: 11.5, every: 4 };

void fetch(`${import.meta.env.BASE_URL}assets/ui/hud.json`)
  .then((r) => (r.ok ? r.json() : null))
  .then((j: HudArt | null) => {
    if (!j) return;
    for (const part of [j.hp, j.drive, j.meter]) {
      const im = new Image();
      im.src = `${import.meta.env.BASE_URL}assets/ui/${part.name}.png`;
      hudImages[part.name] = im;
    }
    hudArt = j;
  })
  .catch(() => {});
const hudReady = (): HudArt | null =>
  hudArt && Object.values(hudImages).every((im) => im.complete && im.naturalWidth > 0) ? hudArt : null;

// 對話框美術：每個角色開場（含勝負台詞）和挑釁各一款，文字樣式也不同
interface BubblePart { name: string; w: number; h: number; text: Box; tail: { x: number; y: number } }
interface BubbleStyle { intro: string; taunt: string; font: string; draw: (g: CanvasRenderingContext2D, text: string, x: number, y: number) => void }
const BUBBLE_STYLE: Record<string, BubbleStyle> = {
  sawa: {
    intro: 'bubble_sawa_2',
    taunt: 'bubble_sawa_1',
    font: `26px Huninn, ${FONT}`,
    draw(g, text, x, y) {
      // 可愛：粉紅漸層字 + 白色外框
      g.lineJoin = 'round';
      g.strokeStyle = '#fff';
      g.lineWidth = 7;
      g.strokeText(text, x, y);
      const gr = g.createLinearGradient(0, y - 13, 0, y + 13);
      gr.addColorStop(0, '#ff5fa2');
      gr.addColorStop(1, '#e0115f');
      g.fillStyle = gr;
      g.fillText(text, x, y);
    },
  },
  mio: {
    intro: 'bubble_mio_2',
    taunt: 'bubble_mio_1',
    font: `24px "LXGW WenKai TC", ${FONT}`,
    draw(g, text, x, y) {
      // 慵懶：淡紫灰手寫字，稍微歪一邊
      g.save();
      g.translate(x, y);
      g.rotate(-0.04);
      g.fillStyle = '#7b6b98';
      g.fillText(text, 0, 0);
      g.restore();
    },
  },
};
const bubbleParts: Record<string, BubblePart> = {};
const bubbleImages: Record<string, HTMLImageElement> = {};
void fetch(`${import.meta.env.BASE_URL}assets/ui/bubbles.json`)
  .then((r) => (r.ok ? r.json() : null))
  .then((j: Record<string, BubblePart[]> | null) => {
    if (!j) return;
    const used = new Set(Object.values(BUBBLE_STYLE).flatMap((b) => [b.intro, b.taunt]));
    for (const part of Object.values(j).flat()) {
      if (!used.has(part.name)) continue;
      bubbleParts[part.name] = part;
      const im = new Image();
      im.src = `${import.meta.env.BASE_URL}assets/ui/${part.name}.png`;
      bubbleImages[part.name] = im;
    }
  })
  .catch(() => {});
// 先把字型載好，畫布才會用到（載不到就用預設字型）
for (const b of Object.values(BUBBLE_STYLE)) void document.fonts?.load(b.font).catch(() => {});

// 必殺技橫幅美術（目前只有 Mio）：圖和放台詞的區域（相對於圖的比例）
interface SuperMeta { image: string; w: number; h: number; text: { x: number; y: number; w: number; h: number } }
const superMeta: Record<string, SuperMeta> = {};
const superImages: Record<string, HTMLImageElement> = {};
void fetch(`${import.meta.env.BASE_URL}assets/ui/super.json`)
  .then((r) => (r.ok ? r.json() : null))
  .then((j: Record<string, SuperMeta> | null) => {
    for (const [id, m] of Object.entries(j ?? {})) {
      superMeta[id] = m;
      const im = new Image();
      im.src = `${import.meta.env.BASE_URL}assets/ui/${m.image}`;
      superImages[id] = im;
    }
  })
  .catch(() => {});

// 選角畫面：角色照片和類型說明
const portraits: Record<string, HTMLImageElement> = {};
for (const id of ['sawa', 'mio']) { const im = new Image(); im.src = `${import.meta.env.BASE_URL}assets/portraits/${id}.jpg`; portraits[id] = im; }
const SELECT_TAG: Record<string, string> = { sawa: '速度型', mio: '沒特別型' };

export class Renderer {
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = SCREEN_W;
    canvas.height = SCREEN_H;
    this.ctx = canvas.getContext('2d')!;
  }

  // ───── 座標 ─────
  private sx(x: number): number { return x / FP; }
  private sy(y: number): number { return GROUND_Y - y / FP; }
  private rect(b: Box): [number, number, number, number] {
    return [this.sx(b.x), this.sy(b.y + b.h), b.w / FP, b.h / FP];
  }

  draw(s: GameState, opt: RenderOptions): void {
    const g = this.ctx;
    // 畫面震動：只移動場景，不移動血條等介面
    g.save();
    if (s.shake) {
      const k = s.shake.mag * Math.min(1, s.shake.timer / 8);
      g.translate((s.frame % 2 ? 1 : -1) * k, (s.frame % 3 === 0 ? 1 : -1) * k * 0.6);
    }
    this.drawStage('battle');
    // Sawa 演唱會的聚光燈畫在角色後面：舞台變暗、燈光照下來，角色本身保持原本的顏色
    for (const f of s.fighters) {
      const m = currentMove(f);
      if (f.charId === 'sawa' && f.action === 'attack' && m?.kind === 'super') this.drawSpotlights(this.sx(f.x), f.frame, m.startup + m.active + m.recovery);
    }
    // 正在出招的角色畫在前面（例如自拍閃光秀手機時不會被貼著的對手擋住）
    const order = [...s.fighters].sort((a, b) => (a.action === 'attack' ? 1 : 0) - (b.action === 'attack' ? 1 : 0));
    for (const f of order) this.drawFighter(s, f, opt.showBoxes);
    for (const f of s.fighters) this.drawSoundWave(f);
    this.drawSuperEffects(s);
    for (const p of s.projectiles) this.drawProjectile(s, p);
    for (const sp of s.sparks) this.drawSpark(sp.x, sp.y, sp.timer, sp.kind);
    if (opt.showBoxes) for (const f of s.fighters) this.drawBoxes(s, f);
    for (const f of s.fighters) this.drawBubble(f);
    g.restore();
    if (s.superFreeze) this.drawSuperFreeze(s);
    this.drawHud(s, opt);
    if (opt.showBoxes) this.drawDebug(s);
    this.drawPhase(s);
    g.textAlign = 'left';
  }

  /** 除錯資訊：狀態、第幾格、頓幀、鬥氣、有利格數。 */
  private drawDebug(s: GameState): void {
    const g = this.ctx;
    const PHASE: Record<string, string> = { startup: '前搖', active: '攻擊判定', recovery: '後搖' };
    for (const i of [0, 1] as const) {
      const f = s.fighters[i];
      const m = currentMove(f);
      const ph = movePhase(f);
      const name = m && f.action === 'attack' ? `${m.name}（${f.moveId}）` : ACTION_LABEL[f.action] || f.action;
      const lines = [
        `狀態 ${f.action}　${name}`,
        m && f.action === 'attack' ? `${PHASE[ph ?? ''] ?? ''} 第 ${f.frame}/${m.startup + m.active + m.recovery} 格（發生 ${m.startup}・持續 ${m.active}・收招 ${m.recovery}）` : `第 ${f.frame} 格${f.stun > 0 ? `　硬直剩 ${f.stun}` : ''}`,
        `鬥氣 ${(f.drive / DRIVE_BAR).toFixed(2)} 格${f.burnout ? '（燃盡）' : ''}　無敵 ${f.invuln}　連段 ${f.comboHits}`,
      ];
      const x = i === 0 ? 40 : SCREEN_W - 40 - 380;
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillRect(x, 166, 380, 64);
      g.font = `13px ${FONT}`;
      g.textAlign = 'left';
      g.fillStyle = '#e0ffe0';
      lines.forEach((t, k) => g.fillText(t, x + 8, 184 + k * 18));
    }
    const adv = s.lastAdv;
    const info = `頓幀 ${s.hitstop}　${adv ? `上一擊：${adv.side === 0 ? 'P1' : 'P2'} ${adv.move} ${adv.blocked ? '被防' : '命中'} ${adv.value >= 0 ? '+' : ''}${adv.value} 格` : ''}`;
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.font = `13px ${FONT}`;
    const w = g.measureText(info).width + 20;
    g.fillRect(SCREEN_W / 2 - w / 2, 136, w, 22);
    g.textAlign = 'center';
    g.fillStyle = '#fff59d';
    g.fillText(info, SCREEN_W / 2, 152);
    g.textAlign = 'left';
  }

  /** 背景：對戰＝西門町、主選單和訊息＝霓虹長街、選角＝霓虹街角；圖還沒讀好就用漸層 */
  private drawStage(kind: 'battle' | 'menu' | 'select' = 'menu'): void {
    const g = this.ctx;
    const img = kind === 'battle' ? stageImage : kind === 'select' ? selectImage : menuImage;
    if (img.complete && img.naturalWidth > 0) {
      // 背景圖：等比例放大蓋滿整個畫面（置中裁切）
      const k = Math.max(SCREEN_W / img.naturalWidth, SCREEN_H / img.naturalHeight);
      const w = img.naturalWidth * k, h = img.naturalHeight * k;
      g.drawImage(img, (SCREEN_W - w) / 2, (SCREEN_H - h) / 2, w, h);
      // 上方稍微壓暗，讓血條、標題和文字看得清楚（選角畫面字比較多，壓暗一些）
      const shade = g.createLinearGradient(0, 0, 0, 240);
      shade.addColorStop(0, `rgba(0,0,0,${kind === 'select' ? 0.6 : 0.45})`);
      shade.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = shade;
      g.fillRect(0, 0, SCREEN_W, 240);
      return;
    }
    const sky = g.createLinearGradient(0, 0, 0, GROUND_Y);
    sky.addColorStop(0, '#2b2350');
    sky.addColorStop(1, '#6b4f8f');
    g.fillStyle = sky;
    g.fillRect(0, 0, SCREEN_W, GROUND_Y);
    g.fillStyle = '#3a2f4f';
    g.fillRect(0, GROUND_Y, SCREEN_W, SCREEN_H - GROUND_Y);
    g.strokeStyle = '#9f8fc4';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, GROUND_Y);
    g.lineTo(SCREEN_W, GROUND_Y);
    g.stroke();
    // 舞台邊界
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect(0, 0, 30, GROUND_Y);
    g.fillRect(SCREEN_W - 30, 0, 30, GROUND_Y);
  }

  private drawFighter(s: GameState, f: FighterState, debug: boolean): void {
    const g = this.ctx;
    const c = getChar(f.charId);
    const st = formStats(f);
    const dino = f.form === 'dino';
    const cx = this.sx(f.x);
    const baseY = this.sy(f.y);

    // 影子
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.ellipse(cx, GROUND_Y + 4, 40, 8, 0, 0, Math.PI * 2);
    g.fill();

    const m = currentMove(f);
    // 無敵時閃爍；必殺技和變身演出中不閃（整段都是無敵，閃起來會看不清楚）
    const showOff = f.action === 'attack' && (m?.kind === 'super' || m?.kind === 'transform');
    const flash = f.invuln > 0 && !showOff && Math.floor(s.frame / 3) % 2 === 0;
    const set = sprites.get(f.charId);
    const pick = set ? pickAnim(s, f, set.data.animations) : null;
    let w = st.hurtStand.w;
    if (set && pick) {
      const fr = frameAt(pick.anim, pick.t, pick.loop);
      // 鬥氣衝刺：身後拉出綠色殘影；鬥氣衝擊出招中、衝刺中出的招：身體帶綠光
      const rushing = f.action === 'driveRush';
      const green = rushing || f.rushBonus && f.action === 'attack' || (m?.kind === 'impact' && f.action === 'attack' && f.frame <= m.startup + m.active && !set.data.animations.impact) // 有鬥氣衝擊動畫時，綠光已經畫在圖裡;
      if (rushing) {
        for (let k = 3; k >= 1; k--) {
          this.drawSprite(set, fr, cx - f.facing * k * 34, baseY, f.facing, 0.42 - k * 0.1, 'sepia(1) hue-rotate(60deg) saturate(6) brightness(1.1)');
        }
      }
      const odGlow = f.action === 'attack' && !!m?.od;
      const filter = f.burnout ? 'brightness(0.65) saturate(0.4)'
        : odGlow ? 'drop-shadow(0 0 12px rgba(255,170,40,1)) drop-shadow(0 0 4px rgba(255,230,120,1))'
        : green ? 'drop-shadow(0 0 10px rgba(80,255,140,0.95)) drop-shadow(0 0 4px rgba(80,255,140,0.95))' : undefined;
      this.drawSprite(set, fr, cx, baseY, f.facing, flash ? 0.55 : 1, filter);
    } else {
    let h = st.hurtStand.h;
    if (f.action === 'crouch' || (m?.stance === 'crouch') || ((f.action === 'hitstun' || f.action === 'blockstun') && f.crouchStun)) h = st.hurtCrouch.h;
    if (f.action === 'air' || m?.stance === 'air' || f.action === 'airHit') h = st.hurtAir.h;
    if (f.action === 'knockdown' || f.action === 'thrown') { w = h; h = 40; }
    if (f.action === 'getup') h = Math.trunc(h * 0.6);
    if (f.action === 'lose') h = Math.trunc(h * 0.55);

    g.globalAlpha = flash ? 0.55 : 1;
    g.fillStyle = dino ? '#ffca28' : c.color;
    g.strokeStyle = dino ? '#a67c00' : c.accent;
    g.lineWidth = 3;
    const x0 = cx - w / 2;
    const y0 = baseY - h;
    roundRect(g, x0, y0, w, h, dino ? 30 : 10);
    g.fill();
    g.stroke();

    if (dino) {
      // 白肚子 + 尾巴
      g.fillStyle = '#fff3d0';
      g.beginPath();
      g.ellipse(cx + f.facing * 6, baseY - h * 0.38, w * 0.3, h * 0.26, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffca28';
      g.beginPath();
      g.moveTo(cx - f.facing * w * 0.45, baseY - 30);
      g.lineTo(cx - f.facing * (w * 0.5 + 40), baseY - 8);
      g.lineTo(cx - f.facing * w * 0.45, baseY - 6);
      g.fill();
    }

    // 眼睛（表示面向）
    if (f.action !== 'knockdown' && f.action !== 'thrown') {
      const eyeY = y0 + Math.min(34, h * 0.2);
      g.fillStyle = '#1b1b2f';
      g.fillRect(cx + f.facing * (w * 0.18), eyeY, 6, 9);
      g.fillRect(cx + f.facing * (w * 0.18) + f.facing * 12, eyeY, 6, 9);
    }
    g.globalAlpha = 1;
    }

    // 檔架：水藍色光圈
    if (f.action === 'parry') {
      const r = 70 + Math.sin(s.frame / 3) * 4;
      g.strokeStyle = 'rgba(80,220,255,0.85)';
      g.fillStyle = 'rgba(80,220,255,0.15)';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(cx, baseY - 100, r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    if (f.action === 'parried') {
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.font = `bold 18px ${FONT}`;
      g.textAlign = 'center';
      g.fillText('✦ 破綻 ✦', cx, baseY - 230);
    }

    // 鞭子
    if (!pick && m?.id === 'sp' && f.charId === 'mio' && movePhase(f) === 'active' && m.hitbox) {
      const hb = toWorld(f, m.hitbox);
      const tipX = f.facing === 1 ? this.sx(hb.x + hb.w) : this.sx(hb.x);
      const yy = this.sy(hb.y + hb.h / 2);
      g.strokeStyle = '#6d4c41';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(cx + f.facing * w * 0.4, yy);
      g.quadraticCurveTo((cx + tipX) / 2, yy - 18, tipX, yy);
      g.stroke();
    }

    // 招式手腳（發生中為虛線外框、持續中為實心）
    const ph = movePhase(f);
    // （有專屬動畫的招式不畫，動畫本身就看得到手腳）
    if ((!pick || pick.substitute) && m?.hitbox && !m.fullScreen && (ph === 'startup' || ph === 'active') && !(m.id === 'sp' && f.charId === 'mio' && ph === 'active')) {
      const [rx, ry, rw, rh] = this.rect(toWorld(f, m.hitbox));
      if (ph === 'active') {
        g.fillStyle = dino ? '#ffca28' : c.color;
        g.fillRect(rx, ry, rw, rh);
        g.strokeStyle = '#ffffff';
        g.lineWidth = 2;
        g.strokeRect(rx, ry, rw, rh);
      } else {
        g.setLineDash([4, 4]);
        g.strokeStyle = 'rgba(255,255,255,0.5)';
        g.lineWidth = 1;
        g.strokeRect(rx, ry, rw, rh);
        g.setLineDash([]);
      }
    }

    // 動作名稱
    const label = m && f.action === 'attack' ? m.name : ACTION_LABEL[f.action] ?? '';
    if (label && (debug || !pick)) {
      g.font = `bold 15px ${FONT}`;
      g.textAlign = 'center';
      g.fillStyle = '#fff';
      g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.lineWidth = 4;
      g.strokeText(label, cx, baseY + 26);
      g.fillText(label, cx, baseY + 26);
    }
  }

  private drawSprite(set: SpriteSet, fr: SpriteFrame, x: number, y: number, facing: 1 | -1, alpha: number, filter?: string): void {
    const g = this.ctx;
    const sc = set.data.scale;
    g.save();
    g.globalAlpha = alpha;
    if (filter) g.filter = filter; // 燃盡變暗、鬥氣綠光等
    g.imageSmoothingEnabled = false;
    g.translate(Math.round(x), Math.round(y));
    g.scale(facing, 1);
    g.drawImage(set.sheet, fr.sheet.x, fr.sheet.y, fr.sheet.w, fr.sheet.h, -fr.anchor.x * sc, -fr.anchor.y * sc, fr.sheet.w * sc, fr.sheet.h * sc);
    g.restore();
  }

  private drawProjectile(s: GameState, p: GameState['projectiles'][number]): void {
    const set = sprites.get(s.fighters[p.owner].charId);
    const m = getChar(s.fighters[p.owner].charId).moves[p.moveId];
    // 召喚物（貓咪）：飛的時候用 <招式>_projectile、黏在臉上抓的時候用 <招式>_latch（OD 版共用一般版的圖）
    const base = p.moveId.replace(/OD$/, '');
    const anims = set?.data.animations;
    const waiting = !!p.wait && p.wait > 0;
    const anim = (p.latch ? anims?.[`${base}_latch`] : waiting ? anims?.[`${base}_sit`] : undefined)
      ?? anims?.[`${p.moveId}_projectile`] ?? anims?.[`${base}_projectile`] ?? (m?.anim ? anims?.[`${m.anim}_projectile`] : undefined);
    const owner = s.fighters[p.owner];
    const facing: 1 | -1 = p.latch ? (s.fighters[1 - p.owner].x >= owner.x ? 1 : -1) : p.vx >= 0 ? 1 : -1;
    if (set && anim?.frames.length) {
      this.drawSprite(set, frameAt(anim, s.frame, true), this.sx(p.x), this.sy(p.y), facing, 1);
    } else if (m?.latch) {
      this.drawCatPlaceholder(this.sx(p.x), this.sy(p.y), facing, !!p.latch, s.frame, waiting);
    } else if (base === 'bubble') {
      this.drawBubblePlaceholder(projBox(s, p), s.frame);
    } else {
      this.drawHeart(projBox(s, p));
    }
  }

  /** 能量滿：條裡面竄動的電光＋整條被真實的火焰包住（火焰是影片做成的循環動畫） */
  private drawMeterFire(x: number, y: number, w: number, h: number, t: number, flip: boolean): void {
    const g = this.ctx;
    g.save();
    g.globalCompositeOperation = 'lighter';
    // 條裡面的電光：幾條鋸齒狀的亮線，每幾格換一次
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    const seed = Math.floor(t / 3);
    for (let n = 0; n < 3; n++) {
      let px = x + ((seed * 53 + n * 97) % Math.max(1, w));
      let py = y + h / 2;
      g.strokeStyle = n === 0 ? 'rgba(255,255,255,0.9)' : 'rgba(255,230,120,0.7)';
      g.lineWidth = n === 0 ? 1.5 : 1;
      g.beginPath();
      g.moveTo(px, py);
      for (let k = 0; k < 7; k++) {
        px += 10 + ((seed * 7 + k * 13 + n * 5) % 14);
        py = y + 2 + ((seed * 11 + k * 17 + n * 3) % Math.max(1, h - 4));
        g.lineTo(px, py);
      }
      g.stroke();
    }
    g.restore();
    if (!meterFire.complete || !meterFire.naturalWidth) { this.drawMeterFlames(x, y, w, h, t); return; }
    // 火焰：把影片裡那條黑色橫條對齊能量條（左右對齊、上下置中）
    const k = Math.floor(t / FIRE.every) % FIRE.frames;
    const sx = w / FIRE.slotW;
    const sy = sx * 2.2; // 火焰往上拉高，像參考圖那樣竄得比條高很多
    const dw = FIRE.w * sx;
    const dh = FIRE.h * sy;
    const dx = x - FIRE.slotX * sx;
    const dy = y + h / 2 - (FIRE.slotY + FIRE.slotH / 2) * sy;
    g.save();
    g.globalCompositeOperation = 'lighter';
    if (flip) { g.translate(dx * 2 + dw, 0); g.scale(-1, 1); }
    g.drawImage(meterFire, 0, k * FIRE.h, FIRE.w, FIRE.h, dx, dy, dw, dh);
    g.globalAlpha = 0.45; // 再疊一次讓火更亮
    g.drawImage(meterFire, 0, k * FIRE.h, FIRE.w, FIRE.h, dx, dy, dw, dh);
    g.restore();
  }

  /** 能量滿時，能量條周圍冒出的火焰（一排會晃動的火舌＋往上飄的火星）；t 用遊戲影格，畫面才會一致 */
  private drawMeterFlames(x: number, y: number, w: number, h: number, t: number): void {
    const g = this.ctx;
    g.save();
    g.globalCompositeOperation = 'lighter';
    // 火舌：兩層（外層橘紅、內層黃白），寬窄高低不規則，像真的火在晃
    const tongue = (bx: number, by: number, fw: number, fh: number, sway: number, c0: string, c1: string) => {
      const grad = g.createLinearGradient(bx, by, bx + sway, by - fh);
      grad.addColorStop(0, c0);
      grad.addColorStop(1, c1);
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(bx - fw, by);
      g.bezierCurveTo(bx - fw, by - fh * 0.45, bx + sway - fw * 0.35, by - fh * 0.7, bx + sway, by - fh);
      g.bezierCurveTo(bx + sway + fw * 0.35, by - fh * 0.7, bx + fw, by - fh * 0.45, bx + fw, by);
      g.closePath();
      g.fill();
    };
    for (let n = 0; ; n++) {
      const k = n * 1.9;
      const bx = x + n * 13 + Math.sin(k * 2.3) * 4;
      if (bx > x + w + 4) break;
      const by = y + h * 0.7;
      const big = (n % 5 === 2 ? 1.5 : 1) * (0.8 + 0.4 * Math.abs(Math.sin(k * 1.7)));
      const fh = (h + 14) * big + Math.sin(t * 0.23 + k) * 8 + Math.sin(t * 0.41 + k * 2.1) * 5;
      const fw = 7 + Math.abs(Math.sin(k * 3.1)) * 6;
      const sway = Math.sin(t * 0.17 + k) * 5 + Math.sin(t * 0.29 + k * 0.6) * 3;
      tongue(bx, by, fw, fh, sway, 'rgba(255,70,0,0.8)', 'rgba(255,150,0,0)');
      tongue(bx + sway * 0.2, by, fw * 0.55, fh * 0.62, sway * 0.7, 'rgba(255,220,90,0.85)', 'rgba(255,255,200,0)');
    }
    // 下緣、兩端的光暈
    const glow = g.createLinearGradient(0, y - 6, 0, y + h + 8);
    glow.addColorStop(0, 'rgba(255,120,0,0.0)');
    glow.addColorStop(0.5, 'rgba(255,110,0,0.45)');
    glow.addColorStop(1, 'rgba(255,60,0,0.0)');
    g.fillStyle = glow;
    g.fillRect(x - 10, y - 6, w + 20, h + 14);
    // 火星：往上飄、慢慢消失
    for (let n = 0; n < 10; n++) {
      const life = 40;
      const p = ((t + n * 13) % life) / life;
      const ex = x + ((n * 97 + Math.floor((t + n * 13) / life) * 53) % Math.max(1, w));
      const ey = y - p * 34;
      g.fillStyle = `rgba(255,${180 + Math.round(60 * (1 - p))},80,${(1 - p) * 0.9})`;
      g.fillRect(ex, ey, 2, 2);
    }
    g.restore();
  }

  /** 麥克風尖叫：從麥克風往前擴散的粉紅音波圈，一路推到攻擊範圍的盡頭 */
  private drawSoundWave(f: FighterState): void {
    const m = currentMove(f);
    if (!m?.eatsProjectiles || f.action !== 'attack' || !m.hitbox) return;
    const life = m.active + 10;
    const t = (f.frame - m.startup) / life;
    if (t <= 0 || t >= 1) return;
    const g = this.ctx;
    const mx = this.sx(f.x + 45 * FP * f.facing); // 麥克風的位置
    const my = this.sy(f.y + 135 * FP);
    const reach = (m.hitbox.x + m.hitbox.w - 45) * (this.sx(FP * 100) - this.sx(0)) / 100;
    g.save();
    for (let k = 0; k < 3; k++) {
      const p = t * 1.35 - k * 0.18;
      if (p <= 0 || p >= 1) continue;
      const r = 20 + reach * p;
      const a = (1 - p) * 0.9;
      const a0 = f.facing === 1 ? -0.55 : Math.PI - 0.55;
      g.lineWidth = 7 + (1 - p) * 5;
      g.strokeStyle = `rgba(255,120,190,${a})`;
      g.beginPath(); g.arc(mx - f.facing * 20, my, r, a0, a0 + 1.1); g.stroke();
      g.lineWidth = 3;
      g.strokeStyle = `rgba(255,255,255,${a})`;
      g.beginPath(); g.arc(mx - f.facing * 20, my, r, a0 + 0.08, a0 + 1.02); g.stroke();
    }
    g.restore();
  }

  /** 瞌睡泡泡還沒有動畫時的暫代圖：半透明彩虹泡泡＋反光＋Zzz，會輕輕晃 */
  private drawBubblePlaceholder(b: Box, frame: number): void {
    const g = this.ctx;
    const cx = this.sx(b.x + b.w / 2);
    const cy = this.sy(b.y + b.h / 2);
    const r = (b.w / FP) / 2 + Math.sin(frame / 6) * 2;
    g.save();
    const grad = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.35)');
    grad.addColorStop(0.7, 'rgba(160,210,255,0.25)');
    grad.addColorStop(1, 'rgba(255,170,220,0.55)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.beginPath(); g.ellipse(cx - r * 0.4, cy - r * 0.45, r * 0.18, r * 0.1, -0.6, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(120,140,255,0.9)';
    g.font = `bold ${Math.round(r * 0.5)}px ${FONT}`;
    g.textAlign = 'center';
    g.fillText('Zzz', cx + 2, cy + r * 0.2);
    g.restore();
  }

  /** 貓咪還沒有動畫時的暫代圖：灰白貓臉＋耳朵；抓臉時左右抖、冒抓痕 */
  private drawCatPlaceholder(x: number, y: number, facing: 1 | -1, latched: boolean, frame: number, waiting = false): void {
    const g = this.ctx;
    const shake = latched ? (frame % 4 < 2 ? -4 : 4) : 0;
    g.save();
    g.translate(x + shake, y);
    g.scale(facing, 1);
    if (!latched && !waiting) {
      // 身體往後拉長（飛撲）
      g.fillStyle = '#ffffff';
      g.strokeStyle = '#222';
      g.lineWidth = 3;
      g.beginPath(); g.ellipse(-30, 6, 30, 14, 0, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#6b6b6b';
      g.beginPath(); g.ellipse(-62, 0, 16, 5, -0.3, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    g.fillStyle = '#6b6b6b';
    g.strokeStyle = '#222';
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(-18, -12); g.lineTo(-12, -34); g.lineTo(-2, -16); g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(18, -12); g.lineTo(12, -34); g.lineTo(2, -16); g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.arc(0, 0, 22, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.ellipse(0, 9, 14, 11, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c8d64a';
    g.beginPath(); g.arc(-8, -4, 4, 0, Math.PI * 2); g.arc(8, -4, 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ff8fa3';
    g.beginPath(); g.arc(0, 5, 3, 0, Math.PI * 2); g.fill();
    if (latched) {
      // 抓痕
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = 3;
      const k = frame % 12 < 6 ? 0 : 1;
      for (let i = 0; i < 3; i++) {
        g.beginPath(); g.moveTo(20 + i * 7 + k * 4, -24); g.lineTo(30 + i * 7 + k * 4, 6); g.stroke();
      }
    }
    g.restore();
  }

  private drawBoxes(s: GameState, f: FighterState): void {
    const g = this.ctx;
    g.lineWidth = 2;
    for (const hb of hurtboxes(f, s)) {
      g.strokeStyle = 'rgba(80,180,255,0.9)';
      g.strokeRect(...this.rect(hb));
    }
    const hit = activeHitbox(f);
    if (hit && !currentMove(f)?.fullScreen) {
      g.fillStyle = 'rgba(255,40,40,0.35)';
      g.fillRect(...this.rect(hit));
      g.strokeStyle = 'rgba(255,60,60,1)';
      g.strokeRect(...this.rect(hit));
    }
    // 推擠框
    const pw = formStats(f).pushWidth;
    g.strokeStyle = 'rgba(255,230,80,0.7)';
    g.strokeRect(this.sx(f.x) - pw / 2, this.sy(f.y) - 6, pw, 6);
  }

  private drawHeart(b: Box): void {
    const g = this.ctx;
    const [x, y, w, h] = this.rect(b);
    const cx = x + w / 2;
    g.fillStyle = '#ff4f9a';
    g.strokeStyle = '#fff';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx, y + h * 0.95);
    g.bezierCurveTo(x - w * 0.3, y + h * 0.45, x + w * 0.15, y - h * 0.2, cx, y + h * 0.25);
    g.bezierCurveTo(x + w * 0.85, y - h * 0.2, x + w * 1.3, y + h * 0.45, cx, y + h * 0.95);
    g.fill();
    g.stroke();
  }

  private drawSuperEffects(s: GameState): void {
    const g = this.ctx;
    for (const f of s.fighters) {
      const m = currentMove(f);
      if (!m?.fullScreen || f.action !== 'attack') continue;
      const cx = this.sx(f.x);
      const t = f.frame - m.startup;
      if (t < 0 || t > m.active) continue;
      const cy = this.sy(f.y + 150 * FP);
      g.lineWidth = 6;
      for (let k = 0; k < 4; k++) {
        const r = ((t * 14 + k * 160) % 640) + 20;
        g.strokeStyle = `rgba(255,120,190,${1 - r / 660})`;
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.stroke();
      }
      g.font = `bold 34px ${FONT}`;
      g.fillStyle = '#ffd1e8';
      g.textAlign = 'center';
      for (let k = 0; k < 10; k++) {
        const nx = (k * 137 + t * 9) % SCREEN_W;
        const ny = 120 + ((k * 83 + t * 3) % 380);
        g.fillText(k % 2 ? '♪' : '♫', nx, ny);
      }
    }
  }

  /** Sawa 必殺技的舞台燈光：畫面變暗＋三道聚光燈照在她身上，唱歌時燈光顏色慢慢變換。 */
  private drawSpotlights(cx: number, frame: number, total: number): void {
    const g = this.ctx;
    const fadeIn = Math.min(1, frame / 8);
    const fadeOut = Math.min(1, Math.max(0, (total - frame) / 12));
    const k = fadeIn * fadeOut;
    if (k <= 0) return;
    // 1. 舞台變暗
    g.fillStyle = `rgba(8,0,20,${0.5 * k})`;
    g.fillRect(0, 0, SCREEN_W, SCREEN_H);
    // 2. 聚光燈：從畫面上方三個點照下來，一開始偏開、10 格內掃到她身上
    const swing = Math.max(0, 1 - Math.max(0, frame - 4) / 10);
    const footY = GROUND_Y + 6;
    const colors = ['255,170,220', '255,250,235', '170,230,255'];
    g.save();
    g.globalCompositeOperation = 'lighter';
    [-430, 0, 430].forEach((dx, i) => {
      const topX = cx + dx * 0.9;
      const aim = cx + dx * 1.1 * swing + Math.sin(frame / 14 + i) * 18 * (1 - swing);
      const col = frame > 30 ? colors[(i + Math.floor(frame / 20)) % 3] : '255,248,235';
      const gr = g.createLinearGradient(0, -20, 0, footY);
      gr.addColorStop(0, `rgba(${col},${0.05 * k})`);
      gr.addColorStop(1, `rgba(${col},${0.32 * k})`);
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(topX - 14, -20);
      g.lineTo(topX + 14, -20);
      g.lineTo(aim + 95, footY);
      g.lineTo(aim - 95, footY);
      g.closePath();
      g.fill();
    });
    // 3. 腳下的光圈
    const pool = g.createRadialGradient(cx, footY, 4, cx, footY, 130);
    pool.addColorStop(0, `rgba(255,240,250,${0.45 * k * (1 - swing)})`);
    pool.addColorStop(1, 'rgba(255,240,250,0)');
    g.fillStyle = pool;
    g.beginPath();
    g.ellipse(cx, footY, 130, 26, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  private drawSpark(x: number, y: number, timer: number, kind: string): void {
    const g = this.ctx;
    const cx = this.sx(x);
    const cy = this.sy(y);
    if (kind === 'parry' || kind === 'perfect') {
      // 檔架：水藍色光環；完美檔架：更大、白色閃光
      const big = kind === 'perfect';
      const life = big ? 20 : 12;
      const r = (life - timer) * (big ? 9 : 6) + 20;
      g.strokeStyle = big ? `rgba(255,255,255,${timer / life})` : `rgba(80,220,255,${timer / life})`;
      g.lineWidth = big ? 8 : 5;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
      if (big) {
        g.strokeStyle = `rgba(80,220,255,${timer / life})`;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(cx, cy, r * 0.6, 0, Math.PI * 2);
        g.stroke();
      }
      return;
    }
    if (kind === 'reversal') {
      // 鬥氣反擊：金色光芒
      g.strokeStyle = `rgba(255,200,40,${timer / 18})`;
      g.lineWidth = 5;
      g.beginPath();
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const r = (18 - timer) * 7 + 30;
        g.moveTo(cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.5);
        g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      g.stroke();
      return;
    }
    if (kind === 'bpop') {
      // 瞌睡泡泡爆開：有動畫就播 Mio 的 bubble_pop，沒有就畫一圈水珠
      const set = sprites.get('mio');
      const anim = set?.data.animations.bubble_pop;
      if (set && anim?.frames.length) {
        this.drawSprite(set, frameAt(anim, 20 - timer, false), cx, cy, 1, 1);
      } else {
        g.fillStyle = `rgba(170,220,255,${timer / 20})`;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const r = (20 - timer) * 4 + 10;
          g.beginPath(); g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 5, 0, Math.PI * 2); g.fill();
        }
      }
      return;
    }
    if (kind === 'counter' || kind === 'punish') {
      // 打康／確反康：對手頭上跳出字
      const life = 45;
      const k = (life - timer) / life;
      const big = kind === 'punish';
      g.save();
      g.globalAlpha = Math.min(1, timer / 12);
      g.font = `italic 900 ${big ? 34 : 38}px ${FONT}`;
      g.textAlign = 'center';
      g.lineWidth = 6;
      g.strokeStyle = '#000';
      g.fillStyle = big ? '#ff5252' : '#ffd740';
      const t = big ? 'PUNISH COUNTER' : 'COUNTER';
      const ty = cy - k * 30;
      g.strokeText(t, cx, ty);
      g.fillText(t, cx, ty);
      g.restore();
      return;
    }
    if (kind === 'od') {
      // OD 強化版：金橘色光環 + 「OD」字
      const life = 20;
      g.strokeStyle = `rgba(255,170,40,${timer / life})`;
      g.lineWidth = 6;
      g.beginPath();
      g.arc(cx, cy, (life - timer) * 6 + 40, 0, Math.PI * 2);
      g.stroke();
      g.save();
      g.globalAlpha = Math.min(1, timer / 8);
      g.font = `italic 900 40px ${FONT}`;
      g.textAlign = 'center';
      g.lineWidth = 6;
      g.strokeStyle = '#000';
      g.fillStyle = '#ffb300';
      g.strokeText('OD', cx, cy - 150 - (life - timer));
      g.fillText('OD', cx, cy - 150 - (life - timer));
      g.restore();
      return;
    }
    if (kind === 'armor') {
      // 霸體吃下攻擊：白色衝擊波
      g.strokeStyle = `rgba(255,255,255,${timer / 16})`;
      g.lineWidth = 7;
      g.beginPath();
      g.arc(cx, cy, (16 - timer) * 5 + 18, 0, Math.PI * 2);
      g.stroke();
      return;
    }
    if (kind === 'impact' || kind === 'rush') {
      // 鬥氣衝擊起手：綠色漩渦；鬥氣衝刺：腳下綠色煙
      const life = kind === 'impact' ? 24 : 16;
      g.strokeStyle = `rgba(80,255,140,${timer / life})`;
      g.lineWidth = kind === 'impact' ? 6 : 4;
      const r = (life - timer) * (kind === 'impact' ? 5 : 4) + 30;
      g.beginPath();
      if (kind === 'impact') g.arc(cx, cy, r, 0, Math.PI * 2);
      else g.ellipse(cx, cy, r * 1.4, r * 0.4, 0, 0, Math.PI * 2);
      g.stroke();
      return;
    }
    if (kind === 'wall') {
      // 撞牆：裂痕
      g.strokeStyle = `rgba(255,255,255,${Math.min(1, timer / 10)})`;
      g.lineWidth = 5;
      g.beginPath();
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + 0.3;
        const r = 70 + (k % 3) * 25;
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.5 + 8);
        g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      g.stroke();
      return;
    }
    if (kind === 'dizzy') {
      // 暈眩：頭上轉圈的星星
      g.fillStyle = '#ffeb3b';
      g.font = `28px ${FONT}`;
      g.textAlign = 'center';
      for (let k = 0; k < 3; k++) {
        const a = timer / 8 + (k / 3) * Math.PI * 2;
        g.fillText('★', cx + Math.cos(a) * 45, cy + Math.sin(a) * 12);
      }
      return;
    }
    if (kind === 'tech') {
      g.strokeStyle = `rgba(255,255,255,${timer / 14})`;
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(cx - 30, cy - 30); g.lineTo(cx + 30, cy + 30);
      g.moveTo(cx + 30, cy - 30); g.lineTo(cx - 30, cy + 30);
      g.stroke();
      return;
    }
    if (kind === 'burnout') {
      g.fillStyle = `rgba(120,120,120,${timer / 30})`;
      for (let k = 0; k < 5; k++) {
        g.beginPath();
        g.arc(cx + (k - 2) * 22, cy - (30 - timer) * 2 - (k % 2) * 10, 16, 0, Math.PI * 2);
        g.fill();
      }
      return;
    }
    if (kind === 'puff') {
      g.fillStyle = `rgba(255,255,255,${timer / 24})`;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const r = (24 - timer) * 4;
        g.beginPath();
        g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 26, 0, Math.PI * 2);
        g.fill();
      }
      return;
    }
    const color = kind === 'hit' ? '255,220,60' : '120,200,255';
    const r = (14 - timer) * 4 + 12;
    g.strokeStyle = `rgba(${color},${timer / 12})`;
    g.lineWidth = 4;
    g.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      g.moveTo(cx + Math.cos(a) * r * 0.4, cy + Math.sin(a) * r * 0.4);
      g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    g.stroke();
  }

  private drawBubble(f: FighterState): void {
    if (!f.bubble) return;
    if (this.drawArtBubble(f)) return;
    const g = this.ctx;
    const st = formStats(f);
    const cx = this.sx(f.x);
    const top = this.sy(f.y + st.hurtStand.h * FP) - 24;
    g.font = `bold 22px ${FONT}`;
    const tw = g.measureText(f.bubble.text).width;
    const bw = tw + 32;
    const bh = 44;
    const bx = Math.min(SCREEN_W - bw - 8, Math.max(8, cx - bw / 2));
    const by = Math.max(80, top - bh);
    g.fillStyle = '#fff';
    g.strokeStyle = '#333';
    g.lineWidth = 3;
    roundRect(g, bx, by, bw, bh, 18);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(cx - 8, by + bh - 1);
    g.lineTo(cx, by + bh + 14);
    g.lineTo(cx + 8, by + bh - 1);
    g.fill();
    g.textAlign = 'center';
    g.fillStyle = '#333';
    g.fillText(f.bubble.text, bx + bw / 2, by + 30);
  }

  /** 有對話框美術時：依角色和台詞種類（挑釁／其他）選框，尾巴尖端對準頭頂。回傳是否已畫。 */
  private drawArtBubble(f: FighterState): boolean {
    const style = BUBBLE_STYLE[f.charId];
    const bubble = f.bubble;
    if (!style || !bubble) return false;
    const c = getChar(f.charId);
    const part = bubbleParts[bubble.text === c.texts.taunt ? style.taunt : style.intro];
    const im = part && bubbleImages[part.name];
    if (!part || !im?.complete || !im.naturalWidth) return false;
    const g = this.ctx;
    g.font = style.font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // 字太長就把整個框等比例放大
    const k = Math.max(0.85, Math.min(1.6, (g.measureText(bubble.text).width + 16) / part.text.w));
    const w = part.w * k, h = part.h * k;
    const st = formStats(f);
    const headY = this.sy(f.y + st.hurtStand.h * FP) - 6;
    const bx = Math.min(SCREEN_W - w - 4, Math.max(4, this.sx(f.x) - part.tail.x * k));
    const by = Math.max(70, headY - part.tail.y * k);
    g.drawImage(im, bx, by, w, h);
    style.draw(g, bubble.text, bx + (part.text.x + part.text.w / 2) * k, by + (part.text.y + part.text.h / 2) * k);
    g.textBaseline = 'alphabetic';
    return true;
  }

  private drawSuperFreeze(s: GameState): void {
    const g = this.ctx;
    const f = s.fighters[s.superFreeze!.owner];
    const m = currentMove(f);
    g.fillStyle = 'rgba(10,0,20,0.55)';
    g.fillRect(0, 0, SCREEN_W, SCREEN_H);
    const c = getChar(f.charId);
    if (this.drawSuperBanner(s, f.charId, c.texts.super ?? `${c.name}　${m?.name ?? ''}`, (m?.superFreeze ?? 40) - s.superFreeze!.timer)) return;
    g.fillStyle = c.color;
    g.fillRect(0, 300, SCREEN_W, 90);
    g.font = `bold 52px ${FONT}`;
    g.textAlign = 'center';
    g.fillStyle = '#fff';
    g.strokeStyle = c.accent;
    g.lineWidth = 6;
    const text = `${c.name}　${m?.name ?? ''}`;
    g.strokeText(text, SCREEN_W / 2, 364);
    g.fillText(text, SCREEN_W / 2, 364);
  }

  /** 有專屬橫幅美術的角色：橫幅從左邊滑進來，台詞彈出來。回傳是否已畫。 */
  private drawSuperBanner(s: GameState, charId: string, text: string, t: number): boolean {
    const meta = superMeta[charId];
    const im = meta && superImages[charId];
    if (!meta || !im?.complete || !im.naturalWidth) return false;
    const g = this.ctx;
    const ease = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
    const by = SCREEN_H / 2 - meta.h / 2 - 20;
    const bx = -SCREEN_W * (1 - ease(t / 8)); // 前 8 格從左邊滑入
    const shake = t < 14 ? ((s.frame % 2) * 2 - 1) * (14 - t) * 0.4 : 0;
    g.drawImage(im, bx + shake, by, meta.w, meta.h);
    // 台詞：橫幅到位後放大彈出
    if (t >= 6) {
      const k = 1 + 0.5 * (1 - ease((t - 6) / 7));
      const cx = bx + (meta.text.x + meta.text.w / 2) * meta.w;
      const cy = by + (meta.text.y + meta.text.h / 2) * meta.h;
      g.save();
      g.translate(cx + shake, cy);
      g.scale(k, k);
      g.rotate(-0.03);
      g.font = `bold 66px Huninn, ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      g.strokeStyle = '#5a2d00';
      g.lineWidth = 14;
      g.strokeText(text, 0, 0);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 6;
      g.strokeText(text, 0, 0);
      const gr = g.createLinearGradient(0, -34, 0, 34);
      gr.addColorStop(0, '#fff6b0');
      gr.addColorStop(0.5, '#ffb300');
      gr.addColorStop(1, '#ff6f00');
      g.fillStyle = gr;
      g.fillText(text, 0, 0);
      g.restore();
      g.textBaseline = 'alphabetic';
    }
    return true;
  }

  private drawHud(s: GameState, opt: RenderOptions): void {
    const g = this.ctx;
    const barW = 500;
    for (const i of [0, 1] as const) {
      const f = s.fighters[i];
      const c = getChar(f.charId);
      const left = i === 0;
      const x = left ? 40 : SCREEN_W - 40 - barW;
      const art = hudReady();
      if (art) this.drawFighterHud(s, opt, f, i, art);
      else {
        // 血條
        g.fillStyle = '#222';
        g.fillRect(x, 30, barW, 26);
        const ratio = f.hp / c.maxHp;
        g.fillStyle = ratio > 0.3 ? '#4caf50' : '#ff7043';
        const hw = barW * ratio;
        g.fillRect(left ? x + barW - hw : x, 30, hw, 26);
        g.strokeStyle = '#fff';
        g.lineWidth = 2;
        g.strokeRect(x, 30, barW, 26);
        // 鬥氣槽（6 格，綠色；燃盡時灰色閃爍）
        const dx0 = left ? x : x + barW - 300;
        const segW = 300 / 6;
        for (let k = 0; k < 6; k++) {
          const sx = left ? dx0 + 300 - (k + 1) * segW : dx0 + k * segW;
          g.fillStyle = '#1b1b1b';
          g.fillRect(sx + 2, 60, segW - 4, 9);
          const fill = Math.max(0, Math.min(1, (f.drive - k * DRIVE_BAR) / DRIVE_BAR));
          if (fill > 0) {
            g.fillStyle = f.burnout ? (Math.floor(s.frame / 10) % 2 ? '#777' : '#555') : fill >= 1 ? '#42a5f5' : '#1e5fa8'; // 鬥氣：藍色
            const fw = (segW - 4) * fill;
            g.fillRect(left ? sx + 2 + (segW - 4) - fw : sx + 2, 60, fw, 9);
          }
        }
        if (f.burnout) {
          g.font = `bold 13px ${FONT}`;
          g.fillStyle = Math.floor(s.frame / 10) % 2 ? '#ff8a80' : '#fff';
          g.textAlign = left ? 'left' : 'right';
          g.fillText('燃盡', left ? dx0 + 306 : dx0 - 6, 69);
        }
        // 名字 + 回合勝場
        g.font = `bold 20px ${FONT}`;
        g.fillStyle = '#fff';
        g.textAlign = left ? 'left' : 'right';
        const label = i === 1 && opt.p2Label ? `${c.name}（${opt.p2Label}）` : c.name;
        g.fillText(label, left ? x : x + barW, 96);
        for (let k = 0; k < WINS_TO_MATCH; k++) {
          const dx = left ? x + barW - 14 - k * 24 : x + 14 + k * 24;
          g.beginPath();
          g.arc(dx, 72, 8, 0, Math.PI * 2);
          g.fillStyle = k < f.wins ? '#ffd54f' : '#444';
          g.fill();
        }
        // 能量條
        const mw = 300;
        const mx = left ? 40 : SCREEN_W - 40 - mw;
        g.fillStyle = '#222';
        g.fillRect(mx, 676, mw, 18);
        const full = f.meter >= METER_MAX;
        if (full) this.drawMeterFire(mx, 676, mw, 18, s.frame, !left);
        g.fillStyle = full ? (Math.floor(s.frame / 6) % 2 ? '#ffca28' : '#fff3e0') : '#ffa000';
        g.fillRect(mx, 676, (mw * f.meter) / METER_MAX, 18);
        g.strokeStyle = '#fff';
        g.strokeRect(mx, 676, mw, 18);
        g.font = `bold 16px ${FONT}`;
        g.fillStyle = '#fff';
        g.textAlign = left ? 'left' : 'right';
        if (full) g.fillText('必殺技 OK', left ? mx : mx + mw, 668);
        // 變身倒數
        if (f.form === 'dino') {
          g.fillStyle = '#ffca28';
          g.textAlign = left ? 'left' : 'right';
          g.fillText(`恐龍形態 ${Math.ceil(f.formTimer / 60)} 秒`, left ? mx + mw + 16 : mx - 16, 691);
        }
      }
      // 連段數（顯示在攻擊方）
      const foe = s.fighters[1 - i];
      if (foe.comboHits >= 2) {
        g.font = `bold 40px ${FONT}`;
        g.fillStyle = '#ffeb3b';
        g.strokeStyle = '#000';
        g.lineWidth = 5;
        g.textAlign = left ? 'left' : 'right';
        const t = `${foe.comboHits} HITS`;
        g.strokeText(t, left ? 40 : SCREEN_W - 40, 275);
        g.fillText(t, left ? 40 : SCREEN_W - 40, 275);
      }
    }
    // 計時
    g.font = `bold 44px ${FONT}`;
    g.textAlign = 'center';
    g.fillStyle = '#fff';
    const sec = Math.ceil(Math.max(0, s.timer) / 60);
    g.fillText(s.timeLimit ? String(Math.min(ROUND_FRAMES / 60, sec)) : '∞', SCREEN_W / 2, 64);
  }

  /** 有介面框美術時的血量／鬥氣／能量（P2 左右鏡像，圖示在外側）。 */
  private drawFighterHud(s: GameState, opt: RenderOptions, f: FighterState, i: 0 | 1, art: HudArt): void {
    const g = this.ctx;
    const c = getChar(f.charId);
    const left = i === 0;
    const blink = (n: number) => Math.floor(s.frame / n) % 2 === 1;
    /** 把框畫在 (x, y)（P1 的座標，P2 自動鏡像），回傳中間空格的畫面座標 */
    const frame = (part: HudPart, x: number, y: number): Box[] => {
      const fx = left ? x : SCREEN_W - x - part.w;
      const im = hudImages[part.name];
      const slots = part.slots.map((b) => ({ x: left ? fx + b.x : fx + part.w - b.x - b.w, y: y + b.y, w: b.w, h: b.h }));
      // 空格底色（圖上是透明的）
      g.fillStyle = 'rgba(10,8,20,0.85)';
      for (const b of slots) g.fillRect(b.x, b.y, b.w, b.h);
      // 框本身等填色畫完再一起畫，蓋住填色的邊緣
      frames.push(() => {
        g.save();
        if (left) g.drawImage(im, fx, y, part.w, part.h);
        else { g.translate(fx + part.w, y); g.scale(-1, 1); g.drawImage(im, 0, 0, part.w, part.h); }
        g.restore();
      });
      return slots;
    };
    const frames: (() => void)[] = [];

    // 血量：從中間（內側）往外扣
    const [hb] = frame(art.hp, 30, 12);
    const ratio = Math.max(0, f.hp / c.maxHp);
    const hw = Math.round(hb.w * ratio);
    g.fillStyle = ratio > 0.3 ? '#5fe08a' : '#ff7043';
    g.fillRect(left ? hb.x + hb.w - hw : hb.x, hb.y, hw, hb.h);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(left ? hb.x + hb.w - hw : hb.x, hb.y + 2, hw, 3);

    // 鬥氣 6 格：第 1 格在內側
    const slots = frame(art.drive, 44, 74);
    const order = left ? [...slots].reverse() : slots; // 由內往外
    order.forEach((b, k) => {
      const fill = Math.max(0, Math.min(1, (f.drive - k * DRIVE_BAR) / DRIVE_BAR));
      if (fill <= 0) return;
      g.fillStyle = f.burnout ? (blink(10) ? '#777' : '#555') : fill >= 1 ? '#42a5f5' : '#1e5fa8'; // 鬥氣：藍色
      const fw = Math.round(b.w * fill);
      g.fillRect(left ? b.x + b.w - fw : b.x, b.y, fw, b.h);
    });

    // 能量（左下／右下）
    const [mb] = frame(art.meter, 30, SCREEN_H - art.meter.h - 8);
    const full = f.meter >= METER_MAX;
    const mw = Math.round((mb.w * f.meter) / METER_MAX);
    // 能量：金橘色；滿了框的周圍冒火焰（等框畫完再畫，才不會被框蓋住）
    if (full) {
      const grad = g.createLinearGradient(0, mb.y, 0, mb.y + mb.h);
      grad.addColorStop(0, blink(6) ? '#fff8e1' : '#ffe082');
      grad.addColorStop(1, '#ff8f00');
      g.fillStyle = grad;
    } else g.fillStyle = '#ffa000';
    g.fillRect(left ? mb.x : mb.x + mb.w - mw, mb.y, mw, mb.h);

    for (const d of frames) d();
    if (full) this.drawMeterFire(mb.x, mb.y, mb.w, mb.h, s.frame + i * 23, !left);

    // 文字：燃盡、名字、勝場、能量提示、變身倒數
    g.textAlign = left ? 'left' : 'right';
    const inner = (xFromEdge: number) => (left ? xFromEdge : SCREEN_W - xFromEdge);
    if (f.burnout) {
      g.font = `bold 15px ${FONT}`;
      g.fillStyle = blink(10) ? '#ff8a80' : '#fff';
      g.strokeStyle = 'rgba(0,0,0,0.8)';
      g.lineWidth = 4;
      g.strokeText('燃盡', inner(44 + art.drive.w + 10), 108);
      g.fillText('燃盡', inner(44 + art.drive.w + 10), 108);
    }
    g.font = `bold 20px ${FONT}`;
    g.fillStyle = '#fff';
    g.strokeStyle = 'rgba(0,0,0,0.7)';
    g.lineWidth = 4;
    const label = i === 1 && opt.p2Label ? `${c.name}（${opt.p2Label}）` : c.name;
    g.strokeText(label, inner(36), 156);
    g.fillText(label, inner(36), 156);
    for (let k = 0; k < WINS_TO_MATCH; k++) {
      const dx = inner(30 + art.hp.w - 14 - k * 24);
      g.beginPath();
      g.arc(dx, 150, 8, 0, Math.PI * 2);
      g.fillStyle = k < f.wins ? '#ffd54f' : 'rgba(40,40,40,0.8)';
      g.fill();
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      g.stroke();
    }
    const my = SCREEN_H - art.meter.h - 14;
    if (full) {
      // 能量滿了才顯示
      g.font = `bold 18px ${FONT}`;
      g.fillStyle = blink(8) ? '#ffe082' : '#fff8e1';
      g.strokeStyle = 'rgba(120,30,0,0.9)';
      g.lineWidth = 5;
      g.strokeText('必殺技 OK', inner(40), my - 4);
      g.fillText('必殺技 OK', inner(40), my - 4);
    }
    if (f.form === 'dino') {
      g.fillStyle = '#ffca28';
      const t = `恐龍形態 ${Math.ceil(f.formTimer / 60)} 秒`;
      g.strokeText(t, inner(30 + art.meter.w + 14), SCREEN_H - 20);
      g.fillText(t, inner(30 + art.meter.w + 14), SCREEN_H - 20);
    }
  }

  private drawPhase(s: GameState): void {
    const g = this.ctx;
    let text = '';
    let sub = '';
    if (s.phase === 'intro') {
      const len = 150; // 每回合開場一樣長（和 core 的 INTRO_FIRST / INTRO_NEXT 一致）
      text = s.phaseTimer > len - 40 ? 'FIGHT!' : `ROUND ${s.round}`;
    } else if (s.phase === 'ko' && s.phaseTimer < 90) {
      text = s.roundResult?.reason === 'time' ? 'TIME' : 'K.O.';
    } else if (s.phase === 'matchEnd') {
      const w = s.matchWinner;
      text = w === null ? 'DRAW' : `${getChar(s.fighters[w].charId).name} WIN!`;
      sub = 'Enter：再戰　Esc：回到選角';
    }
    if (!text) return;
    g.font = `bold 84px ${FONT}`;
    g.textAlign = 'center';
    g.fillStyle = '#fff';
    g.strokeStyle = '#b71c4a';
    g.lineWidth = 10;
    g.strokeText(text, SCREEN_W / 2, 300);
    g.fillText(text, SCREEN_W / 2, 300);
    if (sub) {
      g.font = `bold 26px ${FONT}`;
      g.lineWidth = 5;
      g.strokeStyle = '#000';
      g.strokeText(sub, SCREEN_W / 2, 360);
      g.fillText(sub, SCREEN_W / 2, 360);
    }
  }

  // ───── 角色選擇畫面 ─────
  drawSelect(ids: string[], cursor: [number, number], ready: [boolean, boolean], p2Label: string, hint?: string, tags: [string, string] = ['P1', 'P2'], countdown = 0): void {
    const g = this.ctx;
    this.drawStage('select');
    g.textAlign = 'center';
    g.fillStyle = '#fff';
    g.font = `bold 48px ${FONT}`;
    g.fillText('選擇角色', SCREEN_W / 2, 90);
    g.font = `18px ${FONT}`;
    g.fillText(hint ?? 'P1：A / D 選擇、U 確定　　P2：← / → 選擇、P 確定　　F2：切換玩家 2／電腦／假人', SCREEN_W / 2, 124);

    // 角色卡：明顯的外框；照片填滿上半部（等比例裁切），名字和類型在下方自己的色帶裡，不會蓋到照片
    const cardW = 260;
    const photoH = 290;
    const bandH = 82;
    const cardH = photoH + bandH;
    const gap = 70;
    const slots = ids.length + 1; // 最後一格是「？ 即將登場」
    const total = slots * cardW + (slots - 1) * gap;
    const y = 182;
    const cursorX = (k: number): number => SCREEN_W / 2 - total / 2 + k * (cardW + gap);
    const drawCursor = (k: number): void => {
      const x = cursorX(k);
      // 選擇中的玩家：外圈框線，P1／P2 標籤放在卡片上方（不蓋到照片和文字）
      for (const p of [0, 1] as const) {
        if (cursor[p] !== k) continue;
        g.strokeStyle = p === 0 ? '#ff5252' : '#448aff';
        g.lineWidth = 6;
        const pad = p === 0 ? 12 : 20;
        roundRect(g, x - pad, y - pad, cardW + pad * 2, cardH + pad * 2, 20);
        g.stroke();
        g.fillStyle = g.strokeStyle;
        g.font = `bold 22px ${FONT}`;
        g.textAlign = p === 0 ? 'left' : 'right';
        g.fillText(`${tags[p]}${ready[p] ? ' ✔' : ''}`, p === 0 ? x - 10 : x + cardW + 10, y - 26);
        g.textAlign = 'center';
      }
    };
    // 即將登場：暗色卡片、大問號，不能選
    {
      const k = ids.length;
      const x = SCREEN_W / 2 - total / 2 + k * (cardW + gap);
      g.save();
      roundRect(g, x, y, cardW, cardH, 16);
      g.clip();
      const bg = g.createLinearGradient(0, y, 0, y + photoH);
      bg.addColorStop(0, '#2a2240');
      bg.addColorStop(1, '#0e0b18');
      g.fillStyle = bg;
      g.fillRect(x, y, cardW, cardH);
      g.fillStyle = 'rgba(10,8,18,0.98)';
      g.fillRect(x, y + photoH, cardW, bandH);
      g.fillStyle = '#6e6690';
      g.fillRect(x, y + photoH, cardW, 4);
      g.restore();
      g.strokeStyle = '#6e6690';
      g.lineWidth = 5;
      roundRect(g, x, y, cardW, cardH, 16);
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 1.5;
      roundRect(g, x + 4, y + 4, cardW - 8, cardH - 8, 13);
      g.stroke();
      g.textAlign = 'center';
      g.save();
      g.shadowColor = 'rgba(180,160,255,0.8)';
      g.shadowBlur = 24;
      g.fillStyle = '#d8d0ff';
      g.font = `bold 190px ${FONT}`;
      g.fillText('？', x + cardW / 2, y + photoH / 2 + 66);
      g.restore();
      g.fillStyle = '#fff';
      g.font = `bold 28px ${FONT}`;
      g.fillText('即將登場', x + cardW / 2, y + photoH + 38);
      g.font = `18px ${FONT}`;
      g.fillStyle = '#a89fc8';
      g.fillText('COMING SOON', x + cardW / 2, y + photoH + 66);
    }
    [...ids, ''].forEach((id, k) => {
      if (!id) { drawCursor(k); return; }
      const c = getChar(id);
      const x = SCREEN_W / 2 - total / 2 + k * (cardW + gap);
      // 卡片底和照片
      g.save();
      roundRect(g, x, y, cardW, cardH, 16);
      g.clip();
      g.fillStyle = '#14101f';
      g.fillRect(x, y, cardW, cardH);
      const pic = portraits[id];
      if (pic?.complete && pic.naturalWidth) {
        const sc = Math.max(cardW / pic.naturalWidth, photoH / pic.naturalHeight);
        const sw = cardW / sc, sh = photoH / sc;
        g.drawImage(pic, (pic.naturalWidth - sw) / 2, (pic.naturalHeight - sh) / 2, sw, sh, x, y, cardW, photoH);
      } else {
        g.fillStyle = c.color;
        g.fillRect(x, y, cardW, photoH);
      }
      // 名字色帶
      const band = g.createLinearGradient(0, y + photoH, 0, y + cardH);
      band.addColorStop(0, 'rgba(20,16,31,0.96)');
      band.addColorStop(1, 'rgba(10,8,18,0.98)');
      g.fillStyle = band;
      g.fillRect(x, y + photoH, cardW, bandH);
      g.fillStyle = c.color;
      g.fillRect(x, y + photoH, cardW, 4);
      g.restore();
      // 外框（角色代表色＋白色細線）
      g.strokeStyle = c.color;
      g.lineWidth = 5;
      roundRect(g, x, y, cardW, cardH, 16);
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.75)';
      g.lineWidth = 1.5;
      roundRect(g, x + 4, y + 4, cardW - 8, cardH - 8, 13);
      g.stroke();
      // 名字、類型
      g.textAlign = 'center';
      g.fillStyle = '#fff';
      g.font = `bold 28px ${FONT}`;
      g.fillText(c.name, x + cardW / 2, y + photoH + 38);
      g.font = `18px ${FONT}`;
      g.fillStyle = '#e8e0ff';
      g.fillText(SELECT_TAG[id] ?? '', x + cardW / 2, y + photoH + 66);
      drawCursor(k);
    });
    g.fillStyle = '#fff';
    g.font = `bold 22px ${FONT}`;
    g.fillText(p2Label, SCREEN_W / 2, 600);
    // 雙方都確定後的 3 秒倒數：畫面中間大數字，提示可以按 Esc 取消
    if (countdown > 0) {
      const n = Math.ceil(countdown);
      const frac = countdown - Math.floor(countdown); // 每秒從 1 → 0，用來做數字縮放
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(0, 0, SCREEN_W, SCREEN_H);
      g.save();
      g.translate(SCREEN_W / 2, SCREEN_H / 2 - 10);
      const k = 1 + 0.35 * (frac === 0 ? 1 : frac);
      g.scale(k, k);
      g.font = `bold 150px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 12;
      g.strokeStyle = '#2a0a3a';
      g.strokeText(String(n), 0, 0);
      g.fillStyle = '#fff59d';
      g.fillText(String(n), 0, 0);
      g.restore();
      g.textBaseline = 'alphabetic';
      g.font = `bold 26px ${FONT}`;
      g.fillStyle = '#fff';
      g.fillText('即將開始！想換角色請按 Esc 取消', SCREEN_W / 2, SCREEN_H / 2 + 110);
    }
  }

  /** 連線等待等訊息畫面。 */
  drawMessage(lines: string[]): void {
    const g = this.ctx;
    this.drawStage();
    g.textAlign = 'center';
    lines.forEach((t, i) => {
      g.font = i === 0 ? `bold 44px ${FONT}` : `22px ${FONT}`;
      g.fillStyle = i === 0 ? '#fff' : '#ddd';
      g.fillText(t, SCREEN_W / 2, 260 + (i === 0 ? 0 : 40 + i * 40));
    });
  }

  /** 線上對戰資訊列（畫在畫面最下方中間）。 */
  drawNetInfo(text: string, warn?: string): void {
    const g = this.ctx;
    g.font = `14px ${FONT}`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(0,0,0,0.5)';
    const w = g.measureText(text).width + 24;
    g.fillRect(SCREEN_W / 2 - w / 2, 700, w, 20);
    g.fillStyle = '#ddd';
    g.fillText(text, SCREEN_W / 2, 715);
    if (warn) {
      g.font = `bold 20px ${FONT}`;
      g.fillStyle = '#ff8a80';
      g.fillText(warn, SCREEN_W / 2, 200);
    }
    g.textAlign = 'left';
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}
