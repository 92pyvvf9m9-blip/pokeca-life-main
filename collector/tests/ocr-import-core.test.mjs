import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const corePath=path.resolve(here,'../../ocr-import-core.js');
const context={globalThis:{}};
context.globalThis=context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(corePath,'utf8'),context,{filename:corePath});
const core=context.PokecaOcrCore;

const products=[{name:'拡張パック ストームエメラルダ',aliases:['ストームエメラルダ']}];

test('Xの抽選スクショ本文から店舗・商品・日付を抽出する',()=>{
  const text=`ブックオフ フォレオ広島東店(広島)で\n✅『ストームエメラルダ』の抽選販売\n\n■応募期間\n7月28日（火）まで\n■当選発表\n7/30（木）\n■受取期間\n7/31（金）〜8/2（日）`;
  const result=core.extractLotteryInfo(text,{baseYear:2026,products});
  assert.equal(result.item.shop,'ブックオフ フォレオ広島東店');
  assert.equal(result.item.product,'拡張パック ストームエメラルダ');
  assert.equal(result.item.applyEndDate,'2026-07-28');
  assert.equal(result.item.resultStartDate,'2026-07-30');
  assert.equal(result.item.purchaseStartDate,'2026-07-31');
  assert.equal(result.item.purchaseEndDate,'2026-08-02');
  assert.equal(result.item.type,'店舗');
  assert.equal(result.item.area,'広島県');
});

test('OCRのOとIを含むスラッシュ日付を補正する',()=>{
  const tokens=core.dateTokens('当選発表 7/3O 受取期間 7/3I〜8/2',2026);
  assert.equal(JSON.stringify(Array.from(tokens,token=>token.date)),JSON.stringify(['2026-07-30','2026-07-31','2026-08-02']));
});

test('URL先に日付がない場合は画像OCRの情報を補完する',()=>{
  const page={shop:'',product:'',type:'通販',area:'全国',memo:'Googleフォームから取得'};
  const image={shop:'ブックオフ フォレオ広島東店',product:'拡張パック ストームエメラルダ',applyEndDate:'2026-07-28',resultStartDate:'2026-07-30',purchaseStartDate:'2026-07-31',purchaseEndDate:'2026-08-02',type:'店舗',area:'広島県',memo:'スクショ画像から文字・日付を自動読取'};
  const merged=core.mergeLotteryInfo(page,image,'https://docs.google.com/forms/d/e/example/viewform');
  assert.equal(merged.shop,image.shop);
  assert.equal(merged.product,image.product);
  assert.equal(merged.applyEndDate,image.applyEndDate);
  assert.equal(merged.resultStartDate,image.resultStartDate);
  assert.equal(merged.type,'店舗');
  assert.equal(merged.area,'広島県');
  assert.equal(merged.url,'https://docs.google.com/forms/d/e/example/viewform');
});
