/**
 * @file player.js
 * @description プレイヤーコントローラーおよびオプション追従システム（リングバッファ・停止時陣形維持）（仕様書 3.1節、3.3節準拠）
 */
(function (root) {
  'use strict';

  const CONFIG = (typeof module !== 'undefined' && module.exports)
    ? require('./config.js')
    : root.GradiusSTG.CONFIG;

  /**
   * オプション追従システム（3.3節）
   * 自機の移動座標履歴を固定長リングバッファで保持し、15/30/45/60ステップ遅延で追従する。
   * 自機停止時は履歴更新を止め、オプションの展開陣形を維持する。
   */
  class OptionSystem {
    constructor() {
      this.maxCount = CONFIG.OPTION.MAX_COUNT;
      this.stepDelay = CONFIG.OPTION.STEP_DELAY;
      this.bufferSize = CONFIG.OPTION.BUFFER_SIZE;
      this.historyX = new Float64Array(this.bufferSize);
      this.historyY = new Float64Array(this.bufferSize);
      this.head = 0;
      this.activeCount = 0;
      this.animPhase = 0;

      // 各オプションの現在座標キャッシュ（事前確保）
      this.options = new Array(this.maxCount);
      for (let i = 0; i < this.maxCount; i++) {
        this.options[i] = { x: CONFIG.PLAYER.INITIAL_X, y: CONFIG.PLAYER.INITIAL_Y, index: i };
      }
      this.reset(CONFIG.PLAYER.INITIAL_X, CONFIG.PLAYER.INITIAL_Y);
    }

    /**
     * 履歴バッファとオプション状態を初期座標でリセットする
     * @param {number} startX
     * @param {number} startY
     */
    reset(startX, startY) {
      this.head = 0;
      this.activeCount = 0;
      for (let i = 0; i < this.bufferSize; i++) {
        this.historyX[i] = startX;
        this.historyY[i] = startY;
      }
      for (let i = 0; i < this.maxCount; i++) {
        this.options[i].x = startX;
        this.options[i].y = startY;
      }
    }

    /**
     * オプションを1機追加する（最大4機）
     * @returns {boolean} 追加できたかどうか
     */
    addOption() {
      if (this.activeCount >= this.maxCount) return false;
      this.activeCount++;
      this._syncOptionPositions();
      return true;
    }

    /**
     * 自機の座標履歴を更新する（自機が実際に移動したフレームのみ記録）
     * @param {number} playerX
     * @param {number} playerY
     * @param {boolean} didMove
     * @param {number} dt
     */
    update(playerX, playerY, didMove, dt = CONFIG.SCREEN.FIXED_DT) {
      this.animPhase += dt * 7.5;

      if (didMove) {
        this.head = (this.head + 1) % this.bufferSize;
        this.historyX[this.head] = playerX;
        this.historyY[this.head] = playerY;
      }

      this._syncOptionPositions();
    }

    /**
     * リングバッファから k * stepDelay 前の座標を取得して各オプションに設定する
     * @private
     */
    _syncOptionPositions() {
      for (let i = 0; i < this.activeCount; i++) {
        const delaySteps = (i + 1) * this.stepDelay;
        const idx = (this.head - delaySteps + this.bufferSize * 4) % this.bufferSize;
        this.options[i].x = this.historyX[idx];
        this.options[i].y = this.historyY[idx];
      }
    }

    /**
     * 現在有効なオプション配列スライスを参照用に返す（新規配列生成を避けるため内部配列とカウントを利用可能）
     * @param {Function} callback
     */
    forEachActiveOption(callback) {
      for (let i = 0; i < this.activeCount; i++) {
        callback(this.options[i], i);
      }
    }

    /**
     * オプション（発光プラズマ子機）の描画
     * @param {CanvasRenderingContext2D} ctx
     */
    render(ctx) {
      if (this.activeCount === 0) return;
      ctx.save();
      for (let i = 0; i < this.activeCount; i++) {
        const opt = this.options[i];
        const pulse = 1 + 0.14 * Math.sin(this.animPhase + i * 1.1);
        const rx = (CONFIG.OPTION.WIDTH * 0.5) * pulse;
        const ry = (CONFIG.OPTION.HEIGHT * 0.5) * pulse;

        // 外周オレンジグロー
        ctx.fillStyle = 'rgba(249, 115, 22, 0.35)';
        ctx.beginPath();
        ctx.ellipse(opt.x, opt.y, rx * 1.45, ry * 1.45, 0, 0, Math.PI * 2);
        ctx.fill();

        // 本体コア（グラディウス伝統のオレンジ発光楕円）
        ctx.fillStyle = '#fb923c';
        ctx.beginPath();
        ctx.ellipse(opt.x, opt.y, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();

        // 中心ハイライト
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.ellipse(opt.x + 2, opt.y - 1, rx * 0.5, ry * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /**
   * プレイヤーコントローラー（3.1節）
   */
  class PlayerController {
    /**
     * @param {OptionSystem} optionSystem
     */
    constructor(optionSystem) {
      this.optionSystem = optionSystem || new OptionSystem();
      this.width = CONFIG.PLAYER.WIDTH;
      this.height = CONFIG.PLAYER.HEIGHT;
      this.hitboxRadius = CONFIG.PLAYER.HITBOX_RADIUS;
      this.grazeRadius = CONFIG.PLAYER.GRAZE_RADIUS;
      this.resetAll();
    }

    /**
     * 新規ゲーム開始時の完全初期化
     */
    resetAll() {
      this.x = CONFIG.PLAYER.INITIAL_X;
      this.y = CONFIG.PLAYER.INITIAL_Y;
      this.lives = CONFIG.PLAYER.INITIAL_LIVES;
      this.alive = true;
      this.respawnTimer = 0;
      this.invincibleFrames = 120; // 開始直後も短い保護を付与
      this.tiltAngle = 0;
      this.thrusterPhase = 0;

      // パワーアップ段階状態
      this.speedLevel = 0;   // 0..5
      this.missileLevel = 0; // 0..2
      this.doubleLevel = 0;  // 0..2 (laserLevel と排他)
      this.laserLevel = 0;   // 0..2 (doubleLevel と排他)
      this.shieldHp = 0;     // 0..5
      this.shieldMaxHp = CONFIG.WEAPON.SHIELD.MAX_HP_LV1;

      this.optionSystem.reset(this.x, this.y);
    }

    /**
     * 現在の移動速度 (px/s) を取得
     */
    getSpeed() {
      return CONFIG.PLAYER.BASE_SPEED + this.speedLevel * CONFIG.PLAYER.SPEED_INCREMENT;
    }

    /**
     * 毎フレーム移動・状態更新処理
     * @param {Object} input { left, right, up, down }
     * @param {number} dt
     */
    update(input, dt = CONFIG.SCREEN.FIXED_DT) {
      this.thrusterPhase += dt * 30;

      if (!this.alive) {
        if (this.respawnTimer > 0) {
          this.respawnTimer--;
          if (this.respawnTimer <= 0) {
            this._completeRespawn();
          }
        }
        return;
      }

      if (this.invincibleFrames > 0) {
        this.invincibleFrames--;
      }

      let dx = 0;
      let dy = 0;
      if (input.left) dx -= 1;
      if (input.right) dx += 1;
      if (input.up) dy -= 1;
      if (input.down) dy += 1;

      // 斜め移動時のベクトル正規化（1.4節、3.1節）
      if (dx !== 0 && dy !== 0) {
        dx *= Math.SQRT1_2;
        dy *= Math.SQRT1_2;
      }

      const prevX = this.x;
      const prevY = this.y;
      const speed = this.getSpeed();

      this.x += dx * speed * dt;
      this.y += dy * speed * dt;

      // プレイ領域境界クランプ（3.1節、TC-PL-01）
      const minX = CONFIG.PLAYER.CLAMP_MARGIN_X;
      const maxX = CONFIG.SCREEN.WIDTH - CONFIG.PLAYER.CLAMP_MARGIN_X;
      const minY = CONFIG.SCREEN.PLAY_TOP + CONFIG.PLAYER.CLAMP_MARGIN_Y;
      const maxY = CONFIG.SCREEN.PLAY_BOTTOM - CONFIG.PLAYER.CLAMP_MARGIN_Y;

      if (this.x < minX) this.x = minX;
      if (this.x > maxX) this.x = maxX;
      if (this.y < minY) this.y = minY;
      if (this.y > maxY) this.y = maxY;

      // 移動傾き（ローテーション補正）更新
      let targetTilt = 0;
      if (dy < 0) targetTilt = -CONFIG.PLAYER.MAX_TILT_ANGLE;
      else if (dy > 0) targetTilt = CONFIG.PLAYER.MAX_TILT_ANGLE;
      else if (dx > 0) targetTilt = 0.06;
      else if (dx < 0) targetTilt = -0.06;
      this.tiltAngle += (targetTilt - this.tiltAngle) * 0.25;

      // 実際に座標が変化したかどうかを判定し、オプション履歴を更新（3.3節、TC-OP-01）
      const moved = (Math.abs(this.x - prevX) > 0.001 || Math.abs(this.y - prevY) > 0.001);
      this.optionSystem.update(this.x, this.y, moved, dt);
    }

    /**
     * シールドの当たり判定矩形を取得（シールド有効時のみ）
     * @returns {Object|null} { x, y, width, height }
     */
    getShieldBounds() {
      if (!this.alive || this.shieldHp <= 0) return null;
      return {
        x: this.x + CONFIG.WEAPON.SHIELD.OFFSET_X,
        y: this.y,
        width: CONFIG.WEAPON.SHIELD.WIDTH,
        height: CONFIG.WEAPON.SHIELD.HEIGHT
      };
    }

    /**
     * シールドがダメージを吸収する
     * @param {number} amount
     * @returns {boolean} シールドで防いだ場合 true
     */
    damageShield(amount = 1) {
      if (this.shieldHp <= 0) return false;
      this.shieldHp = Math.max(0, this.shieldHp - amount);
      // シールド被弾時に短い無敵フレーム（6フレーム）を付与して多段蒸発を防ぐ
      this.invincibleFrames = Math.max(this.invincibleFrames, 6);
      return true;
    }

    /**
     * 被弾・ミス処理（3.1節、TC-PL-02）
     * 全装備を初期化し、残機を1減らし、持っていたオプション数に応じてリカバリー用赤カプセル放出数を返す
     * @param {boolean} forceKill 無敵状態を無視するか（テスト用）
     * @returns {{ died: boolean, gameOver: boolean, droppedCapsules: number, deathX: number, deathY: number }}
     */
    kill(forceKill = false) {
      if (!this.alive) {
        return { died: false, gameOver: false, droppedCapsules: 0, deathX: this.x, deathY: this.y };
      }
      if (!forceKill && this.invincibleFrames > 0) {
        return { died: false, gameOver: false, droppedCapsules: 0, deathX: this.x, deathY: this.y };
      }

      const deathX = this.x;
      const deathY = this.y;
      const prevOptions = this.optionSystem.activeCount;
      const droppedCapsules = Math.min(2, prevOptions);

      this.lives = Math.max(0, this.lives - 1);
      this.alive = false;
      this.respawnTimer = CONFIG.PLAYER.RESPAWN_DELAY_FRAMES;

      // 装着していた全パワーアップ装備を剥奪（初期化）（3.1節、TC-PL-02）
      this.speedLevel = 0;
      this.missileLevel = 0;
      this.doubleLevel = 0;
      this.laserLevel = 0;
      this.shieldHp = 0;
      this.optionSystem.reset(CONFIG.PLAYER.INITIAL_X, CONFIG.PLAYER.INITIAL_Y);

      const gameOver = this.lives <= 0;
      return {
        died: true,
        gameOver: gameOver,
        droppedCapsules: droppedCapsules,
        deathX: deathX,
        deathY: deathY
      };
    }

    /**
     * リスポーン完了処理（即座に初期座標へ復帰したいテスト等からも呼べるよう公開）
     */
    _completeRespawn() {
      if (this.lives <= 0) return;
      this.x = CONFIG.PLAYER.INITIAL_X;
      this.y = CONFIG.PLAYER.INITIAL_Y;
      this.alive = true;
      this.respawnTimer = 0;
      this.invincibleFrames = CONFIG.PLAYER.INVINCIBLE_FRAMES;
      this.tiltAngle = 0;
      this.optionSystem.reset(this.x, this.y);
    }

    /**
     * 自機・スラスター・シールド・オプションの描画
     * @param {CanvasRenderingContext2D} ctx
     */
    render(ctx) {
      // オプションを先に描画
      if (this.alive) {
        this.optionSystem.render(ctx);
      }

      if (!this.alive) return;

      // 無敵時間中の高速点滅処理
      if (this.invincibleFrames > 0 && (Math.floor(this.invincibleFrames / 3) % 2 === 1)) {
        ctx.save();
        ctx.globalAlpha = 0.38;
        this._drawVicViper(ctx);
        ctx.restore();
      } else {
        this._drawVicViper(ctx);
      }

      // 前方エネルギーシールド描画
      if (this.shieldHp > 0) {
        this._drawShield(ctx);
      }
    }

    /**
     * 超時空戦闘機ビックバイパー風ベクタースプライト描画
     * @private
     */
    _drawVicViper(ctx) {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.tiltAngle);

      // 1. 後部アフターバーナー（スラスター炎）
      const flameLen = 10 + (this.speedLevel * 2.5) + Math.sin(this.thrusterPhase) * 4;
      const flameGrad = ctx.createLinearGradient(-16 - flameLen, 0, -14, 0);
      flameGrad.addColorStop(0, 'rgba(56, 189, 248, 0)');
      flameGrad.addColorStop(0.5, '#38bdf8');
      flameGrad.addColorStop(1, '#fef08a');
      ctx.fillStyle = flameGrad;
      ctx.beginPath();
      ctx.moveTo(-14, -4);
      ctx.lineTo(-16 - flameLen, 0);
      ctx.lineTo(-14, 4);
      ctx.closePath();
      ctx.fill();

      // 2. 主翼＆尾部フィン（ダークブルー＆レッドストライプ）
      ctx.fillStyle = '#cbd5e1';
      ctx.beginPath();
      ctx.moveTo(-16, -9);
      ctx.lineTo(-4, -9);
      ctx.lineTo(10, -3);
      ctx.lineTo(18, -2); // 上側フロントプロング（二股先端）
      ctx.lineTo(6, -1);
      ctx.lineTo(6, 1);
      ctx.lineTo(18, 2);  // 下側フロントプロング（二股先端）
      ctx.lineTo(10, 3);
      ctx.lineTo(-4, 9);
      ctx.lineTo(-16, 9);
      ctx.lineTo(-12, 0);
      ctx.closePath();
      ctx.fill();

      // 赤いアクセントライン（ビックバイパー伝統の紅白カラー）
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.moveTo(-14, -6);
      ctx.lineTo(4, -3);
      ctx.lineTo(4, 3);
      ctx.lineTo(-14, 6);
      ctx.closePath();
      ctx.fill();

      // 3. 中央機体フレーム（ホワイトシルバー）
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.moveTo(-15, -3);
      ctx.lineTo(18, -1.5);
      ctx.lineTo(18, 1.5);
      ctx.lineTo(-15, 3);
      ctx.closePath();
      ctx.fill();

      // 4. ブルーキャノピー（コックピット）
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.ellipse(-1, 0, 6, 2.6, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    /**
     * 前方シールドの描画（耐久値に応じて青→黄→赤へ変化）
     * @private
     */
    _drawShield(ctx) {
      const bounds = this.getShieldBounds();
      if (!bounds) return;

      ctx.save();
      let color = '#38bdf8';
      let glow = 'rgba(56, 189, 248, 0.35)';
      if (this.shieldHp === 2) {
        color = '#facc15';
        glow = 'rgba(250, 204, 21, 0.35)';
      } else if (this.shieldHp === 1) {
        color = '#f87171';
        glow = 'rgba(248, 113, 113, 0.4)';
      }

      // 外周バリアオーラ
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.ellipse(bounds.x, bounds.y, bounds.width * 0.85, bounds.height * 0.58, 0, -Math.PI * 0.55, Math.PI * 0.55);
      ctx.fill();

      // バリア結晶コア（上下2基のシールド発生体＋アーク）
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(bounds.x - 4, bounds.y, bounds.height * 0.48, -Math.PI * 0.42, Math.PI * 0.42);
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(bounds.x - 3, bounds.y - bounds.height * 0.42, 5, 5);
      ctx.fillRect(bounds.x - 3, bounds.y + bounds.height * 0.42 - 5, 5, 5);
      ctx.restore();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PlayerController, OptionSystem };
  }
  root.GradiusSTG = root.GradiusSTG || {};
  root.GradiusSTG.OptionSystem = OptionSystem;
  root.GradiusSTG.PlayerController = PlayerController;
})(typeof window !== 'undefined' ? window : globalThis);
