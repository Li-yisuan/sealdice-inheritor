# sealdice-inheritor

把海豹核心从旧接入换到 QQ 官方接入后，迁移旧 QQ 的角色卡、群内属性、玩家档案和跑团日志。

不修改海豹源码，直接读写它的数据库文件。

> **提示**
>
> 本项目由 Vibe Coding 方式生产，可能存在各种不稳定问题，甚至恶性 bug。
> 使用前请务必备份数据库；遇到异常欢迎提交 Issue 或 PR。

## 功能

- 角色卡：复制为新身份下的全局卡，命名 `原名-旧QQ`
- 群内属性：旧群内属性表转为全局卡，命名 `原名-群号`
- 群映射：补绑该群的卡、复制玩家档案、迁移日志
- 用户映射与群映射先后均可，后执行的一方自动补齐
- QQ 绑定需邮箱验证码；群映射需管理员
- 写库前自动备份 `data.db` 与 `data-logs.db`

## 环境要求

- Node.js 22.5 或更高版本

## 部署与启动

1. 下载项目：GitHub 页面 **Code → Download ZIP**，或 `git clone https://github.com/AcOH-Li/sealdice-inheritor.git`；
2. 解压到固定目录，例如 Windows `D:\sealdice-inheritor`、Linux `~/sealdice-inheritor`；
3. 备份 `data.db` 和 `data-logs.db`；
4. 在项目目录打开终端，执行：

Windows（PowerShell，路径含空格要加引号）：

```powershell
node src\cli.mjs serve --db "D:\你的海豹目录\data\default\data.db" --token 自己设一串字符
```

Linux / macOS：

```bash
node src/cli.mjs serve --db /opt/sealdice/data/default/data.db --token 自己设一串字符
```

5. 看到 `bridge 已启动：http://127.0.0.1:8787` 即成功。窗口不要关，`Ctrl + C` 停止。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `--db` | 是 | `data.db` 完整路径，含空格用引号包住 |
| `--token` | 建议 | 插件连接口令，插件里要填一致 |
| `--port` | 否 | 默认 `8787`，被占用时换一个 |
| `--logs-db` | 否 | 默认取 `data.db` 同目录的 `data-logs.db` |

启动失败常见原因：没装 Node.js、路径写错、端口被占用（加 `--port 8790`）、数据库被其他程序占用。
Linux/macOS 下如果报权限错误，用运行海豹的同一个用户执行。

**常驻运行**：需要后台常驻或开机自启，请自行搜索计划任务 / systemd / launchd 的教程。

## 安装插件

1. 海豹 WebUI → 扩展 → 上传 `plugin/sealdice-inheritor.js` → 启用「旧号桥接」；
2. 在扩展配置中填写：

| 配置项 | 填什么 |
| --- | --- |
| 后端地址 | `http://127.0.0.1:8787` |
| 后端Token | 启动时设置的 `--token` |
| 发件邮箱 | 你的 QQ 邮箱，如 `123456@qq.com` |
| SMTP授权码 | QQ 邮箱生成的授权码，不是登录密码 |
| SMTP服务器 | `smtp.qq.com` |
| SMTP端口 | `465` |
| SMTP加密 | 开启 |

授权码获取：QQ 邮箱网页版 → 设置 → 账户 → 开启 SMTP 服务 → 生成授权码。

## 使用

玩家（每人一次）：

```
.qqbind 旧QQ号
.qqverify 收到的验证码
```

管理员（每个群一次）：

```
.qqmap 旧群号
```

两条命令先后都行：先 `.qqmap` 后 `.qqbind` 会直接绑定；反过来群映射会回头补绑。

## 命令

| 命令 | 权限 | 说明 |
| --- | --- | --- |
| `.qqbind <旧QQ> [owner]` | 所有人 | 发送邮箱验证码 |
| `.qqverify <验证码>` | 所有人 | 校验并迁移 |
| `.qqmap <旧群号>` | 管理员 | 设置群映射，补绑卡并迁移日志 |
| `.qqmap` | 管理员 | 查看群映射与建议 |
| `.qqhealth` | 所有人 | 检查后端、日志库、SMTP |
| `.qqstatus` | 所有人 | 查看绑定、卡数、本群默认卡 |
| `.qqunbind` | 所有人 | 删除迁移生成的卡 |
| `.qqlog [run/all]` | 管理员 | 预览 / 补迁当前群 / 批量补迁日志 |

## 常见问题

| 现象 | 处理 |
| --- | --- |
| `.qqhealth` 失败 | 后端窗口是否开着、插件里的地址和 Token 是否一致 |
| 收不到验证码 | 检查授权码、端口 465、SMTP 加密是否开启 |
| `.ra` 读不到数据 | 当前群执行过 `.qqmap` 吗；`owner_id` 不是 openid 时用 `.qqbind 旧QQ owner值` |
| 日志迁移提示同名冲突 | 先处理同名日志；卡和档案已补绑，不影响使用 |
| 端口被占用 | 换 `--port`，插件后端地址同步改 |

## 迁移规则

1. `character` 角色卡 → 全局卡，命名 `原名-旧QQ`；
2. `group_user` 群内属性表 → 全局卡，命名 `原名-群号`；绑过卡用被绑卡的数据，空表跳过；
3. `user` 全局属性 → 复制；
4. 群映射时按「迁移标记 + 名称后缀」找回该群的卡，补绑到 `<新群>-<用户>`，并复制玩家档案、迁移日志。

重名卡自动加 `-2`、`-3`；已有绑定不覆盖。

## HTTP API

需要 `Authorization: Bearer <token>`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 运行状态、验证与 SMTP 状态 |
| GET | `/api/state` | 绑定表、卡分布、群映射 |
| GET | `/api/inspect` | 卡列表与本群默认卡 |
| POST | `/api/smtp` | 配置 SMTP |
| POST | `/api/bind/request` | 发送验证码 |
| POST | `/api/bind/verify` | 校验并迁移 |
| POST | `/api/bind` | 直接迁移，需 `admin: true` |
| POST | `/api/unbind` | 解绑并删除迁移卡 |
| POST | `/api/groups/map` | 群映射，需 `admin: true` |
| GET | `/api/groups` | 群列表与映射建议 |
| GET | `/api/logs` | 预览日志迁移 |
| POST | `/api/logs` | 迁移日志，`{all:true}` 批量 |

## 安全与备份

- 群映射：插件要求管理员权限，后端要求 `admin: true`；
- 邮箱验证码 5 分钟有效、最多错 5 次、60 秒内不可重发；
- 写操作前自动备份 `data.db` 与 `data-logs.db`；后端只监听 `127.0.0.1`。

## 许可

MIT
