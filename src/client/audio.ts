// 聲音：用 Web Audio 即時合成的音效和背景音樂（不需要音檔）。
// 瀏覽器規定要使用者先點過畫面才能出聲，所以第一次點擊／按鍵時才建立 AudioContext。
import { getChar } from '../core/characters';
import type { GameState } from '../core/types';

export type SfxName =
  | 'hit_light' | 'hit_heavy' | 'block' | 'parry' | 'perfect_parry' | 'throw' | 'throw_tech' | 'throw_land'
  | 'reversal' | 'burnout' | 'counter' | 'punish' | 'od' | 'meow' | 'scratch' | 'armor' | 'impact' | 'wall' | 'rush' | 'ko' | 'round' | 'fight' | 'super' | 'shot' | 'menu' | 'confirm' | 'hover' | 'whip' | 'heart' | 'mio_select' | 'mio_super' | 'sawa_super'
  | 'ann_round1' | 'ann_round2' | 'ann_final' | 'ann_fight' | 'ann_ko' | 'ann_time' | 'ann_win_sawa' | 'ann_win_mio'
  | 'dino_tail' | 'dino_fire' | 'dino_roar'
  | 'swing_lp' | 'swing_hp' | 'swing_lk' | 'swing_hk' | 'land';

/** 背景音樂：menu = 主選單／選角（輕快）、battle = 對戰（緊張刺激） */
export type BgmTrack = 'menu' | 'battle';
const TEMPO: Record<BgmTrack, number> = { menu: 132, battle: 158 };

export interface AudioSettings {
  /** 背景音樂音量 0～1 */
  bgm: number;
  /** 音效音量 0～1 */
  sfx: number;
}

/** Mio 變身動畫裡奶龍張嘴吼叫的那一格 */
const ROAR_FRAME = 76;
const SWING: Record<string, SfxName> = { LP: 'swing_lp', HP: 'swing_hp', LK: 'swing_lk', HK: 'swing_hk' };
/** 常常出現的小動作音效小聲一點，不要蓋過打擊聲 */
const SAMPLE_VOL: Partial<Record<SfxName, number>> = { swing_lp: 0.7, swing_hp: 0.8, swing_lk: 0.7, swing_hk: 0.8, land: 0.5 };

class AudioSystem {
  settings: AudioSettings = { bgm: 0.5, sfx: 0.8 };
  private ctx: AudioContext | null = null;
  private bgmGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private track: BgmTrack | null = null;
  private bgmTimer: number | null = null;
  private nextNoteTime = 0;
  private step = 0;

  constructor() {
    const unlock = () => this.ensure();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    // 遊戲畫面不在最前面時（切到別的分頁、別的應用程式、縮小視窗）整個暫停，回來再接著播
    const sync = () => {
      if (!this.ctx) return;
      if (this.active()) void this.ctx.resume();
      else void this.ctx.suspend();
    };
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('blur', sync);
    window.addEventListener('focus', sync);
  }

  /** 遊戲頁面是否正在畫面最前面（看得到而且是目前使用中的視窗） */
  private active(): boolean {
    return !document.hidden && document.hasFocus();
  }

