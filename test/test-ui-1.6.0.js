// NODE_PATH=<jsdom> node test/test-ui-1.6.0.js — 列表/时间线两枚胶囊 + 开关
const { JSDOM } = require('jsdom'); const fs = require('fs'); const assert = require('assert');
const cell = (u) => `<div data-testid="UserCell"><div data-testid="User-Name"><a href="/${u}"><span>${u}</span></a><a href="/${u}"><span>@${u}</span></a></div><span>关注了你</span><button>正在关注</button></div>`;
const art = (u, id) => `<article data-testid="tweet"><div data-testid="User-Name"><a href="/${u}">${u}</a><a href="/${u}/status/${id}"><time>1h</time></a></div></article>`;
function run(pathName, html, cfg) {
  const dom = new JSDOM(`<body><a data-testid="AppTabBar_Profile_Link" href="/blacksoil"></a><main>${html}</main></body>`, { url: 'https://x.com' + pathName, runScripts: 'outside-only' });
  const w = dom.window;
  const accounts = { blacksoil: {
    inbound: { alice: { replies: 2, likes: 1, total: 3 }, bob: { likes: 1, total: 1 } },
    outbound: { alice: { replies: 1, likes: 4, total: 5 }, carol: { likes: 2, total: 2 } }
  } };
  w.chrome = {
    storage: { sync: { get: (d, cb) => cb({ ...d, ...cfg }) }, local: { get: (d, cb) => cb({ ...d, activeAccount: 'blacksoil', accounts }), set() {} }, onChanged: { addListener() {} } },
    runtime: { sendMessage: () => Promise.resolve({}), onMessage: { addListener() {} } }
  };
  w.eval(fs.readFileSync('content.js', 'utf8'));
  return new Promise((r) => setTimeout(() => {
    const out = {};
    for (const wrap of w.document.querySelectorAll('.x-oneway-ixwrap')) {
      out[wrap.dataset.user] = Array.from(wrap.children).filter((c) => !c.classList.contains('x-oneway-follow-btn')).map((c) => c.textContent + (c.className.includes('zero') || c.className.includes('none') ? '~' : ''));
      if (wrap.dataset.user === 'alice') out._title = wrap.title;
    }
    w.close(); r(out);
  }, 900));
}
(async () => {
  const users = ['alice', 'bob', 'carol', 'dave', 'blacksoil'];
  let a = await run('/blacksoil/followers', users.map(cell).join(''), {});
  console.log(a);
  assert.deepStrictEqual(a.alice, ['被互动 3', '我互动 5']);
  assert.deepStrictEqual(a.bob, ['被互动 1', '我互动 0~']);
  assert.deepStrictEqual(a.carol, ['被互动 0~', '我互动 2']);
  assert.deepStrictEqual(a.dave, ['暂无互动~']);
  assert(!a.blacksoil, 'self row not marked');
  assert(/【被互动 3】[\s\S]*评你的帖 2[\s\S]*【我互动 5】[\s\S]*我回复 1 · 我点赞 4/.test(a._title), a._title);
  let b = await run('/home', users.map((u, i) => art(u, 100 + i)).join(''), {});
  console.log(b);
  assert.deepStrictEqual(b.alice, ['被 3', '我 5']);
  assert.deepStrictEqual(b.dave, ['暂无~']);
  let c = await run('/home', users.map((u, i) => art(u, 100 + i)).join(''), { showInbound: false, showOutbound: true });
  assert.deepStrictEqual(c.alice, ['我 5']); assert.deepStrictEqual(c.bob, ['我·暂无~']);
  let d = await run('/home', art('alice', 1), { showInteractions: false, showQuickFollow: false });
  assert.deepStrictEqual(d, {}, 'legacy off → both off');
  console.log('UI 1.6 PASS');
})();
