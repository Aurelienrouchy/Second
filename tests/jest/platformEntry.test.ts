import path from 'node:path';
import { resolveEntryPoint } from '@expo/config/paths';

const mockRegisterRouter = jest.fn();
jest.mock('expo-router/entry', () => { mockRegisterRouter(); return {}; });

describe('platform entry scope', () => {
  it.each([
    ['ios', 'index.ts'],
    ['android', 'index.ts'],
    ['web', 'index.web.ts'],
  ])('resolves %s to %s from the actual package entry', (platform, expected) => {
    expect(resolveEntryPoint(process.cwd(), { platform })).toBe(path.join(process.cwd(), expected));
  });

  it('registers Expo Router for the native app entry', () => {
    jest.isolateModules(() => { require('@/index'); });
    expect(mockRegisterRouter).toHaveBeenCalledTimes(1);
  });

  it('keeps the web landing separate from native Router registration', () => {
    jest.isolateModules(() => { require('@/index.web'); });
    expect(mockRegisterRouter).not.toHaveBeenCalled();
  });
});
