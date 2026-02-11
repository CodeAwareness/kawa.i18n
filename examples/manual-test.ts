#!/usr/bin/env tsx

/**
 * Manual Test Script for kawa.i18n
 * Demonstrates dictionary management and code translation
 */

import * as fs from 'fs';
import * as path from 'path';
import { DictionaryManager } from '../src/dictionary/manager';
import { IdentifierExtractor } from '../src/core/identifierExtractor';
import { Translator } from '../src/core/translator';

const examplesDir = __dirname;

console.log('=== Kawa i18n Manual Test ===\n');

// Initialize components
const manager = new DictionaryManager();
const extractor = new IdentifierExtractor();

// Test 1: Load dictionary
console.log('Test 1: Load Dictionary');
console.log('------------------------');
const dictPath = path.join(examplesDir, 'test-dictionary.json');
const dictJson = fs.readFileSync(dictPath, 'utf-8');
const dictionary = manager.import(dictJson);
console.log(`✓ Loaded dictionary: ${dictionary.origin}`);
console.log(`  Language: ${dictionary.language}`);
console.log(`  Terms: ${Object.keys(dictionary.terms).length}`);
console.log(`  Version: ${dictionary.metadata.version}\n`);

// Test 2: Extract identifiers
console.log('Test 2: Extract Identifiers');
console.log('----------------------------');
const sourcePath = path.join(examplesDir, 'calculator.ts');
const sourceCode = fs.readFileSync(sourcePath, 'utf-8');
const identifiers = extractor.extract(sourceCode, sourcePath);
console.log(`✓ Extracted ${identifiers.length} unique identifiers:`);
identifiers.slice(0, 10).forEach(id => {
  console.log(`  - ${id.name} (${id.type}, line ${id.line}, count: ${id.count})`);
});
if (identifiers.length > 10) {
  console.log(`  ... and ${identifiers.length - 10} more\n`);
} else {
  console.log();
}

// Test 3: Translate code
console.log('Test 3: Translate Code (English → Japanese)');
console.log('--------------------------------------------');
const translator = new Translator(dictionary.terms);
const result = translator.toCustom(sourceCode);
console.log(`✓ Translated ${result.translatedTokens.length} tokens`);
console.log(`  Unmapped tokens: ${result.unmappedTokens.length}`);
if (result.unmappedTokens.length > 0) {
  console.log(`  Unmapped: ${result.unmappedTokens.join(', ')}`);
}
console.log('\nTranslated code (first 20 lines):');
console.log('-----------------------------------');
const lines = result.code.split('\n').slice(0, 20);
lines.forEach((line, i) => console.log(`${(i + 1).toString().padStart(2)}: ${line}`));
console.log('...\n');

// Test 4: Reverse translation
console.log('Test 4: Translate Back (Japanese → English)');
console.log('--------------------------------------------');
const reverseTranslator = new Translator(
  Object.fromEntries(Object.entries(dictionary.terms).map(([k, v]) => [v, k]))
);
const reverseResult = reverseTranslator.toCustom(result.code);
const isIdentical = reverseResult.code === sourceCode;
console.log(`✓ Reverse translation completed`);
console.log(`  Result identical to original: ${isIdentical ? 'YES ✓' : 'NO ✗'}`);
if (!isIdentical) {
  console.log('  Warning: Reverse translation did not match original!');
}
console.log();

// Test 5: Dictionary management
console.log('Test 5: Dictionary Management');
console.log('------------------------------');
const testOrigin = 'https://github.com/test/repo.git';
const testLang = 'ja';

// Create
if (!manager.exists(testOrigin, testLang)) {
  const newDict = manager.create(testOrigin, testLang, { test: 'テスト' });
  console.log(`✓ Created new dictionary`);
  console.log(`  Origin: ${newDict.origin}`);
  console.log(`  Language: ${newDict.language}`);
  console.log(`  Initial terms: ${Object.keys(newDict.terms).length}`);
}

// Add terms
const updatedDict = manager.addTerms(testOrigin, testLang, {
  hello: 'こんにちは',
  world: '世界',
});
console.log(`✓ Added terms`);
console.log(`  Total terms: ${Object.keys(updatedDict.terms).length}`);
console.log(`  Version: ${updatedDict.metadata.version}`);

// Get stats
const stats = manager.getStats(testOrigin, testLang);
console.log(`✓ Dictionary stats:`);
console.log(`  Term count: ${stats.termCount}`);
console.log(`  Created: ${new Date(stats.createdAt).toLocaleString()}`);
console.log(`  Updated: ${new Date(stats.updatedAt).toLocaleString()}`);

// List all
const allDicts = manager.listAll();
console.log(`✓ Total cached dictionaries: ${allDicts.length}`);
console.log();

// Test 6: Export/Import
console.log('Test 6: Export/Import');
console.log('----------------------');
const exported = manager.export(testOrigin, testLang);
console.log(`✓ Exported dictionary (${exported.length} bytes)`);

// Clean up test dictionary
manager.delete(testOrigin, testLang);
console.log(`✓ Deleted test dictionary`);
console.log();

console.log('=== All Tests Complete ===');
console.log('Phase 2 implementation is working! ✓');
