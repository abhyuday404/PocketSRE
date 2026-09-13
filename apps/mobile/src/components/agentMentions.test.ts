import { expect, it } from 'vitest';
import { activeMention, attachMention, removeMention } from './agentMentions';
it('recognizes mentions at the cursor but not email addresses', () => {
  expect(activeMention('Review @src/ap')).toEqual({ query: 'src/ap', start: 7, end: 14 });
  expect(activeMention('email@example.com')).toBeNull();
  expect(activeMention('Review @src/ap later', 14)?.query).toBe('src/ap');
  expect(attachMention('Review @src/ap later', 'src/app.ts', 14)).toBe('Review @src/app.ts  later');
});
it('removes only the selected complete reference', () => {
  expect(removeMention('@src/a.ts and @src/a.tsx', 'src/a.ts')).toBe('and @src/a.tsx');
});

it('keeps scoped package paths intact', () => {
  expect(attachMention('Read @packages/@org/util', 'packages/@org/util.ts')).toBe(
    'Read @packages/@org/util.ts ',
  );
});
