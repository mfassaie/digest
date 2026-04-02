import { describe, it, expect } from 'vitest';
import { DockerUnavailableError } from './types.js';

describe('DockerUnavailableError', () => {
  it('is an Error with its own name and message', () => {
    const err = new DockerUnavailableError('docker is down');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('DockerUnavailableError');
    expect(err.message).toBe('docker is down');
  });
});
