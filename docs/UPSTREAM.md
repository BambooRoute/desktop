# 上游来源与维护

## 来源

| 项目 | 记录 |
| --- | --- |
| 官方仓库 | https://github.com/deepseek-ai/deepseek-harness |
| 获取地址 | https://github.com/deepseek-ai/deepseek-harness.git |
| 默认分支 | `master`，仅作为发现更新的入口 |
| 桌面目录 | `apps/desktop` |
| 上游许可 | MIT，版权声明为 `Copyright (c) 2026 DeepSeek` |
| 本次核对日期 | 2026-11-10，Asia/Tokyo |

## 调研快照

本次通过 GitHub 核对到提交 `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`，提交时间为 `2026-11-04T08:40:00Z`，该提交中的桌面包版本为 `0.2.2-rc.1`。

- [提交记录](https://github.com/deepseek-ai/deepseek-harness/commit/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159)
- [桌面包定义](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/apps/desktop/package.json)
- [桌面说明](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/apps/desktop/README.md)
- [多模型网关适配](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/llm/llm-pi-ai/README.md)
- [MIT 许可原文](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/LICENSE)

这是调研快照，尚未作为已验收的生产基线。当前没有拉取上游 Git 对象、导入源码、安装依赖或验证安装包，不把该记录当作运行时锁定文件。

## 接入方式

后续优先采用保留上游提交历史的定制分支，沿用上游工程结构和锁文件，避免只复制桌面目录而遗漏 workspace 依赖。

当前仓库是独立的文档初始化历史。接入上游时，应先保存当前提交，在隔离的分支或工作树中从选定上游提交建立集成历史，再迁入 Bamboo 文档与定制；对重名文件逐项合并。不要直接覆盖目录、重置现有工作区或对不同根历史执行未经检查的合并。

首次接入需要记录：选定提交、版本、依赖锁文件、许可证文件、构建命令、目标平台及最小启动结果。先验证上游原始桌面能够运行，再加入 Bamboo 改动。

## 定制原则

- 优先通过插件、配置、凭据接口和模型适配层实现 Bamboo 能力。
- 品牌、账户、网关接入、消费展示和发行配置分别组织，便于追踪。
- 确有必要修改上游核心时，记录文件、原因、行为差异和验证，不做无关架构重写。
- 注释整理遵守 AGENTS.md，保持独立补丁；版权和许可通知必须保留。
- 不重用官方生产账户、更新源、遥测收集地址、签名凭据或应用标识。

## 更新流程

1. 获取候选上游版本，阅读变更和迁移要求，明确目标提交。
2. 在独立集成分支上处理更新与 Bamboo 补丁，保持现有可用版本可回退。
3. 验证桌面启动、账户授权、模型工具调用、权限、取消和恢复。
4. 分别验证目标平台安装包、升级及数据兼容性。
5. 记录实际验收结果后更新发布基线；不让生产构建隐式跟随分支头或 `latest`。

上游处于快速迭代阶段；文档、接口和桌面行为需要按选定提交核对。版本号或上游测试通过不替代 Bamboo 的集成验收。

## 许可证与远端

当前仅引用项目文档，未分发上游源码或二进制。引入时应保留完整 MIT 许可、版权声明及适用的第三方通知，并核对随包分发依赖的许可要求。

Bamboo 自有代码的许可、仓库是否公开尚未决定。上游 MIT 许可不自动决定 Bamboo 自有部分的许可，也不代表可以使用上游商标作为 Bamboo 的官方身份。

本地 `upstream` 的推送地址设为 `DISABLED`，只保留获取官方代码的用途。Bamboo 自有 `origin` 等确认完整仓库地址后再设置。
