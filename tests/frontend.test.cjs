'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

const configContext = { window: {} };
runScript('config.js', configContext);
const configuredPoll = configContext.window.POLL_CONFIG;
const options = Array.from(configuredPoll.options, option => ({ ...option }));
function snapshot(round = 'round-1', revision = 1, extra = {}) {
  return { round, revision, respondents: 0, open: true, title: round, options,
    counts: Object.fromEntries(options.map(option => [option.id, 0])), fetchedAt: new Date(), ...extra };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function runScript(name, context) {
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'), context, { filename: name });
}

// 只实现页面脚本实际使用的 DOM 接口，不依赖浏览器或第三方测试包。
class Element {
  constructor(tag = 'div') {
    this.tag = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.style = {};
    this.className = ''; this.dataset = {}; this.checked = false; this.textContent = '';
    this.hidden = false; this.disabled = false; this.value = '';
    this.classList = { contains: token => this.className.split(/\s+/).includes(token) };
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  setAttribute(name, value) { this.attributes[name] = value; }
  querySelectorAll(selector) {
    const found = [];
    function walk(element) {
      for (const child of element.children) {
        if (child.tag === 'input' && (selector !== 'input:checked' || child.checked)) found.push(child);
        walk(child);
      }
    }
    walk(this); return found;
  }
}
class Input extends Element { constructor() { super('input'); } }
function descendants(element, className) {
  return element.children.flatMap(child => [
    ...(child.classList.contains(className) ? [child] : []), ...descendants(child, className)
  ]);
}

function page(script, overrides = {}) {
  const elements = new Map();
  let onData, onError, refreshes = 0, resets = 0;
  const poll = {
    config: {}, fallbackOptions: options,
    watch(render, error) { onData = render; onError = error; return { refresh() { refreshes++; } }; },
    resetPendingVote() { resets++; }, vote: async () => snapshot(), read: async () => snapshot(),
    joinUrl: () => 'https://frontend.test/', formatTime: () => '12:00:00', ...overrides
  };
  const get = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  runScript(script, {
    window: { LivePoll: poll }, HTMLInputElement: Input, setTimeout, navigator: {},
    document: { getElementById: get, createElement: tag => tag === 'input' ? new Input() : new Element(tag), addEventListener() {} }
  });
  return {
    get, render: data => onData(data), error: error => onError(error),
    get refreshes() { return refreshes; }, get resets() { return resets; },
    selected: () => get('options').querySelectorAll('input:checked').map(input => input.value),
    select(id) {
      const input = get('options').querySelectorAll('input').find(option => option.value === id);
      input.checked = true; get('options').listeners.change({ target: input });
    },
    submit: () => get('vote-form').listeners.submit({ preventDefault() {} })
  };
}

test('参与页忽略同轮与跨轮的旧统计响应', () => {
  const ui = page('vote.js');
  ui.render(snapshot('round-1', 10)); ui.render(snapshot('round-2', 20));
  ui.select('B');
  ui.render(snapshot('round-1', 11, { open: false }));
  assert.equal(ui.get('poll-title').textContent, 'round-2');
  assert.deepEqual(ui.selected(), ['B']);
  ui.render(snapshot('round-2', 19, { open: false }));
  assert.equal(ui.get('choices-fieldset').disabled, false);
});

test('大屏忽略同轮与跨轮的旧统计响应', () => {
  const ui = page('present.js');
  ui.render(snapshot('round-1', 10, { respondents: 5 }));
  ui.render(snapshot('round-2', 20, { respondents: 2 }));
  ui.render(snapshot('round-1', 11, { respondents: 5, open: false }));
  ui.render(snapshot('round-2', 19, { respondents: 3, open: false }));
  assert.equal(ui.get('poll-title').textContent, 'round-2');
  assert.equal(ui.get('respondents').textContent, '2');
  assert.equal(ui.get('poll-state').textContent, '投票进行中');
});

test('旧轮提交成功晚于换轮到达时保留新轮且不提示提交成功', async () => {
  const pending = deferred(); let requestedRound;
  const ui = page('vote.js', { vote: (choices, round) => { requestedRound = round; return pending.promise; } });
  ui.render(snapshot('round-1', 10)); ui.select('A');
  const submitting = ui.submit();
  assert.equal(requestedRound, 'round-1');
  ui.render(snapshot('round-2', 20));
  pending.resolve(snapshot('round-1', 11, { respondents: 1 })); await submitting;
  assert.equal(ui.get('poll-title').textContent, 'round-2');
  assert.deepEqual(ui.selected(), []);
  assert.match(ui.get('form-message').textContent, /新一轮/);
  assert.doesNotMatch(ui.get('form-message').textContent, /提交成功/);
  assert.equal(ui.get('submit-button').textContent, '提交判断');
  assert.equal(ui.refreshes, 1);
  assert.equal(ui.resets, 1);
});

test('换轮后的旧请求网络错误不覆盖新轮提示', async () => {
  const pending = deferred();
  const ui = page('vote.js', { vote: () => pending.promise });
  ui.render(snapshot('round-1', 10)); ui.select('A'); const submitting = ui.submit();
  ui.render(snapshot('round-2', 20)); pending.reject(new Error('连接超时')); await submitting;
  assert.match(ui.get('form-message').textContent, /新一轮/);
  assert.doesNotMatch(ui.get('form-message').textContent, /选择仍保留/);
});

test('409 恢复读取的旧回包不会覆盖并行轮询获取的新轮', async () => {
  const vote = deferred(), read = deferred(), readStarted = deferred();
  const ui = page('vote.js', {
    vote: () => vote.promise,
    read: () => { readStarted.resolve(); return read.promise; }
  });
  ui.render(snapshot('round-1', 10)); ui.select('A'); const submitting = ui.submit();
  vote.reject(Object.assign(new Error('本轮已切换'), { status: 409 }));
  await readStarted.promise;
  ui.render(snapshot('round-2', 20));
  read.resolve(snapshot('round-1', 11, { open: false })); await submitting;
  assert.equal(ui.get('poll-title').textContent, 'round-2');
  assert.match(ui.get('form-message').textContent, /新一轮/);
  assert.doesNotMatch(ui.get('form-message').textContent, /投票已结束/);
});

test('409 恢复读取失败时仍保留并行收到的新轮提示', async () => {
  const vote = deferred(), read = deferred(), readStarted = deferred();
  const ui = page('vote.js', {
    vote: () => vote.promise, read: () => { readStarted.resolve(); return read.promise; }
  });
  ui.render(snapshot('round-1', 10)); ui.select('A'); const submitting = ui.submit();
  vote.reject(Object.assign(new Error('本轮已切换'), { status: 409 })); await readStarted.promise;
  ui.render(snapshot('round-2', 20)); read.reject(new Error('连接超时')); await submitting;
  assert.match(ui.get('form-message').textContent, /新一轮/);
  assert.equal(ui.get('form-message').classList.contains('error'), false);
});

test('423 恢复读取使用已接受的最新结束状态', async () => {
  const read = deferred(), readStarted = deferred();
  const ui = page('vote.js', {
    vote: async () => { throw Object.assign(new Error('投票已结束'), { status: 423 }); },
    read: () => { readStarted.resolve(); return read.promise; }
  });
  ui.render(snapshot('round-1', 10)); ui.select('A'); const submitting = ui.submit();
  await readStarted.promise;
  ui.render(snapshot('round-1', 20, { open: false }));
  read.resolve(snapshot('round-1', 11)); await submitting;
  assert.equal(ui.get('submit-button').disabled, true);
  assert.match(ui.get('form-message').textContent, /投票已结束/);
});

test('同轮序号冲突后保留选择并允许重试', async () => {
  const ui = page('vote.js', {
    vote: async () => { throw Object.assign(new Error('提交序号冲突'), { status: 409 }); },
    read: async () => snapshot('round-1', 11)
  });
  ui.render(snapshot('round-1', 10)); ui.select('B'); await ui.submit();
  assert.deepEqual(ui.selected(), ['B']);
  assert.equal(ui.get('submit-button').disabled, false);
  assert.match(ui.get('form-message').textContent, /再次提交/);
  assert.equal(ui.resets, 1);
});

test('同轮断线重连保留未提交选择', () => {
  const ui = page('vote.js');
  ui.render(snapshot('round-1', 10)); ui.select('B');
  ui.error(new Error('network'));
  assert.deepEqual(ui.selected(), ['B']);
  assert.equal(ui.get('connection').className, 'connection disconnected');
  ui.render(snapshot('round-1', 11));
  assert.deepEqual(ui.selected(), ['B']);
  assert.equal(ui.get('connection').className, 'connection connected');
});

test('正常提交、修改提交以及互斥选项仍可使用', async () => {
  const ui = page('vote.js', { vote: async () => snapshot('round-1', 11, { respondents: 1 }) });
  ui.render(snapshot('round-1', 10)); ui.select('A'); ui.select('B');
  assert.deepEqual(ui.selected(), ['A', 'B']); await ui.submit();
  assert.match(ui.get('form-message').textContent, /提交成功/);
  assert.equal(ui.get('submit-button').disabled, true);
  ui.select('K'); assert.deepEqual(ui.selected(), ['K']);
  assert.equal(ui.get('submit-button').textContent, '更新我的判断');
  ui.select('L'); assert.deepEqual(ui.selected(), ['L']);
  ui.select('A'); assert.deepEqual(ui.selected(), ['A']);
  await ui.submit(); assert.match(ui.get('form-message').textContent, /提交成功/);
});

test('十二项公开配置与题目、标准、副文案逐字一致', () => {
  assert.equal(configuredPoll.pollTitle, '现场投票：AI 已经能做好哪些任务？');
  assert.equal(configuredPoll.criterion, '给定目标、资料与必要环境，AI 自主交付可用成果。');
  assert.equal(configuredPoll.participationUrl, 'https://guohuan78.github.io/ai-capability-poll/vote.html');
  assert.deepEqual(options.map(option => [option.id, option.label, option.description || '', Boolean(option.exclusive)]), [
    ['A', '制作精美的 PPT', '', false], ['B', '生成精美图表', '', false],
    ['C', '生成精美的 MV', '', false], ['D', '生成精致的三维模型', '', false],
    ['E', '撰写论文', '', false], ['F', '生成技术文章', '获得可观关注与阅读', false],
    ['G', '搭建并上线个人网站', '', false], ['H', '线上 Bug 自主端到端修复', '定位、修改、测试并提交代码', false],
    ['I', '为手机编写可运行的操作系统', '', false], ['J', '嵌入式开发板闭环开发', '编码、部署、运行与验证', false],
    ['K', '以上任务暂无符合预期', '', true], ['L', '了解不足，暂不判断', '', true]
  ]);
});

test('A–J 全部可多选，K 与 L 分别与所有选项互斥', () => {
  const ui = page('vote.js'); ui.render(snapshot());
  for (const id of 'ABCDEFGHIJ') ui.select(id);
  assert.deepEqual(ui.selected(), Array.from('ABCDEFGHIJ'));
  ui.select('K'); assert.deepEqual(ui.selected(), ['K']);
  ui.select('L'); assert.deepEqual(ui.selected(), ['L']);
  ui.select('J'); assert.deepEqual(ui.selected(), ['J']);
  ui.select('A'); assert.deepEqual(ui.selected(), ['A', 'J']);
});

test('投票页分离展示字母、主文案和副文案，并使用服务端标准', () => {
  const ui = page('vote.js'); ui.render(snapshot('round-1', 1, { criterion: configuredPoll.criterion }));
  assert.deepEqual(descendants(ui.get('options'), 'option-letter').map(node => node.textContent), Array.from('ABCDEFGHIJKL'));
  assert.equal(descendants(ui.get('options'), 'option-label').length, 12);
  assert.deepEqual(descendants(ui.get('options'), 'option-description').map(node => node.textContent), [
    '获得可观关注与阅读', '定位、修改、测试并提交代码', '编码、部署、运行与验证'
  ]);
  assert.equal(ui.get('criterion').textContent, configuredPoll.criterion);
});

test('统计页展示十二项字母与副文案，每项零人数仍明确显示', () => {
  const ui = page('present.js'); ui.render(snapshot('round-1', 1, { criterion: configuredPoll.criterion }));
  assert.equal(ui.get('results').children.length, 12);
  assert.deepEqual(descendants(ui.get('results'), 'result-letter').map(node => node.textContent), Array.from('ABCDEFGHIJKL'));
  assert.equal(descendants(ui.get('results'), 'result-description').length, 3);
  for (const metrics of descendants(ui.get('results'), 'result-metrics')) {
    assert.equal(metrics.children[0].textContent, '0 人');
    assert.equal(metrics.children[1].textContent, '0%');
  }
  assert.equal(ui.get('criterion').textContent, configuredPoll.criterion);
  assert.match(ui.get('results').children[7].attributes['aria-label'], /H，线上 Bug 自主端到端修复，定位、修改、测试并提交代码，0 人/);
});

test('旧接口未返回 criterion 时页面保留配置中的标准', () => {
  for (const script of ['vote.js', 'present.js']) {
    const ui = page(script, { config: { criterion: configuredPoll.criterion } });
    ui.render(snapshot()); assert.equal(ui.get('criterion').textContent, configuredPoll.criterion);
  }
});

function transport({ storageBlocked = false, config = {}, timers = {} } = {}) {
  const values = new Map(), calls = [], responses = [];
  const context = {
    window: { POLL_CONFIG: { apiBase: 'https://api.test', room: 'room', options, ...config }, crypto: { randomUUID }, addEventListener() {}, removeEventListener() {} },
    document: { addEventListener() {}, removeEventListener() {} }, AbortController, URL,
    location: { href: 'https://frontend.test/ai-capability-poll/' },
    setTimeout: timers.setTimeout || setTimeout, clearTimeout: timers.clearTimeout || clearTimeout,
    localStorage: {
      getItem(key) { if (storageBlocked) throw new Error('denied'); return values.get(key) || null; },
      setItem(key, value) { if (storageBlocked) throw new Error('denied'); values.set(key, value); }
    },
    async fetch(url, init) {
      calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      if (typeof next === 'function') return next(url, init);
      return next || Response.json(snapshot());
    }
  };
  runScript('poll.js', context);
  return { poll: context.window.LivePoll, calls, responses };
}

test('公开读取使用匿名请求且禁用缓存', async () => {
  const api = transport(); await api.poll.read();
  assert.equal(api.calls[0].url, 'https://api.test/api/polls/room');
  assert.equal(api.calls[0].init.credentials, 'omit');
  assert.equal(api.calls[0].init.cache, 'no-store');
});

test('网络失败重试复用身份与提交序号，修改选择和换轮递增序号', async () => {
  const api = transport(); api.responses.push(new Error('network'));
  await assert.rejects(api.poll.vote(['A', 'B'], 'round-1'));
  await api.poll.vote(['B', 'A'], 'round-1');
  assert.equal(api.calls[0].body.voterId, api.calls[1].body.voterId);
  assert.equal(api.calls[0].body.voteRevision, api.calls[1].body.voteRevision);
  await api.poll.vote(['A'], 'round-1');
  assert.equal(api.calls[2].body.voteRevision, api.calls[1].body.voteRevision + 1);
  await api.poll.vote(['A'], 'round-2');
  assert.equal(api.calls[3].body.voteRevision, api.calls[2].body.voteRevision + 1);
  api.poll.resetPendingVote(); await api.poll.vote(['A'], 'round-2');
  assert.equal(api.calls[4].body.voteRevision, api.calls[3].body.voteRevision + 1);
});

test('隐私模式禁用本地存储时会话内身份保持稳定', async () => {
  const api = transport({ storageBlocked: true });
  await api.poll.vote(['A'], 'round-1'); await api.poll.vote(['B'], 'round-1');
  assert.equal(api.calls[0].body.voterId, api.calls[1].body.voterId);
});

for (const status of [401, 403]) {
  for (const contentType of ['text/html', 'application/json']) {
    test(`HTTP ${status} ${contentType} 明确提示网络入口拒绝`, async () => {
      const api = transport();
      api.responses.push(new Response(contentType === 'text/html' ? '<html>Access denied</html>' : '{"error":"denied"}', {
        status, headers: { 'Content-Type': contentType }
      }));
      await assert.rejects(api.poll.read(), error => error.status === status && /网络入口拒绝访问/.test(error.message) && !/匿名访问设置/.test(error.message));
    });
  }
}

test('HTTP 200 HTML 登录页面明确提示服务地址与访问设置', async () => {
  const api = transport();
  api.responses.push(new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } }));
  await assert.rejects(api.poll.read(), /返回了网页/);
});

