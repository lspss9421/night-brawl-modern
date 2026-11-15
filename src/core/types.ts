// 核心型別。所有遊戲邏輯只用整數運算（可決定性，之後做 rollback 連線必要）。
// 座標單位：centi-pixel（1 像素 = 100）。角色資料中的 Box 以「像素」表示。

export const FP = 100;

/** 以角色腳底中心為原點、面朝右時的矩形；y 往上為正，(x, y) 為左下角。單位：像素。 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type GuardType = 'mid' | 'low' | 'high';
export type MoveKind = 'normal' | 'special' | 'super' | 'transform' | 'throw' | 'taunt' | 'reversal' | 'impact';

export interface ProjectileDef {
  spawnFrame: number;
  speed: number; // centi-px / frame
  box: Box; // 以投射物中心為原點
  spawnX: number; // 相對角色的生成位置（像素）
  spawnY: number;
  /** 飛多少格後消失（沒設定 = 300） */
  life?: number;
  /** 每格往上飄多少（centi-px），例如瞌睡泡泡 */
  rise?: number;
  /** 時間到消失時冒一團煙 */
  endPuff?: boolean;
  /** 召喚物：第幾格先出現在腳邊等著（到 spawnFrame 才飛出去）；出現的位置（像素，相對角色） */
  summon?: { frame: number; x: number; y: number };
}

export interface MoveDef {
  id: string;
  name: string;
  kind: MoveKind;
  stance: 'stand' | 'crouch' | 'air';
  startup: number;
  active: number;
  recovery: number;
  damage: number;
  chip?: number;
  hitstun: number;
  blockstun: number;
  hitstop?: number;
  pushback: number; // centi-px / frame 的初速
  guard: GuardType;
  hitbox?: Box;
  /** 出招中（發生後到收招）額外的受擊範圍，例如鞭子伸出去的手。 */
  hurtbox?: Box;
  knockdown?: boolean;
  /** 打中或被防時可以取消接出的招式 id。 */
  cancel?: string[];
  meterGain?: number;
  projectile?: ProjectileDef;
  /** 多段攻擊：從 startup 開始每 interval 影格一段，共 count 段。 */
  multiHit?: { count: number; interval: number };
  /** 特殊技要扣的鬥氣（預設 1 格 = DRIVE_BAR） */
  driveCost?: number;
  fullScreen?: boolean;
  /** 從第 0 格起的無敵影格數。 */
  invuln?: number;
  /** 發生到持續期間每格向前移動（centi-px）。 */
  advance?: number;
  /** 從第幾格才開始往前移動（例如先拿出枕頭再跳） */
  advanceFrom?: number;
  /** 第幾格到第幾格人在空中（動畫裡跳起來）：投技抓不到、被打中會被打飛 */
  airborne?: [number, number];
  /** 必殺技畫面暫停的影格數。 */
  superFreeze?: number;
  /** 擊飛：命中時把對手往上打飛（centi-px / 格）；需搭配 knockdown */
  launch?: { vx: number; vy: number };
  /** 打不死人（對手最少留 1 滴血），例如鬥氣反擊 */
  nonLethal?: boolean;
  /** 攻擊範圍固定用程式設定的，不套用動畫畫出來的紅框 */
  codeHitbox?: boolean;
  /** 借用別的招式的動畫（這招還沒有自己的圖時） */
  anim?: string;
  /** 霸體：發生到攻擊結束前，可以硬吃幾下攻擊不被打斷（例如鬥氣衝擊） */
  armor?: number;
  /** OD（強化版）特殊技 */
  od?: boolean;
  /** 召喚物撲到對手身上：打中後黏在對手臉上連抓 hits 下（每 interval 格一下），抓完消失；被防或沒打中就消失 */
  latch?: { hits: number; interval: number };
  /** 攻擊範圍可以抵銷對手的飛行道具（例如麥克風尖叫的音波） */
  eatsProjectiles?: boolean;
  /** 沒打中（揮空或被防）時，攻擊結束後只剩這麼多格收招，後面的動畫直接取消（例如自拍閃光沒閃到就不看照片） */
  whiffRecovery?: number;
  /** 打中時對手頭上轉星星（頭暈；暈多久就是 hitstun） */
  dizzyHit?: boolean;
  /** 打中時畫面慢動作幾格（畫面影格數；慢動作期間遊戲 1/3 速度） */
  slowmo?: number;
}

