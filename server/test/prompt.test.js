import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PromptRejected, cacheKeyText, cleanIdea } from '../src/prompt.js';

test('removes names, places and numbers', () => {
  assert.equal(cleanIdea('me and Anna at our house in Berlin'), 'a child and at a house');
  assert.equal(cleanIdea('my sister is 5 and lives at Hauptstr. 12'), 'a sister');
  assert.equal(cleanIdea('Дракон в замке у Маши'), 'Дракон в замке');
});

test('keeps ordinary ideas and drops request openings', () => {
  assert.equal(cleanIdea('A dinosaur eating ice cream'), 'A dinosaur eating ice cream');
  assert.equal(cleanIdea('Draw me a cat astronaut'), 'a cat astronaut');
  assert.equal(cleanIdea('I want a unicorn on the Moon'), 'a unicorn on the Moon');
});

test('removes contact details', () => {
  assert.equal(cleanIdea('a robot, mail kid@example.com or call 0151 1234567'), 'a robot, mail or call');
});

test('rejects blocked and empty ideas', () => {
  assert.throws(() => cleanIdea('a knife'), PromptRejected);
  assert.throws(() => cleanIdea('ein Messer'), PromptRejected);
  assert.throws(() => cleanIdea('12345'), PromptRejected);
  assert.throws(() => cleanIdea(''), PromptRejected);
});

test('cache key ignores small wording differences', () => {
  assert.equal(cacheKeyText('A unicorn!'), cacheKeyText('the unicorn'));
  assert.notEqual(cacheKeyText('a unicorn'), cacheKeyText('a dinosaur'));
});
