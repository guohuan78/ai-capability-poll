'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const context = { window: {} };
vm.runInNewContext(read('config.js'), context);
const config = context.window.POLL_CONFIG;

test('默认入口展示现场统计，参与按钮指向独立投票页', () => {
  const html = read('index.html');
  assert.match(html, /class="present-page"/);
  assert.match(html, /id="results"/);
  assert.match(html, /id="respondents"/);
  assert.match(html, /src="present\.js\?v=/);
  assert.doesNotMatch(html, /src="vote\.js/);
  assert.match(html, /href="vote\.html" class="quiet-button">参与投票/);
  assert.match(html, /src="qr\.png\?v=/);
});

test('独立投票页和原统计链接保持可达', () => {
  assert.match(read('vote.html'), /id="vote-form"/);
  assert.match(read('vote.html'), /A–J 可多选，K \/ L 需单独选择/);
  assert.match(read('vote.html'), /href="\.\/">查看现场统计/);
  assert.match(read('present.html'), /http-equiv="refresh" content="0;url=\.\/"/);
  assert.match(read('present.html'), /location\.search \+ location\.hash/);
  assert.equal(config.participationUrl, 'https://guohuan78.github.io/ai-capability-poll/vote.html');
});

test('配置与 PPT 第五页的十二个选项及说明一致', () => {
  const actual = JSON.parse(JSON.stringify(config.options));
  assert.equal(config.pollTitle, '现场投票：AI 已经能做好哪些任务？');
  assert.equal(config.criterion, '给定目标、资料与必要环境，AI 自主交付可用成果。');
  assert.deepEqual(actual.map(o => [o.id, o.label]), [
    ['A', '制作精美的 PPT'], ['B', '生成精美图表'], ['C', '生成精美的 MV'],
    ['D', '生成精致的三维模型'], ['E', '撰写论文'], ['F', '生成技术文章'],
    ['G', '搭建并上线个人网站'], ['H', '线上 Bug 自主端到端修复'],
    ['I', '为手机编写可运行的操作系统'], ['J', '嵌入式开发板闭环开发'],
    ['K', '以上任务暂无符合预期'], ['L', '了解不足，暂不判断']
  ]);
  assert.deepEqual(actual.filter(o => o.exclusive).map(o => o.id), ['K', 'L']);
  assert.equal(actual[5].description, '获得可观关注与阅读');
  assert.equal(actual[7].description, '定位、修改、测试并提交代码');
  assert.equal(actual[9].description, '编码、部署、运行与验证');
});

test('HTML 引用的本地静态文件均存在', () => {
  for (const file of ['index.html', 'vote.html', 'present.html']) {
    for (const [, ref] of read(file).matchAll(/(?:src|href)="([^"#]+)"/g)) {
      if (/^https?:/.test(ref)) continue;
      const target = ref.split(/[?#]/)[0];
      assert.ok(fs.existsSync(path.join(root, target)), `${file}: ${ref}`);
    }
  }
  assert.equal(fs.readFileSync(path.join(root, 'qr.png')).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});
