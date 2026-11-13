/**
 * @file collision.js
 * @description 物理・衝突判定エンジン（AABB矩形、円形距離、帯状レーザー、線形補間地形高度比較）（仕様書 3.6節準拠）
 */
(function (root) {
  'use strict';

  const CONFIG = (typeof module !== 'undefined' && module.exports)
    ? require('./config.js')
    : root.GradiusSTG.CONFIG;

  class CollisionSystem {
    /**
     * 1. 矩形（AABB）衝突判定（中心座標ベース）（3.6節）
     */
    static checkAABB(ax, ay, aw, ah, bx, by, bw, bh) {
      return (
        Math.abs(ax - bx) <= (aw + bw) * 0.5 &&
        Math.abs(ay - by) <= (ah + bh) * 0.5
      );
    }

    /**
     * 2. 円形（距離計算）衝突判定（三平方の定理）（3.6節）
     */
    static checkCircle(ax, ay, ar, bx, by, br) {
      const dx = ax - bx;
      const dy = ay - by;
      const dist = Math.sqrt(dx * dx + dy * dy);
      return dist <= (ar + br);
    }

    /**
     * 3. 帯状（横長矩形）レーザー衝突判定（3.6節、TC-WP-01）
     * @param {Object} laser { startX, endX, y, height }
     * @param {number} tx ターゲット中心X
     * @param {number} ty ターゲット中心Y
     * @param {number} tw ターゲット幅
     * @param {number} th ターゲット高さ
     */
    static checkLaserBand(laser, tx, ty, tw, th) {
      const targetLeft = tx - tw * 0.5;
      const targetRight = tx + tw * 0.5;
      const effectiveEndX = laser.visualMaxX !== undefined ? Math.min(laser.endX, laser.visualMaxX) : laser.endX;

      if (targetRight < laser.startX || targetLeft > effectiveEndX) {
        return false;
      }

      const halfBand = laser.height * 0.5 + th * 0.5 + CONFIG.WEAPON.LASER.HIT_PAD_Y;
      return Math.abs(laser.y - ty) <= halfBand;
    }

    /**
     * 4. 線形補間（高さ比較）地形衝突判定（3.6節、TC-CL-01）
     * @param {number} x
     * @param {number} y
     * @param {number} radius
     * @param {TerrainSystem} terrain
     * @returns {boolean} 地形内部に接触・めり込んだ場合 true
     */
    static checkTerrainCollision(x, y, radius, terrain) {
      if (!terrain) return false;
      const topLimit = terrain.getTerrainTopAt(x);
      const bottomLimit = terrain.getTerrainBottomAt(x);

      const hasTopWall = topLimit > CONFIG.SCREEN.PLAY_TOP + 1.0;
      const hasBottomWall = bottomLimit < CONFIG.SCREEN.PLAY_BOTTOM - 1.0;

      if (hasTopWall && (y - radius <= topLimit)) {
        return true;
      }
      if (hasBottomWall && (y + radius >= bottomLimit)) {
        return true;
      }
      return false;
    }

    /**
     * ゲーム全体の当たり判定を一括処理する
     * @param {Object} game GameStateManagerインスタンス
     */
    processAll(game) {
      const player = game.player;
      const weapons = game.weapons;
      const enemies = game.enemies;
      const terrain = game.terrain;
      const effects = game.effects;
      const sound = game.sound;

      // --- A. 貫通ロングレーザー vs 雑魚敵・中型敵・ボス（帯状判定） ---
      weapons.laserPool.forEachActive((laser) => {
        laser.visualMaxX = CONFIG.SCREEN.WIDTH;

        // A-1. ボス遮蔽板（シャッター）との判定（遮蔽板が生きていればレーザーをせき止めてダメージを与える）
        if (enemies.boss.active && !enemies.boss.entering) {
          const boss = enemies.boss;
          const shutterX = boss.x - 35;
          for (let i = 0; i < boss.shutters.length; i++) {
            const sh = boss.shutters[i];
            if (!sh.active) continue;
            const shY = boss.y + sh.yOffset;
            if (CollisionSystem.checkLaserBand(laser, shutterX, shY, 16, sh.height)) {
              sh.hp -= laser.damagePerTick;
              boss.flashTimer = 0.05;
              effects.spawnLaserSpark(shutterX - 6, laser.y, laser.level >= 2);
              if (sound) sound.playHitSpark();

              if (sh.hp <= 0) {
                sh.active = false;
                effects.spawnExplosion(shutterX, shY, 'medium');
                if (sound) sound.playExplosion('medium', game.comboCount);
                game.addScore(500, shutterX, shY, 'SHUTTER BREAK!');
              } else {
                // 遮蔽板がまだ残っている場合はそこでレーザーが止まる
                laser.visualMaxX = Math.min(laser.visualMaxX, shutterX);
              }
            }
          }

          // A-2. ボス中心コア（弱点）との判定
          const coreX = boss.x + 4;
          const coreY = boss.y;
          if (CollisionSystem.checkLaserBand(laser, coreX, coreY, 42, 42)) {
            boss.hp -= laser.damagePerTick;
            boss.flashTimer = 0.05;
            effects.spawnLaserSpark(coreX - 14, laser.y, laser.level >= 2);
            if (sound) sound.playHitSpark();

            if (boss.hp <= 0) {
              game.onBossDefeated();
            }
          } else if (CollisionSystem.checkLaserBand(laser, boss.x, boss.y, boss.width, boss.height)) {
            // ボス上下装甲部への軽減ダメージ
            boss.hp -= laser.damagePerTick * 0.25;
            effects.spawnLaserSpark(boss.x - 30, laser.y, false);
            if (boss.hp <= 0) {
              game.onBossDefeated();
            }
          }
        }

        // A-3. 一般雑魚敵および中型敵との判定（雑魚は一撃貫通、中型は継続ダメージ：3.2節、TC-WP-01）
        enemies.enemyPool.forEachActive((e) => {
          if (CollisionSystem.checkLaserBand(laser, e.x, e.y, e.width, e.height)) {
            if (e.type !== 'MEDIUM') {
              // 耐久力のない一般雑魚敵は同一フレーム内で貫通撃破（レーザーは消滅しない）
              e.hp = 0;
              game.onEnemyKilled(e);
            } else {
              // 中型敵は毎フレーム継続ダメージ
              e.hp -= laser.damagePerTick * 1.35;
              e.flashTimer = 0.05;
              effects.spawnLaserSpark(e.x - e.width * 0.4, laser.y, laser.level >= 2);
              if (sound) sound.playHitSpark();
              if (e.hp <= 0) {
                game.onEnemyKilled(e);
              }
            }
          }
        });
      });

      // --- B. 通常ショット・ダブル vs 敵・ボス・地形 ---
      weapons.bulletPool.forEachActive((b) => {
        // 地形に当たった通常弾は消滅
        if (terrain && CollisionSystem.checkTerrainCollision(b.x, b.y, 2, terrain)) {
          weapons.bulletPool.release(b);
          return;
        }

        // 一般敵・中型敵とのAABB判定
        let hit = false;
        enemies.enemyPool.forEachActive((e) => {
          if (hit) return;
          if (CollisionSystem.checkAABB(b.x, b.y, b.width, b.height, e.x, e.y, e.width, e.height)) {
            hit = true;
            e.hp -= b.damage;
            e.flashTimer = 0.06;
            if (e.hp <= 0) {
              game.onEnemyKilled(e);
            }
          }
        });

        // ボスとの判定
        if (!hit && enemies.boss.active && !enemies.boss.entering) {
          const boss = enemies.boss;
          const shutterX = boss.x - 35;
          for (let i = 0; i < boss.shutters.length; i++) {
            const sh = boss.shutters[i];
            if (!sh.active) continue;
            const shY = boss.y + sh.yOffset;
            if (CollisionSystem.checkAABB(b.x, b.y, b.width, b.height, shutterX, shY, 16, sh.height)) {
              hit = true;
              sh.hp -= b.damage;
              boss.flashTimer = 0.05;
              if (sh.hp <= 0) {
                sh.active = false;
                effects.spawnExplosion(shutterX, shY, 'medium');
                if (sound) sound.playExplosion('medium', game.comboCount);
                game.addScore(500, shutterX, shY, 'SHUTTER BREAK!');
              }
              break;
            }
          }

          if (!hit && CollisionSystem.checkAABB(b.x, b.y, b.width, b.height, boss.x + 4, boss.y, 44, 44)) {
            hit = true;
            boss.hp -= b.damage;
            boss.flashTimer = 0.06;
            if (boss.hp <= 0) {
              game.onBossDefeated();
            }
          } else if (!hit && CollisionSystem.checkAABB(b.x, b.y, b.width, b.height, boss.x, boss.y, boss.width, boss.height)) {
            hit = true;
            boss.hp -= b.damage * 0.25;
            if (boss.hp <= 0) {
              game.onBossDefeated();
            }
          }
        }

        if (hit) {
          weapons.bulletPool.release(b);
        }
      });

      // --- C. 地表滑行ミサイル vs 敵・ボス ---
      weapons.missilePool.forEachActive((m) => {
        let hit = false;
        enemies.enemyPool.forEachActive((e) => {
          if (hit) return;
          if (CollisionSystem.checkAABB(m.x, m.y, m.width, m.height, e.x, e.y, e.width, e.height)) {
            hit = true;
            e.hp -= m.damage;
            e.flashTimer = 0.08;
            effects.spawnExplosion(m.x, m.y, 'small');
            if (e.hp <= 0) {
              game.onEnemyKilled(e);
            }
          }
        });

        if (!hit && enemies.boss.active && !enemies.boss.entering) {
          const boss = enemies.boss;
          if (CollisionSystem.checkAABB(m.x, m.y, m.width, m.height, boss.x, boss.y, boss.width, boss.height)) {
            hit = true;
            boss.hp -= m.damage * 0.7;
            boss.flashTimer = 0.07;
            effects.spawnExplosion(m.x, m.y, 'small');
            if (boss.hp <= 0) {
              game.onBossDefeated();
            }
          }
        }

        if (hit) {
          weapons.missilePool.release(m);
        }
      });

      if (!player || !player.alive) return;

      // --- D. 自機 vs パワーアップカプセル（赤 / 青） ---
      enemies.capsulePool.forEachActive((c) => {
        if (CollisionSystem.checkAABB(player.x, player.y, player.width + 8, player.height + 8, c.x, c.y, c.radius * 2, c.radius * 2)) {
          enemies.capsulePool.release(c);
          game.onCapsuleCollected(c.isBlue, c.x, c.y);
        }
      });

      // --- E. 自機 / シールド vs 敵弾（円形距離判定＆かすりGRAZE判定：3.6節） ---
      const shieldBounds = player.getShieldBounds();
      enemies.bulletPool.forEachActive((eb) => {
        // E-1. 前方シールドでの防御判定
        if (shieldBounds && CollisionSystem.checkAABB(
          shieldBounds.x, shieldBounds.y, shieldBounds.width, shieldBounds.height,
          eb.x, eb.y, eb.width, eb.height
        )) {
          enemies.bulletPool.release(eb);
          player.damageShield(1);
          effects.spawnLaserSpark(shieldBounds.x, eb.y, false);
          if (sound) sound.playHitSpark();
          return;
        }

        // E-2. 自機中心の極小円判定（半径 5px vs 敵弾半径）
        if (CollisionSystem.checkCircle(player.x, player.y, player.hitboxRadius, eb.x, eb.y, eb.radius)) {
          enemies.bulletPool.release(eb);
          if (player.shieldHp > 0) {
            player.damageShield(1);
            effects.spawnLaserSpark(player.x + 10, player.y, false);
          } else {
            game.onPlayerHit();
          }
          return;
        }

        // E-3. かすり（GRAZE）ボーナス判定（スリリングな回避への報酬）
        if (!eb.grazed && CollisionSystem.checkCircle(player.x, player.y, player.grazeRadius, eb.x, eb.y, eb.radius)) {
          eb.grazed = true;
          game.addScore(50, player.x, player.y - 16, 'GRAZE +50');
          effects.spawnLaserSpark(player.x, player.y, false);
        }
      });

      if (!player.alive) return;

      // --- F. 自機 / シールド vs 敵機本体・ボス本体（AABB矩形判定：3.6節、TC-PL-02） ---
      enemies.enemyPool.forEachActive((e) => {
        if (!player.alive) return;
        const sb = player.getShieldBounds();
        if (sb && CollisionSystem.checkAABB(sb.x, sb.y, sb.width, sb.height, e.x, e.y, e.width, e.height)) {
          player.damageShield(1);
          e.hp -= 40;
          if (e.hp <= 0) game.onEnemyKilled(e);
          return;
        }

        if (CollisionSystem.checkAABB(player.x, player.y, player.width * 0.55, player.height * 0.55, e.x, e.y, e.width * 0.8, e.height * 0.8)) {
          if (player.shieldHp > 0) {
            player.damageShield(1);
            e.hp -= 40;
            if (e.hp <= 0) game.onEnemyKilled(e);
          } else {
            game.onPlayerHit();
          }
        }
      });

      if (player.alive && enemies.boss.active && !enemies.boss.entering) {
        const boss = enemies.boss;
        if (CollisionSystem.checkAABB(player.x, player.y, player.width * 0.55, player.height * 0.55, boss.x, boss.y, boss.width * 0.85, boss.height * 0.85)) {
          if (player.shieldHp > 0) {
            player.damageShield(2);
          } else {
            game.onPlayerHit();
          }
        }
      }

      // --- G. 自機 vs スクロール地形（線形補間高さ比較判定：3.6節、TC-CL-01） ---
      if (player.alive && CollisionSystem.checkTerrainCollision(player.x, player.y, player.hitboxRadius + 2, terrain)) {
        if (player.shieldHp > 0) {
          player.damageShield(1);
          // 地形から少し押し戻す
          const topY = terrain.getTerrainTopAt(player.x);
          const botY = terrain.getTerrainBottomAt(player.x);
          if (player.y - topY < botY - player.y) {
            player.y = topY + player.hitboxRadius + 6;
          } else {
            player.y = botY - player.hitboxRadius - 6;
          }
        } else {
          game.onPlayerHit();
        }
      }
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CollisionSystem;
  }
  root.GradiusSTG = root.GradiusSTG || {};
  root.GradiusSTG.CollisionSystem = CollisionSystem;
})(typeof window !== 'undefined' ? window : globalThis);
