// NODE_PATH=<jsdom> node test/test-follow-1.7.1.js — 时间线一键关注：unknown/false 显示，true 隐藏，页面其它按钮不影响（1.7.2 仍适用，逻辑未改）
const { JSDOM } = require('jsdom'); const fs = require('fs'); const assert = require('assert');
// 故意塞入会误伤旧逻辑的按钮：aria-label 含 following / Follow @ / 回关 / 正在关注
const noise = `<div role="group"><button aria-label="12 replies. Reply">r</button><button aria-label="Followings timeline">x</button><button aria-label="Follow @someone">关注</button><button>回关</button><button>正在关注</button></div>`;
const art = (u, id) => `<article data-testid="tweet"><div data-testid="User-Name"><a href="/${u}">${u}</a><a href="/${u}/status/${id}"><time>1h</time></a></div>${noise}</article>`;
function run(cfg, followState) {
  const dom = new JSDOM(`<body><a data-testid="AppTabBar_Profile_Link" href="/blacksoil"></a><main>${['aiyygg','known_no','known_yes','blacksoil'].map((u,i)=>art(u,200+i)).join('')}</main></body>`, { url: 'https://x.com/home', runScripts: 'outside-only' });
  const w = dom.window;
  w.chrome = {
    storage: { sync: { get: (d, cb) => cb({ ...d, ...cfg }) }, local: { get: (d, cb) => cb({ ...d, activeAccount: 'blacksoil', accounts: { blacksoil: { inbound: {}, outbound: {} } } }), set() {} }, onChanged: { addListener() {} } },
    runtime: { sendMessage: () => Promise.resolve({}), onMessage: { addListener() {} } }
  };
  w.eval(fs.readFileSync('content.js', 'utf8'));
  w.dispatchEvent(new w.CustomEvent('x-oneway-follow', { detail: { kind: 'dump', users: followState } }));
  return new Promise((r) => setTimeout(() => {
    const out = {};
    for (const wrap of w.document.querySelectorAll('.x-oneway-ixwrap')) {
      out[wrap.dataset.user] = Array.from(wrap.children).map((c) => (c.classList.contains('x-oneway-follow-btn') ? 'BTN:' : '') + c.textContent);
    }
    w.close(); r(out);
  }, 900));
}
(async () => {
  const st = { known_no: { following: false }, known_yes: { following: true } };
  const a = await run({}, st);
  console.log(a);
  assert.strictEqual(a.aiyygg[0], 'BTN:关注', 'unknown 必须有关注按钮');
  assert.strictEqual(a.aiyygg[1], '暂无', 'order: 关注 → 互动');
  assert.strictEqual(a.known_no[0], 'BTN:关注');
  assert(!a.known_yes.some((x) => x.startsWith('BTN:')), '已关注不显示');
  assert(!a.blacksoil, '自己不标');
  const b = await run({ showQuickFollow: false }, st);
  console.log(b);
  assert(!Object.values(b).flat().some((x) => x.startsWith('BTN:')), '开关关闭时不显示');
  console.log('OK test-follow-1.7.1');
})().catch((e) => { console.error(e); process.exit(1); });
