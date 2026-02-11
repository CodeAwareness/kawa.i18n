/**
 * Simple Calculator Example
 * This file demonstrates code identifier translation
 */

class 計算機 {
  private 結果: number;

  constructor() {
    this.結果 = 0;
  }

  追加(値: number): 計算機 {
    this.結果 += 値;
    return this;
  }

  減算(値: number): 計算機 {
    this.結果 -= 値;
    return this;
  }

  乗算(値: number): 計算機 {
    this.結果 *= 値;
    return this;
  }

  除算(値: number): 計算機 {
    if (値 === 0) {
      throw new Error('Cannot divide by zero');
    }
    this.結果 /= 値;
    return this;
  }

  結果取得(): number {
    return this.結果;
  }

  リセット(): void {
    this.結果 = 0;
  }
}

// Usage example
const 計算 = new 計算機();
const 最終結果 = 計算
  .追加(10)
  .減算(5)
  .乗算(2)
  .除算(2)
  .結果取得();

console.log('Result:', 最終結果); // Should be 5
