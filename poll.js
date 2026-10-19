(function () {
  'use strict';

  const config = window.POLL_CONFIG || {};
  const room = config.room || 'ai-capability-20261019';
  const base = String(config.apiBase || '').replace(/\/+$/, '');
  const endpoint = base + '/api/polls/' + encodeURIComponent(room);
  const intervalMs = Math.max(1000, Number(config.pollIntervalMs) || 2000);
  const fallbackOptions = Array.isArray(config.options) ? config.options : [];
  const exclusiveIds = new Set(fallbackOptions.filter(option => option.exclusive).map(option => option.id));
  const storageKey = 'live-poll:voter:' + room;
  let volatileVoterId;
  let volatileRevision = 0;
  let pendingVote;

  class PollError extends Error {
    constructor(message, status) { super(message); this.name = 'PollError'; this.status = status; }
  }

  function getVoterId() {
    if (volatileVoterId) return volatileVoterId;
    try {
      const existing = localStorage.getItem(storageKey);
      if (existing && /^[a-zA-Z0-9_-]{16,100}$/.test(existing)) return (volatileVoterId = existing);
    } catch (_) { /* 隐私模式不允许存储时，在本次页面会话中保留匿名编号。 */ }
    let id;
    if (window.crypto && typeof window.crypto.randomUUID === 'function') id = window.crypto.randomUUID();
    else if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      id = Array.from(window.crypto.getRandomValues(new Uint8Array(24)), n => n.toString(16).padStart(2, '0')).join('');
    } else throw new PollError('当前浏览器无法生成匿名投票编号，请换用新版浏览器。');
    volatileVoterId = id;
    try { localStorage.setItem(storageKey, id); } catch (_) { /* 不影响本次提交。 */ }
    return id;
  }

  async function request(path, options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    try {
      const response = await fetch(endpoint + path, Object.assign({
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      }, options || {}));
      let data;
      try { data = await response.json(); }
      catch (_) { throw new PollError('服务返回了无法识别的数据，请稍后重试。', response.status); }
      if (!response.ok) {
        const message = typeof data.error === 'string' ? data.error : typeof data.message === 'string' ? data.message : '';
        if (response.status === 409 || response.status === 423) throw new PollError(message || '本轮投票已结束。', response.status);
        if (response.status === 429) throw new PollError('提交过于频繁，请稍等片刻再试。', response.status);
        throw new PollError(message || '暂时无法连接投票服务，请稍后重试。', response.status);
      }
      return normalize(data);
    } catch (error) {
      if (error instanceof PollError) throw error;
      if (error.name === 'AbortError') throw new PollError('连接超时，请检查网络后重试。');
      throw new PollError('暂时无法连接投票服务，正在尝试重新连接。');
    } finally { clearTimeout(timeout); }
  }

  function normalize(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.options) || !Number.isFinite(Number(data.respondents)) || typeof data.round !== 'string' || !data.round) {
      throw new PollError('统计数据格式不正确，请稍后重试。');
    }
    const options = data.options.filter(option => option && typeof option.id === 'string' && typeof option.label === 'string')
      .map(option => ({ id: option.id, label: option.label, exclusive: Boolean(option.exclusive) || exclusiveIds.has(option.id) }));
    if (!options.length) throw new PollError('本轮投票尚未设置选项。');
    const respondents = Math.max(0, Math.floor(Number(data.respondents)));
    const counts = {};
    for (const option of options) counts[option.id] = Math.max(0, Math.floor(Number(data.counts && data.counts[option.id]) || 0));
    return { title: String(data.title || config.pollTitle || ''), options, counts, respondents,
      open: data.open !== false, round: data.round, revision: data.revision, fetchedAt: new Date() };
  }

  function read() { return request(''); }
  function resetPendingVote() { pendingVote = undefined; }
  function vote(choices, round) {
    if (typeof round !== 'string' || !round) return Promise.reject(new PollError('请先连接本轮投票，再提交判断。'));
    const signature = JSON.stringify([round, choices.slice().sort()]);
    if (!pendingVote || pendingVote.signature !== signature) {
      let persisted = 0;
      try { persisted = Math.max(0, Number(localStorage.getItem(storageKey + ':revision')) || 0); } catch (_) { /* 会话内计数仍然有效。 */ }
      volatileRevision = Math.max(volatileRevision, persisted) + 1;
      pendingVote = { signature, revision: volatileRevision };
      try { localStorage.setItem(storageKey + ':revision', String(volatileRevision)); } catch (_) { /* 不影响本次提交。 */ }
    }
    return request('/votes', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ voterId: getVoterId(), choices, round, voteRevision: pendingVote.revision })
    });
  }

  function watch(onData, onError) {
    let timer;
    let busy = false;
    let stopped = false;
    async function refresh() {
      if (busy || stopped) return;
      busy = true;
      clearTimeout(timer);
      try { const data = await read(); if (!stopped) onData(data); }
      catch (error) { if (!stopped) onError(error); }
      finally { busy = false; if (!stopped) timer = setTimeout(refresh, intervalMs); }
    }
    function onVisibility() { if (!document.hidden) refresh(); }
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    refresh();
    return { refresh, stop() { stopped = true; clearTimeout(timer); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', onVisibility); } };
  }

  function formatTime(date) {
    return date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function joinUrl() {
    return config.participationUrl || new URL('./index.html', location.href).href;
  }

  window.LivePoll = { config, read, vote, resetPendingVote, watch, formatTime, joinUrl, exclusiveIds, fallbackOptions, PollError };
})();
