import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseRundown, rundownToText, shiftEvents } from '../assets/js/parse.js';
import { fmtHMS, resolveCurrent, statusFor, sectionProgress } from '../assets/js/format.js';

describe('parseRundown', () => {
  test('絶対+相対の混在', () => {
    const base = new Date(2026, 9, 9, 10, 0, 0);
    const { events, errors } = parseRundown('10:40:00 番組開始\n5分30秒 コーナー\n10秒 スタート', base);
    assert.equal(errors.length, 0);
    assert.equal(events.length, 3);
    assert.equal(events[0].mode, 'absolute');
    assert.equal(events[0].title, '番組開始');
    assert.equal(events[1].eventTime - events[0].eventTime, (5 * 60 + 30) * 1000);
    assert.equal(events[2].eventTime - events[1].eventTime, 10 * 1000);
  });
  test('不正行はerrorsに', () => {
    const { events, errors } = parseRundown('hello world\n5分 OK', new Date());
    assert.equal(events.length, 1);
    assert.equal(errors.length, 1);
  });
  test('HH:MM形式も受付', () => {
    const { events } = parseRundown('10:40 終了', new Date(2026, 9, 9));
    assert.equal(events.length, 1);
    const d = new Date(events[0].eventTime);
    assert.equal(d.getHours(), 10);
    assert.equal(d.getMinutes(), 40);
  });
});

describe('format/resolve', () => {
  test('fmtHMS', () => {
    assert.equal(fmtHMS(3661000), '01:01:01');
    assert.equal(fmtHMS(-65000).startsWith('-'), true);
  });
  test('resolveCurrent', () => {
    const now = Date.now();
    const ev = [
      { title: 'A', eventTime: now - 1000, order: 0 },
      { title: 'B', eventTime: now + 5000, order: 1 },
    ];
    const r = resolveCurrent(ev, now);
    assert.equal(r.current.title, 'B');
    assert.equal(r.index, 1);
  });
  test('statusFor', () => {
    assert.equal(statusFor(120000, 60, 30), 'normal');
    assert.equal(statusFor(59000, 60, 30), 'warn1');
    assert.equal(statusFor(29000, 60, 30), 'warn2');
    assert.equal(statusFor(-1000, 60, 30), 'over');
  });
  test('shiftEvents', () => {
    const out = shiftEvents([{ eventTime: 1000 }], 60);
    assert.equal(out[0].eventTime, 61000);
  });
  test('rundownToText roundtrip', () => {
    const t = Date.now() + 60000;
    const txt = rundownToText([{ title: 'X', eventTime: t }]);
    assert.match(txt, /X/);
  });
});