  private ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && this.active()) void this.ctx.resume();
      return this.ctx;
    }
    // 使用者還沒點過頁面時瀏覽器不允許出聲：先不建立，等第一次點擊／按鍵
    const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (activation && !activation.hasBeenActive) return null;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    this.ctx = ctx;
    this.bgmGain = ctx.createGain();
    this.sfxGain = ctx.createGain();
    this.bgmGain.connect(ctx.destination);
    this.sfxGain.connect(ctx.destination);
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    void this.loadSamples(ctx);
    this.applyVolume();
    if (this.track) this.startScheduler();
    return ctx;
  }

  setVolume(v: Partial<AudioSettings>): void {
    Object.assign(this.settings, v);
    this.applyVolume();
  }

  private applyVolume(): void {
    // 音量用平方曲線，滑桿中段聽起來比較自然
    if (this.bgmGain) this.bgmGain.gain.value = this.settings.bgm ** 2 * 0.5;
    if (this.sfxGain) this.sfxGain.gain.value = this.settings.sfx ** 2;
  }

  // ───── 音效 ─────

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.sfxGain!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private hiss(dur: number, vol: number, freq: number, q = 1, delay = 0, out?: GainNode): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(out ?? this.sfxGain!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  // ───── 錄音音效（真實的聲音檔，讀不到就改用合成的） ─────
  private samples: Partial<Record<SfxName, AudioBuffer>> = {};

  private async loadSamples(ctx: AudioContext): Promise<void> {
    // Mio 鞭擊：真實的抽鞭聲；Sawa 愛心波動：亮晶晶的魔法音
    // mio_select：選角時鎖定 Mio 播的語音
    const files: Partial<Record<SfxName, string>> = { whip: 'whip.wav', heart: 'heart.wav', mio_select: 'mio_select.m4a', mio_super: 'mio_super.m4a', sawa_super: 'sawa_super.m4a',
      // 旁白（Victor）
      ann_round1: 'ann_round1.wav', ann_round2: 'ann_round2.wav', ann_final: 'ann_final.wav',
      ann_fight: 'ann_fight.wav', ann_ko: 'ann_ko.wav', ann_time: 'ann_time.wav',
      ann_win_sawa: 'ann_win_sawa.wav', ann_win_mio: 'ann_win_mio.wav',
      // 奶龍：尾巴橫掃的咻聲、龍之吐息的噴火聲
      dino_tail: 'dino_tail.wav', dino_fire: 'dino_fire.wav', dino_roar: 'dino_roar.wav',
      // Mio 召喚貓咪：喵叫、抓臉
      meow: 'meow.wav', scratch: 'scratch.wav',
      // 出招揮空聲（輕重拳腳各一種）、落地
      swing_lp: 'swing_lp.wav', swing_hp: 'swing_hp.wav', swing_lk: 'swing_lk.wav', swing_hk: 'swing_hk.wav',
      land: 'land.wav' };
    for (const [name, file] of Object.entries(files)) {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}assets/sfx/${file}`);
        if (res.ok) this.samples[name as SfxName] = await ctx.decodeAudioData(await res.arrayBuffer());
      } catch {
        // 讀不到就用合成音效
      }
    }
  }

  private voice: AudioBufferSourceNode | null = null;

  /** 停掉正在播的語音（例如選角語音不要延續到對戰） */
  stopVoice(): void {
    try { this.voice?.stop(); } catch { /* 已經播完 */ }
    this.voice = null;
  }

  private playSample(buf: AudioBuffer, vol = 1, exclusive = false): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.sfxGain!);
    // 語音類（較長）同時只播一個：再觸發時先停掉上一個
    if (exclusive) {
      try { this.voice?.stop(); } catch { /* 已經播完 */ }
      this.voice = src;
    }
    src.start();
  }

  play(name: SfxName): void {
    if (!this.active() || !this.ensure() || this.settings.sfx <= 0) return; // 不在畫面最前面時不播（回來時才不會一次全部冒出來）
    const sample = this.samples[name];
    const voice = name === 'mio_select' || name === 'mio_super' || name === 'sawa_super';
    if (sample) { this.playSample(sample, SAMPLE_VOL[name] ?? 1, voice); return; }
    if (voice || name.startsWith('ann_') || name.startsWith('dino_') || name.startsWith('swing_') || name === 'land') return; // 聲音檔還沒讀好就不播
    switch (name) {
      case 'hit_light': this.hiss(0.08, 0.7, 1800, 0.8); this.tone('square', 320, 120, 0.06, 0.15); break;
      case 'hit_heavy': this.hiss(0.16, 0.9, 900, 0.7); this.tone('sawtooth', 180, 45, 0.18, 0.3); break;
      case 'block': this.hiss(0.06, 0.5, 3500, 2); this.tone('triangle', 900, 700, 0.05, 0.15); break;
      case 'parry': this.tone('sine', 1200, 1500, 0.12, 0.25); this.hiss(0.05, 0.3, 5000, 3); break;
      case 'perfect_parry': this.tone('sine', 1500, 2400, 0.25, 0.3); this.tone('sine', 2250, 3000, 0.25, 0.15, 0.03); break;
      case 'throw': this.hiss(0.1, 0.5, 600, 1); this.tone('square', 220, 160, 0.08, 0.12); break;
      case 'throw_tech': this.tone('square', 700, 900, 0.08, 0.18); this.tone('square', 900, 700, 0.08, 0.18, 0.06); break;
      case 'throw_land': this.tone('sine', 120, 40, 0.3, 0.6); this.hiss(0.2, 0.6, 300, 0.6); break;
      case 'reversal': this.tone('sawtooth', 200, 800, 0.2, 0.25); this.hiss(0.25, 0.4, 1500, 0.5); break;
      case 'burnout': this.tone('square', 400, 100, 0.5, 0.2); break;
      case 'od': this.tone('sawtooth', 400, 1600, 0.18, 0.18); this.tone('sine', 1600, 2400, 0.2, 0.15, 0.05); break;
      case 'counter': this.tone('square', 990, 1320, 0.1, 0.16); this.tone('square', 1320, 1760, 0.12, 0.14, 0.06); break;
      case 'punish': this.tone('sawtooth', 660, 1320, 0.14, 0.18); this.tone('square', 1760, 1760, 0.16, 0.14, 0.08); break;
      case 'armor': this.tone('triangle', 300, 220, 0.12, 0.3); this.hiss(0.08, 0.5, 2500, 1); break;
      case 'impact': this.tone('sawtooth', 90, 300, 0.4, 0.22); this.hiss(0.4, 0.35, 900, 0.5); break;
      case 'wall': this.tone('sine', 90, 35, 0.45, 0.6); this.hiss(0.3, 0.8, 500, 0.6); break;
      case 'rush': this.hiss(0.22, 0.45, 1600, 0.8); this.tone('sine', 300, 700, 0.15, 0.12); break;
      case 'ko': this.tone('sawtooth', 220, 30, 0.9, 0.35); this.hiss(0.6, 0.6, 400, 0.4); break;
      case 'round': this.tone('square', 523, 523, 0.12, 0.12); this.tone('square', 659, 659, 0.18, 0.12, 0.12); break;
      case 'fight': [523, 659, 784, 1046].forEach((f, i) => this.tone('square', f, f, 0.12, 0.13, i * 0.07)); break;
      case 'super': this.tone('sawtooth', 100, 1600, 0.6, 0.2); this.hiss(0.6, 0.3, 2000, 0.3); break;
      case 'shot': this.tone('sine', 900, 400, 0.15, 0.2); break;
      case 'menu': this.tone('square', 880, 880, 0.04, 0.08); break;
      case 'confirm': this.tone('square', 660, 660, 0.05, 0.1); this.tone('square', 990, 990, 0.08, 0.1, 0.05); break;
      case 'heart': this.tone('sine', 1200, 2400, 0.25, 0.2); this.tone('sine', 1800, 3600, 0.2, 0.12, 0.05); break; // 聲音檔讀不到時的替代
      case 'whip': this.hiss(0.18, 0.3, 1200, 0.6); this.hiss(0.05, 1, 5000, 0.5, 0.2); break; // 聲音檔讀不到時的替代
      case 'hover': this.tone('triangle', 1320, 1480, 0.045, 0.12); break;
    }
  }

  // ───── 背景音樂 ─────

  /** 切換背景音樂（null = 停止）；同一首就繼續播，不會從頭開始 */
  setBgm(track: BgmTrack | null): void {
    if (track === this.track) return;
    this.stopScheduler();
    this.track = track;
    // 還沒點過畫面時先記住要播哪首，等第一次點擊／按鍵（ensure）再開始
    if (track && this.ctx) { this.ensure(); this.startScheduler(); }
  }

  private startScheduler(): void {
    if (this.bgmTimer !== null || !this.ctx) return;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.bgmTimer = window.setInterval(() => this.schedule(), 50);
  }

  private stopScheduler(): void {
    if (this.bgmTimer !== null) window.clearInterval(this.bgmTimer);
    this.bgmTimer = null;
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.track) return;
    const sixteenth = 60 / TEMPO[this.track] / 4;
    while (this.nextNoteTime < ctx.currentTime + 0.25) {
      if (this.track === 'battle') this.playBattleStep(this.step, this.nextNoteTime, sixteenth);
      else this.playStep(this.step, this.nextNoteTime, sixteenth);
      this.step = (this.step + 1) % 128; // 8 小節
      this.nextNoteTime += sixteenth;
    }
  }

  private note(type: OscillatorType, midi: number, t: number, dur: number, vol: number, lowpass = 0): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    if (lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      o.connect(f).connect(g);
    } else o.connect(g);
    g.connect(this.bgmGain!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** 主選單音樂：輕快的晶片音樂（Am－F－C－G，每分鐘 132 拍） */
  private playStep(step: number, t: number, s16: number): void {
    const bar = Math.floor(step / 16) % 4;
    const pos = step % 16;
    // 和弦根音：Am F C G
    const roots = [45, 41, 48, 43];
    const root = roots[bar];
    // 貝斯：八分音符，根音和八度交替
    if (pos % 2 === 0) this.note('triangle', root + (pos % 4 === 2 ? 12 : 0), t, s16 * 1.8, 0.5);
    // 鼓：大鼓（低沉的 sine）在 1、3 拍，小鼓（雜訊）在 2、4 拍，hi-hat 每個八分音符
    if (pos === 0 || pos === 8 || (pos === 10 && bar === 3)) {
      const o = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      g.gain.setValueAtTime(0.7, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      o.connect(g).connect(this.bgmGain!);
      o.start(t);
      o.stop(t + 0.17);
    }
    if (pos === 4 || pos === 12) this.noiseHit(t, 0.12, 0.35, 2500);
    if (pos % 2 === 0) this.noiseHit(t, 0.03, 0.12, 8000);
    // 旋律：前 4 小節和後 4 小節不同
    const second = step >= 64;
    const melodyA = [
      [69, -1, 72, -1, 76, -1, 74, 72, -1, 69, -1, 71, 72, -1, -1, -1],
      [65, -1, 69, -1, 72, -1, 71, 69, -1, 65, -1, 67, 69, -1, -1, -1],
      [72, -1, 76, -1, 79, -1, 77, 76, -1, 72, -1, 74, 76, -1, 74, -1],
      [71, -1, 74, -1, 79, -1, 77, 74, -1, 71, -1, 72, 74, -1, -1, -1],
    ];
    const melodyB = [
      [76, -1, 76, 74, 72, -1, 74, -1, 76, -1, 81, -1, 79, -1, 76, -1],
      [77, -1, 77, 76, 74, -1, 72, -1, 69, -1, 72, -1, 74, -1, -1, -1],
      [79, -1, 79, 77, 76, -1, 77, -1, 79, -1, 84, -1, 83, -1, 79, -1],
      [83, -1, 81, -1, 79, -1, 77, -1, 74, -1, 76, -1, 77, -1, 79, -1],
    ];
    const n = (second ? melodyB : melodyA)[bar][pos];
    if (n > 0) this.note('square', n, t, s16 * 1.6, 0.12);
    // 和弦點綴：每拍反拍
    if (pos % 4 === 2) for (const iv of [12, 15 + (bar === 0 ? 0 : 1), 19]) this.note('square', root + iv + 12, t, s16 * 0.8, 0.025);
  }

  private kick(t: number, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.11);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(g).connect(this.bgmGain!);
    o.start(t);
    o.stop(t + 0.16);
  }

  /** 對戰音樂：E 小調（和聲小調，有升 D 的緊張感）、每分鐘 158 拍、奔馳般的十六分音符貝斯 */
  private playBattleStep(step: number, t: number, s16: number): void {
    const bar = Math.floor(step / 16); // 0～7
    const pos = step % 16;
    // 和弦根音：Em Em C D ｜ Em Em C B（最後一小節 B 大和弦，拉回 Em 的緊張感）
    const roots = [40, 40, 36, 38, 40, 40, 36, 35];
    const root = roots[bar];
    const major = bar === 7 || bar === 2 || bar === 3 || bar === 6; // C、D、B 是大和弦
    // 貝斯：奔馳節奏（每拍 1、3、4 個十六分音符），第三拍升八度
    if (pos % 4 !== 1) this.note('sawtooth', root + (pos >= 8 && pos < 12 ? 12 : 0), t, s16 * 0.9, 0.32, 700);
    // 大鼓：每拍都打；第 4、8 小節最後多一下
    if (pos % 4 === 0 || (pos === 14 && (bar === 3 || bar === 7))) this.kick(t, 0.75);
    // 小鼓：2、4 拍；最後一小節後半連打，越打越大聲
    if (pos === 4 || pos === 12) { this.noiseHit(t, 0.14, 0.4, 1800); this.note('triangle', 50, t, 0.08, 0.2); }
    if (bar === 7 && pos >= 8) this.noiseHit(t, 0.08, 0.12 + (pos - 8) * 0.04, 1800);
    // hi-hat：十六分音符，反拍重一點
    this.noiseHit(t, 0.025, pos % 2 ? 0.1 : 0.05, 9000);
    // 琶音：快速往上的和弦音，營造速度感
    const chord = [24, major ? 28 : 27, 31, 36];
    this.note('square', root + chord[pos % 4], t, s16 * 0.7, 0.028);
    // 主旋律（鋸齒波，帶一點刺）
    const lead = [
      [76, -1, -1, 75, 76, -1, 71, -1, 79, -1, 78, -1, 76, -1, 75, -1],
      [76, -1, -1, -1, 79, -1, -1, 78, 76, -1, 74, -1, 71, -1, -1, -1],
      [72, -1, -1, 71, 72, -1, 76, -1, 79, -1, -1, 76, 72, -1, -1, -1],
      [74, -1, -1, 72, 74, -1, 78, -1, 81, -1, 79, -1, 78, -1, 74, -1],
      [83, -1, -1, -1, 81, -1, 79, -1, 78, -1, 79, -1, 81, -1, 83, -1],
      [84, -1, 83, -1, 81, -1, 79, -1, 78, -1, 76, -1, 75, -1, 76, -1],
      [72, -1, 76, -1, 79, -1, 84, -1, 83, -1, 79, -1, 76, -1, 79, -1],
      [75, -1, 78, -1, 81, -1, 83, -1, 87, -1, -1, -1, 83, -1, -1, -1],
    ];
    const n = lead[bar][pos];
    if (n > 0) {
      this.note('sawtooth', n, t, s16 * 1.7, 0.06, 3200);
      this.note('square', n - 12, t, s16 * 1.5, 0.03); // 低八度加厚
    }
    // 最後一小節：往上衝的雜訊，準備回到開頭
    if (bar === 7 && pos === 0) {
      const ctx = this.ctx!;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 2;
      f.frequency.setValueAtTime(400, t);
      f.frequency.exponentialRampToValueAtTime(6000, t + s16 * 16);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + s16 * 15);
      g.gain.exponentialRampToValueAtTime(0.001, t + s16 * 16);
      src.connect(f).connect(g).connect(this.bgmGain!);
      src.start(t);
      src.stop(t + s16 * 16 + 0.02);
    }
  }

  private noiseHit(t: number, dur: number, vol: number, freq: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.bgmGain!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  // ───── 從遊戲狀態產生音效 ─────

  private lastPhase = '';
  private lastProjectiles = 0;
  private lastFreeze = 0;
  private lastKey = ['', ''];

  /** 每跑完一格遊戲邏輯呼叫一次 */
  onStep(s: GameState): void {
    for (const e of s.events) {
      if (e === 'burnout_end') continue;
      if (e === 'throw_toss') continue;
      this.play(e as SfxName);
    }
    // 旁白：開場畫面出現「ROUND N」時唸回合、變成「FIGHT!」時喊 Fight（和畫面上的字同步，開場 150 格、最後 40 格是 FIGHT!）
    if (s.phase === 'intro') {
      if (s.phaseTimer === 12) this.play(s.round >= 3 ? 'ann_final' : s.round === 2 ? 'ann_round2' : 'ann_round1');
      if (s.phaseTimer === 111) this.play('ann_fight');
    }
    if (s.phase !== this.lastPhase) {
      if (s.phase === 'ko') { this.play('ko'); this.play(s.roundResult?.reason === 'time' ? 'ann_time' : 'ann_ko'); }
      // 整場結束：旁白宣布勝利者（平手就不講）
      if (s.phase === 'matchEnd' && s.matchWinner !== null && s.matchWinner !== undefined) {
        const id = s.fighters[s.matchWinner]?.charId;
        if (id === 'sawa') this.play('ann_win_sawa');
        else if (id === 'mio') this.play('ann_win_mio');
      }
      if (s.phase === 'fight' && this.lastPhase === 'intro') this.play('fight');
      if (s.phase === 'intro') this.play('round');
      this.lastPhase = s.phase;
    }
    if (s.projectiles.length > this.lastProjectiles) {
      // 新射出的飛行道具：Sawa 的愛心波動有自己的音效
      const p = s.projectiles[s.projectiles.length - 1];
      this.play(s.fighters[p.owner]?.charId === 'sawa' ? 'heart' : 'shot');
    }
    this.lastProjectiles = s.projectiles.length;
    const freeze = s.superFreeze ? 1 : 0;
    if (freeze && !this.lastFreeze) {
      this.play('super');
      // Mio 放必殺技：橫幅出現時一起喊「我是奶龍」
      if (s.superFreeze && s.fighters[s.superFreeze.owner]?.charId === 'mio') this.play('mio_super');
    }
    this.lastFreeze = freeze;
    // Mio 揮鞭：出招第一格播抽鞭聲（錄音裡的爆裂聲剛好落在鞭子打到的那一格）
    for (const [i, f] of s.fighters.entries()) {
      // 定格（打擊停頓、必殺技演出）時影格不會前進：同一格只播一次
      const key = `${f.action}:${f.moveId}:${f.frame}`;
      if (key === this.lastKey[i]) continue;
      this.lastKey[i] = key;
      if (f.charId === 'mio' && f.form === 'normal' && f.action === 'attack' && (f.moveId === 'sp' || f.moveId === 'spOD') && f.frame === 1) this.play('whip');
      // 奶龍：出招第一格播（咻聲最響的地方剛好在尾巴打到的時候；噴火聲先吸氣再噴）
      if (f.action === 'attack' && f.frame === 1 && f.moveId === 'dHK') this.play('dino_tail');
      if (f.action === 'attack' && f.frame === 1 && f.moveId === 'dBreath') this.play('dino_fire');
      // Mio 變身：奶龍抬頭張嘴吼叫那一格播恐龍咆哮（變身動畫第 76 格）
      if (f.charId === 'mio' && f.action === 'attack' && f.moveId === 'super' && f.frame === ROAR_FRAME) this.play('dino_roar');
      // Sawa 必殺技：橫幅結束、拿起麥克風那一格開始播（音檔約 2 秒，剛好到技能結束）
      if (f.charId === 'sawa' && f.action === 'attack' && f.frame === 1 && f.moveId === 'super') this.play('sawa_super');
      // 一般技：出招第一格播揮空聲（站／蹲／空中、奶龍的拳腳都算；奶龍重腳已經有尾巴聲）
      if (f.action === 'attack' && f.frame === 1 && f.moveId && f.moveId !== 'dHK') {
        // 借用拳腳動畫的特殊技（上勾拳、旋踢、滑壘、鬥氣衝擊）也用那個拳腳的揮空聲
        const mv = getChar(f.charId).moves[f.moveId];
        const m = /^[scjd](LP|HP|LK|HK)$/.exec(mv?.anim ?? (mv?.kind === 'impact' ? 'sHP' : f.moveId));
        if (m) this.play(SWING[m[1]]);
      }
      // 舞步旋踢：轉三圈，每一踢前播一次重腳揮空聲
      if (f.action === 'attack' && (f.moveId === 'rush' || f.moveId === 'rushOD')) {
        const mv = getChar(f.charId).moves[f.moveId];
        const hit = mv.multiHit;
        if (hit && f.frame >= mv.startup - 1 && (f.frame - (mv.startup - 1)) % hit.interval === 0 && (f.frame - (mv.startup - 1)) / hit.interval < hit.count) this.play('swing_hk');
      }
      // Mio 召喚貓咪：出招第一格喵一聲
      if (f.action === 'attack' && f.frame === 1 && (f.moveId === 'cat' || f.moveId === 'catOD')) this.play('meow');
      if (f.frame === 1 && f.action === 'land') this.play('land');
    }
  }
}

export const audio = new AudioSystem();
