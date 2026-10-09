import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/room.js';

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

describe('watch (長時間ポーリング)', () => {
  test('revが進むこと・古いrevでは即時返答・待機中は別更新で起床', async () => {
    const c = await call({ method: 'POST', url: '/api/room', body: { act: 'create' } });
    assert.equal(c.json.ok, true);
    const { id, adminKey } = c.json;

    const m = await call({ method: 'POST', url: '/api/room', body: { act: 'set', id, k: adminKey, cmd: 'message', text: 'hi' } });
    assert.equal(m.json.ok, true);
    const rev1 = m.json.state.rev;
    assert.ok(rev1 >= 1, 'message保存でrevが進む');

    // hbではrevが進まない
    await call({ method: 'POST', url: '/api/room', body: { act: 'hb', id, fs: false } });
    const g = await call({ method: 'GET', url: `/api/room?act=get&id=${id}` });
    assert.equal(g.json.state.rev, rev1, 'hbでrev不変');

    // 古いrevでwatch → 待たずに即時返答
    const t0 = Date.now();
    const w1 = await call({ method: 'GET', url: `/api/room?act=watch&id=${id}&rev=0` });
    assert.ok(Date.now() - t0 < 3000, '即時返答すること');
    assert.equal(w1.json.state.extraMessage, 'hi');

    // 最新revでwatch開始 → 別更新が入ったら起床して新stateを返す
    const wp = call({ method: 'GET', url: `/api/room?act=watch&id=${id}&rev=${rev1}` });
    await new Promise((r) => setTimeout(r, 1000));
    const m2 = await call({ method: 'POST', url: '/api/room', body: { act: 'set', id, k: adminKey, cmd: 'message', text: 'hi2' } });
    assert.equal(m2.json.ok, true);
    const t1 = Date.now();
    const w2 = await wp;
    assert.ok(Date.now() - t1 < 3000, '更新で速やかに起床すること');
    assert.equal(w2.json.state.extraMessage, 'hi2');
  });
});
