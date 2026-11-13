/**
 * @file audio.js
 * @description Web Audio APIによる動的音源合成・コンボ連動ピッチ上昇SE・プロシージャルBGM（仕様書 3.8節準拠）
 */
(function (root) {
  'use strict';

  class SoundSystem {
    constructor() {
      this.ctx = null;
      this.masterGain = null;
      this.noiseBuffer = null;
      this.muted = false;
      this.bgmPlaying = false;
      this.bgmMode = 'stage'; // 'stage' | 'boss'
      this.bgmStep = 0;
      this.bgmTimer = 0;
      this.lastSparkTime = 0;
      this.lastShootTime = 0;
    }

    /**
     * ユーザー操作時にAudioContextを初期化・アンロックする
     */
    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') {
          this.ctx.resume();
        }
        return;
      }
      const AudioCtx = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
      if (!AudioCtx) return;

      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.32;
      this.masterGain.connect(this.ctx.destination);

      // 爆発音・スパーク音用のホワイトノイズバッファを事前生成
      const sampleRate = this.ctx.sampleRate;
      const bufferSize = sampleRate * 1.5;
      this.noiseBuffer = this.ctx.createBuffer(1, bufferSize, sampleRate);
      const output = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
    }

    toggleMute() {
      this.muted = !this.muted;
      if (this.masterGain && this.ctx) {
        this.masterGain.gain.setValueAtTime(this.muted ? 0 : 0.32, this.ctx.currentTime);
      }
      return this.muted;
    }

    /**
     * ショット / 貫通レーザー発射音
     * @param {boolean} isLaser
     * @param {number} level 1 or 2
     */
    playShoot(isLaser, level) {
      if (!this.ctx || this.muted) return;
      const now = this.ctx.currentTime;
      if (now - this.lastShootTime < 0.04) return;
      this.lastShootTime = now;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      if (isLaser) {
        // グラディウス風のシャープな電子レーザー発射音
        osc.type = level >= 2 ? 'sawtooth' : 'square';
        const startFreq = level >= 2 ? 1520 : 1280;
        const endFreq = level >= 2 ? 320 : 420;
        osc.frequency.setValueAtTime(startFreq, now);
        osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.13);

        gain.gain.setValueAtTime(0.22, now);
        gain.gain.exponentialRampToValueAtTime(0.008, now + 0.14);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.14);
      } else {
        // 通常・ダブルショット発射音
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(980, now);
        osc.frequency.exponentialRampToValueAtTime(240, now + 0.07);

        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.075);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.08);
      }
    }

    /**
     * ミサイル発射音
     */
    playMissile() {
      if (!this.ctx || this.muted) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(340, now);
      osc.frequency.exponentialRampToValueAtTime(120, now + 0.09);

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.095);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.1);
    }

    /**
     * レーザー継続照射時の装甲スパーク音（スロットリング制御付き）
     */
    playHitSpark() {
      if (!this.ctx || this.muted) return;
      const now = this.ctx.currentTime;
      if (now - this.lastSparkTime < 0.055) return;
      this.lastSparkTime = now;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      const baseFreq = 1800 + Math.random() * 700;
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(600, now + 0.035);

      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.005, now + 0.04);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.04);
    }

    /**
     * 敵撃破・爆発音（コンボ連動ピッチ上昇対応）
     * @param {'small'|'medium'|'boss'|'player'} type
     * @param {number} comboCount 現在のコンボ数
     */
    playExplosion(type, comboCount = 1) {
      if (!this.ctx || this.muted || !this.noiseBuffer) return;
      const now = this.ctx.currentTime;

      // ノイズバースト
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      const noiseGain = this.ctx.createGain();

      // コンボ数に応じた半音ピッチ上昇（最大 +12半音 = 1オクターブ上）
      const semitones = Math.min(Math.max(0, comboCount - 1), 12);
      const pitchMult = Math.pow(2, semitones / 12);

      if (type === 'small') {
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(750 * pitchMult, now);
        filter.frequency.exponentialRampToValueAtTime(180 * pitchMult, now + 0.16);
        filter.Q.value = 2.2;

        noiseGain.gain.setValueAtTime(0.26, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.17);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.masterGain);
        noise.start(now);
        noise.stop(now + 0.18);

        // 爽快なコンボ撃破チャイム倍音を重ねる
        const tone = this.ctx.createOscillator();
        const toneGain = this.ctx.createGain();
        tone.type = 'triangle';
        tone.frequency.setValueAtTime(330 * pitchMult, now);
        tone.frequency.exponentialRampToValueAtTime(165 * pitchMult, now + 0.12);
        toneGain.gain.setValueAtTime(0.18, now);
        toneGain.gain.exponentialRampToValueAtTime(0.008, now + 0.13);
        tone.connect(toneGain);
        toneGain.connect(this.masterGain);
        tone.start(now);
        tone.stop(now + 0.13);
      } else if (type === 'medium') {
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(900, now);
        filter.frequency.exponentialRampToValueAtTime(90, now + 0.38);

        noiseGain.gain.setValueAtTime(0.42, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.masterGain);
        noise.start(now);
        noise.stop(now + 0.41);

        // 重低音スイープ
        const sub = this.ctx.createOscillator();
        const subGain = this.ctx.createGain();
        sub.type = 'sawtooth';
        sub.frequency.setValueAtTime(180, now);
        sub.frequency.exponentialRampToValueAtTime(38, now + 0.36);
        subGain.gain.setValueAtTime(0.3, now);
        subGain.gain.exponentialRampToValueAtTime(0.01, now + 0.38);
        sub.connect(subGain);
        subGain.connect(this.masterGain);
        sub.start(now);
        sub.stop(now + 0.39);
      } else {
        // ボス撃破 または 自機被弾の大爆発
        const duration = type === 'boss' ? 1.15 : 0.65;
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1200, now);
        filter.frequency.exponentialRampToValueAtTime(55, now + duration);

        noiseGain.gain.setValueAtTime(0.55, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.008, now + duration);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.masterGain);
        noise.start(now);
        noise.stop(now + duration + 0.02);

        const sub = this.ctx.createOscillator();
        const subGain = this.ctx.createGain();
        sub.type = 'sawtooth';
        sub.frequency.setValueAtTime(150, now);
        sub.frequency.exponentialRampToValueAtTime(28, now + duration);
        subGain.gain.setValueAtTime(0.45, now);
        subGain.gain.exponentialRampToValueAtTime(0.008, now + duration);
        sub.connect(subGain);
        subGain.connect(this.masterGain);
        sub.start(now);
        sub.stop(now + duration + 0.02);
      }
    }

    /**
     * カプセル取得音＆パワーアップゲージ移動音
     * @param {boolean} isBlue 青カプセル（全画面一掃）かどうか
     */
    playCapsuleGet(isBlue = false) {
      if (!this.ctx || this.muted) return;
      const now = this.ctx.currentTime;

      if (isBlue) {
        // 青カプセル：全画面フラッシュ和音
        const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
        notes.forEach((freq, idx) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + idx * 0.035);
          gain.gain.setValueAtTime(0.22, now + idx * 0.035);
          gain.gain.exponentialRampToValueAtTime(0.008, now + idx * 0.035 + 0.35);
          osc.connect(gain);
          gain.connect(this.masterGain);
          osc.start(now + idx * 0.035);
          osc.stop(now + idx * 0.035 + 0.36);
        });
      } else {
        // 赤カプセル：グラディウス風の軽快な2音ピロッ＋ゲージカーソル音
        const freqs = [880, 1318.5];
        freqs.forEach((freq, idx) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'square';
          osc.frequency.setValueAtTime(freq, now + idx * 0.045);
          gain.gain.setValueAtTime(0.18, now + idx * 0.045);
          gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.045 + 0.08);
          osc.connect(gain);
          gain.connect(this.masterGain);
          osc.start(now + idx * 0.045);
          osc.stop(now + idx * 0.045 + 0.085);
        });
      }
    }

    /**
     * パワーアップ発動音（アルペジオ和音）
     */
    playPowerUpActivate() {
      if (!this.ctx || this.muted) return;
      const now = this.ctx.currentTime;
      const notes = [440, 554.37, 659.25, 880, 1108.73];
      notes.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        const t = now + idx * 0.04;
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.008, t + 0.2);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.21);
      });
    }

    /**
     * ボス接近 WARNING サイレン音
     */
    playWarning() {
      if (!this.ctx || this.muted) return;
      const now = this.ctx.currentTime;
      for (let i = 0; i < 3; i++) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const t = now + i * 0.9;
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(420, t);
        osc.frequency.linearRampToValueAtTime(780, t + 0.45);
        osc.frequency.linearRampToValueAtTime(420, t + 0.85);

        gain.gain.setValueAtTime(0.22, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.85);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.86);
      }
    }

    /**
     * 毎フレーム呼び出されるプロシージャルBGMシーケンサー更新
     * @param {number} dt
     * @param {'stage'|'boss'} mode
     */
    updateBGM(dt, mode = 'stage') {
      if (!this.ctx || this.muted) return;
      this.bgmMode = mode;
      const stepInterval = mode === 'boss' ? 0.115 : 0.145;
      this.bgmTimer += dt;
      if (this.bgmTimer < stepInterval) return;
      this.bgmTimer -= stepInterval;

      const stageNotes = [
        146.83, 146.83, 220.00, 146.83, 261.63, 220.00, 196.00, 174.61,
        164.81, 164.81, 246.94, 164.81, 293.66, 261.63, 220.00, 196.00
      ];
      const bossNotes = [
        110.00, 116.54, 110.00, 130.81, 110.00, 116.54, 146.83, 138.59,
        110.00, 116.54, 110.00, 164.81, 155.56, 146.83, 130.81, 116.54
      ];
      const seq = mode === 'boss' ? bossNotes : stageNotes;
      const freq = seq[this.bgmStep % seq.length];
      this.bgmStep = (this.bgmStep + 1) % seq.length;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = mode === 'boss' ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.006, now + stepInterval * 0.85);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + stepInterval * 0.9);
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SoundSystem;
  }
  root.GradiusSTG = root.GradiusSTG || {};
  root.GradiusSTG.SoundSystem = SoundSystem;
})(typeof window !== 'undefined' ? window : globalThis);
