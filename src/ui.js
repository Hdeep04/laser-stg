/**
 * @file ui.js
 * @description パワーアップゲージシステムおよびHUD・タイトル/ポーズ/ゲームオーバーUI描画（仕様書 3.4節、3.9節準拠）
 */
(function (root) {
  'use strict';

  const CONFIG = (typeof module !== 'undefined' && module.exports)
    ? require('./config.js')
    : root.GradiusSTG.CONFIG;

  /**
   * グラディウス式6枠パワーアップゲージ管理（3.4節、TC-PU-01、TC-PU-02）
   * 1: SPEED UP, 2: MISSILE, 3: DOUBLE, 4: LASER, 5: OPTION, 6: SHIELD
   */
  class PowerUpGauge {
    constructor() {
      this.cursor = 0; // 0: 未点灯, 1..6: 選択中スロット
      this.slots = CONFIG.POWERUP.SLOTS;
    }

    reset() {
      this.cursor = 0;
    }

    /**
     * 赤カプセル取得時にゲージカーソルを1つ右へ進める（6の次は1へループ）
     * @returns {number} 移動後のカーソル位置 (1..6)
     */
    advance() {
      this.cursor = (this.cursor % 6) + 1;
      return this.cursor;
    }

    /**
     * 現在選択中のスロットのラベル名を取得
     * @returns {string|null}
     */
    getCurrentSlotName() {
      if (this.cursor < 1 || this.cursor > 6) return null;
      return this.slots[this.cursor - 1];
    }

    /**
     * 指定スロット（1..6）が既に最大強化上限（MAX）に達しているか判定
     * @param {number} slotIndex 1..6
     * @param {PlayerController} player
     * @returns {boolean}
     */
    isSlotMaxed(slotIndex, player) {
      if (!player) return false;
      switch (slotIndex) {
        case 1: return false; // SPEED UPは最大5段階到達後、再発動で段階1へ安全リセット可能
        case 2: return player.missileLevel >= 2;
        case 3: return player.doubleLevel >= 2;
        case 4: return player.laserLevel >= 2;
        case 5: return player.optionSystem.activeCount >= CONFIG.OPTION.MAX_COUNT;
        case 6: return player.shieldHp >= CONFIG.WEAPON.SHIELD.MAX_HP_LV2;
        default: return false;
      }
    }

    /**
     * 現在カーソルが当たっているパワーアップを発動し、カーソルを0にリセットする（3.4節、TC-PU-02）
     * @param {PlayerController} player
     * @param {SoundSystem} [sound]
     * @param {EffectSystem} [effects]
     * @returns {{ activated: boolean, slot: number, label: string }}
     */
    activate(player, sound, effects) {
      if (!player || !player.alive || this.cursor < 1 || this.cursor > 6) {
        return { activated: false, slot: 0, label: '' };
      }

      const slot = this.cursor;
      if (this.isSlotMaxed(slot, player)) {
        return { activated: false, slot: slot, label: 'MAX' };
      }

      let label = this.slots[slot - 1];

      switch (slot) {
        case 1: // SPEED UP
          if (player.speedLevel >= CONFIG.PLAYER.MAX_SPEED_LEVEL) {
            player.speedLevel = 1;
            label = 'SPEED RESET';
          } else {
            player.speedLevel++;
            label = `SPEED UP Lv${player.speedLevel}`;
          }
          break;

        case 2: // MISSILE
          player.missileLevel = Math.min(2, player.missileLevel + 1);
          label = player.missileLevel >= 2 ? 'SPREAD MISSILE!' : 'MISSILE!';
          break;

        case 3: // DOUBLE（LASERと排他制御：TC-PU-02）
          player.laserLevel = 0;
          player.doubleLevel = Math.min(2, player.doubleLevel + 1);
          label = player.doubleLevel >= 2 ? 'TWIN DOUBLE!' : 'DOUBLE!';
          break;

        case 4: // LASER（DOUBLEと排他制御：TC-PU-02）
          player.doubleLevel = 0;
          player.laserLevel = Math.min(2, player.laserLevel + 1);
          label = player.laserLevel >= 2 ? 'HYPER LASER!!' : 'LASER!';
          break;

        case 5: // OPTION（最大4機）
          player.optionSystem.addOption();
          label = `OPTION x${player.optionSystem.activeCount}!`;
          break;

        case 6: // SHIELD
          if (player.shieldHp > 0) {
            player.shieldHp = CONFIG.WEAPON.SHIELD.MAX_HP_LV2;
            player.shieldMaxHp = CONFIG.WEAPON.SHIELD.MAX_HP_LV2;
            label = 'FORCE SHIELD!';
          } else {
            player.shieldHp = CONFIG.WEAPON.SHIELD.MAX_HP_LV1;
            player.shieldMaxHp = CONFIG.WEAPON.SHIELD.MAX_HP_LV1;
            label = 'SHIELD!';
          }
          break;
      }

      this.cursor = 0;
      if (sound) sound.playPowerUpActivate();
      if (effects) {
        effects.spawnPopupText(player.x, player.y - 22, label, '#38bdf8', 1.25);
      }

      return { activated: true, slot: slot, label: label };
    }
  }

  /**
   * HUDおよびゲーム状態画面レンダラー（3.9節）
   */
  class UISystem {
    constructor() {
      this.blinkTimer = 0;
      this.showDebug = false;
    }

    update(dt) {
      this.blinkTimer += dt;
    }

    /**
     * 上部HUD・下部パワーアップゲージ・ボスHP・状態オーバーレイを描画
     * @param {CanvasRenderingContext2D} ctx
     * @param {Object} game GameStateManagerインスタンス
     */
    render(ctx, game) {
      ctx.save();

      // 1. 上部HUDバー（Y: 0〜40）
      this._renderTopHUD(ctx, game);

      // 2. 下部HUDバー：6枠パワーアップゲージ（Y: 550〜600）
      this._renderPowerUpGauge(ctx, game.gauge, game.player);

      // 3. ボス WARNING バナー または ボスHPバー
      if (game.enemies.boss.warningActive) {
        this._renderWarningBanner(ctx, game.enemies.boss.warningTimer);
      } else if (game.enemies.boss.active) {
        this._renderBossHealthBar(ctx, game.enemies.boss);
      }

      // 4. ゲーム状態別オーバーレイ（TITLE / PAUSED / GAMEOVER）
      if (game.state === 'TITLE') {
        this._renderTitleOverlay(ctx, game);
      } else if (game.state === 'PAUSED') {
        this._renderPausedOverlay(ctx);
      } else if (game.state === 'GAMEOVER') {
        this._renderGameOverOverlay(ctx, game);
      }

      // 5. デバッグ/テレメトリ表示（F3キーで切替）
      if (this.showDebug) {
        this._renderDebugTelemetry(ctx, game);
      }

      ctx.restore();
    }

    _renderTopHUD(ctx, game) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.fillRect(0, 0, CONFIG.SCREEN.WIDTH, CONFIG.SCREEN.PLAY_TOP);
      ctx.strokeStyle = '#1e3a8a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, CONFIG.SCREEN.PLAY_TOP);
      ctx.lineTo(CONFIG.SCREEN.WIDTH, CONFIG.SCREEN.PLAY_TOP);
      ctx.stroke();

      ctx.font = 'bold 14px "Orbitron", "Courier New", monospace';
      ctx.textBaseline = 'middle';

      // スコア表示
      ctx.textAlign = 'left';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('1P', 16, 20);
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(String(Math.floor(game.score)).padStart(8, '0'), 44, 20);

      // ハイスコア表示
      ctx.fillStyle = '#facc15';
      ctx.fillText('HI', 175, 20);
      ctx.fillStyle = '#fef08a';
      ctx.fillText(String(Math.floor(game.highScore)).padStart(8, '0'), 202, 20);

      // コンボ＆倍率表示
      if (game.comboCount > 1) {
        const mult = game.getComboMultiplier().toFixed(1);
        ctx.fillStyle = '#38bdf8';
        ctx.fillText(`${game.comboCount} HIT (x${mult})`, 335, 20);

        // コンボ残り時間バー
        const ratio = Math.max(0, game.comboTimer / CONFIG.EFFECTS.COMBO_WINDOW);
        ctx.fillStyle = '#0ea5e9';
        ctx.fillRect(335, 31, 95 * ratio, 3);
      }

      // WAVE表示
      ctx.textAlign = 'center';
      ctx.fillStyle = '#c084fc';
      ctx.fillText(`WAVE ${game.enemies.wave}`, 530, 20);

      // 残機アイコン描画
      ctx.textAlign = 'left';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('LEFT', 610, 20);
      const maxIcons = Math.min(5, game.player.lives);
      for (let i = 0; i < maxIcons; i++) {
        const ix = 665 + i * 24;
        const iy = 20;
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.moveTo(ix + 9, iy);
        ctx.lineTo(ix - 7, iy - 6);
        ctx.lineTo(ix - 4, iy);
        ctx.lineTo(ix - 7, iy + 6);
        ctx.closePath();
        ctx.fill();
      }
    }

    _renderPowerUpGauge(ctx, gauge, player) {
      const yTop = CONFIG.SCREEN.PLAY_BOTTOM;
      const barH = CONFIG.SCREEN.HEIGHT - yTop;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
      ctx.fillRect(0, yTop, CONFIG.SCREEN.WIDTH, barH);
      ctx.strokeStyle = '#1e3a8a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, yTop);
      ctx.lineTo(CONFIG.SCREEN.WIDTH, yTop);
      ctx.stroke();

      const slotCount = 6;
      const slotW = 114;
      const gap = 8;
      const totalW = slotCount * slotW + (slotCount - 1) * gap;
      const startX = (CONFIG.SCREEN.WIDTH - totalW) * 0.5;
      const slotY = yTop + 9;
      const slotH = 32;

      ctx.font = 'bold 12px "Orbitron", "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let i = 0; i < slotCount; i++) {
        const slotNum = i + 1;
        const sx = startX + i * (slotW + gap);
        const isSelected = gauge.cursor === slotNum;
        const isMaxed = gauge.isSlotMaxed(slotNum, player);

        // スロット背景
        if (isSelected) {
          const pulse = 0.75 + 0.25 * Math.sin(this.blinkTimer * 18);
          ctx.fillStyle = isMaxed
            ? `rgba(100, 116, 139, ${pulse})`
            : `rgba(249, 115, 22, ${pulse})`;
        } else {
          ctx.fillStyle = isMaxed ? '#0f172a' : '#172554';
        }
        ctx.fillRect(sx, slotY, slotW, slotH);

        // スロット枠線
        ctx.strokeStyle = isSelected ? '#fef08a' : (isMaxed ? '#334155' : '#3b82f6');
        ctx.lineWidth = isSelected ? 2.5 : 1.5;
        ctx.strokeRect(sx, slotY, slotW, slotH);

        // ラベル文字列と現在レベル表示
        let label = gauge.slots[i];
        if (isMaxed) {
          label = `${label} [MAX]`;
        } else if (slotNum === 1 && player.speedLevel > 0) {
          label = `SPEED Lv${player.speedLevel}`;
        } else if (slotNum === 4 && player.laserLevel === 1) {
          label = 'HYPER LASER';
        } else if (slotNum === 5 && player.optionSystem.activeCount > 0) {
          label = `OPTION (${player.optionSystem.activeCount}/4)`;
        }

        ctx.fillStyle = isSelected ? '#ffffff' : (isMaxed ? '#475569' : '#93c5fd');
        ctx.fillText(label, sx + slotW * 0.5, slotY + slotH * 0.5);
      }
    }

    _renderWarningBanner(ctx, timer) {
      const blink = Math.floor(timer * 6) % 2 === 0;
      ctx.save();
      ctx.fillStyle = blink ? 'rgba(220, 38, 38, 0.35)' : 'rgba(15, 23, 42, 0.5)';
      ctx.fillRect(0, 235, CONFIG.SCREEN.WIDTH, 110);

      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, 235);
      ctx.lineTo(CONFIG.SCREEN.WIDTH, 235);
      ctx.moveTo(0, 345);
      ctx.lineTo(CONFIG.SCREEN.WIDTH, 345);
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 34px "Orbitron", "Courier New", monospace';
      ctx.fillStyle = blink ? '#fef08a' : '#ef4444';
      ctx.fillText('WARNING!!', CONFIG.SCREEN.WIDTH * 0.5, 272);

      ctx.font = 'bold 16px "Orbitron", "Courier New", monospace';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('HUGE BATTLESHIP "BIG CORE MK-II" APPROACHING', CONFIG.SCREEN.WIDTH * 0.5, 314);
      ctx.restore();
    }

    _renderBossHealthBar(ctx, boss) {
      const barW = 360;
      const barH = 10;
      const bx = (CONFIG.SCREEN.WIDTH - barW) * 0.5;
      const by = CONFIG.SCREEN.PLAY_TOP + 12;
      const ratio = Math.max(0, boss.hp / boss.maxHp);

      ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
      ctx.fillRect(bx - 2, by - 2, barW + 4, barH + 4);

      ctx.fillStyle = ratio > 0.3 ? '#ef4444' : '#facc15';
      ctx.fillRect(bx, by, barW * ratio, barH);

      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(bx - 2, by - 2, barW + 4, barH + 4);

      ctx.font = 'bold 11px "Orbitron", "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fecaca';
      ctx.fillText('BIG CORE MK-II', CONFIG.SCREEN.WIDTH * 0.5, by + 20);
    }

    _renderTitleOverlay(ctx) {
      ctx.save();
      ctx.fillStyle = 'rgba(2, 6, 23, 0.72)';
      ctx.fillRect(0, CONFIG.SCREEN.PLAY_TOP, CONFIG.SCREEN.WIDTH, CONFIG.SCREEN.PLAY_BOTTOM - CONFIG.SCREEN.PLAY_TOP);

      const cx = CONFIG.SCREEN.WIDTH * 0.5;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // タイトルロゴ
      ctx.font = 'bold 46px "Orbitron", "Courier New", monospace';
      ctx.fillStyle = '#38bdf8';
      ctx.fillText('GRADIUS LASER', cx, 155);
      ctx.font = 'bold 20px "Orbitron", "Courier New", monospace';
      ctx.fillStyle = '#f472b6';
      ctx.fillText('HYPER WINDER EDITION', cx, 195);

      // 操作ガイドボックス
      ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
      ctx.strokeStyle = '#1d4ed8';
      ctx.lineWidth = 2;
      ctx.fillRect(cx - 250, 235, 500, 175);
      ctx.strokeRect(cx - 250, 235, 500, 175);

      ctx.font = 'bold 14px "Courier New", monospace';
      ctx.fillStyle = '#fef08a';
      ctx.fillText('--- CONTROLS & SYSTEM ---', cx, 260);

      ctx.font = '13px "Courier New", monospace';
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText('MOVE        : Arrow Keys / WASD', cx, 290);
      ctx.fillText('AUTO SHOT   : Z / Space / J (Hold to Continuous Fire)', cx, 315);
      ctx.fillText('POWER-UP    : X / Shift / K / Enter (Activate Gauge)', cx, 340);
      ctx.fillText('PAUSE / MUTE: P (Pause) / M (Mute Audio)', cx, 365);
      ctx.fillStyle = '#38bdf8';
      ctx.fillText('INSTANT BOOST KEYS: [1] +Capsule  [2] Full Hyper Laser  [3] Boss', cx, 390);

      // スタート点滅表示
      if (Math.floor(this.blinkTimer * 3) % 2 === 0) {
        ctx.font = 'bold 22px "Orbitron", "Courier New", monospace';
        ctx.fillStyle = '#fef08a';
        ctx.fillText('PRESS [SPACE] OR [Z] TO LAUNCH', cx, 465);
      }

      ctx.restore();
    }

    _renderPausedOverlay(ctx) {
      ctx.save();
      ctx.fillStyle = 'rgba(2, 6, 23, 0.65)';
      ctx.fillRect(0, CONFIG.SCREEN.PLAY_TOP, CONFIG.SCREEN.WIDTH, CONFIG.SCREEN.PLAY_BOTTOM - CONFIG.SCREEN.PLAY_TOP);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 38px "Orbitron", "Courier New", monospace';
      ctx.fillStyle = '#fef08a';
      ctx.fillText('PAUSED', CONFIG.SCREEN.WIDTH * 0.5, 270);

      ctx.font = '16px "Courier New", monospace';
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText('Press [P] or [ESC] to Resume', CONFIG.SCREEN.WIDTH * 0.5, 315);
      ctx.restore();
    }

    _renderGameOverOverlay(ctx, game) {
      ctx.save();
      ctx.fillStyle = 'rgba(2, 6, 23, 0.78)';
      ctx.fillRect(0, CONFIG.SCREEN.PLAY_TOP, CONFIG.SCREEN.WIDTH, CONFIG.SCREEN.PLAY_BOTTOM - CONFIG.SCREEN.PLAY_TOP);

      const cx = CONFIG.SCREEN.WIDTH * 0.5;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.font = 'bold 48px "Orbitron", "Courier New", monospace';
      ctx.fillStyle = '#ef4444';
      ctx.fillText('GAME OVER', cx, 225);

      ctx.font = 'bold 20px "Courier New", monospace';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(`FINAL SCORE : ${String(Math.floor(game.score)).padStart(8, '0')}`, cx, 285);
      ctx.fillStyle = '#facc15';
      ctx.fillText(`HIGH SCORE  : ${String(Math.floor(game.highScore)).padStart(8, '0')}`, cx, 318);

      if (Math.floor(this.blinkTimer * 3) % 2 === 0) {
        ctx.font = 'bold 20px "Orbitron", "Courier New", monospace';
        ctx.fillStyle = '#38bdf8';
        ctx.fillText('PRESS [SPACE] OR [Z] TO RETRY', cx, 385);
      }
      ctx.restore();
    }

    _renderDebugTelemetry(ctx, game) {
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(8, 46, 235, 92);
      ctx.font = '11px monospace';
      ctx.fillStyle = '#4ade80';
      ctx.textAlign = 'left';
      ctx.fillText(`FPS: ${game.fps.toFixed(0)} | TimeScale: ${game.effects.timeScale.toFixed(1)}`, 14, 60);
      ctx.fillText(`Pools Active -> Bullets:${game.weapons.bulletPool.activeCount} Lasers:${game.weapons.laserPool.activeCount}`, 14, 76);
      ctx.fillText(`Enemies:${game.enemies.enemyPool.activeCount} E.Bullets:${game.enemies.bulletPool.activeCount}`, 14, 92);
      ctx.fillText(`Particles:${game.effects.particlePool.activeCount} Options:${game.player.optionSystem.activeCount}`, 14, 108);
      ctx.fillText(`Spd:${game.player.speedLevel} Msl:${game.player.missileLevel} Dbl:${game.player.doubleLevel} Lsr:${game.player.laserLevel}`, 14, 124);
      ctx.restore();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PowerUpGauge, UISystem };
  }
  root.GradiusSTG = root.GradiusSTG || {};
  root.GradiusSTG.PowerUpGauge = PowerUpGauge;
  root.GradiusSTG.UISystem = UISystem;
})(typeof window !== 'undefined' ? window : globalThis);
