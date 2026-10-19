(function () {
  'use strict';
  const poll = window.LivePoll;
  const title = document.getElementById('poll-title');
  const criterion = document.getElementById('criterion');
  const results = document.getElementById('results');
  const respondents = document.getElementById('respondents');
  const pollState = document.getElementById('poll-state');
  const connection = document.getElementById('connection');
  const connectionText = document.getElementById('connection-text');
  const updateTime = document.getElementById('update-time');
  const joinLink = document.getElementById('join-link');
  const fullscreen = document.getElementById('fullscreen-button');
  let lastUpdate;
  let lastData;
  let optionSignature = '';
  const rows = new Map();
  if (poll.config.pollTitle) title.textContent = poll.config.pollTitle;
  if (poll.config.criterion) criterion.textContent = poll.config.criterion;
  joinLink.href = poll.joinUrl();
  joinLink.textContent = poll.joinUrl().replace(/^https?:\/\//, '');
  document.getElementById('join-qr').addEventListener('error', event => {
    event.target.hidden = true;
    document.getElementById('qr-fallback').hidden = false;
  });

  function ensureRows(options) {
    const signature = JSON.stringify(options);
    if (signature === optionSignature) return;
    optionSignature = signature; rows.clear(); results.replaceChildren();
    for (const option of options) {
      const row = document.createElement('div'); row.className = 'result-row' + (option.exclusive ? ' exclusive-result' : '');
      const topline = document.createElement('div'); topline.className = 'result-topline';
      const label = document.createElement('span'); label.className = 'result-label'; label.textContent = option.label;
      const metrics = document.createElement('span'); metrics.className = 'result-metrics';
      const count = document.createElement('strong'); count.textContent = '—';
      const percent = document.createElement('span'); percent.textContent = '—';
      metrics.append(count, percent); topline.append(label, metrics);
      const track = document.createElement('div'); track.className = 'bar-track';
      const fill = document.createElement('div'); fill.className = 'bar-fill'; track.append(fill);
      row.append(topline, track); results.append(row);
      rows.set(option.id, { row, count, percent, fill });
    }
  }

  function render(data) {
    if (lastData && Number.isFinite(Number(lastData.revision)) && Number(data.revision) < Number(lastData.revision)) return;
    lastData = data;
    lastUpdate = data.fetchedAt;
    title.textContent = data.title; respondents.textContent = data.respondents.toLocaleString('zh-CN');
    ensureRows(data.options);
    results.setAttribute('aria-busy', 'false');
    for (const option of data.options) {
      const row = rows.get(option.id);
      const count = data.counts[option.id];
      const percent = data.respondents ? count / data.respondents * 100 : 0;
      row.count.textContent = count.toLocaleString('zh-CN') + ' 人';
      row.percent.textContent = percent.toFixed(0) + '%';
      row.fill.style.width = Math.min(100, percent) + '%';
      row.row.setAttribute('aria-label', option.label + '，' + count + ' 人，' + percent.toFixed(0) + '%');
    }
    pollState.textContent = data.open ? '投票进行中' : '投票已结束';
    pollState.className = 'pill' + (data.open ? '' : ' closed-pill');
    connection.className = 'connection connected';
    connectionText.textContent = '已连接 · 现场统计';
    updateTime.textContent = '上次同步 ' + poll.formatTime(lastUpdate) + ' · 每 ' + ((poll.config.pollIntervalMs || 2000) / 1000) + ' 秒同步';
  }
  function onError(error) {
    connection.className = 'connection disconnected';
    connectionText.textContent = lastUpdate ? '连接中断 · 正在重新连接' : error.message;
    if (lastUpdate) updateTime.textContent = '当前保留 ' + poll.formatTime(lastUpdate) + ' 的统计';
    else { pollState.textContent = '等待连接'; updateTime.textContent = '连接成功后开始同步'; }
  }
  poll.watch(render, onError);

  fullscreen.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (_) { fullscreen.textContent = '请按 F11 进入全屏'; }
  });
  document.addEventListener('fullscreenchange', () => { fullscreen.textContent = document.fullscreenElement ? '退出全屏' : '全屏展示'; });
  document.getElementById('copy-link').addEventListener('click', async event => {
    try { await navigator.clipboard.writeText(poll.joinUrl()); event.target.textContent = '已复制参与链接'; }
    catch (_) { event.target.textContent = '请复制上方链接'; }
    setTimeout(() => { event.target.textContent = '复制参与链接'; }, 2500);
  });
})();
