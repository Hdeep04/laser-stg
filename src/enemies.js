/**
 * @file enemies.js
 * @description 敵・ボスAIシステム（赤色編隊・サイン波・突進・地上砲台・中型機・遮蔽板＆コア構造ボス）（仕様書 3.5節準拠）
 */
(function (root) {
  'use strict';

  const CONFIG = (typeof module !== 'undefined' && module.exports)
    ? require('./config.js')
    : root.GradiusSTG.CONFIG;
  const ObjectPool = (typeof module !== 'undefined' && module.exports)
    ? require('./pool.js')
    : root.GradiusSTG.ObjectPool;

  class EnemySystem {
    constructor() {
      // 1. 雑魚・中型敵オブジェクトプール
      this.enemyPool = new ObjectPool(() => ({
        active: false,
        type: 'WAVE', // 'RED_SQUAD' | 'WAVE' | 'RUSH' | 'TURRET' | 'MEDIUM'
        x: 0,
        y: 0,
        baseY: 0,
        vx: 0,
        vy: 0,
        width: 24,
        height: 20,
        hp: 10,
        maxHp: 10,
        score: 100,
        age: 0,
        phase: 0,
        fireTimer: 0,
        flashTimer: 0,
        squadronId: 0,
        dropsCapsule: false,
        isCeilingTurret: false
      }), CONFIG.ENEMY.POOL_SIZE_ENEMIES);

      // 2. 敵弾オブジェクトプール
      this.bulletPool = new ObjectPool(() => ({
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        radius: 4,
        isBossLaser: false,
        width: 8,
        height: 8,
        grazed: false
      }), CONFIG.ENEMY.POOL_SIZE_BULLETS);

      // 3. パワーアップカプセル（赤/青）オブジェクトプール
      this.capsulePool = new ObjectPool(() => ({
        active: false,
        x: 0,
        y: 0,
        vx: CONFIG.POWERUP.CAPSULE_SPEED_X,
        vy: 0,
        radius: CONFIG.POWERUP.CAPSULE_RADIUS,
        isBlue: false,
        age: 0
      }), CONFIG.ENEMY.POOL_SIZE_CAPSULES);

      // 編隊全滅判定用の固定長カウンタ配列（GCゼロ）
      this.squadronRemaining = new Int16Array(64);
      this.nextSquadronId = 1;

      // ボス（ビッグコア型）状態オブジェクト（事前確保）
      this.boss = {
        active: false,
        warningActive: false,
        warningTimer: 0,
        entering: false,
        x: 900,
        y: 295,
        vy: 95,
        width: CONFIG.ENEMY.BOSS.WIDTH,
        height: CONFIG.ENEMY.BOSS.HEIGHT,
        hp: CONFIG.ENEMY.BOSS.CORE_HP_BASE,
        maxHp: CONFIG.ENEMY.BOSS.CORE_HP_BASE,
        flashTimer: 0,
        attackPattern: 0,
        patternTimer: 0,
        chargeTimer: 0,
        isChargingLaser: false,
        shutters: [
          { hp: 65, maxHp: 65, yOffset: -27, height: 14, active: true },
          { hp: 65, maxHp: 65, yOffset: -9,  height: 14, active: true },
          { hp: 65, maxHp: 65, yOffset: 9,   height: 14, active: true },
          { hp: 65, maxHp: 65, yOffset: 27,  height: 14, active: true }
        ]
      };

      this.wave = 1;
      this.stageTimer = 0;
      this.spawnTimer = 0;
      this.squadTimer = 0;
      this.mediumTimer = 0;
    }

    reset() {
      this.enemyPool.clear();
      this.bulletPool.clear();
      this.capsulePool.clear();
      this.squadronRemaining.fill(0);
      this.nextSquadronId = 1;

      this.boss.active = false;
      this.boss.warningActive = false;
      this.boss.warningTimer = 0;
      this.wave = 1;
      this.stageTimer = 0;
      this.spawnTimer = 0.6;
      this.squadTimer = 2.2;
      this.mediumTimer = 8.5;
    }

    /**
     * 指定タイプの敵機をスポーンさせる
     */
    spawnEnemy(type, x, y, options = {}) {
      const e = this.enemyPool.acquire();
      if (!e) return null;

      const spec = CONFIG.ENEMY.TYPES[type] || CONFIG.ENEMY.TYPES.WAVE;
      const waveScale = 1 + (this.wave - 1) * 0.2;

      e.type = type;
      e.x = x;
      e.y = y;
      e.baseY = y;
      e.width = spec.width;
      e.height = spec.height;
      e.hp = type === 'RED_SQUAD' || type === 'RUSH' ? spec.hp : Math.round(spec.hp * waveScale);
      e.maxHp = e.hp;
      e.score = spec.score;
      e.age = 0;
      e.phase = options.phase || 0;
      e.flashTimer = 0;
      e.squadronId = options.squadronId || 0;
      e.dropsCapsule = Boolean(options.dropsCapsule);
      e.isCeilingTurret = Boolean(options.isCeilingTurret);

      if (type === 'RED_SQUAD') {
        e.vx = -spec.speed;
        e.vy = 0;
        e.fireTimer = 99;
      } else if (type === 'RUSH') {
        e.vx = -spec.speed;
        e.vy = 0;
        e.fireTimer = 99;
      } else if (type === 'WAVE') {
        e.vx = -spec.speed;
        e.vy = 0;
        e.fireTimer = 1.4 + Math.random() * 1.2;
      } else if (type === 'TURRET') {
        e.vx = -CONFIG.TERRAIN.SCROLL_SPEED;
        e.vy = 0;
        e.fireTimer = 1.1 + Math.random() * 0.9;
      } else if (type === 'MEDIUM') {
        e.vx = -spec.speed;
        e.vy = 55;
        e.fireTimer = 1.2;
        e.dropsCapsule = true;
      }

      return e;
    }

    /**
     * 赤色カプセル編隊（5機連隊）をスポーンさせる
     */
    spawnRedSquadron(startY) {
      const squadId = this.nextSquadronId;
      this.nextSquadronId = (this.nextSquadronId % 60) + 1;
      const count = 5;
      this.squadronRemaining[squadId] = count;

      const clampedY = Math.max(CONFIG.SCREEN.PLAY_TOP + 65, Math.min(CONFIG.SCREEN.PLAY_BOTTOM - 65, startY));
      for (let i = 0; i < count; i++) {
        this.spawnEnemy('RED_SQUAD', CONFIG.SCREEN.WIDTH + 25 + i * 38, clampedY, {
          squadronId: squadId,
          phase: i * 0.45
        });
      }
    }

    /**
     * カプセル（赤または青）をドロップさせる
     */
    spawnCapsule(x, y, isBlue = false) {
      const c = this.capsulePool.acquire();
      if (!c) return null;
      c.x = Math.max(40, Math.min(CONFIG.SCREEN.WIDTH - 30, x));
      c.y = Math.max(CONFIG.SCREEN.PLAY_TOP + 22, Math.min(CONFIG.SCREEN.PLAY_BOTTOM - 22, y));
      c.vx = CONFIG.POWERUP.CAPSULE_SPEED_X;
      c.vy = 0;
      c.radius = CONFIG.POWERUP.CAPSULE_RADIUS;
      c.isBlue = isBlue;
      c.age = 0;
      return c;
    }

    /**
     * 敵弾を発射する
     */
    fireEnemyBullet(x, y, vx, vy, isBossLaser = false) {
      const b = this.bulletPool.acquire();
      if (!b) return null;
      b.x = x;
      b.y = y;
      b.vx = vx;
      b.vy = vy;
      b.isBossLaser = isBossLaser;
      b.radius = isBossLaser ? 5 : 4;
      b.width = isBossLaser ? 32 : 8;
      b.height = isBossLaser ? 6 : 8;
      b.grazed = false;
      return b;
    }

    /**
     * ボス戦シークエンス（WARNING演出 → ビッグコア出現）を開始する（3.5節）
     * @param {SoundSystem} [sound]
     * @param { boolean } [immediateSpawn] WARNINGをスキップして即座に出現させるか（テスト用）
     */
    startBossSequence(sound, immediateSpawn = false) {
      if (this.boss.active || this.boss.warningActive) return;

      if (immediateSpawn) {
        this._activateBossEntity();
        return;
      }

      this.boss.warningActive = true;
      this.boss.warningTimer = CONFIG.ENEMY.BOSS.WARNING_DURATION;
      if (sound) sound.playWarning();
    }

    _activateBossEntity() {
      this.boss.warningActive = false;
      this.boss.active = true;
      this.boss.entering = true;
      this.boss.x = CONFIG.SCREEN.WIDTH + 90;
      this.boss.y = (CONFIG.SCREEN.PLAY_TOP + CONFIG.SCREEN.PLAY_BOTTOM) * 0.5;
      this.boss.vy = 95 + (this.wave - 1) * 15;
      this.boss.maxHp = CONFIG.ENEMY.BOSS.CORE_HP_BASE + (this.wave - 1) * CONFIG.ENEMY.BOSS.CORE_HP_PER_WAVE;
      this.boss.hp = this.boss.maxHp;
      this.boss.flashTimer = 0;
      this.boss.attackPattern = 0;
      this.boss.patternTimer = 0;
      this.boss.chargeTimer = 0;
      this.boss.isChargingLaser = false;

      const shutterHp = CONFIG.ENEMY.BOSS.SHUTTER_HP + (this.wave - 1) * 20;
      for (let i = 0; i < this.boss.shutters.length; i++) {
        this.boss.shutters[i].hp = shutterHp;
        this.boss.shutters[i].maxHp = shutterHp;
        this.boss.shutters[i].active = true;
      }
    }

    /**
     * 毎フレームの敵スポーン・移動・AI更新
     * @param {number} dt
     * @param {PlayerController} player
     * @param {TerrainSystem} terrain
     * @param {SoundSystem} [sound]
     */
    update(dt, player, terrain, sound) {
      this.stageTimer += dt;

      // 1. ボス出現タイミング管理
      if (!this.boss.active && !this.boss.warningActive) {
        if (this.stageTimer >= CONFIG.TERRAIN.BOSS_SPAWN_TIME) {
          this.startBossSequence(sound, false);
        } else {
          this._updateRegularSpawns(dt, player, terrain);
        }
      }

      // 2. ボス WARNING カウントダウン
      if (this.boss.warningActive) {
        this.boss.warningTimer -= dt;
        if (this.boss.warningTimer <= 0) {
          this._activateBossEntity();
        }
      }

      // 3. ボス本体AIと攻撃ローテーション更新
      if (this.boss.active) {
        this._updateBossAI(dt, player);
      }

      // 4. 一般敵・中型敵の移動と射撃更新
      this.enemyPool.forEachActive((e) => {
        e.age += dt;
        if (e.flashTimer > 0) e.flashTimer = Math.max(0, e.flashTimer - dt);

        if (e.type === 'RED_SQUAD') {
          e.x += e.vx * dt;
          e.y = e.baseY + Math.sin(e.age * 5.2 + e.phase) * 42;
        } else if (e.type === 'WAVE') {
          e.x += e.vx * dt;
          e.y = e.baseY + Math.sin(e.age * 4.5 + e.phase) * 52;
          e.fireTimer -= dt;
          if (e.fireTimer <= 0 && player && player.alive && e.x > player.x + 60) {
            this._fireAimedShot(e.x - 10, e.y, player.x, player.y, 260);
            e.fireTimer = 2.0;
          }
        } else if (e.type === 'RUSH') {
          // 出現直後に自機のY座標へ急速ホーミングし、その後水平突進
          if (e.age < 0.45 && player && player.alive) {
            const diffY = player.y - e.y;
            e.y += Math.sign(diffY) * Math.min(Math.abs(diffY), 190 * dt);
          }
          e.x += e.vx * dt;
        } else if (e.type === 'TURRET') {
          e.x += e.vx * dt;
          if (terrain) {
            if (e.isCeilingTurret) {
              e.y = terrain.getTerrainTopAt(e.x) + e.height * 0.45;
            } else {
              e.y = terrain.getTerrainBottomAt(e.x) - e.height * 0.45;
            }
          }
          e.fireTimer -= dt;
          if (e.fireTimer <= 0 && player && player.alive && e.x > 80 && e.x < CONFIG.SCREEN.WIDTH - 30) {
            this._fireAimedShot(e.x - 6, e.y, player.x, player.y, 240);
            e.fireTimer = 1.65;
          }
        } else if (e.type === 'MEDIUM') {
          // 一定距離進入後、X=600付近で停止して上下移動しながら扇状3WAY弾を発射（3.5節）
          if (e.x > 610) {
            e.x += e.vx * dt;
          } else {
            e.y += e.vy * dt;
            const topLim = (terrain ? terrain.getTerrainTopAt(e.x) : CONFIG.SCREEN.PLAY_TOP) + 40;
            const botLim = (terrain ? terrain.getTerrainBottomAt(e.x) : CONFIG.SCREEN.PLAY_BOTTOM) - 40;
            if (e.y < topLim) { e.y = topLim; e.vy = Math.abs(e.vy); }
            if (e.y > botLim) { e.y = botLim; e.vy = -Math.abs(e.vy); }
          }

          e.fireTimer -= dt;
          if (e.fireTimer <= 0 && player && player.alive) {
            this._fireFanShots(e.x - 20, e.y, player.x, player.y, 3, 0.26, 270);
            e.fireTimer = 1.55;
          }
        }

        // プレイ領域上下のクランプ（地形砲台以外）
        if (e.type !== 'TURRET') {
          const minY = CONFIG.SCREEN.PLAY_TOP + e.height * 0.5;
          const maxY = CONFIG.SCREEN.PLAY_BOTTOM - e.height * 0.5;
          if (e.y < minY) e.y = minY;
          if (e.y > maxY) e.y = maxY;
        }

        // 左端から画面外へ出た敵の除外（赤編隊の場合は逃がしたため編隊ボーナス無効化）
        if (e.x < -50) {
          if (e.squadronId > 0) {
            this.squadronRemaining[e.squadronId] = -1;
          }
          this.enemyPool.release(e);
        }
      });

      // 5. 敵弾の更新
      this.bulletPool.forEachActive((b) => {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (
          b.x < -40 ||
          b.x > CONFIG.SCREEN.WIDTH + 40 ||
          b.y < CONFIG.SCREEN.PLAY_TOP - 10 ||
          b.y > CONFIG.SCREEN.PLAY_BOTTOM + 10
        ) {
          this.bulletPool.release(b);
        }
      });

      // 6. パワーアップカプセルの更新
      this.capsulePool.forEachActive((c) => {
        c.age += dt;
        c.x += c.vx * dt;
        c.y += Math.sin(c.age * 6) * 18 * dt;
        if (c.x < -25) {
          this.capsulePool.release(c);
        }
      });
    }

    /**
     * 通常ステージ中の雑魚・編隊・中型機スポーン制御
     * @private
     */
    _updateRegularSpawns(dt, player, terrain) {
      // 赤色カプセル編隊スポーン（約5.5秒ごと）
      this.squadTimer -= dt;
      if (this.squadTimer <= 0) {
        const randY = CONFIG.SCREEN.PLAY_TOP + 90 + Math.random() * (CONFIG.SCREEN.PLAY_BOTTOM - CONFIG.SCREEN.PLAY_TOP - 180);
        this.spawnRedSquadron(randY);
        this.squadTimer = 5.2;
      }

      // 一般雑魚・地上砲台スポーン
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        const topLim = terrain ? terrain.getTerrainTopAt(CONFIG.SCREEN.WIDTH - 10) : CONFIG.SCREEN.PLAY_TOP;
        const botLim = terrain ? terrain.getTerrainBottomAt(CONFIG.SCREEN.WIDTH - 10) : CONFIG.SCREEN.PLAY_BOTTOM;
        const safeSpan = Math.max(80, botLim - topLim - 80);
        const spawnY = topLim + 40 + Math.random() * safeSpan;

        const roll = Math.random();
        if (roll < 0.48) {
          this.spawnEnemy('WAVE', CONFIG.SCREEN.WIDTH + 20, spawnY, { phase: Math.random() * 3 });
        } else if (roll < 0.82) {
          this.spawnEnemy('RUSH', CONFIG.SCREEN.WIDTH + 20, spawnY);
        } else if (terrain && terrain.cavernActive) {
          const isCeiling = Math.random() < 0.45;
          const turretY = isCeiling ? topLim + 10 : botLim - 10;
          this.spawnEnemy('TURRET', CONFIG.SCREEN.WIDTH + 10, turretY, {
            isCeilingTurret: isCeiling,
            dropsCapsule: Math.random() < 0.35
          });
        } else {
          this.spawnEnemy('WAVE', CONFIG.SCREEN.WIDTH + 20, spawnY);
        }

        this.spawnTimer = Math.max(0.42, 0.95 - (this.wave - 1) * 0.08);
      }

      // 中型敵スポーン（約9.5秒ごと、必ずカプセルをドロップ）
      this.mediumTimer -= dt;
      if (this.mediumTimer <= 0) {
        const spawnY = CONFIG.SCREEN.PLAY_TOP + 120 + Math.random() * (CONFIG.SCREEN.PLAY_BOTTOM - CONFIG.SCREEN.PLAY_TOP - 240);
        this.spawnEnemy('MEDIUM', CONFIG.SCREEN.WIDTH + 35, spawnY, { dropsCapsule: true });
        this.mediumTimer = 9.0;
      }
    }

    /**
     * ビッグコア型ボスの移動・攻撃パターンローテーション制御（3.5節）
     * @private
     */
    _updateBossAI(dt, player) {
      const b = this.boss;
      if (b.flashTimer > 0) b.flashTimer = Math.max(0, b.flashTimer - dt);

      if (b.entering) {
        b.x -= 140 * dt;
        if (b.x <= 650) {
          b.x = 650;
          b.entering = false;
        }
        return;
      }

      // 上下反復移動
      b.y += b.vy * dt;
      const minY = CONFIG.SCREEN.PLAY_TOP + b.height * 0.5 + 18;
      const maxY = CONFIG.SCREEN.PLAY_BOTTOM - b.height * 0.5 - 18;
      if (b.y < minY) { b.y = minY; b.vy = Math.abs(b.vy); }
      if (b.y > maxY) { b.y = maxY; b.vy = -Math.abs(b.vy); }

      b.patternTimer += dt;

      // パターン0：予告線付き4連極太ビーム照射
      if (b.attackPattern === 0) {
        if (b.patternTimer > 0.7 && b.patternTimer < 1.55) {
          b.isChargingLaser = true;
          b.chargeTimer += dt;
        } else if (b.isChargingLaser && b.patternTimer >= 1.55) {
          b.isChargingLaser = false;
          const offsets = [-46, -18, 18, 46];
          for (let i = 0; i < offsets.length; i++) {
            this.fireEnemyBullet(b.x - 45, b.y + offsets[i], -560, 0, true);
          }
        }
        if (b.patternTimer >= 2.7) {
          b.patternTimer = 0;
          b.attackPattern = 1;
        }
      }
      // パターン1：自機狙い5WAY拡散弾幕
      else if (b.attackPattern === 1) {
        if (b.patternTimer >= 0.85) {
          b.patternTimer = 0;
          if (player && player.alive) {
            this._fireFanShots(b.x - 48, b.y, player.x, player.y, 5, 0.22, 300);
          }
          b.attackPattern = 2;
        }
      }
      // パターン2：護衛赤カプセル編隊の召喚＋全方位リング弾
      else {
        if (b.patternTimer >= 1.2) {
          b.patternTimer = 0;
          // 全方位8方向弾
          for (let i = 0; i < 8; i++) {
            const ang = (Math.PI * 2 * i) / 8;
            this.fireEnemyBullet(b.x - 30, b.y, Math.cos(ang) * 210, Math.sin(ang) * 210, false);
          }
          // ボス戦中もカプセル補給できるよう赤色護衛機をスポーン
          this.spawnEnemy('RED_SQUAD', CONFIG.SCREEN.WIDTH + 15, b.y - 70, { dropsCapsule: true });
          b.attackPattern = 0;
        }
      }
    }

    _fireAimedShot(sx, sy, tx, ty, speed) {
      const angle = Math.atan2(ty - sy, tx - sx);
      this.fireEnemyBullet(sx, sy, Math.cos(angle) * speed, Math.sin(angle) * speed, false);
    }

    _fireFanShots(sx, sy, tx, ty, count, spreadRad, speed) {
      const baseAngle = Math.atan2(ty - sy, tx - sx);
      const half = (count - 1) * 0.5;
      for (let i = 0; i < count; i++) {
        const ang = baseAngle + (i - half) * spreadRad;
        this.fireEnemyBullet(sx, sy, Math.cos(ang) * speed, Math.sin(ang) * speed, false);
      }
    }

    /**
     * 敵・ボス・カプセル・敵弾の描画
     * @param {CanvasRenderingContext2D} ctx
     */
    render(ctx) {
      ctx.save();

      // 1. パワーアップカプセル（赤 / 青）の描画
      this.capsulePool.forEachActive((c) => {
        const pulse = 1 + 0.16 * Math.sin(c.age * 12);
        const r = c.radius * pulse;

        ctx.fillStyle = c.isBlue ? 'rgba(56, 189, 248, 0.35)' : 'rgba(239, 68, 68, 0.35)';
        ctx.beginPath();
        ctx.arc(c.x, c.y, r * 1.45, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = c.isBlue ? '#0ea5e9' : '#ef4444';
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.fill();

        // カプセル中央の白帯とハイライト
        ctx.fillStyle = '#fef08a';
        ctx.fillRect(c.x - r * 0.75, c.y - 2, r * 1.5, 4);
      });

      // 2. 雑魚敵・中型敵の描画
      this.enemyPool.forEachActive((e) => {
        ctx.save();
        ctx.translate(e.x, e.y);

        const isFlashing = e.flashTimer > 0;

        if (e.type === 'RED_SQUAD') {
          ctx.fillStyle = isFlashing ? '#ffffff' : '#ef4444';
          ctx.beginPath();
          ctx.moveTo(-11, 0);
          ctx.lineTo(9, -9);
          ctx.lineTo(5, 0);
          ctx.lineTo(9, 9);
          ctx.closePath();
          ctx.fill();

          ctx.fillStyle = '#fef08a';
          ctx.fillRect(-4, -2, 6, 4);
        } else if (e.type === 'RUSH') {
          ctx.fillStyle = isFlashing ? '#ffffff' : '#f97316';
          ctx.beginPath();
          ctx.moveTo(-12, 0);
          ctx.lineTo(10, -7);
          ctx.lineTo(12, 0);
          ctx.lineTo(10, 7);
          ctx.closePath();
          ctx.fill();
        } else if (e.type === 'WAVE') {
          ctx.fillStyle = isFlashing ? '#ffffff' : '#a855f7';
          ctx.beginPath();
          ctx.ellipse(0, 0, 12, 9, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#38bdf8';
          ctx.beginPath();
          ctx.arc(-3, 0, 4, 0, Math.PI * 2);
          ctx.fill();
        } else if (e.type === 'TURRET') {
          ctx.fillStyle = isFlashing ? '#ffffff' : '#64748b';
          ctx.fillRect(-11, -9, 22, 18);
          ctx.fillStyle = '#f43f5e';
          ctx.fillRect(-14, -3, 10, 6);
        } else if (e.type === 'MEDIUM') {
          // 中型重装甲艦
          ctx.fillStyle = isFlashing ? '#ffffff' : '#eab308';
          ctx.beginPath();
          ctx.moveTo(-23, -8);
          ctx.lineTo(-8, -18);
          ctx.lineTo(22, -14);
          ctx.lineTo(23, 14);
          ctx.lineTo(-8, 18);
          ctx.lineTo(-23, 8);
          ctx.closePath();
          ctx.fill();

          // 中型艦のコア
          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.arc(-6, 0, 7, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      });

      // 3. ビッグコア型ボスの描画
      if (this.boss.active) {
        this._renderBoss(ctx);
      }

      // 4. 敵弾＆ボスレーザーの描画
      this.bulletPool.forEachActive((b) => {
        if (b.isBossLaser) {
          ctx.fillStyle = '#f43f5e';
          ctx.fillRect(b.x - b.width * 0.5, b.y - b.height * 0.5, b.width, b.height);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(b.x - b.width * 0.45, b.y - b.height * 0.2, b.width * 0.9, b.height * 0.4);
        } else {
          ctx.fillStyle = '#fb7185';
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.radius * 1.35, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fff1f2';
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.radius * 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      ctx.restore();
    }

    /**
     * ビッグコア MK-II ボス（装甲・遮蔽板・中心赤コア・レーザー予告線）の描画
     * @private
     */
    _renderBoss(ctx) {
      const b = this.boss;
      ctx.save();

      // レーザーチャージ予告線（4門）
      if (b.isChargingLaser) {
        const offsets = [-46, -18, 18, 46];
        ctx.strokeStyle = 'rgba(244, 63, 94, 0.55)';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        for (let i = 0; i < offsets.length; i++) {
          ctx.beginPath();
          ctx.moveTo(b.x - 45, b.y + offsets[i]);
          ctx.lineTo(0, b.y + offsets[i]);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      ctx.translate(b.x, b.y);
      const isFlash = b.flashTimer > 0;

      // ボス上下ウイング装甲
      ctx.fillStyle = isFlash ? '#ffffff' : '#475569';
      ctx.beginPath();
      ctx.moveTo(-55, -26);
      ctx.lineTo(-15, -75);
      ctx.lineTo(52, -52);
      ctx.lineTo(55, 52);
      ctx.lineTo(-15, 75);
      ctx.lineTo(-55, 26);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2;
      ctx.stroke();

      // 中心コア通路（ダークキャビティ）
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(-48, -34, 68, 68);

      // 中心の巨大赤コア（弱点）
      const coreGrad = ctx.createRadialGradient(4, 0, 3, 4, 0, 22);
      coreGrad.addColorStop(0, '#ffffff');
      coreGrad.addColorStop(0.35, '#fef08a');
      coreGrad.addColorStop(0.7, '#ef4444');
      coreGrad.addColorStop(1, '#7f1d1d');
      ctx.fillStyle = isFlash ? '#ffffff' : coreGrad;
      ctx.beginPath();
      ctx.arc(4, 0, 21, 0, Math.PI * 2);
      ctx.fill();

      // 前面の遮蔽板（シャッター4枚）
      for (let i = 0; i < b.shutters.length; i++) {
        const sh = b.shutters[i];
        if (!sh.active) continue;
        const ratio = sh.hp / sh.maxHp;
        ctx.fillStyle = ratio > 0.5 ? '#38bdf8' : '#f97316';
        ctx.fillRect(-42, sh.yOffset - sh.height * 0.5, 14, sh.height);
        ctx.strokeStyle = '#e2e8f0';
        ctx.strokeRect(-42, sh.yOffset - sh.height * 0.5, 14, sh.height);
      }

      ctx.restore();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = EnemySystem;
  }
  root.GradiusSTG = root.GradiusSTG || {};
  root.GradiusSTG.EnemySystem = EnemySystem;
})(typeof window !== 'undefined' ? window : globalThis);
