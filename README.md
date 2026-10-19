# AI 能力认知现场投票

手机匿名投票，浏览器实时展示统计，用于一次组会中的 AI 能力认知讨论。

- [参与投票](https://guohuan78.github.io/ai-capability-poll/)
- [统计大屏](https://guohuan78.github.io/ai-capability-poll/present.html)
- [主持台](https://ai-capability-poll-api.prime-daisy-7276.chatgpt.site/admin)

## 使用

演示前打开统计大屏，点击全屏展示。参与者扫描页面二维码，用手机选择并提交。大屏每两秒读取一次共享后端，无需安装 PowerPoint 插件。PPT 通过普通超链接进入网页，讲完使用 Alt+Tab 返回。

主持台使用创建网站的 ChatGPT 账号登录，可开放、结束投票，或清零开始新一轮。统计页与参与页不要求登录。

## 统计口径

A–F 可多选，G、H 各需单独选择。每个选项占比的分母是参与人数，各项比例合计可超过 100%。同一浏览器可修改选择，更新答卷不会增加人数。浏览器随机编号用于普通重复提交去重，不代表实名一人一票。

前端托管于 GitHub Pages；共享数据由独立 Worker 与 D1 保存，公开配置只包含服务地址。公开仓库不包含管理密钥、实习材料或论文文件。
