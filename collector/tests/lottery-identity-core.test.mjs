import test from 'node:test';
import assert from 'node:assert/strict';

await import('../../lottery-identity-core.js');
const identity = globalThis.PokecaLotteryIdentityCore;

test('同じ応募URLでも商品が違えば別抽選として保持する', () => {
  const base = { shop: 'カードショップA', url: 'https://example.com/lottery', applyEndDate: '2026-07-28' };
  assert.notEqual(
    identity.identity({ ...base, product: 'ストームエメラルダ' }),
    identity.identity({ ...base, product: 'アビスアイ' })
  );
});

test('同じURL・店舗・商品・締切はURL表記差があっても同じ抽選になる', () => {
  const a = { shop: 'カードショップA', product: 'ストームエメラルダ', applyEndDate: '2026-07-28', url: 'https://example.com/lottery?utm_source=x' };
  const b = { shop: 'カードショップA', product: 'ストームエメラルダ', applyEndDate: '2026-07-28', url: 'https://example.com/lottery' };
  assert.equal(identity.identity(a), identity.identity(b));
});

test('同じURLと商品でも締切が違う再抽選は別件になる', () => {
  const base = { shop: 'カードショップA', product: 'ストームエメラルダ', url: 'https://example.com/lottery' };
  assert.notEqual(identity.identity({ ...base, applyEndDate: '2026-07-28' }), identity.identity({ ...base, applyEndDate: '2026-08-05' }));
});

test('GoogleフォームURLを正規化する', () => {
  const direct = identity.normalizeHttpUrl('https://docs.google.com/forms/d/e/FORM_ID/viewform?utm_source=x');
  assert.equal(direct, 'https://docs.google.com/forms/d/e/FORM_ID/viewform');
});
