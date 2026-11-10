# Bamboo Desktop

BambooRoute 的桌面客户端，基于官方 DeepSeek Harness 桌面端进行定制。目标是让用户安装应用、登录 Bamboo 账户后，通过统一账户使用模型与本地任务能力，无需手动配置 API Key 或接口地址。

## 当前状态

2026-11-10：仓库初始化阶段。当前只有项目文档、协作约束和 Git 配置，没有应用源码、上游源码、运行时依赖、安装包或可运行功能。

“登录后使用”是产品目标，尚未实现。首次调用仍需要明确账户开通、邮箱验证、可用额度和模型能力等后端条件。

## 已确定的方向

- 基础项目采用 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的官方桌面端。
- 沿用上游 Electron 桌面壳、本地 Host 和插件体系，优先复用已有能力。
- BambooRoute 后端继续负责账户、模型目录、网关路由、价格、钱包和结算。
- 桌面端负责交互、本地工作区、任务执行及设备凭据管理。
- Bamboo 定制优先放在插件、配置和独立模块中，控制对上游核心的修改范围。
- 本阶段不实现业务功能，不安装依赖，不调用收费模型，不发布应用。

## 文档导航

| 文档 | 用途 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | 所有代码代理与开发者需要遵守的项目约束 |
| [产品范围](docs/PRODUCT.md) | 用户流程、首版边界、产品文案及待定事项 |
| [架构边界](docs/ARCHITECTURE.md) | 桌面、本地运行时与云端后端的职责和接口边界 |
| [上游维护](docs/UPSTREAM.md) | 上游来源、调研版本、集成方式及许可证处理 |
| [实施路线](docs/ROADMAP.md) | 分阶段工作和验收条件 |
| [协作方式](CONTRIBUTING.md) | 分支、提交、验证与评审要求 |

## 仓库关系

本仓库只承载桌面端。现有后端为 [ly95/BambooRoute](https://github.com/ly95/BambooRoute)，不在本次初始化中复制或修改。

网站为 [bambooroute.com](https://bambooroute.com)，模型 API 基址为 `https://api.bambooroute.com/v1`。这些地址用于说明系统边界，不表示桌面端已完成连接或验收。

本地初始分支为 `codex/bootstrap`。`upstream` 指向官方 DeepSeek Harness，仅用于获取上游；推送地址设为 `DISABLED`。尚未配置 `origin`，也未创建或推送新的 GitHub 仓库。

## 开发与许可

当前没有安装、开发、构建或测试命令。应用源码接入后，再根据选定上游版本记录真实可运行的命令。

当前未导入第三方代码。上游采用 MIT 许可；引入源码时需要保留对应版权和许可文件。Bamboo 自有部分的发布许可与仓库可见性尚未确定，详见[上游维护](docs/UPSTREAM.md)。
