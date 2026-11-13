/**
 * @file terrain.js
 * @description 3層パララックス星空背景および安全通路幅保証付きプロシージャル地形生成・線形補間高度計算（仕様書 3.6節、3.7節準拠）
 */
(function (root) {
  'use strict';

  const CONFIG = (typeof module !== 'undefined' && module.exports)
    ? require('./config.js')
    : root.GradiusSTG.CONFIG;

  class TerrainSystem {
    constructor() {
      this.segWidth = CONFIG.TERRAIN.SEGMENT_WIDTH;
      this.numSegments = Math.ceil(CONFIG.SCREEN.WIDTH / this.segWidth) + 3;
      this.segments = new Array(this.numSegments);
      for (let i = 0; i < this.numSegments; i++) {
        this.segments[i] = { x: i * this.segWidth, topHeight: 0, bottomHeight: 0, hasCrystal: false };
      }

      // 3層パララックス星配列の事前確保（GC防止）
      this.stars = new Array(CONFIG.TERRAIN.STAR_COUNT);
      for (let i = 0; i < CONFIG.TERRAIN.STAR_COUNT; i++) {
        const layer = i % 3; // 0: 遠景(遅・暗), 1: 中景(標準), 2: 近景(速・明)
        this.stars[i] = {
          x: Math.random() * CONFIG.SCREEN.WIDTH,
          y: CONFIG.SCREEN.PLAY_TOP + Math.random() * (CONFIG.SCREEN.PLAY_BOTTOM - CONFIG.SCREEN.PLAY_TOP),
          layer: layer,
          speed: layer === 0 ? 35 : (layer === 1 ? 85 : 175),
          size: layer === 0 ? 1.2 : (layer === 1 ? 1.8 : 2.6),
          color: layer === 0 ? '#4a5a80' : (layer === 1 ? '#8ab4f8' : '#ffffff'),
          twinklePhase: Math.random() * Math.PI * 2
        };
      }

      this.scrollDistance = 0;
      this.stageTime = 0;
      this.cavernActive = false;
      this.forceCavern = false;
      this.currentGenTop = 0;
      this.currentGenBottom = 0;
      this.segmentCounter = 0;
      this.onSegmentGenerated = null;
      this.reset();
    }

    reset() {
      this.scrollDistance = 0;
      this.stageTime = 0;
      this.cavernActive = false;
      this.forceCavern = false;
      this.currentGenTop = 0;
      this.currentGenBottom = 0;
      this.segmentCounter = 0;

      for (let i = 0; i < this.numSegments; i++) {
        this.segments[i].x = i * this.segWidth;
        this.segments[i].topHeight = 0;
        this.segments[i].bottomHeight = 0;
        this.segments[i].hasCrystal = false;
      }
    }

    /**
     * 洞窟・要塞地形生成モードの有効/無効を設定する
     * @param {boolean} active
     * @param {boolean} immediate 即座に壁を隆起させるか（テスト用）
     */
    setCavernMode(active, immediate = false) {
      this.forceCavern = active;
      this.cavernActive = active;
      if (immediate && active) {
        this.currentGenTop = 75;
        this.currentGenBottom = 85;
        for (let i = 0; i < this.numSegments; i++) {
          this.segments[i].topHeight = 75 + Math.sin(i * 0.4) * 20;
          this.segments[i].bottomHeight = 85 + Math.cos(i * 0.35) * 22;
        }
      }
    }

    /**
     * 毎ティック更新処理
     * @param {number} dt
     * @param {boolean} bossActive ボス戦中は地形を平坦退避させる
     */
    update(dt, bossActive = false) {
      const scrollDelta = CONFIG.TERRAIN.SCROLL_SPEED * dt;
      this.scrollDistance += scrollDelta;
      this.stageTime += dt;

      // ステージ進行に応じた地形フェーズ切り替え（12秒〜48秒の間は洞窟・要塞エリア）
      if (!this.forceCavern) {
        const cycleTime = this.stageTime % 60;
        this.cavernActive = !bossActive && (cycleTime >= 10 && cycleTime <= 46);
      } else if (bossActive) {
        this.cavernActive = false;
      }

      // 3層パララックス星のスクロール更新
      const playHeight = CONFIG.SCREEN.PLAY_BOTTOM - CONFIG.SCREEN.PLAY_TOP;
      for (let i = 0; i < this.stars.length; i++) {
        const s = this.stars[i];
        s.x -= s.speed * dt;
        s.twinklePhase += dt * 4;
        if (s.x < 0) {
          s.x += CONFIG.SCREEN.WIDTH;
          s.y = CONFIG.SCREEN.PLAY_TOP + Math.random() * playHeight;
        }
      }

      // 地形セグメントの左スクロール更新
      for (let i = 0; i < this.numSegments; i++) {
        this.segments[i].x -= scrollDelta;
      }

      // 左端から画面外に出たセグメントを右端へ循環再利用（GCゼロ）
      while (this.segments[0].x <= -this.segWidth) {
        const recycled = this.segments.shift();
        const lastSeg = this.segments[this.segments.length - 1];
        recycled.x = lastSeg.x + this.segWidth;
        this._generateNextSegmentHeights(recycled);
        this.segments.push(recycled);
      }
    }

    /**
     * 次の地形セグメントの上下壁高さを生成（安全通路幅 MIN_GAP を厳守）
     * @private
     */
    _generateNextSegmentHeights(seg) {
      this.segmentCounter++;
      const maxH = CONFIG.TERRAIN.MAX_WALL_HEIGHT;
      const maxDelta = CONFIG.TERRAIN.MAX_DELTA_HEIGHT;
      const playAreaHeight = CONFIG.SCREEN.PLAY_BOTTOM - CONFIG.SCREEN.PLAY_TOP;

      if (this.cavernActive) {
        // 目標ベース高さへ向かってランダムウォーク＋うねり
        const targetTop = 65 + Math.sin(this.segmentCounter * 0.14) * 38;
        const targetBottom = 72 + Math.cos(this.segmentCounter * 0.11) * 42;

        const deltaTop = Math.max(-maxDelta, Math.min(maxDelta, (targetTop - this.currentGenTop) * 0.35 + (Math.random() * 2 - 1) * maxDelta));
        const deltaBottom = Math.max(-maxDelta, Math.min(maxDelta, (targetBottom - this.currentGenBottom) * 0.35 + (Math.random() * 2 - 1) * maxDelta));

        this.currentGenTop = Math.max(16, Math.min(maxH, this.currentGenTop + deltaTop));
        this.currentGenBottom = Math.max(16, Math.min(maxH, this.currentGenBottom + deltaBottom));

        // 最低安全通路幅（MIN_GAP = 220px）ガードレール
        const currentGap = playAreaHeight - (this.currentGenTop + this.currentGenBottom);
        if (currentGap < CONFIG.TERRAIN.MIN_GAP) {
          const excess = CONFIG.TERRAIN.MIN_GAP - currentGap;
          this.currentGenTop = Math.max(16, this.currentGenTop - excess * 0.5);
          this.currentGenBottom = Math.max(16, this.currentGenBottom - excess * 0.5);
        }
        seg.hasCrystal = (this.segmentCounter % 7 === 0);
      } else {
        // 宇宙エリアまたはボスエリア：滑らかに壁高さを0へ退避
        this.currentGenTop = Math.max(0, this.currentGenTop - 4.5);
        this.currentGenBottom = Math.max(0, this.currentGenBottom - 4.5);
        seg.hasCrystal = false;
      }

      seg.topHeight = this.currentGenTop;
      seg.bottomHeight = this.currentGenBottom;

      if (this.onSegmentGenerated && seg.bottomHeight > 25) {
        this.onSegmentGenerated(seg, this.segmentCounter);
      }
    }

    /**
     * 指定X座標における天井（上部地形）の下端Y座標を線形補間で算出する（3.6節）
     * @param {number} x
     * @returns {number} 天井の境界Y座標（PLAY_TOP + 補間された壁高さ）
     */
    getTerrainTopAt(x) {
      const segs = this.segments;
      const len = segs.length;
      for (let i = 0; i < len - 1; i++) {
        const s0 = segs[i];
        const s1 = segs[i + 1];
        if (x >= s0.x && x <= s1.x) {
          const t = (x - s0.x) / (s1.x - s0.x || 1);
          const h = s0.topHeight + (s1.topHeight - s0.topHeight) * t;
          return CONFIG.SCREEN.PLAY_TOP + h;
        }
      }
      return CONFIG.SCREEN.PLAY_TOP + (segs[0] ? segs[0].topHeight : 0);
    }

    /**
     * 指定X座標における地面（下部地形）の上端Y座標を線形補間で算出する（3.6節）
     * @param {number} x
     * @returns {number} 地面の境界Y座標（PLAY_BOTTOM - 補間された壁高さ）
     */
    getTerrainBottomAt(x) {
      const segs = this.segments;
      const len = segs.length;
      for (let i = 0; i < len - 1; i++) {
        const s0 = segs[i];
        const s1 = segs[i + 1];
        if (x >= s0.x && x <= s1.x) {
          const t = (x - s0.x) / (s1.x - s0.x || 1);
          const h = s0.bottomHeight + (s1.bottomHeight - s0.bottomHeight) * t;
          return CONFIG.SCREEN.PLAY_BOTTOM - h;
        }
      }
      return CONFIG.SCREEN.PLAY_BOTTOM - (segs[0] ? segs[0].bottomHeight : 0);
    }

    /**
     * 背景およびプロシージャル地形の描画
     * @param {CanvasRenderingContext2D} ctx
     */
    render(ctx) {
      // 1. パララックス3層星空の描画
      for (let i = 0; i < this.stars.length; i++) {
        const s = this.stars[i];
        ctx.fillStyle = s.color;
        const alpha = s.layer === 2 ? (0.75 + 0.25 * Math.sin(s.twinklePhase)) : 0.85;
        ctx.globalAlpha = alpha;
        ctx.fillRect(s.x, s.y, s.size, s.size);
      }
      ctx.globalAlpha = 1.0;

      // 地形が存在しない場合はスキップ
      let hasAnyWall = false;
      for (let i = 0; i < this.numSegments; i++) {
        if (this.segments[i].topHeight > 0.5 || this.segments[i].bottomHeight > 0.5) {
          hasAnyWall = true;
          break;
        }
      }
      if (!hasAnyWall) return;

      // 2. 上部地形（天井）ポリゴン描画
      ctx.save();
      const topGrad = ctx.createLinearGradient(0, CONFIG.SCREEN.PLAY_TOP, 0, CONFIG.SCREEN.PLAY_TOP + 140);
      topGrad.addColorStop(0, '#0f172a');
      topGrad.addColorStop(0.7, '#1e3a5f');
      topGrad.addColorStop(1, '#38bdf8');

      ctx.fillStyle = topGrad;
      ctx.beginPath();
      ctx.moveTo(this.segments[0].x, CONFIG.SCREEN.PLAY_TOP);
      for (let i = 0; i < this.numSegments; i++) {
        const seg = this.segments[i];
        ctx.lineTo(seg.x, CONFIG.SCREEN.PLAY_TOP + seg.topHeight);
      }
      ctx.lineTo(this.segments[this.numSegments - 1].x, CONFIG.SCREEN.PLAY_TOP);
      ctx.closePath();
      ctx.fill();

      // 天井のエッジ発光ライン
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < this.numSegments; i++) {
        const seg = this.segments[i];
        const y = CONFIG.SCREEN.PLAY_TOP + seg.topHeight;
        if (i === 0) ctx.moveTo(seg.x, y);
        else ctx.lineTo(seg.x, y);
      }
      ctx.stroke();

      // 3. 下部地形（地面）ポリゴン描画
      const botGrad = ctx.createLinearGradient(0, CONFIG.SCREEN.PLAY_BOTTOM, 0, CONFIG.SCREEN.PLAY_BOTTOM - 140);
      botGrad.addColorStop(0, '#0f172a');
      botGrad.addColorStop(0.7, '#1e3a5f');
      botGrad.addColorStop(1, '#38bdf8');

      ctx.fillStyle = botGrad;
      ctx.beginPath();
      ctx.moveTo(this.segments[0].x, CONFIG.SCREEN.PLAY_BOTTOM);
      for (let i = 0; i < this.numSegments; i++) {
        const seg = this.segments[i];
        ctx.lineTo(seg.x, CONFIG.SCREEN.PLAY_BOTTOM - seg.bottomHeight);
      }
      ctx.lineTo(this.segments[this.numSegments - 1].x, CONFIG.SCREEN.PLAY_BOTTOM);
      ctx.closePath();
      ctx.fill();

      // 地面のエッジ発光ライン
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < this.numSegments; i++) {
        const seg = this.segments[i];
        const y = CONFIG.SCREEN.PLAY_BOTTOM - seg.bottomHeight;
        if (i === 0) ctx.moveTo(seg.x, y);
        else ctx.lineTo(seg.x, y);
      }
      ctx.stroke();

      // 要塞リブ（構造柱）のディテール描画
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.22)';
      ctx.lineWidth = 1;
      for (let i = 0; i < this.numSegments; i++) {
        const seg = this.segments[i];
        if (seg.topHeight > 4) {
          ctx.beginPath();
          ctx.moveTo(seg.x, CONFIG.SCREEN.PLAY_TOP);
          ctx.lineTo(seg.x, CONFIG.SCREEN.PLAY_TOP + seg.topHeight);
          ctx.stroke();
        }
        if (seg.bottomHeight > 4) {
          ctx.beginPath();
          ctx.moveTo(seg.x, CONFIG.SCREEN.PLAY_BOTTOM);
          ctx.lineTo(seg.x, CONFIG.SCREEN.PLAY_BOTTOM - seg.bottomHeight);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TerrainSystem;
  }
  root.GradiusSTG = root.GradiusSTG || {};
  root.GradiusSTG.TerrainSystem = TerrainSystem;
})(typeof window !== 'undefined' ? window : globalThis);
