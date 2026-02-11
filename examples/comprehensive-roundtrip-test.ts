#!/usr/bin/env tsx

/**
 * Comprehensive Roundtrip Translation Test
 * Tests multiple code samples to ensure EN -> JA -> EN is always identical
 */

import { Translator } from '../src/core/translator';

interface TestCase {
  name: string;
  code: string;
  dictionary: Record<string, string>;
}

const testCases: TestCase[] = [
  {
    name: 'Simple Class',
    code: `class Calculator {
  add(value: number): number {
    return value;
  }
}`,
    dictionary: {
      Calculator: '計算機',
      add: '追加',
      value: '値',
    },
  },

  {
    name: 'Function with Variables',
    code: `function processData(input: string): string {
  const result = input.toUpperCase();
  const output = result.trim();
  return output;
}`,
    dictionary: {
      processData: 'データ処理',
      input: '入力',
      result: '結果',
      output: '出力',
    },
  },

  {
    name: 'Interface and Type',
    code: `interface User {
  name: string;
  age: number;
}

type UserRole = 'admin' | 'user';

function createUser(name: string, age: number): User {
  return { name, age };
}`,
    dictionary: {
      User: 'ユーザー',
      name: '名前',
      age: '年齢',
      UserRole: 'ユーザー役割',
      createUser: 'ユーザー作成',
    },
  },

  {
    name: 'Arrow Functions and Const',
    code: `const sum = (a: number, b: number): number => a + b;
const multiply = (x: number, y: number): number => x * y;
const result = sum(multiply(2, 3), 4);`,
    dictionary: {
      sum: '合計',
      a: 'あ',
      b: 'び',
      multiply: '乗算',
      x: 'えっくす',
      y: 'わい',
      result: '結果',
    },
  },

  {
    name: 'Class with Methods and Properties',
    code: `class BankAccount {
  private balance: number;

  constructor(initialBalance: number) {
    this.balance = initialBalance;
  }

  deposit(amount: number): void {
    this.balance += amount;
  }

  withdraw(amount: number): boolean {
    if (this.balance >= amount) {
      this.balance -= amount;
      return true;
    }
    return false;
  }

  getBalance(): number {
    return this.balance;
  }
}`,
    dictionary: {
      BankAccount: '銀行口座',
      balance: '残高',
      initialBalance: '初期残高',
      deposit: '預金',
      amount: '金額',
      withdraw: '引出',
      getBalance: '残高取得',
    },
  },

  {
    name: 'Nested Objects and Arrays',
    code: `const users = [
  { id: 1, username: 'alice' },
  { id: 2, username: 'bob' }
];

const userMap = users.reduce((map, user) => {
  map[user.id] = user;
  return map;
}, {});`,
    dictionary: {
      users: 'ユーザー達',
      id: 'アイディー',
      username: 'ユーザー名',
      userMap: 'ユーザーマップ',
      map: 'マップ',
      user: 'ユーザー',
    },
  },

  {
    name: 'With Comments and Empty Lines',
    code: `// This is a calculator
class Calculator {
  // Store the result
  private result: number;

  constructor() {
    this.result = 0;
  }

  // Add to result
  add(value: number): void {
    this.result += value;
  }
}`,
    dictionary: {
      Calculator: '計算機',
      result: '結果',
      add: '追加',
      value: '値',
    },
  },

  {
    name: 'Complex Generics',
    code: `interface Container<T> {
  value: T;
  transform<U>(fn: (input: T) => U): Container<U>;
}

function createContainer<T>(value: T): Container<T> {
  return {
    value,
    transform: (fn) => createContainer(fn(value))
  };
}`,
    dictionary: {
      Container: 'コンテナ',
      value: '値',
      transform: '変換',
      fn: '関数',
      input: '入力',
      createContainer: 'コンテナ作成',
    },
  },
];

console.log('=== Comprehensive Roundtrip Translation Test ===\n');

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  console.log(`Test: ${testCase.name}`);
  console.log('-'.repeat(50));

  try {
    // EN -> JA
    const translatorEN2JA = new Translator(testCase.dictionary);
    const resultJA = translatorEN2JA.toCustom(testCase.code);

    // JA -> EN
    const reverseMapping = Object.fromEntries(
      Object.entries(testCase.dictionary).map(([k, v]) => [v, k])
    );
    const translatorJA2EN = new Translator(reverseMapping);
    const resultEN = translatorJA2EN.toCustom(resultJA.code);

    // Compare
    const isIdentical = resultEN.code === testCase.code;

    if (isIdentical) {
      console.log(`✅ PASSED - Roundtrip translation is identical`);
      console.log(`   Translated: ${resultJA.translatedTokens.length} tokens`);
      passed++;
    } else {
      console.log(`❌ FAILED - Roundtrip translation differs`);
      console.log(`\nOriginal (${testCase.code.length} chars):`);
      console.log(testCase.code.substring(0, 100) + '...');
      console.log(`\nResult (${resultEN.code.length} chars):`);
      console.log(resultEN.code.substring(0, 100) + '...');

      // Find first difference
      for (let i = 0; i < Math.max(testCase.code.length, resultEN.code.length); i++) {
        if (testCase.code[i] !== resultEN.code[i]) {
          console.log(`\nFirst difference at position ${i}:`);
          console.log(`  Original: "${testCase.code.substring(i, i + 20)}"`);
          console.log(`  Result:   "${resultEN.code.substring(i, i + 20)}"`);
          break;
        }
      }
      failed++;
    }
  } catch (error: any) {
    console.log(`❌ FAILED - Exception: ${error.message}`);
    failed++;
  }

  console.log();
}

console.log('='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed === 0) {
  console.log('\n✅ ALL TESTS PASSED! Roundtrip translation is perfect.\n');
  process.exit(0);
} else {
  console.log(`\n❌ ${failed} TEST(S) FAILED\n`);
  process.exit(1);
}