test('HTTP 502 HTML 网关错误保留状态码', async () => {
  const api = transport();
  api.responses.push(new Response('<html>Bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }));
  await assert.rejects(api.poll.read(), error => error.status === 502 && /HTTP 502/.test(error.message));
});

test('非 JSON 内容与无效统计数据保持可恢复错误', async () => {
  const api = transport();
  api.responses.push(new Response('not json'));
  await assert.rejects(api.poll.read(), /无法识别的数据/);
  api.responses.push(Response.json({ options: [] }));
  await assert.rejects(api.poll.read(), /统计数据格式/);
  const data = await api.poll.read(); assert.equal(data.round, 'round-1');
});

test('入口网络失败后切换备用，并优先复用最近成功入口', async () => {
  const api = transport({ config: { apiFallbackBases: ['https://relay.test/'] } });
  api.responses.push(new TypeError('Failed to fetch'));
  await api.poll.read(); await api.poll.read();
  assert.deepEqual(api.calls.map(call => call.url), [
    'https://api.test/api/polls/room', 'https://relay.test/api/polls/room', 'https://relay.test/api/polls/room'
  ]);
});

for (const status of [401, 403, 500, 502, 503]) {
  test(`HTTP ${status} 允许切换备用入口`, async () => {
    const api = transport({ config: { apiFallbackBases: ['https://relay.test'] } });
    api.responses.push(Response.json({ error: 'unavailable' }, { status }));
    assert.equal((await api.poll.read()).round, 'round-1');
    assert.equal(api.calls.length, 2);
    assert.equal(api.calls[1].url, 'https://relay.test/api/polls/room');
  });
}

for (const type of ['text/html', 'text/plain']) {
  test(`${type} 非 JSON 响应允许切换备用入口`, async () => {
    const api = transport({ config: { apiFallbackBases: ['https://relay.test'] } });
    api.responses.push(new Response('gateway response', { headers: { 'Content-Type': type } }));
    await api.poll.read(); assert.equal(api.calls.length, 2);
  });
}

for (const status of [400, 409, 423, 429]) {
  for (const type of ['application/json', 'text/html']) {
    test(`HTTP ${status} ${type} 业务错误不切换入口`, async () => {
      const api = transport({ config: { apiFallbackBases: ['https://relay.test'] } });
      api.responses.push(new Response(type === 'application/json' ? '{"error":"业务拒绝"}' : '<html>业务拒绝</html>', {
        status, headers: { 'Content-Type': type }
      }));
      await assert.rejects(api.poll.vote(['A'], 'round-1'), error => error.status === status);
      assert.equal(api.calls.length, 1);
    });
  }
}

test('入口切换复用完全相同的 POST 请求正文与提交序号', async () => {
  const api = transport({ config: { apiFallbackBases: ['https://relay.test'] } });
  api.responses.push(new TypeError('response lost after commit'));
  await api.poll.vote(['A', 'B'], 'round-1');
  assert.equal(api.calls.length, 2);
  assert.equal(api.calls[0].init.body, api.calls[1].init.body);
  assert.equal(api.calls[0].body.voteRevision, api.calls[1].body.voteRevision);
  assert.equal(api.calls[0].body.voterId, api.calls[1].body.voterId);
  assert.equal(api.calls[0].init.method, 'POST');
  assert.equal(api.calls[1].init.method, 'POST');
});

test('备用入口再次失败时可以切回主入口', async () => {
  const api = transport({ config: { apiFallbackBases: ['https://relay.test'] } });
  api.responses.push(new Error('primary offline')); await api.poll.read();
  api.responses.push(new Error('relay offline')); await api.poll.read(); await api.poll.read();
  assert.deepEqual(api.calls.map(call => new URL(call.url).hostname), [
    'api.test', 'relay.test', 'relay.test', 'api.test', 'api.test'
  ]);
});

test('较早请求的延迟成功不会覆盖较新请求选定的入口', async () => {
  const api = transport({ config: { apiFallbackBases: ['https://relay.test'] } });
  const old = deferred();
  api.responses.push(() => old.promise);
  const olderRead = api.poll.read();
  api.responses.push(new Error('primary blocked'));
  await api.poll.read();
  old.resolve(Response.json(snapshot())); await olderRead;
  await api.poll.read();
  assert.equal(api.calls[api.calls.length - 1].url, 'https://relay.test/api/polls/room');
});

test('每个入口最多等待 6 秒，超时后切换且使用独立 AbortSignal', async () => {
  const delays = [];
  const api = transport({
    config: { apiFallbackBases: ['https://relay.test'] },
    timers: {
      setTimeout(callback, delay) { delays.push(delay); queueMicrotask(callback); return delays.length; },
      clearTimeout() {}
    }
  });
  api.responses.push((url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'AbortError' })));
  }));
  await api.poll.read();
  assert.deepEqual(delays, [6000, 6000]);
  assert.equal(api.calls[0].init.signal.aborted, true);
  assert.notEqual(api.calls[0].init.signal, api.calls[1].init.signal);
});

