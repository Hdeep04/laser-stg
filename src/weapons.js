/**
 * @file weapons.js
 * @description 武器・弾薬管理システム（通常弾・ダブル・貫通ロングレーザー＆ワインダー・地表滑行ミサイル）（仕様書 3.2節準拠）
 */
(function (root) {
  'use strict';

  const CONFIG = (typeof module !== 'undefined' && module.exports)
    ? require('./config.js')
    : root.GradiusSTG.CONFIG;
  const ObjectPool = (typeof module !== 'undefined' && module.exports)
    ? require('./pool.js')
    : root.GradiusSTG.ObjectPool;

  class WeaponSystem {
    constructor() {
      // 1. 通常ショット・ダブル用オブジェクトプール
      this.bulletPool = new ObjectPool(() => ({
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        width: CONFIG.WEAPON.SHOT.WIDTH,
        height: CONFIG.WEAPON.SHOT.HEIGHT,
        damage: CONFIG.WEAPON.SHOT.DAMAGE,
        isDoubleAngle: false,
        level: 1
      }), CONFIG.WEAPON.POOL_SIZE_BULLETS);

      // 2. 貫通ロングレーザー用オブジェクトプール
      this.laserPool = new ObjectPool(() => ({
        active: false,
        ownerType: 'player', // 'player' | 'option'
        ownerIndex: -1,
        startX: 0,
        endX: CONFIG.SCREEN.WIDTH,
        visualMaxX: CONFIG.SCREEN.WIDTH,
        y: 0,
        height: CONFIG.WEAPON.LASER.HEIGHT_LV1,
        damagePerTick: CONFIG.WEAPON.LASER.DAMAGE_PER_TICK_LV1,
        damage: 999, // 一般雑魚敵を一撃貫通するための基準威力
        level: 1,
        elapsed: 0,
        duration: CONFIG.WEAPON.LASER.DURATION,
        // ワインダーしなり描画用のY座標履歴（固定長Float64ArrayでGCゼロ）
        ribbonY: new Float64Array(8)
      }), CONFIG.WEAPON.POOL_SIZE_LASERS);

      // 3. 地表滑行ミサイル用オブジェクトプール
      this.missilePool = new ObjectPool(() => ({
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        width: CONFIG.WEAPON.MISSILE.WIDTH,
        height: CONFIG.WEAPON.MISSILE.HEIGHT,
        damage: CONFIG.WEAPON.MISSILE.DAMAGE_LV1,
        level: 1,
        state: 'falling', // 'falling' | 'sliding'
        slopeAngle: 0.45
      }), CONFIG.WEAPON.POOL_SIZE_MISSILES);

      this.shotTimer = 0;
      this.missileTimer = 0;
      this.laserAnimPhase = 0;
    }

    /**
     * 全弾薬プールとクールダウンをリセット
     */
    reset() {
      this.bulletPool.clear();
      this.laserPool.clear();
      this.missilePool.clear();
      this.shotTimer = 0;
      this.missileTimer = 0;
    }

    /**
     * プレイヤーおよび全オプションから武装を発射する（押しっぱなしオート連射対応）
     * @param {PlayerController} player
     * @param {SoundSystem} [sound]
     * @returns {boolean} 発射が行われたか
     */
    tryFire(player, sound) {
      if (!player || !player.alive) return false;
      let firedAny = false;

      // 1. メイン武装（レーザー / ダブル / 通常ショット）
      if (this.shotTimer <= 0) {
        if (player.laserLevel > 0) {
          this._fireLaserFromAllEmitters(player);
          this.shotTimer = CONFIG.WEAPON.LASER.COOLDOWN;
          if (sound) sound.playShoot(true, player.laserLevel);
        } else {
          const isDouble = player.doubleLevel > 0;
          const lv = isDouble ? player.doubleLevel : 1;
          this._fireBulletsFromAllEmitters(player, isDouble, lv);
          this.shotTimer = lv >= 2 ? CONFIG.WEAPON.SHOT.COOLDOWN_LV2 : CONFIG.WEAPON.SHOT.COOLDOWN_LV1;
          if (sound) sound.playShoot(false, lv);
        }
        firedAny = true;
      }

      // 2. サブ武装（地表滑行ミサイル）
      if (player.missileLevel > 0 && this.missileTimer <= 0) {
        this._fireMissilesFromAllEmitters(player, player.missileLevel);
        this.missileTimer = player.missileLevel >= 2
          ? CONFIG.WEAPON.MISSILE.COOLDOWN_LV2
          : CONFIG.WEAPON.MISSILE.COOLDOWN_LV1;
        if (sound) sound.playMissile();
        firedAny = true;
      }

      return firedAny;
    }

    /**
     * 自機および全オプションから通常弾・ダブルを発射
     * @private
     */
    _fireBulletsFromAllEmitters(player, isDouble, level) {
      const speed = level >= 2 ? CONFIG.WEAPON.SHOT.SPEED_LV2 : CONFIG.WEAPON.SHOT.SPEED_LV1;

      const emitFrom = (ex, ey) => {
        // 前方ショット
        const b1 = this.bulletPool.acquire();
        if (b1) {
          b1.x = ex + 16;
          b1.y = ey;
          b1.vx = speed;
          b1.vy = 0;
          b1.width = CONFIG.WEAPON.SHOT.WIDTH;
          b1.height = CONFIG.WEAPON.SHOT.HEIGHT;
          b1.damage = CONFIG.WEAPON.SHOT.DAMAGE;
          b1.isDoubleAngle = false;
          b1.level = level;
        }

        // ダブル装備時は斜め上45度にも同時発射（3.2節）
        if (isDouble) {
          const b2 = this.bulletPool.acquire();
          if (b2) {
            const angle = -Math.PI / 4; // 斜め上45度
            b2.x = ex + 12;
            b2.y = ey - 6;
            b2.vx = Math.cos(angle) * speed;
            b2.vy = Math.sin(angle) * speed;
            b2.width = CONFIG.WEAPON.SHOT.WIDTH;
            b2.height = CONFIG.WEAPON.SHOT.HEIGHT;
            b2.damage = CONFIG.WEAPON.SHOT.DAMAGE;
            b2.isDoubleAngle = true;
            b2.level = level;
          }
        }
      };

      emitFrom(player.x, player.y);
      player.optionSystem.forEachActiveOption((opt) => {
        emitFrom(opt.x, opt.y);
      });
    }

    /**
     * 自機および全オプションから貫通ロングレーザーを発射（または照射時間を延長）
     * @private
     */
    _fireLaserFromAllEmitters(player) {
      const level = player.laserLevel;
      const height = level >= 2 ? CONFIG.WEAPON.LASER.HEIGHT_LV2 : CONFIG.WEAPON.LASER.HEIGHT_LV1;
      const dmgTick = level >= 2 ? CONFIG.WEAPON.LASER.DAMAGE_PER_TICK_LV2 : CONFIG.WEAPON.LASER.DAMAGE_PER_TICK_LV1;

      const emitLaser = (ownerType, ownerIndex, ex, ey) => {
        // 既に同一発射元のアクティブなレーザーがあれば持続時間をリフレッシュして切れ目ない照射を維持
        let existing = null;
        this.laserPool.forEachActive((l) => {
          if (l.ownerType === ownerType && l.ownerIndex === ownerIndex) {
            existing = l;
          }
        });

        const laser = existing || this.laserPool.acquire();
        if (!laser) return;

        laser.ownerType = ownerType;
        laser.ownerIndex = ownerIndex;
        laser.startX = ex + 16;
        laser.endX = CONFIG.SCREEN.WIDTH;
        laser.visualMaxX = CONFIG.SCREEN.WIDTH;
        laser.y = ey;
        laser.height = height;
        laser.damagePerTick = dmgTick;
        laser.damage = 999;
        laser.level = level;
        laser.elapsed = 0;
        laser.duration = CONFIG.WEAPON.LASER.DURATION;

        if (!existing) {
          for (let i = 0; i < laser.ribbonY.length; i++) {
            laser.ribbonY[i] = ey;
          }
        }
      };

      emitLaser('player', -1, player.x, player.y);
      player.optionSystem.forEachActiveOption((opt, idx) => {
        emitLaser('option', idx, opt.x, opt.y);
      });
    }

    /**
     * 自機および全オプションから地表滑行ミサイルを発射
     * @private
     */
    _fireMissilesFromAllEmitters(player, level) {
      const emitMissile = (ex, ey) => {
        const m = this.missilePool.acquire();
        if (!m) return;
        m.x = ex + 6;
        m.y = ey + 8;
        m.vx = CONFIG.WEAPON.MISSILE.FALL_SPEED_X;
        m.vy = CONFIG.WEAPON.MISSILE.FALL_SPEED_Y;
        m.width = CONFIG.WEAPON.MISSILE.WIDTH;
        m.height = CONFIG.WEAPON.MISSILE.HEIGHT;
        m.damage = level >= 2 ? CONFIG.WEAPON.MISSILE.DAMAGE_LV2 : CONFIG.WEAPON.MISSILE.DAMAGE_LV1;
        m.level = level;
        m.state = 'falling';
        m.slopeAngle = 0.55;
      };

      emitMissile(player.x, player.y);
      player.optionSystem.forEachActiveOption((opt) => {
        emitMissile(opt.x, opt.y);
      });
    }

    /**
     * 全弾薬・レーザーワインダー・地表ミサイルの毎フレーム更新
     * @param {number} dt
     * @param {PlayerController} player
     * @param {TerrainSystem} [terrain]
     */
    update(dt, player, terrain) {
      if (this.shotTimer > 0) this.shotTimer = Math.max(0, this.shotTimer - dt);
      if (this.missileTimer > 0) this.missileTimer = Math.max(0, this.missileTimer - dt);
      this.laserAnimPhase += dt * 45;

      // 1. 通常ショット・ダブルの移動と画面外除外
      this.bulletPool.forEachActive((b) => {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (
          b.x > CONFIG.SCREEN.WIDTH + 20 ||
          b.x < -20 ||
          b.y < CONFIG.SCREEN.PLAY_TOP - 10 ||
          b.y > CONFIG.SCREEN.PLAY_BOTTOM + 10
        ) {
          this.bulletPool.release(b);
        }
      });

      // 2. 貫通ロングレーザーの更新とレーザーワインダーY軸追従（3.2節、TC-WP-02）
      this.laserPool.forEachActive((l) => {
        if (!player || !player.alive) {
          this.laserPool.release(l);
          return;
        }

        l.elapsed += dt;
        if (l.elapsed >= l.duration) {
          this.laserPool.release(l);
          return;
        }

        // 発射元（自機またはオプション）の現在座標へ同期追従（レーザーワインダー動作）
        let ownerX = player.x;
        let ownerY = player.y;
        if (l.ownerType === 'option') {
          if (l.ownerIndex >= 0 && l.ownerIndex < player.optionSystem.activeCount) {
            const opt = player.optionSystem.options[l.ownerIndex];
            ownerX = opt.x;
            ownerY = opt.y;
          } else {
            this.laserPool.release(l);
            return;
          }
        }

        // ワインダーしなり描画用の履歴シフト
        for (let i = l.ribbonY.length - 1; i > 0; i--) {
          l.ribbonY[i] = l.ribbonY[i - 1];
        }
        l.ribbonY[0] = ownerY;

        l.startX = ownerX + 16;
        l.y = ownerY;
        l.endX = CONFIG.SCREEN.WIDTH;
        l.visualMaxX = CONFIG.SCREEN.WIDTH;
      });

      // 3. 地表滑行ミサイルの移動と地形追従（3.2節、TC-CL-01）
      this.missilePool.forEachActive((m) => {
        const floorY = terrain
          ? terrain.getTerrainBottomAt(m.x)
          : CONFIG.SCREEN.PLAY_BOTTOM;

        if (m.state === 'falling') {
          m.x += m.vx * dt;
          m.y += m.vy * dt;
          m.slopeAngle = 0.55;

          // 地面（または下部プレイ境界）に接触したら地表滑行モードへ移行
          if (m.y + m.height * 0.5 >= floorY) {
            m.y = floorY - m.height * 0.5;
            m.state = 'sliding';
          }
        } else {
          // 地表滑行モード：地形の傾斜に沿って前進
          const slideSpeed = m.level >= 2
            ? CONFIG.WEAPON.MISSILE.SLIDE_SPEED_LV2
            : CONFIG.WEAPON.MISSILE.SLIDE_SPEED_LV1;
          const prevX = m.x;
          const prevY = m.y;
          m.x += slideSpeed * dt;

          const newFloorY = terrain
            ? terrain.getTerrainBottomAt(m.x)
            : CONFIG.SCREEN.PLAY_BOTTOM;
          m.y = newFloorY - m.height * 0.5;
          m.slopeAngle = Math.atan2(m.y - prevY, m.x - prevX);
        }

        // 天井への衝突または画面外判定
        const ceilY = terrain ? terrain.getTerrainTopAt(m.x) : CONFIG.SCREEN.PLAY_TOP;
        if (m.x > CONFIG.SCREEN.WIDTH + 20 || m.y - m.height * 0.5 <= ceilY) {
          this.missilePool.release(m);
        }
      });
    }

    /**
     * 全武装の描画
     * @param {CanvasRenderingContext2D} ctx
     */
    render(ctx) {
      ctx.save();

      // 1. 通常ショット＆ダブル描画
      this.bulletPool.forEachActive((b) => {
        ctx.save();
        ctx.translate(b.x, b.y);
        if (b.isDoubleAngle) {
          ctx.rotate(-Math.PI / 4);
        }
        ctx.fillStyle = b.level >= 2 ? '#f472b6' : '#facc15';
        ctx.fillRect(-b.width * 0.5, -b.height * 0.5, b.width, b.height);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-b.width * 0.3, -b.height * 0.25, b.width * 0.7, b.height * 0.5);
        ctx.restore();
      });

      // 2. 貫通ロングレーザー＆ワインダーリボン描画
      this.laserPool.forEachActive((l) => {
        const endX = Math.min(l.endX, l.visualMaxX);
        const width = Math.max(0, endX - l.startX);
        if (width <= 0) return;

        const isHyper = l.level >= 2;
        const pulse = 1 + 0.15 * Math.sin(this.laserAnimPhase);
        const h = l.height * pulse;

        // (a) ワインダーのしなり残像リボン（上下移動時に美しい波形を描く）
        ctx.strokeStyle = isHyper ? 'rgba(232, 121, 249, 0.38)' : 'rgba(56, 189, 248, 0.35)';
        ctx.lineWidth = h * 1.35;
        ctx.beginPath();
        const segLen = width / (l.ribbonY.length - 1);
        for (let i = 0; i < l.ribbonY.length; i++) {
          const rx = l.startX + i * segLen;
          const ry = l.ribbonY[i];
          if (i === 0) ctx.moveTo(rx, ry);
          else ctx.lineTo(rx, ry);
        }
        ctx.stroke();

        // (b) 貫通ロングレーザー本体の外周プラズマグロー
        ctx.fillStyle = isHyper ? 'rgba(217, 70, 239, 0.45)' : 'rgba(14, 165, 233, 0.45)';
        ctx.fillRect(l.startX, l.y - h * 0.85, width, h * 1.7);

        // (c) ミドルビーム層
        ctx.fillStyle = isHyper ? '#e879f9' : '#38bdf8';
        ctx.fillRect(l.startX, l.y - h * 0.5, width, h);

        // (d) 中心高輝度ホワイトコア
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(l.startX, l.y - h * 0.22, width, h * 0.44);

        // (e) 発射口マズルフラッシュ
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.arc(l.startX, l.y, h * 0.65, 0, Math.PI * 2);
        ctx.fill();
      });

      // 3. 地表滑行ミサイル描画
      this.missilePool.forEachActive((m) => {
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(m.slopeAngle);

        // ミサイル噴射炎
        ctx.fillStyle = '#fb923c';
        ctx.fillRect(-m.width * 0.8, -2, 5, 4);

        // ミサイル本体
        ctx.fillStyle = m.level >= 2 ? '#34d399' : '#e2e8f0';
        ctx.fillRect(-m.width * 0.5, -m.height * 0.5, m.width, m.height);

        // 弾頭レッドキャップ
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(m.width * 0.2, -m.height * 0.5, m.width * 0.3, m.height);
        ctx.restore();
      });

      ctx.restore();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = WeaponSystem;
  }
  root.GradiusSTG = root.GradiusSTG || {};
  root.GradiusSTG.WeaponSystem = WeaponSystem;
})(typeof window !== 'undefined' ? window : globalThis);