/** 指令技：搓招 + 拳／腳 */
export interface CommandDef {
  /** 262 = ↓→↓、236 = ↓↘→、623 = →↓↘、214 = ↓↙←（以面向為準） */
  /** 沒設定 = 不能搓招，只能用特殊鍵出（見 spOnly） */
  motion?: '262' | '236' | '623' | '214';
  /** 只有按這顆攻擊鍵才出（沒設定 = 輕中重任一顆） */
  btn?: 'L' | 'M' | 'H';
  move: string;
  /** 兩顆攻擊鍵一起按 = OD 強化版 */
  od?: string;
  /** 簡易操作：特殊鍵（n = 單按、f = 前＋特殊、d = 下＋特殊）也能出，但傷害 8 成；特殊＋中 = OD */
  sp?: 'n' | 'f' | 'd';
  /** 只能用特殊鍵出的招（全傷害；特殊＋中 = OD） */
  spOnly?: boolean;
}

export interface FormStats {
  walkFwd: number;
  walkBack: number;
  jumpVel: number;
  gravity: number;
  jumpH: number;
  canDash: boolean;
  canCrouch: boolean;
  damagePct: number; // 100 = 1.0 倍
  /** 受到的傷害倍率（100 = 正常；越低越耐打），沒設定就是 100 */
  defensePct?: number;
  hurtStand: Box;
  hurtCrouch: Box;
  hurtAir: Box;
  pushWidth: number; // 像素
  /** 現代操作：輕／中／重三顆鍵在站、蹲、空中各對應的招式 id；缺少代表這個形態沒有該招。 */
  moves: {
    sL?: string; sM?: string; sH?: string;
    cL?: string; cM?: string; cH?: string;
    jL?: string; jM?: string; jH?: string;
    sp?: string;
  };
  /** 指令技（依序判斷） */
  cmds?: CommandDef[];
}

export interface CharacterDef {
  id: string;
  name: string;
  color: string; // M1 色塊用
  accent: string;
  maxHp: number;
  dash: { frames: number; speed: number };
  backdash: { frames: number; speed: number; invuln: number };
  throwDamage: number;
  forms: { normal: FormStats; dino?: FormStats };
  super: string; // 必殺技招式 id
  transform?: { duration: number; noMeterGain: boolean };
  moves: Record<string, MoveDef>;
  /** super：放必殺技時橫幅上的台詞（沒設定就顯示「角色名＋招式名」） */
  texts: { intro: string; win: string; lose: string; taunt: string; super?: string };
  /** 由素材資料（data.json）產生：每組動畫每一格的受擊框（遊戲像素、以腳底為原點） */
  anims?: Record<string, AnimHurt>;
}

export interface AnimHurt {
  loop: boolean;
  frames: { duration: number; hurt: Box[] }[];
}

export type Action =
  | 'idle'
  | 'walkF'
  | 'walkB'
  | 'crouch'
  | 'jumpSquat'
  | 'air'
  | 'land'
  | 'dashF'
  | 'dashB'
  | 'attack'
  | 'blockstun'
  | 'hitstun'
  | 'airHit'
  | 'knockdown'
  | 'getup'
  | 'throwing'
  | 'thrown'
  | 'taunt'
  | 'win'
  | 'lose'
  | 'parry'
  | 'parryEnd'
  | 'parried'
  | 'driveRush'
  | 'crumple';

export interface Bubble {
  text: string;
  timer: number;
}

