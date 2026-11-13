/**
 * @file game.js
 * @description ゲームステートマネージャー（メインループ・固定タイムステップ・入力統合・全コンポーネント統括）（仕様書 2.1節、3.9節、4節準拠）
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const CONFIG = isNode ? require('./config.js') : root.GradiusSTG.CONFIG;
  const SoundSystem = isNode ? require('./audio.js') : root.GradiusSTG.SoundSystem;
  const TerrainSystem = isNode ? require('./terrain.js') : root.GradiusSTG.TerrainSystem;
  const { PlayerController, OptionSystem } = isNode ? require('./player.js') : root.GradiusSTG;
  const WeaponSystem = isNode ? require('./weapons.js') : root.GradiusSTG.WeaponSystem;
  const EnemySystem = isNode ? require('./enemies.js') : root.GradiusSTG.EnemySystem;
  const CollisionSystem = isNode ? require('./collision.js') : root.GradiusSTG.CollisionSystem;
  const EffectSystem = isNode ? require('./effects.js') : root.GradiusSTG.EffectSystem;
  const { PowerUpGauge, UISystem } = isNode ? require('./ui.js') : root.GradiusSTG;

  class GameStateManager {
    /**
     * @param {HTMLCanvasElement|null} canvas
     */
    constructor(canvas = null) {
      this.canvas = canvas;
      this.ctx = canvas ? canvas.getContext('2d') : null;

      // 9大コンポーネントの初期化
      this.sound = new SoundSystem();
      this.terrain = new TerrainSystem();
      this.optionSystem = new OptionSystem();
      this.player = new PlayerController(this.optionSystem);
      this.weapons = new WeaponSystem();
      this.enemies = new EnemySystem();
      this.collision = new CollisionSystem();
      this.effects = new EffectSystem();
      this.gauge = new PowerUpGauge();
      this.ui = new UISystem();

      // ゲーム状態 ('TITLE' | 'PLAYING' | 'PAUSED' | 'GAMEOVER')
      this.state = 'TITLE';
      this.score = 0;
      this.highScore = 50000;
      this.comboCount = 0;
      this.comboTimer = 0;

      // 入力状態フラグ
      this.input = {
        left: false,
        right: false,
        up: false,
        down: false,
        fire: false,
        powerUp: false
      };

      // 固定タイムステップ管理用
      this.lastFrameTime = 0;
      this.accumulator = 0;
      this.fps = 60;
      this.rafId = null;

      this._loadHighScore();
      if (typeof window !== 'undefined' && canvas) {
        this._bindInputEvents();
      }
    }

    _loadHighScore() {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          const saved = parseInt(window.localStorage.getItem('gradius_laser_highscore') || '50000', 10);
          if (!isNaN(saved) && saved > this.highScore) {
            this.highScore = saved;
          }
        }
      } catch (_) {
        // localStorage 非対応環境では無視
      }
    }

    _saveHighScore() {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('gradius_laser_highscore', String(Math.floor(this.highScore)));
        }
      } catch (_) {}
    }

    /**
     * 新規ゲームプレイを開始（全コンポーネントを初期化して PLAYING ステートへ遷移）
     */
    startNewGame() {
      this.sound.init();
      this.terrain.reset();
      this.player.resetAll();
      this.weapons.reset();
      this.enemies.reset();
      this.effects.reset();
      this.gauge.reset();

      this.score = 0;
      this.comboCount = 0;
      this.comboTimer = 0;
      this.state = 'PLAYING';

      // 開幕直後に気持ちよくパワーアップできるよう最初の赤色カプセル編隊をスポーン
      this.enemies.spawnRedSquadron(260);
    }

    /**
     * 最強装備（ハイパーレーザーLv2＋オプション4機＋ミサイルLv2＋スピードLv2＋シールド）を即時装着するブースト機能
     */
    applyFullPowerPreset() {
      if (this.state !== 'PLAYING') {
        this.startNewGame();
      }
      this.player.speedLevel = 2;
      this.player.missileLevel = 2;
      this.player.doubleLevel = 0;
      this.player.laserLevel = 2; // ハイパーレーザー
      this.player.shieldHp = CONFIG.WEAPON.SHIELD.MAX_HP_LV2;
      this.player.shieldMaxHp = CONFIG.WEAPON.SHIELD.MAX_HP_LV2;

      while (this.player.optionSystem.activeCount < CONFIG.OPTION.MAX_COUNT) {
        this.player.optionSystem.addOption();
      }
      // オプションが美しく展開して見えるよう初期トレイルを少しずらして配置
      for (let step = 1; step <= 64; step++) {
        const sy = this.player.y + Math.sin(step * 0.18) * 48;
        const sx = Math.max(40, this.player.x - Math.sin(step * 0.08) * 28);
        this.player.optionSystem.update(sx, sy, true, CONFIG.SCREEN.FIXED_DT);
      }

      this.sound.playPowerUpActivate();
      this.effects.spawnPopupText(this.player.x + 40, this.player.y - 25, 'FULL HYPER LASER + 4 OPTIONS!!', '#e879f9', 1.35);
      this.effects.triggerFlash('#e879f9', 0.35, 2.5);
    }

    /**
     * 現在のコンボ倍率（1.0〜8.0）を算出
     */
    getComboMultiplier() {
      if (this.comboCount <= 1) return 1.0;
      return Math.min(CONFIG.EFFECTS.MAX_COMBO_MULT, 1.0 + (this.comboCount - 1) * 0.5);
    }

    /**
     * スコア加算処理
     */
    addScore(basePoints, x, y, customLabel = null) {
      this.score += basePoints;
      if (this.score > this.highScore) {
        this.highScore = this.score;
        this._saveHighScore();
      }
      if (customLabel && x !== undefined && y !== undefined) {
        this.effects.spawnPopupText(x, y, customLabel, '#fef08a', 1.0);
      }
    }

    /**
     * 敵機撃破時のコンボ・スコア・爆発・カプセルドロップ処理
     * @param {Object} enemy
     */
    onEnemyKilled(enemy) {
      if (!enemy || !enemy.active) return;
      const ex = enemy.x;
      const ey = enemy.y;
      const eType = enemy.type;
      const baseScore = enemy.score;
      const squadId = enemy.squadronId;
      const dropsCap = enemy.dropsCapsule;

      this.enemies.enemyPool.release(enemy);

      // コンボ更新
      this.comboCount++;
      this.comboTimer = CONFIG.EFFECTS.COMBO_WINDOW;
      const mult = this.getComboMultiplier();
      const earned = Math.round(baseScore * mult);

      const label = this.comboCount >= 3 ? `+${earned} (x${mult.toFixed(1)})` : `+${earned}`;
      this.addScore(earned, ex, ey - 10, label);

      // 爆発パーティクル＆コンボ連動ピッチ上昇SE（3.8節）
      const expType = eType === 'MEDIUM' ? 'medium' : 'small';
      this.effects.spawnExplosion(ex, ey, expType);
      this.sound.playExplosion(expType, this.comboCount);
      if (eType === 'MEDIUM') {
        this.effects.triggerShake(6, 0.22);
      }

      // 赤色カプセル編隊の全滅判定（最後の1機を倒したら赤カプセル＆編隊ボーナス）
      if (squadId > 0 && this.enemies.squadronRemaining[squadId] > 0) {
        this.enemies.squadronRemaining[squadId]--;
        if (this.enemies.squadronRemaining[squadId] === 0) {
          this.enemies.spawnCapsule(ex, ey, false);
          this.addScore(CONFIG.ENEMY.SQUADRON_BONUS, ex, ey - 26, 'SQUADRON BONUS +1000!');
        }
      } else if (dropsCap) {
        // 中型敵や特定敵からのカプセルドロップ（中型敵は一定確率で青カプセル）
        const isBlue = eType === 'MEDIUM' && (Math.random() < CONFIG.POWERUP.BLUE_CAPSULE_CHANCE);
        this.enemies.spawnCapsule(ex, ey, isBlue);
      }
    }

    /**
     * カプセル取得時の処理（赤：ゲージ進行、青：全画面雑魚・敵弾一掃フラッシュ）
     */
    onCapsuleCollected(isBlue, cx, cy) {
      this.sound.playCapsuleGet(isBlue);
      if (!isBlue) {
        this.gauge.advance();
        const slotName = this.gauge.getCurrentSlotName();
        this.addScore(200, cx, cy - 12, `CAPSULE [${slotName}]`);
      } else {
        // 青カプセル：全画面フラッシュ＆全雑魚・敵弾一掃
        this.effects.triggerFlash('#38bdf8', 0.75, 2.2);
        this.effects.triggerShake(10, 0.35);
        this.enemies.bulletPool.clear();

        let wiped = 0;
        this.enemies.enemyPool.forEachActive((e) => {
          if (e.type !== 'MEDIUM') {
            e.hp = 0;
            this.onEnemyKilled(e);
            wiped++;
          } else {
            e.hp -= 55;
            if (e.hp <= 0) this.onEnemyKilled(e);
          }
        });
        this.addScore(1500 + wiped * 100, cx, cy - 18, 'BLUE FLASH WIPEOUT!!');
      }
    }

    /**
     * 自機被弾・ミス時の処理（3.1節、TC-PL-02）
     */
    onPlayerHit() {
      const result = this.player.kill(false);
      if (!result.died) return;

      this.effects.spawnExplosion(result.deathX, result.deathY, 'player');
      this.effects.triggerShake(12, 0.45);
      this.effects.triggerFlash('#ef4444', 0.45, 2.2);
      this.sound.playExplosion('player', 1);

      // 持っていたオプション数に応じてリカバリー用赤カプセルを画面内に放出
      for (let i = 0; i < result.droppedCapsules; i++) {
        this.enemies.spawnCapsule(result.deathX + 80 + i * 45, result.deathY + (i === 0 ? -25 : 25), false);
      }

      if (result.gameOver) {
        this.state = 'GAMEOVER';
      }
    }

    /**
     * ボス撃破時のヒットストップ・大爆発・次WAVE進行処理（3.5節、TC-BS-01）
     */
    onBossDefeated() {
      if (!this.enemies.boss.active) return;
      const bx = this.enemies.boss.x;
      const by = this.enemies.boss.y;

      this.enemies.boss.active = false;
      this.enemies.bulletPool.clear();

      // 0.42秒間のヒットストップ（時間軸を1/10に減衰するスローモーション演出）
      this.effects.triggerHitStop(CONFIG.ENEMY.BOSS.HITSTOP_DURATION, CONFIG.ENEMY.BOSS.HITSTOP_TIMESCALE);
      this.effects.triggerShake(16, 0.85);
      this.effects.triggerFlash('#ffffff', 0.85, 1.6);

      // 多重爆発エフェクト生成
      this.effects.spawnExplosion(bx, by, 'boss');
      this.effects.spawnExplosion(bx - 30, by - 35, 'medium');
      this.effects.spawnExplosion(bx + 25, by + 35, 'medium');
      this.sound.playExplosion('boss', this.comboCount);

      this.addScore(CONFIG.ENEMY.BOSS.SCORE_BONUS, bx, by - 20, `BOSS DESTROYED! +${CONFIG.ENEMY.BOSS.SCORE_BONUS}`);

      // 次WAVEへ進行
      this.enemies.wave++;
      this.enemies.stageTimer = 0;
    }

    /**
     * 1ティック（基準 dt = 1/60秒）分のゲーム論理更新を実行
     * @param {number} rawDt 実フレーム経過時間
     */
    step(rawDt = CONFIG.SCREEN.FIXED_DT) {
      this.ui.update(rawDt);

      if (this.state === 'TITLE') {
        // タイトル待機中も背景星空をスクロール演出
        this.terrain.update(rawDt, true);
        if (this.input.fire) {
          this.input.fire = false;
          this.startNewGame();
        }
        return;
      }

      if (this.state === 'PAUSED') {
        return;
      }

      if (this.state === 'GAMEOVER') {
        this.terrain.update(rawDt * 0.4, true);
        this.effects.update(rawDt);
        if (this.input.fire) {
          this.input.fire = false;
          this.startNewGame();
        }
        return;
      }

      // --- PLAYING 状態 ---
      // 1. エフェクト更新とヒットストップ（スローモーション）補正後 dt の取得
      const dt = this.effects.update(rawDt);

      // 2. コンボタイマー更新
      if (this.comboTimer > 0) {
        this.comboTimer -= dt;
        if (this.comboTimer <= 0) {
          this.comboTimer = 0;
          this.comboCount = 0;
        }
      }

      // 3. パワーアップ発動入力処理
      if (this.input.powerUp) {
        this.input.powerUp = false;
        this.gauge.activate(this.player, this.sound, this.effects);
      }

      // 4. 自機移動とオプション追従履歴更新
      this.player.update(this.input, dt);

      // 5. ショット/レーザー/ミサイル発射（押しっぱなしオート連射対応）
      if (this.input.fire && this.player.alive) {
        this.weapons.tryFire(this.player, this.sound);
      }

      // 6. 武装更新（レーザーワインダー追従・ミサイル地形滑行含む）
      this.weapons.update(dt, this.player, this.terrain);

      // 7. ステージ・地形スクロール更新
      const bossMode = this.enemies.boss.active || this.enemies.boss.warningActive;
      this.terrain.update(dt, bossMode);

      // 8. 敵・ボスAI更新
      this.enemies.update(dt, this.player, this.terrain, this.sound);

      // 9. 物理・衝突判定一括実行
      this.collision.processAll(this);

      // 10. プロシージャルBGM更新
      this.sound.updateBGM(rawDt, bossMode ? 'boss' : 'stage');
    }

    /**
     * 画面描画処理（requestAnimationFrame 同期）
     */
    render() {
      if (!this.ctx) return;
      const ctx = this.ctx;

      ctx.save();
      // ベース宇宙背景クリア
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, CONFIG.SCREEN.WIDTH, CONFIG.SCREEN.HEIGHT);

      // 画面シェイクオフセットの適用（プレイ領域描画のみ）
      ctx.save();
      ctx.translate(this.effects.shakeOffsetX, this.effects.shakeOffsetY);

      // 1. パララックス3層背景＆プロシージャル洞窟地形
      this.terrain.render(ctx);

      // 2. 武装（レーザー・ショット・ミサイル）
      this.weapons.render(ctx);

      // 3. 自機・オプション・シールド
      if (this.state !== 'TITLE') {
        this.player.render(ctx);
      }

      // 4. 敵・ボス・カプセル・敵弾
      this.enemies.render(ctx);

      // 5. パーティクル・ポップアップテキスト・フラッシュ
      this.effects.render(ctx);

      ctx.restore();

      // 6. 上下HUDおよびステート画面（シェイクの影響を受けない固定描画）
      this.ui.render(ctx, this);

      ctx.restore();
    }

    /**
     * ブラウザ用メインループを開始（固定タイムステップ 60Hz アキュムレータ方式）
     */
    startLoop() {
      if (typeof requestAnimationFrame === 'undefined') return;
      this.lastFrameTime = performance.now();

      const loop = (now) => {
        const elapsedSec = Math.min(0.1, Math.max(0, (now - this.lastFrameTime) / 1000));
        this.lastFrameTime = now;
        if (elapsedSec > 0) {
          this.fps = this.fps * 0.9 + (1 / elapsedSec) * 0.1;
        }

        this.accumulator += elapsedSec;
        const fixedDt = CONFIG.SCREEN.FIXED_DT;
        let steps = 0;
        while (this.accumulator >= fixedDt && steps < CONFIG.SCREEN.MAX_FRAME_SKIP) {
          this.step(fixedDt);
          this.accumulator -= fixedDt;
          steps++;
        }

        this.render();
        this.rafId = requestAnimationFrame(loop);
      };

      this.rafId = requestAnimationFrame(loop);
    }

    /**
     * キーボードイベントリスナー登録（入力遅延最小化：4.2節）
     * @private
     */
    _bindInputEvents() {
      window.addEventListener('keydown', (e) => {
        const code = e.code;
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code)) {
          e.preventDefault();
        }

        if (code === 'ArrowLeft' || code === 'KeyA') this.input.left = true;
        if (code === 'ArrowRight' || code === 'KeyD') this.input.right = true;
        if (code === 'ArrowUp' || code === 'KeyW') this.input.up = true;
        if (code === 'ArrowDown' || code === 'KeyS') this.input.down = true;

        if (code === 'KeyZ' || code === 'Space' || code === 'KeyJ') {
          this.sound.init();
          this.input.fire = true;
        }

        if (code === 'KeyX' || code === 'ShiftLeft' || code === 'ShiftRight' || code === 'KeyK' || code === 'Enter') {
          this.sound.init();
          this.input.powerUp = true;
        }

        if (code === 'KeyP' || code === 'Escape') {
          if (this.state === 'PLAYING') this.state = 'PAUSED';
          else if (this.state === 'PAUSED') this.state = 'PLAYING';
        }

        if (code === 'KeyM') {
          this.sound.toggleMute();
        }

        if (code === 'F3') {
          e.preventDefault();
          this.ui.showDebug = !this.ui.showDebug;
        }

        // クイック体験・テスト用ショートカットキー
        if (code === 'Digit1') {
          if (this.state === 'PLAYING') {
            this.onCapsuleCollected(false, this.player.x, this.player.y);
          }
        } else if (code === 'Digit2') {
          this.applyFullPowerPreset();
        } else if (code === 'Digit3') {
          if (this.state === 'PLAYING') {
            this.enemies.startBossSequence(this.sound, false);
          }
        }
      });

      window.addEventListener('keyup', (e) => {
        const code = e.code;
        if (code === 'ArrowLeft' || code === 'KeyA') this.input.left = false;
        if (code === 'ArrowRight' || code === 'KeyD') this.input.right = false;
        if (code === 'ArrowUp' || code === 'KeyW') this.input.up = false;
        if (code === 'ArrowDown' || code === 'KeyS') this.input.down = false;
        if (code === 'KeyZ' || code === 'Space' || code === 'KeyJ') this.input.fire = false;
        if (code === 'KeyX' || code === 'ShiftLeft' || code === 'ShiftRight' || code === 'KeyK' || code === 'Enter') {
          this.input.powerUp = false;
        }
      });
    }
  }

  if (isNode) {
    module.exports = GameStateManager;
  }
  root.GradiusSTG = root.GradiusSTG || {};
  root.GradiusSTG.GameStateManager = GameStateManager;
})(typeof window !== 'undefined' ? window : globalThis);
