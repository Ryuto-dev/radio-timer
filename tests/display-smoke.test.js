// display.js の import時スモークテスト
// 回帰対象: boot(roomId) が let 初期化より先に走るTDZバグ
// (タイトル・カウントだけ動いてバー/CUE/進行表が全死する症状になった)。
// DOM・タイマー・fetchをスタブした子プロセスでimport評価し、同期throwしないことを見る。
// 子プロセス方式なのは、無限watchループやsetIntervalスタブでテストランナーを巻き込まないため。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

describe('display smoke', () => {
  test('room付きimportがTDZ等で落ちない', () => {
    const target = pathToFileURL(path.resolve(import.meta.dirname, '../assets/js/display.js')).href;
    const setup = [
      "globalThis.window = { addEventListener() {} };",
      "globalThis.location = { search: '?id=620900', origin: 'http://t', pathname: '/display.html', hash: '' };",
      "const mk = () => ({ textContent:'', innerHTML:'', value:'', className:'', dataset:{}, style:{},",
      "  classList:{add(){},remove(){},toggle(){}}, appendChild(){}, addEventListener(){},",
      "  querySelector(){return null}, querySelectorAll(){return []} });",
      "globalThis.document = { getElementById: () => mk(), fullscreenElement: null };",
      "globalThis.localStorage = { getItem:()=>null, setItem(){}, removeItem(){} };",
      "globalThis.fetch = () => new Promise(()=>{});",
      "globalThis.setInterval = () => 0;",
      "globalThis.BroadcastChannel = class { postMessage(){} close(){} set onmessage(_){} };",
    ].join('\n');
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `${setup}\nawait import(${JSON.stringify(target)});\nconsole.log('IMPORT_OK');`],
      { timeout: 15000, encoding: 'utf8' },
    );
    assert.match(out, /IMPORT_OK/);
  });
});
