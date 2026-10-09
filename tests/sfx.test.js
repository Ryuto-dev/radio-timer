import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/room.js';
import { CALLSIGNS } from '../assets/js/callsigns.js';

function mockReq({ method = 'GET', url = '/', body = undefined }) {
  return { method, url, headers: {}, socket: {}, body };
}
function mockRes() {
  const res = {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k] = v; },
    end(s) { this.body = s; this._done?.(); },
  };
  res.done = new Promise((r) => { res._done = r; });
  return res;
}
async function call(opts) {
  const req = mockReq(opts);
  const res = mockRes();
  await handler(req, res);
  await res.done;
  return { code: res.statusCode, json: JSON.parse(res.body) };
}
const setCmd = (id, k, cmd, extra = {}) =>
  call({ method: 'POST', url: '/api/room', body: { act: 'set', id, k, cmd, ...extra } });

describe('callsign sfx', () => {
  test('manifestに上・下がある', () => {
    assert.deepEqual(CALLSIGNS.map((c) => c.id), ['ue', 'shita']);
  });
  test('再生指示→revが進む・不正idは拒否・resetで消去', async () => {
    const c = await call({ method: 'POST', url: '/api/room', body: { act: 'create' } });
    const { id, adminKey: k } = c.json;
    const g0 = await call({ method: 'GET', url: `/api/room?act=get&id=${id}` });

    const ng = await setCmd(id, k, 'sfx', { sid: 'nope' });
    assert.equal(ng.code, 400);
    assert.equal(ng.json.error, 'unknown_callsign');

    const ok = await setCmd(id, k, 'sfx', { sid: 'ue' });
    assert.equal(ok.json.ok, true);
    assert.equal(ok.json.state.sfx.id, 'ue');
    assert.ok(ok.json.state.sfx.at > 0);
    assert.ok(ok.json.state.rev > g0.json.state.rev);

    // hbやmessageでは消えない
    await call({ method: 'POST', url: '/api/room', body: { act: 'hb', id } });
    await setCmd(id, k, 'message', { text: 'hi' });
    const g1 = await call({ method: 'GET', url: `/api/room?act=get&id=${id}` });
    assert.equal(g1.json.state.sfx.id, 'ue');

    // resetで消える
    await setCmd(id, k, 'reset');
    const g2 = await call({ method: 'GET', url: `/api/room?act=get&id=${id}` });
    assert.equal(g2.json.state.sfx.id, '');

    // 鍵なしは拒否
    const bad = await setCmd(id, 'x'.repeat(32), 'sfx', { sid: 'ue' });
    assert.equal(bad.code, 403);
  });
});
