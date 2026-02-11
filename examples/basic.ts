/**
 * Basic example of using the Kawa i18n translator
 */

import { Translator } from '../src/core/translator';

// Define Spanish mapping
const spanishMapping = {
  'Calculator': 'Calculadora',
  'add': 'sumar',
  'subtract': 'restar',
  'multiply': 'multiplicar',
  'divide': 'dividir',
  'result': 'resultado',
  'value': 'valor',
  'calculator': 'calculadora',
};

// Create translator
const translator = new Translator(spanishMapping);

// Original English TypeScript
const englishCode = `
// Simple calculator class
class Calculator {
  add(a: number, b: number): number {
    const result = a + b;
    return result;
  }

  subtract(a: number, b: number): number {
    const result = a - b;
    return result;
  }

  multiply(a: number, b: number): number {
    return a * b;
  }

  divide(a: number, b: number): number {
    if (b === 0) {
      throw new Error('Cannot divide by zero');
    }
    return a / b;
  }
}

const calculator = new Calculator();
const value = calculator.add(5, 3);
`;

console.log('=== BASIC TRANSLATION EXAMPLE ===\n');

console.log('Original English TypeScript:');
console.log('---');
console.log(englishCode);

// Translate to Spanish
const spanishResult = translator.toCustom(englishCode);

console.log('\nTranslated to Spanish:');
console.log('---');
console.log(spanishResult.code);

console.log('\nTranslation Stats:');
console.log('Translated tokens:', spanishResult.translatedTokens);
console.log('Unmapped tokens:', spanishResult.unmappedTokens);

// Translate back to English
const backToEnglish = translator.toEnglish(spanishResult.code);

console.log('\nTranslated Back to English:');
console.log('---');
console.log(backToEnglish.code);

console.log('\nRoundtrip successful:', backToEnglish.code === englishCode);
