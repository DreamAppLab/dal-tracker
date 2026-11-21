import { isNewer, loadedMainBundle } from './useNewVersion';

test('detects a newer deployed bundle than the one this tab loaded', () => {
  expect(isNewer({ files: { 'main.js': '/static/js/main.bbb.js' } }, '/static/js/main.aaa.js')).toBe(true);
  expect(isNewer({ files: { 'main.js': '/static/js/main.aaa.js' } }, '/static/js/main.aaa.js')).toBe(false);
  expect(isNewer({}, '/static/js/main.aaa.js')).toBe(false);
  expect(isNewer({ files: { 'main.js': '/static/js/main.bbb.js' } }, null)).toBe(false);
});

test('finds the loaded main bundle (absolute or relative src)', () => {
  document.body.innerHTML = '<script src="https://mc.example/static/js/main.abc123.js"></script><script src="/static/js/453.chunk.js"></script>';
  expect(loadedMainBundle(document)).toBe('/static/js/main.abc123.js');
  document.body.innerHTML = '<script src="/static/js/bundle.js"></script>';
  expect(loadedMainBundle(document)).toBe(null);
});
