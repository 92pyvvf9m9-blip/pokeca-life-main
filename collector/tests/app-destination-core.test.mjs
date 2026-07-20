import test from 'node:test';
import assert from 'node:assert/strict';

await import('../../app-destination-core.js');
const core = globalThis.PokecaAppDestinationCore;

test('アプリ応募のコジマ抽選は公式アプリ情報へ補完される', () => {
  const item = core.enrich({ shop: 'コジマ×ビックカメラ', destinationType: 'app', product: 'ストームエメラルダ' });
  const resolved = core.resolve(item, 'ios');
  assert.equal(resolved.isApp, true);
  assert.equal(resolved.appId, 'kojima');
  assert.equal(resolved.appName, 'コジマアプリ');
  assert.match(resolved.iosStoreUrl, /id1216586207$/);
  assert.equal(resolved.hasDirectLaunch, false);
});

test('通常のGoogleフォーム抽選は店舗名だけでアプリ応募に変えない', () => {
  const item = core.enrich({ shop: 'ブックオフ フォレオ広島東店', destinationType: 'direct', url: 'https://docs.google.com/forms/d/e/example/viewform' });
  const resolved = core.resolve(item, 'ios');
  assert.equal(item.destinationType, 'direct');
  assert.equal(resolved.isApp, false);
});

test('明示されたカスタムスキームは壊さず起動URLに使う', () => {
  const resolved = core.resolve({ destinationType: 'app', appName: 'テストアプリ', appUrl: 'example-app://lottery/123' }, 'ios');
  assert.equal(resolved.launchUrl, 'example-app://lottery/123');
  assert.equal(resolved.hasDirectLaunch, true);
});

test('ふるいちのLINEミニアプリURLは直接起動候補になる', () => {
  const resolved = core.resolve({ destinationType: 'app', shop: 'ふるいち', url: 'https://liff.line.me/123-example' }, 'ios');
  assert.equal(resolved.appId, 'furuichi');
  assert.equal(resolved.launchUrl, 'https://liff.line.me/123-example');
  assert.equal(resolved.hasDirectLaunch, true);
});
