/* 公开配置：这里只能填写公开 API 地址，不能放管理口令或任何服务密钥。 */
window.POLL_CONFIG = {
  apiBase: 'https://advised-tools-edwards-quiz.trycloudflare.com',
  apiFallbackBases: ['https://ai-capability-poll-api.prime-daisy-7276.chatgpt.site'],
  room: 'ai-capability-20261019',
  pollTitle: '现场投票：AI 已经能做好哪些任务？',
  criterion: '给定目标、资料与必要环境，AI 自主交付可用成果。',
  participationUrl: 'https://guohuan78.github.io/ai-capability-poll/vote.html',
  pollIntervalMs: 2000,
  options: [
    { id: 'A', label: '制作精美的 PPT' },
    { id: 'B', label: '生成精美图表' },
    { id: 'C', label: '生成精美的 MV' },
    { id: 'D', label: '生成精致的三维模型' },
    { id: 'E', label: '撰写论文' },
    { id: 'F', label: '生成技术文章', description: '获得可观关注与阅读' },
    { id: 'G', label: '搭建并上线个人网站' },
    { id: 'H', label: '线上 Bug 自主端到端修复', description: '定位、修改、测试并提交代码' },
    { id: 'I', label: '为手机编写可运行的操作系统' },
    { id: 'J', label: '嵌入式开发板闭环开发', description: '编码、部署、运行与验证' },
    { id: 'K', label: '以上任务暂无符合预期', exclusive: true },
    { id: 'L', label: '了解不足，暂不判断', exclusive: true }
  ]
};
