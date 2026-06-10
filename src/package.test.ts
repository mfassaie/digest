import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

describe('SPEC-015: npm package tarball contents', () => {
  const files = (() => {
    const output = execSync('npm pack --dry-run 2>&1', {
      encoding: 'utf-8',
      cwd: process.cwd(),
    });
    // Output format: "npm notice <size> <path>" between
    // "Tarball Contents" and "Tarball Details" markers
    const lines = output.split('\n');
    const result: string[] = [];
    let inContents = false;

    for (const line of lines) {
      if (line.includes('Tarball Contents')) {
        inContents = true;
        continue;
      }
      if (line.includes('Tarball Details')) {
        inContents = false;
        continue;
      }
      if (!inContents) continue;

      // "npm notice 1.1kB LICENSE"
      // Strip "npm notice", then split on whitespace.
      // First token is the size, rest is the file path.
      const stripped = line
        .replace(/^npm notice\s+/, '')
        .trim();
      if (!stripped) continue;

      const spaceIdx = stripped.indexOf(' ');
      if (spaceIdx === -1) continue;
      const filePath = stripped.slice(spaceIdx + 1).trim();
      if (filePath) result.push(filePath);
    }
    return result;
  })();

  it('contains dist/ files', () => {
    const distFiles = files.filter(
      f => f.startsWith('dist/')
    );
    expect(distFiles.length).toBeGreaterThan(0);
  });

  it('contains package.json', () => {
    expect(files).toContain('package.json');
  });

  it('contains README.md', () => {
    expect(files).toContain('README.md');
  });

  it('contains LICENSE', () => {
    expect(files).toContain('LICENSE');
  });

  it('does not contain src/ files', () => {
    const srcFiles = files.filter(f => f.startsWith('src/'));
    expect(srcFiles).toEqual([]);
  });

  it('does not contain .falk/ files', () => {
    const falkFiles = files.filter(
      f => f.startsWith('.falk/')
    );
    expect(falkFiles).toEqual([]);
  });

  it('does not contain scripts/ files', () => {
    const scriptFiles = files.filter(
      f => f.startsWith('scripts/')
    );
    expect(scriptFiles).toEqual([]);
  });

  it('does not contain test files', () => {
    const testFiles = files.filter(
      f => f.endsWith('.test.ts')
    );
    expect(testFiles).toEqual([]);
  });

  it('does not contain vitest.config.ts', () => {
    expect(files).not.toContain('vitest.config.ts');
  });

  it('does not contain tsconfig.json', () => {
    expect(files).not.toContain('tsconfig.json');
  });

  it('only contains allowed top-level entries', () => {
    const allowed = new Set([
      'package.json', 'README.md', 'LICENSE',
    ]);
    const unexpected = files.filter(
      f => !f.startsWith('dist/') &&
        !f.startsWith('docker/') &&
        !allowed.has(f)
    );
    expect(unexpected).toEqual([]);
  });
});
