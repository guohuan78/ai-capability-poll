/* 公开配置：这里只能填写公开 API 地址，不能放管理口令或任何服务密钥。 */
window.POLL_CONFIG = {
  apiBase: 'https://ai-capability-poll-api.prime-daisy-7276.chatgpt.site',
  room: 'ai-capability-20261019',
  pollTitle: '你认为，目前 AI 已经能较好完成哪些任务？',
  criterion: '“做得较好”指：经过少量人工检查或修改，结果就能实际使用。',
  participationUrl: 'https://guohuan78.github.io/ai-capability-poll/',
  pollIntervalMs: 2000,
  options: [
    { id: 'A', label: '阅读资料、提炼要点' },
    { id: 'B', label: '编写常见代码、辅助排错' },
    { id: 'C', label: '整理数据、生成图表' },
    { id: 'D', label: '起草文档、制作 PPT' },
    { id: 'E', label: '搭建简单网页或小工具' },
    { id: 'F', label: '生成图片、音视频内容' },
    { id: 'G', label: '以上任务都还没达到我的预期', exclusive: true },
    { id: 'H', label: '使用或了解不多，暂不判断', exclusive: true }
  ]
};
