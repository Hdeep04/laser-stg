/**
 * @file config.js
 * @description ゲーム全体の定数・バランス調整パラメータ定義（仕様書 4.3節準拠）
 */
(function (root) {
  'use strict';

  const CONFIG = {
    // 画面およびレイアウト定義（1.3節）
    SCREEN: {
      WIDTH: 800,
      HEIGHT: 600,
      PLAY_TOP: 40,
      PLAY_BOTTOM: 550,
      FIXED_DT: 1 / 60, // 60Hz 固定タイムステップ (16.666ms)
      MAX_FRAME_SKIP: 5
    },

    // 自機（ビックバイパー型）設定（3.1節、3.6節）
    PLAYER: {
      INITIAL_X: 100,
      INITIAL_Y: 295,
      WIDTH: 36,
      HEIGHT: 18,
      HITBOX_RADIUS: 5,     // 極小コックピット円判定（かすり回避用）
      GRAZE_RADIUS: 18,     // かすり（GRAZE）ボーナス判定半径
      CLAMP_MARGIN_X: 22,
      CLAMP_MARGIN_Y: 12,
      BASE_SPEED: 240,      // 初期移動速度 (px/s)
      SPEED_INCREMENT: 65,  // SPEED UP 1段階あたりの加算速度 (px/s)
      MAX_SPEED_LEVEL: 5,   // 最大5段階（超過再発動時は段階1へループリセット）
      INITIAL_LIVES: 3,
      RESPAWN_DELAY_FRAMES: 50,       // 被弾から再出現までの待機フレーム
      INVINCIBLE_FRAMES: 180,         // リスポーン後の無敵時間（3.0秒 = 180フレーム）
      MAX_TILT_ANGLE: 0.22            // 上下移動時の機体傾き角（ラジアン）
    },

    // オプション（追従子機）設定（3.3節）
    OPTION: {
      MAX_COUNT: 4,
      STEP_DELAY: 15,       // オプション間の履歴ステップ間隔（15, 30, 45, 60 フレーム遅延）
      BUFFER_SIZE: 128,     // 座標履歴リングバッファサイズ
      WIDTH: 16,
      HEIGHT: 12
    },

    // 武器・弾薬設定（3.2節）
    WEAPON: {
      POOL_SIZE_BULLETS: 120,
      POOL_SIZE_LASERS: 40,
      POOL_SIZE_MISSILES: 40,

      // 通常ショット & ダブル（DOUBLE）
      SHOT: {
        COOLDOWN_LV1: 0.11,
        COOLDOWN_LV2: 0.075,
        SPEED_LV1: 780,
        SPEED_LV2: 960,
        WIDTH: 14,
        HEIGHT: 4,
        DAMAGE: 12
      },

      // 貫通ロングレーザー（LASER Lv1 / HYPER LASER Lv2）
      LASER: {
        COOLDOWN: 0.14,
        EXTEND_SPEED: 2100,   // 先端伸長速度 (px/s)
        DURATION: 0.20,       // 1発あたりの照射持続時間（連射で隙間なく繋がる）
        HEIGHT_LV1: 6,
        HEIGHT_LV2: 16,       // ハイパーレーザー時は極太化
        HIT_PAD_Y: 4,         // 帯状判定の優遇拡大幅（3.6節）
        DAMAGE_PER_TICK_LV1: 2.4, // 60Hz毎ティックダメージ（約144 DPS/本、5本で720 DPS）
        DAMAGE_PER_TICK_LV2: 3.8  // ハイパーレーザー毎ティックダメージ（約228 DPS/本、5本で1140 DPS）
      },

      // 地表滑行ミサイル（MISSILE Lv1 / Lv2）
      MISSILE: {
        COOLDOWN_LV1: 0.45,
        COOLDOWN_LV2: 0.26,
        FALL_SPEED_X: 220,
        FALL_SPEED_Y: 260,
        SLIDE_SPEED_LV1: 380,
        SLIDE_SPEED_LV2: 520,
        WIDTH: 12,
        HEIGHT: 8,
        DAMAGE_LV1: 28,
        DAMAGE_LV2: 45,
        BLAST_RADIUS_LV2: 36
      },

      // シールド（SHIELD）
      SHIELD: {
        MAX_HP_LV1: 3,
        MAX_HP_LV2: 5,
        OFFSET_X: 24,
        WIDTH: 12,
        HEIGHT: 34
      }
    },

    // パワーアップゲージ設定（3.4節）
    POWERUP: {
      SLOTS: ['SPEED UP', 'MISSILE', 'DOUBLE', 'LASER', 'OPTION', 'SHIELD'],
      CAPSULE_SPEED_X: -110,
      CAPSULE_RADIUS: 10,
      BLUE_CAPSULE_CHANCE: 0.16 // 中型敵からの青カプセル出現率 (16%)
    },

    // ステージ・地形スクロール設定（3.7節）
    TERRAIN: {
      SCROLL_SPEED: 180,     // 基準スクロール速度 (px/s)
      SEGMENT_WIDTH: 20,     // 地形セグメント幅 (px)
      MIN_GAP: 220,          // 最低安全通路幅 (px)
      MAX_WALL_HEIGHT: 135,  // 上下壁の最大高さ (px)
      MAX_DELTA_HEIGHT: 6,   // 隣接セグメント間の最大高低差 (px)
      STAR_COUNT: 120,
      BOSS_SPAWN_TIME: 52    // ボスが出現するまでのステージ経過秒数
    },

    // 敵・ボス設定（3.5節）
    ENEMY: {
      POOL_SIZE_ENEMIES: 80,
      POOL_SIZE_BULLETS: 160,
      POOL_SIZE_CAPSULES: 30,

      TYPES: {
        RED_SQUAD: { hp: 10, width: 22, height: 18, score: 150, speed: 230 },
        RUSH:      { hp: 10, width: 24, height: 16, score: 120, speed: 360 },
        WAVE:      { hp: 16, width: 24, height: 20, score: 180, speed: 210 },
        TURRET:    { hp: 32, width: 24, height: 20, score: 300, speed: 180 },
        MEDIUM:    { hp: 110, width: 46, height: 36, score: 1200, speed: 140 }
      },

      SQUADRON_BONUS: 1000,

      BOSS: {
        WIDTH: 110,
        HEIGHT: 150,
        CORE_HP_BASE: 680,
        CORE_HP_PER_WAVE: 220,
        SHUTTER_COUNT: 4,
        SHUTTER_HP: 65,
        SCORE_BONUS: 20000,
        WARNING_DURATION: 3.2, // WARNING演出秒数
        HITSTOP_DURATION: 0.42, // 撃破時ヒットストップ秒数
        HITSTOP_TIMESCALE: 0.1  // 1/10 スローモーション
      }
    },

    // 演出・コンボ設定（3.8節、3.9節）
    EFFECTS: {
      POOL_SIZE_PARTICLES: 450,
      POOL_SIZE_TEXTS: 45,
      COMBO_WINDOW: 1.25,     // コンボ継続受付秒数
      MAX_COMBO_MULT: 8.0     // 最大スコア倍率
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
  }
  root.GradiusSTG = root.GradiusSTG || {};
  root.GradiusSTG.CONFIG = CONFIG;
})(typeof window !== 'undefined' ? window : globalThis);
