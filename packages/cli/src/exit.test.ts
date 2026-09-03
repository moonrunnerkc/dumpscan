import { describe, expect, it } from 'vitest';

import { messageOf, UsageError } from './exit.js';

describe('messageOf', () => {
  it('renders a plain error as its message', () => {
    expect(messageOf(new Error('the snapshot has no manifest.json'))).toBe(
      'the snapshot has no manifest.json',
    );
  });

  it('names the cause under the message that wraps it', () => {
    const wrapped = new Error('signKeyless: Sigstore signing failed', {
      cause: new Error('fulcio returned 429 Too Many Requests'),
    });
    expect(messageOf(wrapped)).toBe(
      'signKeyless: Sigstore signing failed\n  caused by: fulcio returned 429 Too Many Requests',
    );
  });

  it('walks a chain of causes outermost first', () => {
    const wrapped = new Error('scan failed', {
      cause: new Error('could not reach the store', {
        cause: new Error('ECONNREFUSED 127.0.0.1:443'),
      }),
    });
    expect(messageOf(wrapped).split('\n  caused by: ')).toStrictEqual([
      'scan failed',
      'could not reach the store',
      'ECONNREFUSED 127.0.0.1:443',
    ]);
  });

  it('reports a cause that is not an error', () => {
    expect(messageOf(new Error('parse failed', { cause: 'unexpected token' }))).toBe(
      'parse failed\n  caused by: unexpected token',
    );
  });

  it('stops on a cause that points back into the chain', () => {
    const outer = new Error('outer');
    const inner = new Error('inner', { cause: outer });
    outer.cause = inner;
    expect(messageOf(outer)).toBe('outer\n  caused by: inner');
  });

  it('keeps a UsageError message intact so the exit code and text agree', () => {
    expect(messageOf(new UsageError('--snapshot is required'))).toBe('--snapshot is required');
  });

  it('renders an object cause as JSON rather than [object Object]', () => {
    const wrapped = new Error('the store refused', {
      cause: { status: 429, retryAfter: '60' },
    });
    expect(messageOf(wrapped)).toBe(
      'the store refused\n  caused by: {"status":429,"retryAfter":"60"}',
    );
  });

  it('falls back to a type tag when a cause will not serialize', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(messageOf(new Error('nope', { cause: circular }))).toBe(
      'nope\n  caused by: [object Object]',
    );
  });

  it('stringifies a thrown value that is not an error', () => {
    expect(messageOf('plain string')).toBe('plain string');
    expect(messageOf(undefined)).toBe('undefined');
  });
});
