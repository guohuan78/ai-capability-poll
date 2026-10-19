(function () {
  'use strict';
  const poll = window.LivePoll;
  const elements = {
    title: document.getElementById('poll-title'), criterion: document.getElementById('criterion'),
    connection: document.getElementById('connection'), connectionText: document.getElementById('connection-text'),
    form: document.getElementById('vote-form'), fieldset: document.getElementById('choices-fieldset'),
    options: document.getElementById('options'), message: document.getElementById('form-message'),
    submit: document.getElementById('submit-button'), hint: document.getElementById('selection-hint')
  };
  let data;
  let hasConnected = false;
  let isSubmitting = false;
  let submitted = false;
  let dirty = false;
  let optionSignature = '';
  const newRoundMessage = '已开始新一轮投票，请重新选择并提交你的判断。';

  if (poll.config.pollTitle) elements.title.textContent = poll.config.pollTitle;
  if (poll.config.criterion) elements.criterion.textContent = poll.config.criterion;

  function selected() { return Array.from(elements.options.querySelectorAll('input:checked'), input => input.value); }
  function setMessage(text, kind) {
    elements.message.hidden = !text;
    elements.message.className = 'form-message ' + (kind || '');
    elements.message.textContent = text;
  }
  function updateButton() {
    const isOpen = Boolean(data && data.open);
    elements.fieldset.disabled = !isOpen || isSubmitting;
    elements.submit.disabled = !hasConnected || !isOpen || isSubmitting || selected().length === 0 || (submitted && !dirty);
    elements.submit.textContent = isSubmitting ? '正在提交…' : !isOpen && hasConnected ? '本轮投票已结束' : submitted && !dirty ? '已提交，感谢参与' : submitted ? '更新我的判断' : '提交判断';
  }
  function renderOptions(options) {
    const signature = JSON.stringify(options);
    if (signature === optionSignature) return;
    optionSignature = signature;
    const previous = new Set(selected());
    elements.options.replaceChildren();
    for (const option of options) {
      const label = document.createElement('label');
      label.className = 'option-card' + (option.exclusive ? ' exclusive-option' : '');
      const input = document.createElement('input');
      input.type = 'checkbox'; input.name = 'choices'; input.value = option.id;
      input.checked = previous.has(option.id); input.dataset.exclusive = String(option.exclusive);
      const mark = document.createElement('span'); mark.className = 'option-mark'; mark.setAttribute('aria-hidden', 'true');
      const copy = document.createElement('span'); copy.className = 'option-copy';
      const text = document.createElement('span'); text.className = 'option-label'; text.textContent = option.label;
      const letter = document.createElement('span'); letter.className = 'option-letter'; letter.textContent = option.id.toUpperCase();
      copy.append(text);
      if (option.description) {
        const description = document.createElement('span'); description.className = 'option-description'; description.textContent = option.description;
        copy.append(description);
      }
      label.append(input, mark, letter, copy); elements.options.append(label);
    }
  }
  function render(next) {
    // revision 由服务端全局递增，换轮也不能接受较早的响应。
    if (data && Number.isFinite(Number(data.revision)) && Number(next.revision) < Number(data.revision)) return;
    const changedRound = Boolean(data && data.round !== next.round);
    data = next; hasConnected = true;
    elements.title.textContent = next.title;
    if (typeof next.criterion === 'string') elements.criterion.textContent = next.criterion;
    renderOptions(next.options);
    if (changedRound) {
      for (const input of elements.options.querySelectorAll('input')) input.checked = false;
      submitted = false; dirty = false;
      setMessage(newRoundMessage, 'info');
    }
    elements.connection.className = 'connection connected';
    elements.connectionText.textContent = next.open ? '投票进行中 · 已有 ' + next.respondents + ' 人参与' : '本轮投票已结束 · 共 ' + next.respondents + ' 人参与';
    updateButton();
  }
  function onError(error) {
    elements.connection.className = 'connection disconnected';
    elements.connectionText.textContent = hasConnected ? '连接中断，正在重新连接；提交时会再次确认。' : error.message;
    updateButton();
  }

  renderOptions(poll.fallbackOptions.map(option => Object.assign({}, option, { exclusive: Boolean(option.exclusive) })));
  const watcher = poll.watch(render, onError);

  elements.options.addEventListener('change', event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.checked) {
      for (const other of elements.options.querySelectorAll('input')) {
        if (other === target) continue;
        if (target.dataset.exclusive === 'true' || other.dataset.exclusive === 'true') other.checked = false;
      }
    }
    dirty = true;
    if (!submitted || elements.message.classList.contains('error')) setMessage('', '');
    else setMessage('选择已调整，请点击“更新我的判断”保存。', 'info');
    updateButton();
  });

  elements.form.addEventListener('submit', async event => {
    event.preventDefault();
    const choices = selected();
    if (!choices.length || isSubmitting || !data || !data.open) return;
    const submittedRound = data.round;
    isSubmitting = true; updateButton(); setMessage('', '');
    try {
      const next = await poll.vote(choices, submittedRound);
      render(next);
      if (data.round !== submittedRound || next.round !== submittedRound) {
        poll.resetPendingVote();
        setMessage(newRoundMessage, 'info');
        watcher.refresh();
        return;
      }
      submitted = true; dirty = false;
      setMessage('提交成功！你的判断已计入现场统计。可以调整选择后重新提交。', 'success');
    } catch (error) {
      if (data.round !== submittedRound) {
        poll.resetPendingVote();
        setMessage(newRoundMessage, 'info');
      } else if (error.status === 409 || error.status === 423) {
        poll.resetPendingVote();
        try {
          const next = await poll.read(); render(next);
          if (data.round !== submittedRound) setMessage(newRoundMessage, 'info');
          else if (!data.open) setMessage('本轮投票已结束，当前提交未被计入。', 'error');
          else setMessage('提交状态已更新。请确认当前选项，再次提交。', 'info');
        } catch (_) {
          if (data.round !== submittedRound) setMessage(newRoundMessage, 'info');
          else setMessage(error.message + ' 请等待重新连接后确认本轮状态。', 'error');
        }
      } else setMessage(error.message + ' 你的选择仍保留在本页。', 'error');
    } finally { isSubmitting = false; updateButton(); }
  });
})();
