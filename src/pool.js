/**
 * @file pool.js
 * @description GC（ガベージコレクション）を排除するための固定長オブジェクトプール（仕様書 3.2節、4.1節準拠）
 */
(function (root) {
  'use strict';

  class ObjectPool {
    /**
     * @param {Function} factory 初期オブジェクト生成関数
     * @param {number} size 事前確保サイズ
     */
    constructor(factory, size) {
      this.size = size;
      this.items = new Array(size);
      for (let i = 0; i < size; i++) {
        const obj = factory(i);
        obj.active = false;
        obj._poolIndex = i;
        this.items[i] = obj;
      }
      this.activeCount = 0;
      this.nextSearchIndex = 0;
    }

    /**
     * 非アクティブなオブジェクトをプールから取得して有効化する（動的 new なし）
     * @returns {Object|null}
     */
    acquire() {
      const len = this.size;
      for (let i = 0; i < len; i++) {
        const idx = (this.nextSearchIndex + i) % len;
        const item = this.items[idx];
        if (!item.active) {
          item.active = true;
          this.activeCount++;
          this.nextSearchIndex = (idx + 1) % len;
          return item;
        }
      }
      return null;
    }

    /**
     * オブジェクトを非アクティブ化してプールへ返却する
     * @param {Object} item
     */
    release(item) {
      if (item && item.active) {
        item.active = false;
        this.activeCount = Math.max(0, this.activeCount - 1);
      }
    }

    /**
     * 全オブジェクトを非アクティブ化する
     */
    clear() {
      for (let i = 0; i < this.size; i++) {
        this.items[i].active = false;
      }
      this.activeCount = 0;
      this.nextSearchIndex = 0;
    }

    /**
     * アクティブな全要素に対してコールバックを実行する（高階関数による配列生成なし）
     * @param {Function} callback
     */
    forEachActive(callback) {
      for (let i = 0; i < this.size; i++) {
        const item = this.items[i];
        if (item.active) {
          callback(item, i);
        }
      }
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ObjectPool;
  }
  root.GradiusSTG = root.GradiusSTG || {};
  root.GradiusSTG.ObjectPool = ObjectPool;
})(typeof window !== 'undefined' ? window : globalThis);
