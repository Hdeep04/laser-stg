/**
 * @file effects.js
 * @description 爆発パーティクル・レーザースパーク・画面シェイク・ヒットストップ・ポップアップテキスト管理（仕様書 3.5節、3.8節、3.9節準拠）
 */
(function (root) {
  'use strict';

  const CONFIG = (typeof module !== 'undefined' && module.exports)
    ? require('./config.js')
    : root.GradiusSTG.CONFIG;
  const ObjectPool = (typeof module !== 'undefined' && module.exports)
    ? require('./pool.js')
    : root.GradiusSTG.ObjectPool;

  class EffectSystem {
    constructor() {
      // 1. 爆発・火花パーティクル用オブジェクトプール（GC排除）
      this.particlePool = new ObjectPool(() => ({
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        size: 2,
        hue: 0,
        sat: 100,
        light: 60,
        alpha: 1,
        life: 0,
        maxLife: 0.4,
        drag: 0.96
      }), CONFIG.EFFECTS.POOL_SIZE_PARTICLES);

      // 2. フローティングスコア・コンボポップアップ用プール
      this.textPool = new ObjectPool(() => ({
        active: false,
        x: 0,
        y: 0,
        vy: -45,
        text: '',
        color: '#fef08a',
        life: 0,
        maxLife: 0.85,
        scale: 1
      }), CONFIG.EFFECTS.POOL_SIZE_TEXTS);

      this.shakeIntensity = 0;
      this.shakeTimer = 0;
      this.shakeDuration = 0;
      this.shakeOffsetX = 0;
      this.shakeOffsetY = 0;

      this.flashAlpha = 0;
      this.flashColor = '#ffffff';
      this.flashDecay = 3.0;

      // ヒットストップ（スローモーション演出）（3.5節、TC-BS-01）
      this.hitStopTimer = 0;
      this.timeScale = 1.0;
    }

    reset() {
      this.particlePool.clear();
      this.textPool.clear();
      this.shakeIntensity = 0;
      this.shakeTimer = 0;
      this.shakeOffsetX = 0;
      this.shakeOffsetY = 0;
      this.flashAlpha = 0;
      this.hitStopTimer = 0;
      this.timeScale = 1.0;
    }

    /**
     * 敵・ボス・自機撃破時の放射状爆発パーティクル生成（3.8節）
     * HSLカラー指定により雑魚（赤）、中型（オレンジ）、ボス（青・紫）を表現
     * @param {number} x
     * @param {number} y
     * @param {'small'|'medium'|'boss'|'player'} type
     */
    spawnExplosion(x, y, type = 'small') {
      let count = 24;
      let baseHue = 8; // 雑魚：赤系
      let hueSpread = 25;
      let speedMin = 60;
      let speedMax = 240;
      let maxLife = 0.45;
      let baseSize = 3.0;

      if (type === 'medium') {
        count = 34;
        baseHue = 32; // 中型：オレンジ〜ゴールド系
        hueSpread = 28;
        speedMin = 80;
        speedMax = 320;
        maxLife = 0.65;
        baseSize = 4.2;
      } else if (type === 'boss') {
        count = 80;
        baseHue = 245; // ボス：青〜紫〜マゼンタ系
        hueSpread = 75;
        speedMin = 90;
        speedMax = 440;
        maxLife = 1.1;
        baseSize = 5.5;
      } else if (type === 'player') {
        count = 45;
        baseHue = 195; // 自機：シアン＆オレンジ
        hueSpread = 160;
        speedMin = 80;
        speedMax = 350;
        maxLife = 0.85;
        baseSize = 4.0;
      }

      for (let i = 0; i < count; i++) {
        const p = this.particlePool.acquire();
        if (!p) break;
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.35;
        const speed = speedMin + Math.random() * (speedMax - speedMin);
        p.x = x + (Math.random() - 0.5) * 8;
        p.y = y + (Math.random() - 0.5) * 8;
        p.vx = Math.cos(angle) * speed;
        p.vy = Math.sin(angle) * speed;
        p.size = baseSize * (0.6 + Math.random() * 0.8);
        p.hue = (baseHue + (Math.random() - 0.5) * hueSpread + 360) % 360;
        p.sat = 95;
        p.light = 55 + Math.random() * 35;
        p.alpha = 1.0;
        p.life = 0;
        p.maxLife = maxLife * (0.7 + Math.random() * 0.5);
        p.drag = 0.94;
      }
    }

    /**
     * 貫通レーザー着弾時の高速スパーク（火花）生成
     * @param {number} x
     * @param {number} y
     * @param {boolean} isHyper
     */
    spawnLaserSpark(x, y, isHyper = false) {
      const count = isHyper ? 4 : 2;
      for (let i = 0; i < count; i++) {
        const p = this.particlePool.acquire();
        if (!p) break;
        const angle = Math.PI + (Math.random() - 0.5) * 1.8; // 左方向を中心に跳ね返る火花
        const speed = 140 + Math.random() * 240;
        p.x = x;
        p.y = y + (Math.random() - 0.5) * 6;
        p.vx = Math.cos(angle) * speed;
        p.vy = Math.sin(angle) * speed;
        p.size = isHyper ? 3.2 : 2.4;
        p.hue = isHyper ? 295 : 195;
        p.sat = 100;
        p.light = 75;
        p.alpha = 1.0;
        p.life = 0;
        p.maxLife = 0.16 + Math.random() * 0.1;
        p.drag = 0.9;
      }
    }

    /**
     * ポップアップテキスト（スコア・コンボ・ボーナス表示）の生成（3.9節）
     */
    spawnPopupText(x, y, text, color = '#fef08a', scale = 1.0) {
      const t = this.textPool.acquire();
      if (!t) return;
      t.x = Math.max(40, Math.min(CONFIG.SCREEN.WIDTH - 40, x));
      t.y = Math.max(CONFIG.SCREEN.PLAY_TOP + 20, Math.min(CONFIG.SCREEN.PLAY_BOTTOM - 20, y));
      t.vy = -48;
      t.text = text;
      t.color = color;
      t.life = 0;
      t.maxLife = 0.85;
      t.scale = scale;
    }

    /**
     * 画面シェイクを発動（3.8節）
     * @param {number} intensity 最大揺れ幅 (px)
     * @param {number} duration 持続秒数
     */
    triggerShake(intensity = 8, duration = 0.3) {
      this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
      this.shakeDuration = Math.max(this.shakeDuration, duration);
      this.shakeTimer = Math.max(this.shakeTimer, duration);
    }

    /**
     * 画面フラッシュ演出を発動
     */
    triggerFlash(color = '#ffffff', alpha = 0.65, decay = 2.5) {
      this.flashColor = color;
      this.flashAlpha = alpha;
      this.flashDecay = decay;
    }

    /**
     * ボス撃破時などのヒットストップ（スローモーション）を発動（3.5節、TC-BS-01）
     * @param {number} duration 実時間での持続秒数（例: 0.42秒）
     * @param {number} scale 時間減衰率（例: 0.1 = 1/10速度）
     */
    triggerHitStop(duration = CONFIG.ENEMY.BOSS.HITSTOP_DURATION, scale = CONFIG.ENEMY.BOSS.HITSTOP_TIMESCALE) {
      this.hitStopTimer = duration;
      this.timeScale = scale;
    }

    /**
     * 実フレーム経過時間 rawDt を受け取り、ヒットストップ補正後の実効 dt を返すとともにエフェクトを更新する
     * @param {number} rawDt
     * @returns {number} ゲームロジック用の実効 dt
     */
    update(rawDt) {
      // ヒットストップ（スローモーション）タイマーは実時間で進行
      if (this.hitStopTimer > 0) {
        this.hitStopTimer -= rawDt;
        if (this.hitStopTimer <= 0) {
          this.hitStopTimer = 0;
          this.timeScale = 1.0;
        }
      } else {
        this.timeScale = 1.0;
      }

      const effectiveDt = rawDt * this.timeScale;

      // 画面シェイクの更新（実時間で振動減衰）
      if (this.shakeTimer > 0) {
        this.shakeTimer = Math.max(0, this.shakeTimer - rawDt);
        const ratio = this.shakeDuration > 0 ? (this.shakeTimer / this.shakeDuration) : 0;
        const currentMag = this.shakeIntensity * ratio;
        this.shakeOffsetX = (Math.random() * 2 - 1) * currentMag;
        this.shakeOffsetY = (Math.random() * 2 - 1) * currentMag;
        if (this.shakeTimer <= 0) {
          this.shakeIntensity = 0;
          this.shakeOffsetX = 0;
          this.shakeOffsetY = 0;
        }
      } else {
        this.shakeOffsetX = 0;
        this.shakeOffsetY = 0;
      }

      // 画面フラッシュの減衰
      if (this.flashAlpha > 0) {
        this.flashAlpha = Math.max(0, this.flashAlpha - this.flashDecay * rawDt);
      }

      // パーティクルはスローモーション中も少し動くよう中間dtで更新して重厚感を出す
      const particleDt = rawDt * (0.35 + 0.65 * this.timeScale);
      this.particlePool.forEachActive((p) => {
        p.life += particleDt;
        if (p.life >= p.maxLife) {
          this.particlePool.release(p);
          return;
        }
        p.x += p.vx * particleDt;
        p.y += p.vy * particleDt;
        p.vx *= p.drag;
        p.vy *= p.drag;
        p.alpha = 1.0 - (p.life / p.maxLife);
      });

      // ポップアップテキスト更新
      this.textPool.forEachActive((t) => {
        t.life += rawDt;
        if (t.life >= t.maxLife) {
          this.textPool.release(t);
          return;
        }
        t.y += t.vy * rawDt;
      });

      return effectiveDt;
    }

    /**
     * パーティクル・ポップアップテキスト・画面フラッシュの描画
     * @param {CanvasRenderingContext2D} ctx
     */
    render(ctx) {
      ctx.save();

      // 1. 爆発・火花パーティクル描画（HSLカラー）
      this.particlePool.forEachActive((p) => {
        ctx.fillStyle = `hsla(${p.hue | 0}, ${p.sat}%, ${p.light | 0}%, ${p.alpha.toFixed(2)})`;
        ctx.fillRect(p.x - p.size * 0.5, p.y - p.size * 0.5, p.size, p.size);
      });

      // 2. フローティングテキスト描画
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      this.textPool.forEachActive((t) => {
        const alpha = Math.max(0, 1 - (t.life / t.maxLife));
        ctx.globalAlpha = alpha;
        const fontSize = Math.round(13 * t.scale);
        ctx.font = `bold ${fontSize}px "Orbitron", "Courier New", monospace`;
        ctx.fillStyle = '#000000';
        ctx.fillText(t.text, t.x + 1, t.y + 1);
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, t.x, t.y);
      });
      ctx.globalAlpha = 1.0;

      // 3. 全画面フラッシュオーバーレイ描画
      if (this.flashAlpha > 0.01) {
        ctx.fillStyle = this.flashColor;
        ctx.globalAlpha = this.flashAlpha;
        ctx.fillRect(0, 0, CONFIG.SCREEN.WIDTH, CONFIG.SCREEN.HEIGHT);
        ctx.globalAlpha = 1.0;
      }

      ctx.restore();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = EffectSystem;
  }
  root.GradiusSTG = root.GradiusSTG || {};
  root.GradiusSTG.EffectSystem = EffectSystem;
})(typeof window !== 'undefined' ? window : globalThis);
