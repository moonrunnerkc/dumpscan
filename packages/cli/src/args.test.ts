import { describe, expect, it } from 'vitest';

import { flag, parseArgs, requireOption } from './args.js';

describe('parseArgs', () => {
  it('takes the first bare word as the command and the rest as positional', () => {
    const args = parseArgs(['scan', 'package-lock.json', 'extra']);
    expect(args.command).toBe('scan');
    expect(args.positional).toStrictEqual(['package-lock.json', 'extra']);
  });

  it('reports no command for an empty line', () => {
    expect(parseArgs([]).command).toBeNull();
  });

  it('reads an option written with a space or with an equals sign', () => {
    expect(parseArgs(['scan', '--snapshot', 'x']).options.get('snapshot')).toBe('x');
    expect(parseArgs(['scan', '--snapshot=x']).options.get('snapshot')).toBe('x');
  });

  it('keeps an equals sign inside the value', () => {
    expect(parseArgs(['scan', '--identity-token=a=b']).options.get('identity-token')).toBe('a=b');
  });

  it('treats an option with no value as a flag', () => {
    const args = parseArgs(['scan', '--sign', '--json']);
    expect(flag(args, 'sign')).toBe(true);
    expect(flag(args, 'json')).toBe(true);
    expect(flag(args, 'missing')).toBe(false);
  });

  it('does not swallow the next option as a value', () => {
    const args = parseArgs(['scan', '--sign', '--out', 'bundle.json']);
    expect(args.options.get('sign')).toBe('');
    expect(args.options.get('out')).toBe('bundle.json');
  });

  it('accepts an explicit true for a flag', () => {
    expect(flag(parseArgs(['scan', '--sign=true']), 'sign')).toBe(true);
    expect(flag(parseArgs(['scan', '--sign=false']), 'sign')).toBe(false);
  });

  it('collects a repeated option', () => {
    const args = parseArgs(['snapshot', '--ecosystems', 'npm', '--ecosystems', 'PyPI']);
    expect(args.repeated.get('ecosystems')).toStrictEqual(['npm', 'PyPI']);
    expect(args.options.get('ecosystems')).toBe('PyPI');
  });

  it('stops parsing options after a double dash', () => {
    const args = parseArgs(['scan', '--', '--not-an-option']);
    expect(args.positional).toStrictEqual(['--not-an-option']);
    expect(args.options.size).toBe(0);
  });

  it('takes a value that starts with a single dash', () => {
    expect(parseArgs(['scan', '--out', '-']).options.get('out')).toBe('-');
  });

  it('refuses a short flag rather than guessing what it means', () => {
    expect(() => parseArgs(['scan', '-s', 'x'])).toThrow(
      /"-s" is not an option dumpscan accepts; every option is spelled --name/,
    );
  });
});

describe('requireOption', () => {
  it('returns the value when it is there', () => {
    expect(requireOption(parseArgs(['scan', '--snapshot', 'x']), 'snapshot', 'why')).toBe('x');
  });

  it('says what the option is for when it is absent or empty', () => {
    expect(() => requireOption(parseArgs(['scan']), 'snapshot', 'pin the feed')).toThrow(
      /--snapshot is required; pin the feed/,
    );
    expect(() =>
      requireOption(parseArgs(['scan', '--snapshot']), 'snapshot', 'pin the feed'),
    ).toThrow(/--snapshot is required/);
  });
});
