import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseRundown, normalizeLine } from '../assets/js/parse.js';
import { makeRow, computeRows, rowsToEvents, eventsToRows, clockToMs, msToClock, fmtOffset } from '../assets/js/rows.js';

describe('parse tolerant', () => {
  test('全角入力', () => {
    assert.equal(normalizeLine('１０：４０：００　開始'), '10:40:00 開始');
    const { events, errors } = parseRundown('５分３０秒 コーナー', new Date(2026, 9, 9, 10, 0, 0));
    assert.equal(errors.length, 0);
    assert.equal(events[0].offsetSec, 330);
  });
  test('時間単位', () => {
    const base = new Date(2026, 9, 9, 10, 0, 0);
    const { events } = parseRundown('1時間 特集\n1時間5分 本番', base);
    assert.equal(events[0].offsetSec, 3600);
    assert.equal(events[1].offsetSec, 3900);
  });
  test('絶対スペースなし', () => {
    const { events } = parseRundown('10:40:00開始', new Date(2026, 9, 9));
    assert.equal(events[0].title, '開始');
  });
  test('行対応items', () => {
    const { events, items } = parseRundown('5分 A\nへんな行\n3分 B', new Date());
    assert.equal(events.length, 2);
    const nb = items.filter((i) => !i.blank);
    assert.equal(nb.length, 3);
    assert.ok(nb[0].event && nb[1].error && nb[2].event);
  });
});

describe('rows model', () => {
  test('相対チェーン', () => {
    const base = new Date(2026, 9, 9, 10, 0, 0).getTime();
    const rows = [
      makeRow({ mode: 'relative', min: 5, sec: 0, title: 'A' }),
      makeRow({ mode: 'relative', min: 0, sec: 30, title: 'B' }),
    ];
    const c = computeRows(rows, base);
    assert.equal(c[0].eventTime, base + 300000);
    assert.equal(c[1].eventTime, base + 330000);
    assert.equal(fmtOffset(330000), '5:30');
  });
  test('絶対混在', () => {
    const base = new Date(2026, 9, 9, 9, 0, 0).getTime();
    const rows = [
      makeRow({ mode: 'absolute', clock: '10:00:00', title: '開始' }),
      makeRow({ mode: 'relative', min: 5, sec: 0, title: '次' }),
    ];
    const c = computeRows(rows, base);
    assert.equal(msToClock(c[0].eventTime), '10:00:00');
    assert.equal(msToClock(c[1].eventTime), '10:05:00');
  });
  test('検証で送信阻止', () => {
    assert.ok(computeRows([makeRow({ min: 0, sec: 0, title: '' })])[0].error);
    assert.ok(computeRows([makeRow({ mode: 'absolute', clock: '99:99', title: 'X' })])[0].error);
    assert.equal(rowsToEvents([makeRow({ min: 1, sec: 0, title: '' })]), null);
    assert.equal(clockToMs('25:00:00'), null);
  });
  test('サーバー復元', () => {
    const rows = eventsToRows([{ title: 'X', eventTime: new Date(2026, 9, 9, 10, 30, 0).getTime() }]);
    assert.equal(rows[0].clock, '10:30:00');
    assert.equal(rows[0].mode, 'absolute');
  });
});
