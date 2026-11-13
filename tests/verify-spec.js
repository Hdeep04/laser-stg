/**
 * @file verify-spec.js
 * @description gradius-laser-stg-spec.md 第5章「機能・システム検証テストマトリクス」の全10項目自動検証スクリプト
 */
'use strict';

const assert = require('assert');
const CONFIG = require('../src/config.js');
const GameStateManager = require('../src/game.js');

function runAllSpecTests() {
  console.log('=== GRADIUS LASER STG - 仕様書テストマトリクス検証開始 ===\n');

  // ---------------------------------------------------------------------------
  // TC-PL-01: 自機8方向移動・境界クランプ
  // ---------------------------------------------------------------------------
  {
    const game = new GameStateManager(null);
    game.startNewGame();

    // 左上方向へ200フレーム押し続ける
    game.input.left = true;
    game.input.up = true;
    for (let i = 0; i < 200; i++) game.player.update(game.input, CONFIG.SCREEN.FIXED_DT);

    const minX = CONFIG.PLAYER.CLAMP_MARGIN_X;
    const minY = CONFIG.SCREEN.PLAY_TOP + CONFIG.PLAYER.CLAMP_MARGIN_Y;
    assert.strictEqual(game.player.x, minX, '左端クランプ位置が一致すること');
    assert.strictEqual(game.player.y, minY, '上端HUD境界クランプ位置が一致すること');

    // 右下方向へ300フレーム押し続ける
    game.input.left = false;
    game.input.up = false;
    game.input.right = true;
    game.input.down = true;
    for (let i = 0; i < 300; i++) game.player.update(game.input, CONFIG.SCREEN.FIXED_DT);

    const maxX = CONFIG.SCREEN.WIDTH - CONFIG.PLAYER.CLAMP_MARGIN_X;
    const maxY = CONFIG.SCREEN.PLAY_BOTTOM - CONFIG.PLAYER.CLAMP_MARGIN_Y;
    assert.strictEqual(game.player.x, maxX, '右端クランプ位置が一致すること');
    assert.strictEqual(game.player.y, maxY, '下端HUD境界クランプ位置が一致すること');

    console.log('[PASS] TC-PL-01: 自機8方向移動・境界クランプ');
  }

  // ---------------------------------------------------------------------------
  // TC-PL-02: 自機被弾・装備リセット・その場復活とカプセル救済
  // ---------------------------------------------------------------------------
  {
    const game = new GameStateManager(null);
    game.startNewGame();
    game.player.invincibleFrames = 0;
    game.applyFullPowerPreset();
    game.player.invincibleFrames = 0;
    game.player.shieldHp = 0; // シールドなし状態で被弾テスト

    const initialLives = game.player.lives;
    // 自機座標に敵弾を配置して衝突判定
    game.enemies.fireEnemyBullet(game.player.x, game.player.y, 0, 0, false);
    game.collision.processAll(game);

    assert.strictEqual(game.player.lives, initialLives - 1, '被弾により残機が1減ること');
    assert.strictEqual(game.player.speedLevel, 0, 'スピード装備が初期化されること');
    assert.strictEqual(game.player.laserLevel, 0, 'レーザー装備が初期化されること');
    assert.strictEqual(game.player.optionSystem.activeCount, 0, 'オプションが初期化されること');
    assert.ok(game.enemies.capsulePool.activeCount >= 2, 'リカバリー用の赤カプセルが放出されること');

    console.log('[PASS] TC-PL-02: 自機被弾・全装備リセット・リカバリー赤カプセル放出');
  }

  // ---------------------------------------------------------------------------
  // TC-WP-01: レーザー貫通処理＆赤色編隊全滅ボーナス
  // ---------------------------------------------------------------------------
  {
    const game = new GameStateManager(null);
    game.startNewGame();
    game.enemies.enemyPool.clear();
    game.player.x = 100;
    game.player.y = 280;
    game.player.laserLevel = 1;

    // 同一Y軸上に横一列に5機の赤色編隊を配置
    const squadId = 5;
    game.enemies.squadronRemaining[squadId] = 5;
    for (let i = 0; i < 5; i++) {
      game.enemies.spawnEnemy('RED_SQUAD', 220 + i * 70, 280, { squadronId: squadId });
    }
    assert.strictEqual(game.enemies.enemyPool.activeCount, 5, '5機の雑魚敵が配置されていること');

    // 貫通レーザーを発射して衝突判定を実行
    game.weapons.tryFire(game.player, null);
    assert.strictEqual(game.weapons.laserPool.activeCount, 1, 'レーザーが1本生成されること');
    game.collision.processAll(game);

    assert.strictEqual(game.enemies.enemyPool.activeCount, 0, '横一列の雑魚敵5機すべてが1フレームで貫通撃破されること');
    assert.strictEqual(game.weapons.laserPool.activeCount, 1, '貫通後にレーザーが消滅せず残っていること');
    assert.strictEqual(game.enemies.capsulePool.activeCount, 1, '赤色編隊全滅により赤カプセルがドロップすること');

    console.log('[PASS] TC-WP-01: レーザー貫通処理＆赤色編隊全滅カプセルドロップ');
  }

  // ---------------------------------------------------------------------------
  // TC-WP-02: レーザーワインダー動作（自機Y座標移動への追従）
  // ---------------------------------------------------------------------------
  {
    const game = new GameStateManager(null);
    game.startNewGame();
    game.player.x = 120;
    game.player.y = 250;
    game.player.laserLevel = 1;

    game.weapons.tryFire(game.player, null);
    let activeLaser = null;
    game.weapons.laserPool.forEachActive((l) => { activeLaser = l; });
    assert.ok(activeLaser, 'レーザーが存在すること');
    assert.strictEqual(activeLaser.y, 250, '発射時のレーザーY座標が自機Y座標と一致すること');

    // 自機をY=340へ素早く移動させて武装更新
    game.player.y = 340;
    game.weapons.update(CONFIG.SCREEN.FIXED_DT, game.player, game.terrain);
    assert.strictEqual(activeLaser.y, 340, '発射済みレーザーのY座標が自機の移動に追従して変化すること');

    console.log('[PASS] TC-WP-02: レーザーワインダー動作（Y座標追従）');
  }

  // ---------------------------------------------------------------------------
  // TC-OP-01: オプション追従遅延（15/30フレーム）と停止時の陣形維持
  // ---------------------------------------------------------------------------
  {
    const game = new GameStateManager(null);
    game.startNewGame();
    game.player.optionSystem.addOption();
    game.player.optionSystem.addOption();

    const recordedPositions = [];
    game.input.right = true;
    game.input.down = true;

    for (let step = 0; step < 40; step++) {
      game.player.update(game.input, CONFIG.SCREEN.FIXED_DT);
      recordedPositions.push({ x: game.player.x, y: game.player.y });
    }

    const opt1 = game.player.optionSystem.options[0];
    const opt2 = game.player.optionSystem.options[1];
    const expectedOpt1 = recordedPositions[recordedPositions.length - 1 - 15];
    const expectedOpt2 = recordedPositions[recordedPositions.length - 1 - 30];

    assert.ok(Math.abs(opt1.x - expectedOpt1.x) < 1e-5 && Math.abs(opt1.y - expectedOpt1.y) < 1e-5, 'オプション1が正確に15フレーム前の座標をトレースすること');
    assert.ok(Math.abs(opt2.x - expectedOpt2.x) < 1e-5 && Math.abs(opt2.y - expectedOpt2.y) < 1e-5, 'オプション2が正確に30フレーム前の座標をトレースすること');

    // 自機をピタリと停止させて30フレーム経過させる（陣形維持の検証）
    game.input.right = false;
    game.input.down = false;
    for (let step = 0; step < 30; step++) {
      game.player.update(game.input, CONFIG.SCREEN.FIXED_DT);
    }
    assert.ok(Math.abs(opt1.x - expectedOpt1.x) < 1e-5 && Math.abs(opt2.x - expectedOpt2.x) < 1e-5, '自機停止時にオプションが自機へ収束せず展開陣形を維持すること');

    console.log('[PASS] TC-OP-01: オプション追従遅延（15/30フレーム）＆停止時陣形維持');
  }

  // ---------------------------------------------------------------------------
  // TC-PU-01: パワーアップゲージ進捗とループ
  // ---------------------------------------------------------------------------
  {
    const game = new GameStateManager(null);
    game.startNewGame();
    const expectedNames = ['SPEED UP', 'MISSILE', 'DOUBLE', 'LASER', 'OPTION', 'SHIELD', 'SPEED UP'];

    for (let i = 0; i < expectedNames.length; i++) {
      game.onCapsuleCollected(false, 100, 100);
      assert.strictEqual(game.gauge.getCurrentSlotName(), expectedNames[i], `${i + 1}個目の赤カプセルで ${expectedNames[i]} が選択されること`);
    }

    console.log('[PASS] TC-PU-01: パワーアップゲージ進捗とループ');
  }

  // ---------------------------------------------------------------------------
  // TC-PU-02: ダブル/レーザー排他制御＆2段階ハイパーレーザー強化
  // ---------------------------------------------------------------------------
  {
    const game = new GameStateManager(null);
    game.startNewGame();

    // カーソル3 (DOUBLE) を発動
    game.gauge.cursor = 3;
    game.gauge.activate(game.player, null, null);
    assert.strictEqual(game.player.doubleLevel, 1, 'ダブルLv1が装着されること');
    assert.strictEqual(game.player.laserLevel, 0, 'レーザーは0であること');
    assert.strictEqual(game.gauge.cursor, 0, '発動後にゲージカーソルが0にリセットされること');

    // カーソル4 (LASER) を発動 → ダブルが解除されレーザーLv1へ切り替わる
    game.gauge.cursor = 4;
    game.gauge.activate(game.player, null, null);
    assert.strictEqual(game.player.doubleLevel, 0, 'レーザー発動によりダブルが排他解除されること');
    assert.strictEqual(game.player.laserLevel, 1, 'レーザーLv1に切り替わること');

    // 再度カーソル4 (LASER) を発動 → ハイパーレーザー (Lv2) へ進化
    game.gauge.cursor = 4;
    game.gauge.activate(game.player, null, null);
    assert.strictEqual(game.player.laserLevel, 2, '2回目のレーザー発動でハイパーレーザー(Lv2)に強化されること');

    console.log('[PASS] TC-PU-02: ダブル/レーザー排他制御＆ハイパーレーザー2段階強化');
  }

  // ---------------------------------------------------------------------------
  // TC-CL-01: 地形線形補間衝突判定とミサイル地表滑行
  // ---------------------------------------------------------------------------
  {
    const game = new GameStateManager(null);
    game.startNewGame();
    game.terrain.setCavernMode(true, true);
    game.player.invincibleFrames = 0;
    game.player.missileLevel = 1;

    // ミサイルを発射して地表まで落下させ、滑行状態に移行するか検証
    game.weapons.tryFire(game.player, null);
    let missile = null;
    game.weapons.missilePool.forEachActive((m) => { missile = m; });
    assert.ok(missile, 'ミサイルが発射されること');

    for (let i = 0; i < 60; i++) {
      game.weapons.update(CONFIG.SCREEN.FIXED_DT, game.player, game.terrain);
    }
    assert.strictEqual(missile.state, 'sliding', '地面接触後にミサイルが地表滑行(sliding)状態へ移行すること');

    // 自機を補間計算された天井地形壁に接触させる
    const topWallY = game.terrain.getTerrainTopAt(game.player.x);
    game.player.y = topWallY + 2; // 壁境界に接触
    const prevLives = game.player.lives;
    game.collision.processAll(game);
    assert.strictEqual(game.player.lives, prevLives - 1, '補間地形壁との接触で正確にミス判定が下されること');

    console.log('[PASS] TC-CL-01: 地形線形補間衝突判定＆ミサイル地表滑行');
  }

  // ---------------------------------------------------------------------------
  // TC-BS-01: ボス遮蔽板破壊・コア集中照射・撃破時ヒットストップ（スローモーション）
  // ---------------------------------------------------------------------------
  {
    const game = new GameStateManager(null);
    game.startNewGame();
    game.applyFullPowerPreset();
    game.enemies.startBossSequence(null, true); // 即時ボス出現
    game.enemies.boss.entering = false;
    game.enemies.boss.x = 640;
    game.enemies.boss.y = 295;
    game.player.x = 120;
    game.player.y = 295;

    // ボスHPを残りわずかに設定し、レーザーを発射して撃破させる
    for (let i = 0; i < game.enemies.boss.shutters.length; i++) {
      game.enemies.boss.shutters[i].active = false;
    }
    game.enemies.boss.hp = 2;

    game.weapons.tryFire(game.player, null);
    game.collision.processAll(game);

    assert.strictEqual(game.enemies.boss.active, false, 'ボスのHPが0になり撃破されること');
    assert.strictEqual(game.effects.timeScale, CONFIG.ENEMY.BOSS.HITSTOP_TIMESCALE, '撃破の瞬間に時間軸が1/10のスローモーション(ヒットストップ)になること');
    assert.ok(game.effects.shakeIntensity >= 15, 'ボス撃破時に大画面シェイクが発生すること');
    assert.ok(game.effects.particlePool.activeCount >= 50, 'ボス撃破時に大量の爆発パーティクルが発生すること');

    console.log('[PASS] TC-BS-01: ボス撃破ヒットストップ（1/10スローモーション）＆大爆発シェイク');
  }

  // ---------------------------------------------------------------------------
  // TC-PF-01: 画面内大量オブジェクト時のプール再利用（GCゼロ）＆フレーム処理性能検証
  // ---------------------------------------------------------------------------
  {
    const game = new GameStateManager(null);
    game.startNewGame();
    game.applyFullPowerPreset();
    game.input.fire = true;

    const bulletRefs = new Set(game.weapons.bulletPool.items);
    const particleRefs = new Set(game.effects.particlePool.items);

    const startTime = process.hrtime.bigint();
    const totalFrames = 60 * 10; // 600フレーム分の高負荷シミュレーション
    for (let f = 0; f < totalFrames; f++) {
      if (f % 15 === 0) {
        game.enemies.spawnRedSquadron(180 + (f % 200));
        game.effects.spawnExplosion(400, 300, 'medium');
      }
      game.step(CONFIG.SCREEN.FIXED_DT);
    }
    const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1e6;
    const avgFrameMs = elapsedMs / totalFrames;

    // プール内の全オブジェクト参照が初期確保時のものと完全一致するか検証（新規生成ゼロ）
    for (const item of game.weapons.bulletPool.items) {
      assert.ok(bulletRefs.has(item), '弾プール配列要素が再生成されず再利用されていること');
    }
    for (const item of game.effects.particlePool.items) {
      assert.ok(particleRefs.has(item), 'パーティクルプール配列要素が再生成されず再利用されていること');
    }
    assert.ok(avgFrameMs < 2.0, `1フレームあたりの平均論理更新時間が十分高速であること (実測: ${avgFrameMs.toFixed(3)} ms/frame << 16.6ms)`);

    console.log(`[PASS] TC-PF-01: 大量弾幕・パーティクル時のプール再利用＆高速処理検証 (平均 ${avgFrameMs.toFixed(3)} ms/frame)`);
  }

  // ---------------------------------------------------------------------------
  // 追加検証: 全ステート・全エフェクトの Canvas 2D 描画パス検証
  // ---------------------------------------------------------------------------
  {
    const noop = () => {};
    const mockGrad = { addColorStop: noop };
    const mockCanvas = {
      width: 800,
      height: 600,
      getContext: () => ({
        save: noop,
        restore: noop,
        translate: noop,
        rotate: noop,
        beginPath: noop,
        closePath: noop,
        moveTo: noop,
        lineTo: noop,
        arc: noop,
        ellipse: noop,
        fill: noop,
        stroke: noop,
        fillRect: noop,
        strokeRect: noop,
        fillText: noop,
        setLineDash: noop,
        createLinearGradient: () => mockGrad,
        createRadialGradient: () => mockGrad
      })
    };

    const game = new GameStateManager(mockCanvas);
    // TITLE描画
    game.render();

    // PLAYING (洞窟＋フルパワー＋全敵タイプ＋ボスWARNING＋ボス本体＋デバッグHUD)
    game.startNewGame();
    game.ui.showDebug = true;
    game.terrain.setCavernMode(true, true);
    game.applyFullPowerPreset();
    game.enemies.spawnEnemy('WAVE', 400, 200);
    game.enemies.spawnEnemy('RUSH', 450, 250);
    game.enemies.spawnEnemy('TURRET', 500, 120, { isCeilingTurret: true });
    game.enemies.spawnEnemy('MEDIUM', 580, 300);
    game.enemies.spawnCapsule(300, 300, true);
    game.weapons.tryFire(game.player, null);
    game.enemies.startBossSequence(null, false);
    game.step(CONFIG.SCREEN.FIXED_DT);
    game.render();

    // ボス本体＋レーザー予告線描画
    game.enemies.startBossSequence(null, true);
    game.enemies.boss.isChargingLaser = true;
    game.player.laserLevel = 0;
    game.player.doubleLevel = 2;
    game.weapons.shotTimer = 0;
    game.weapons.tryFire(game.player, null);
    game.render();

    // PAUSED / GAMEOVER 描画
    game.state = 'PAUSED';
    game.render();
    game.state = 'GAMEOVER';
    game.render();

    console.log('[PASS] TC-RD-01: 全ゲーム状態・全武装・ボス・HUDのCanvas 2D描画パイプライン検証');
  }

  console.log('\n=== 全項目の仕様検証テストに合格しました (ALL TESTS PASSED) ===');
}

runAllSpecTests();
