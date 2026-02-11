#!/usr/bin/env tsx

/**
 * Roundtrip Translation Test
 * Ensures EN -> JA -> EN produces identical code
 */

import * as fs from 'fs';
import * as path from 'path';
import { DictionaryManager } from '../src/dictionary/manager';
import { Translator } from '../src/core/translator';

console.log('=== Roundtrip Translation Test ===\n');

const examplesDir = __dirname;
const manager = new DictionaryManager();

// Load dictionary
const dictPath = path.join(examplesDir, 'test-dictionary.json');
const dictJson = fs.readFileSync(dictPath, 'utf-8');
const dictionary = manager.import(dictJson);

// Load original code
const sourcePath = path.join(examplesDir, 'calculator.ts');
const originalCode = fs.readFileSync(sourcePath, 'utf-8');

console.log('Step 1: Load original code');
console.log('--------------------------');
console.log(`✓ Loaded ${sourcePath}`);
console.log(`  Lines: ${originalCode.split('\n').length}`);
console.log(`  Characters: ${originalCode.length}`);
console.log();

// EN -> JA
console.log('Step 2: Translate English → Japanese');
console.log('-------------------------------------');
const translatorEN2JA = new Translator(dictionary.terms);
const resultJA = translatorEN2JA.toCustom(originalCode);
console.log(`✓ Translation complete`);
console.log(`  Translated tokens: ${resultJA.translatedTokens.length}`);
console.log(`  Unmapped tokens: ${resultJA.unmappedTokens.length}`);
if (resultJA.unmappedTokens.length > 0) {
  console.log(`  Unmapped: ${resultJA.unmappedTokens.join(', ')}`);
}
console.log();

// JA -> EN
console.log('Step 3: Translate Japanese → English');
console.log('-------------------------------------');
const reverseMapping = Object.fromEntries(
  Object.entries(dictionary.terms).map(([k, v]) => [v, k])
);
const translatorJA2EN = new Translator(reverseMapping);
const resultEN = translatorJA2EN.toCustom(resultJA.code);
console.log(`✓ Reverse translation complete`);
console.log(`  Translated tokens: ${resultEN.translatedTokens.length}`);
console.log(`  Unmapped tokens: ${resultEN.unmappedTokens.length}`);
if (resultEN.unmappedTokens.length > 0) {
  console.log(`  Unmapped: ${resultEN.unmappedTokens.join(', ')}`);
}
console.log();

// Compare
console.log('Step 4: Compare with original');
console.log('------------------------------');
const isIdentical = resultEN.code === originalCode;
console.log(`✓ Comparison complete`);
console.log(`  Result: ${isIdentical ? '✅ IDENTICAL' : '❌ DIFFERENT'}`);
console.log();

if (!isIdentical) {
  console.log('ERROR: Roundtrip translation failed!');
  console.log('Finding differences...\n');

  const originalLines = originalCode.split('\n');
  const resultLines = resultEN.code.split('\n');

  if (originalLines.length !== resultLines.length) {
    console.log(`Line count mismatch: ${originalLines.length} vs ${resultLines.length}`);
  }

  let differences = 0;
  const maxLines = Math.max(originalLines.length, resultLines.length);

  for (let i = 0; i < maxLines; i++) {
    const orig = originalLines[i] || '';
    const result = resultLines[i] || '';

    if (orig !== result) {
      differences++;
      console.log(`Line ${i + 1} differs:`);
      console.log(`  Original: "${orig}"`);
      console.log(`  Result:   "${result}"`);
      console.log();

      // Show first 10 differences only
      if (differences >= 10) {
        console.log('... (showing first 10 differences only)');
        break;
      }
    }
  }

  console.log(`Total differences: ${differences} lines`);
  process.exit(1);
} else {
  console.log('✅ SUCCESS: Roundtrip translation is perfect!');
  console.log('   EN → JA → EN produces identical code');
  console.log();

  // Show sample of Japanese translation
  console.log('Sample of Japanese translation:');
  console.log('--------------------------------');
  const sampleLines = resultJA.code.split('\n').slice(5, 15);
  sampleLines.forEach((line, i) => {
    console.log(`${(i + 6).toString().padStart(2)}: ${line}`);
  });
  console.log();

  console.log('=== Roundtrip Test PASSED ✅ ===');
}