test('配置入口去重并兼容仅 apiBase 的已有配置', async () => {
  const api = transport({ config: { apiBase: 'https://api.test/', apiFallbackBases: ['https://api.test', ' ', null, 'https://relay.test/', 'https://relay.test'] } });
  api.responses.push(new Error('offline'), new Error('offline'));
  await assert.rejects(api.poll.read());
  assert.equal(api.calls.length, 2);
  const single = transport(); single.responses.push(new Error('offline'));
  await assert.rejects(single.poll.read()); assert.equal(single.calls.length, 1);
});

test('JSON 统计结构错误不切换入口', async () => {
  const api = transport({ config: { apiFallbackBases: ['https://relay.test'] } });
  api.responses.push(Response.json({ round: 'invalid' }));
  await assert.rejects(api.poll.read(), /统计数据格式/);
  assert.equal(api.calls.length, 1);
});

test('API 归一化保留 criterion 与独立 description，并识别 K/L 互斥', async () => {
  const api = transport({ config: { criterion: '配置标准' } });
  api.responses.push(Response.json(snapshot('round-1', 1, { criterion: configuredPoll.criterion })));
  const data = await api.poll.read();
  assert.equal(data.criterion, configuredPoll.criterion);
  assert.equal(data.options.find(option => option.id === 'F').label, '生成技术文章');
  assert.equal(data.options.find(option => option.id === 'F').description, '获得可观关注与阅读');
  assert.equal(data.options.find(option => option.id === 'A').description, '');
  assert.deepEqual(Array.from(api.poll.exclusiveIds), ['K', 'L']);
  assert.equal((await api.poll.read()).criterion, '配置标准');
});

test('参与链接未配置时指向独立投票页 vote.html', () => {
  assert.equal(transport().poll.joinUrl(), 'https://frontend.test/ai-capability-poll/vote.html');
});
