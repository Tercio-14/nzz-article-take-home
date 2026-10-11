import { ANDROID_HOST, FIXTURE_PORT, IOS_HOST, resolveBaseUrl } from './baseUrl';

describe('resolveBaseUrl', () => {
  it('uses the host loopback on iOS', () => {
    expect(resolveBaseUrl('ios')).toBe(`http://${IOS_HOST}:${FIXTURE_PORT}`);
  });

  it('uses 10.0.2.2 on Android, where the emulator reaches the host', () => {
    expect(resolveBaseUrl('android')).toBe(`http://${ANDROID_HOST}:${FIXTURE_PORT}`);
  });

  it('prefers an override, for a device on a LAN address', () => {
    expect(resolveBaseUrl('ios', 'http://192.168.1.20:8787')).toBe('http://192.168.1.20:8787');
  });

  it('removes a trailing slash from an override, so paths can be appended', () => {
    expect(resolveBaseUrl('android', 'http://192.168.1.20:8787/')).toBe('http://192.168.1.20:8787');
  });
});
