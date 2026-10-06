const { JSDOM } = require('jsdom'); const fs = require('fs'); const assert = require('assert');
const art = (user, id, extra = '') => `<div data-testid="cellInnerDiv"><article data-testid="tweet"><div data-testid="User-Name"><a href="/${user}">${user}</a><a href="/${user}/status/${id}"><time>t</time></a></div>${extra}<div data-testid="tweetText">hi</div></article></div>`;
const focal = (user, id) => `<div data-testid="cellInnerDiv"><article data-testid="tweet" tabindex="-1"><div data-testid="User-Name"><a href="/${user}">${user}</a></div><div data-testid="tweetText">多少钱</div><a href="/${user}/status/${id}"><time>下午3:20</time></a></article></div>`;
const sep = '<div data-testid="cellInnerDiv"><div></div></div>';
function run(html, pathName) {
  const dom = new JSDOM(`<body><a data-testid="AppTabBar_Profile_Link" href="/blacksoil"></a><main>${html}</main></body>`, { url: 'https://x.com' + pathName, runScripts: 'outside-only' });
  const sent = [];
  const w = dom.window;
  w.chrome = {
    storage: { sync: { get: (d, cb) => cb(d) }, local: { get: (d, cb) => cb({ ...d, activeAccount: 'blacksoil' }), set() {} }, onChanged: { addListener() {} } },
    runtime: { sendMessage: (m) => { sent.push(m); return Promise.resolve({}); }, onMessage: { addListener() {} } }
  };
  w.BigInt = BigInt;
  w.eval(fs.readFileSync('content.js', 'utf8'));
  return new Promise((r) => setTimeout(() => { r(sent.filter((m) => m.type === 'X_ONEWAY_IX')); w.close(); }, 3300));
}
(async () => {
  // 我的原帖 900：maqinuo 直接回复；leo 是对 maqinuo 的楼中楼（同组、无分隔）；我自己的回复不记；发现更多之后忽略
  const html = focal('blacksoil', '900') + art('maqinuo0605', '1001') + art('blacksoil', '1002') + art('leo', '1003') + sep +
    art('kate', '1004') + sep + art('mia', '1005', '<div>Replying to <a href="/nina">@nina</a></div>') + sep +
    '<div data-testid="cellInnerDiv"><h2>Discover more</h2></div>' + art('spam', '1999');
  const a = await run(html, '/blacksoil/status/900');
  console.log(a.map((m) => `${m.action}:${m.username}`));
  assert.deepStrictEqual(a.map((m) => `${m.action}:${m.username}:${m.notifId}`), ['reply:maqinuo0605:tw:1001:maqinuo0605', 'reply:kate:tw:1004:kate']);
  // 我在别人帖下的回复 950 打开后：有祖先(别人) → 回你的楼
  const b = await run(art('dave', '940') + focal('blacksoil', '950') + art('dave', '960'), '/blacksoil/status/950');
  console.log(b.map((m) => `${m.action}:${m.username}`));
  assert.deepStrictEqual(b.map((m) => `${m.action}:${m.username}`), ['thread_reply:dave']);
  // 别人的帖：不扫
  const c = await run(focal('dave', '940') + art('erin', '941'), '/dave/status/940');
  assert.strictEqual(c.length, 0);
  console.log('THREAD DOM PASS');
})();