export interface FighterState {
  charId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  hp: number;
  meter: number;
  action: Action;
  frame: number;
  moveId: string | null;
  hitsDone: number;
  stun: number;
  crouchStun: boolean;
  slide: number;
  slideDir: 1 | -1;
  jumpDir: -1 | 0 | 1;
  prevInput: number;
  bufBits: number;
  bufTimer: number;
  lastFwdTap: number;
  lastBackTap: number;
  dashReq: -1 | 0 | 1;
  dashTimer: number;
  invuln: number;
  comboHits: number;
  airHitKnockdown: boolean;
  form: 'normal' | 'dino';
  formTimer: number;
  bubble: Bubble | null;
  wins: number;
  /** 鬥氣（0～DRIVE_MAX，6 格） */
  drive: number;
  /** 燃盡：鬥氣用光後直到回滿為止 */
  burnout: boolean;
  /** 被投時是在檔架中（被抓會多扣血） */
  throwPunish: boolean;
  /** 被投出去後，落地時才扣的傷害 */
  landDamage: number;
  /** 後撤結束後的冷卻（影格），歸零前不能再後撤 */
  backdashCd: number;
  /** 最近的方向變化（數字鍵盤方向、以面向為準，6 = 前）和發生的影格；判斷搓招用 */
  dirHist: { d: number; f: number }[];
  /** 這招是從鬥氣衝刺出的（打中／被防多 4 格硬直） */
  rushBonus: boolean;
  /** 這招是用簡易操作（特殊鍵）出的（傷害 8 成） */
  assisted: boolean;
  /** 這招霸體已經吃了幾下 */
  armorUsed: number;
  /** 撞牆／暈眩中：倒下前不會被推離牆邊 */
  wallSplat: boolean;
  /** 這招有沒有真的打中（不算被防）；whiffRecovery 用 */
  hitLanded: boolean;
  /** 這次倒地是跪倒後倒下的（倒地動畫沿用跪倒的最後一格，不再重播往後摔） */
  afterCrumple: boolean;
}

export interface Projectile {
  owner: 0 | 1;
  moveId: string;
  x: number;
  y: number;
  vx: number;
  life: number;
  /** 用簡易操作放的（傷害 8 成） */
  assisted?: boolean;
  /** 黏在對手身上：還要抓幾下、下一下還剩幾格 */
  latch?: { left: number; timer: number };
  /** 召喚物在腳邊等待：還要等幾格才飛出去（等待中不會打人） */
  wait?: number;
  /** 飛出去後要飛到的高度（centi-px） */
  targetY?: number;
  /** 每格往上飄多少（centi-px） */
  vy?: number;
}

export interface Spark {
  x: number;
  y: number;
  timer: number;
  kind: 'hit' | 'block' | 'puff' | 'parry' | 'perfect' | 'reversal' | 'tech' | 'burnout' | 'counter' | 'punish' | 'armor' | 'impact' | 'wall' | 'rush' | 'dizzy' | 'od' | 'bpop';
}

export type Phase = 'intro' | 'fight' | 'ko' | 'matchEnd';

export interface GameState {
  frame: number;
  phase: Phase;
  phaseTimer: number;
  round: number;
  timer: number;
  /** false = 時間無限（測試用） */
  timeLimit: boolean;
  /** 測試用：能量一直是滿的 */
  infiniteMeter?: boolean;
  fighters: [FighterState, FighterState];
  projectiles: Projectile[];
  sparks: Spark[];
  hitstop: number;
  /** 慢動作剩幾格（畫面影格）：這段時間每 3 格才跑 1 格遊戲邏輯 */
  slowmo?: number;
  superFreeze: { owner: 0 | 1; timer: number } | null;
  roundResult: { winner: 0 | 1 | null; reason: 'ko' | 'time' } | null;
  matchWinner: 0 | 1 | null;
  /** 畫面震動（只影響畫面） */
  shake: { timer: number; mag: number } | null;
  /** 這一格發生的事件（之後給音效用；rollback 重算時可能重複，播放端需自行去重） */
  events: string[];
  /** 最近一次命中／被防的有利格數（除錯畫面用） */
  lastAdv: { side: 0 | 1; value: number; blocked: boolean; move: string } | null;
}
