/**
 * Simple Calculator Example
 * This file demonstrates code identifier translation
 */

class Calculator {
  private result: number;

  constructor() {
    this.result = 0;
  }

  add(value: number): Calculator {
    this.result += value;
    return this;
  }

  subtract(value: number): Calculator {
    this.result -= value;
    return this;
  }

  multiply(value: number): Calculator {
    this.result *= value;
    return this;
  }

  divide(value: number): Calculator {
    if (value === 0) {
      throw new Error('Cannot divide by zero');
    }
    this.result /= value;
    return this;
  }

  getResult(): number {
    return this.result;
  }

  reset(): void {
    this.result = 0;
  }
}

// Usage example
const calc = new Calculator();
const finalResult = calc
  .add(10)
  .subtract(5)
  .multiply(2)
  .divide(2)
  .getResult();

console.log('Result:', finalResult); // Should be 5
