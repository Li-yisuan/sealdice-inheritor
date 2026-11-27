# sealdice-inheritor

把 SealDice（海豹核心）旧接入（OneBot 等）的数据迁到 QQ 官方接入。

不修改海豹源码，直接读写 SQLite：角色卡、群内属性、玩家档案、跑团日志。

> **提示**
>
> 本项目由 Vibe Coding 方式生产，可能存在各种不稳定问题，甚至恶性 bug。
> 使用前请务必备份数据库；遇到异常欢迎提交 Issue 或 PR。

## 功能

- **角色卡**：旧角色的卡复制为新身份下的全局卡，命名 `原名-旧QQ`
- **群内属性**：旧群内属性表转为全局卡，命名 `原名-群号`
- **群映射**：记录旧群与新群的对应关系，补绑该群的卡、复制玩家档案、迁移日志
- **双向补位**：用户映射与群映射先后均可，后执行的一方会自动补齐
- **邮箱验证**：QQ 绑定需验证 `<旧QQ>@qq.com` 收到的验证码
- **权限控制**：群映射需管理员，直连接口需管理员标记
- **自动备份**：写库前分别备份 `data.db` 与 `data-logs.db`

## 环境要求

- Node.js ≥ 22.5
- 海豹使用 SQLite 部署（默认）

## 启动后端

```bash
cd sealdice-inheritor

# 建议先手工备份一次
cp /path/to/data.db /path/to/data.db.manual-bak

node src/cli.mjs serve --db /path/to/data.db --port 8787 --token <随机串>
```

- 日志库默认取 `data.db` 同目录的 `data-logs.db`，可用 `--logs-db` 指定；
- 服务默认只监听 `127.0.0.1`；

## 安装插件

把 `plugin/sealdice-inheritor.js` 放入海豹的 `scripts` 目录，重载后在扩展列表中启用。

插件配置：

| 配置项 | 说明 |
| --- | --- |
| 后端地址 | 默认 `http://127.0.0.1:8787` |
| 后端Token | 与启动参数 `--token` 一致 |
| 发件邮箱 | SMTP 发件地址，例如 `你的QQ@qq.com` |
| SMTP授权码 | 邮箱生成的授权码，不是登录密码 |
| SMTP服务器 | QQ 邮箱为 `smtp.qq.com` |
| SMTP端口 | 465（SSL）或 587（STARTTLS） |
| SMTP加密 | 465 开启，587 关闭 |

## 使用流程

```
玩家：    .qqbind <旧QQ号>      →  邮箱收到 6 位验证码
          .qqverify <验证码>    →  完成迁移

管理员：  .qqmap <旧群号>       →  补绑卡 + 复制档案 + 迁移日志
```

两条命令互不依赖：先做群映射，用户迁移时会直接绑定；先做用户迁移，群映射会回头补绑。

## 命令

| 命令 | 权限 | 说明 |
| --- | --- | --- |
| `.qqbind <旧QQ> [owner]` | 所有人 | 发送邮箱验证码 |
| `.qqverify <验证码>` | 所有人 | 校验并迁移 |
| `.qqmap <旧群号>` | 管理员 | 设置群映射并执行补绑与日志迁移 |
| `.qqmap` | 管理员 | 查看群映射与建议 |
| `.qqhealth` | 所有人 | 检查后端、日志库、SMTP 状态 |
| `.qqstatus` | 所有人 | 查看绑定、卡数、本群默认卡 |
| `.qqunbind` | 所有人 | 删除迁移生成的卡 |
| `.qqlog` / `.qqlog run` / `.qqlog all` | 管理员 | 预览 / 补迁当前群 / 批量补迁日志 |

## HTTP API

需要 `Authorization: Bearer <token>`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 运行状态、是否开启验证、SMTP 是否就绪 |
| GET | `/api/state` | 绑定表、卡分布、群映射状态 |
| GET | `/api/inspect?openid=&group=&owner=` | 卡列表与本群默认卡 |
| POST | `/api/smtp` | 配置 SMTP |
| POST | `/api/bind/request` | 发送验证码 |
| POST | `/api/bind/verify` | 校验验证码并迁移 |
| POST | `/api/bind` | 直接迁移，需 `admin: true` |
| POST | `/api/unbind` | 解绑并删除迁移卡 |
| POST | `/api/groups/map` | 群映射，需 `admin: true` |
| GET | `/api/groups` | 群列表与映射建议 |
| GET | `/api/logs?group=&oldGroup=` | 预览日志迁移 |
| POST | `/api/logs` | 迁移日志，`{all:true}` 为批量 |

## 迁移规则

1. `character` 角色卡 → 复制为新身份的全局卡，命名 `原名-旧QQ`；
2. `group_user` 群内属性表 → 转为全局卡，命名 `原名-群号`；
   若该表绑过角色卡，使用被绑卡的数据；空表跳过；
3. `user` 全局属性 → 复制；
4. 群映射时，按「迁移标记 + 名称后缀」找回该群的卡，补绑到 `<新群>-<用户>`；
   同时复制玩家档案（昵称、名片模板、面数）并迁移该群日志。

重名卡自动追加 `-2`、`-3`。已有绑定不会被覆盖。

## 安全与备份

- 群映射：插件侧要求 `privilegeLevel ≥ 50`，后端同时要求 `admin: true`；
- QQ 绑定：邮箱验证码 5 分钟有效、最多错 5 次、60 秒内不可重发、每小时最多 5 次；
- 验证码只存内存，进程重启即失效；
- 直连接口 `/api/bind` 需 `admin: true`，仅建议在受控环境使用；
- 所有写操作前自动备份 `data.db` 与 `data-logs.db`。

## 常见问题

**`.ra` 读不到数据？**
确认当前群已执行 `.qqmap <旧群号>`。若 `owner_id` 不是 openid（例如 UniformID），
在 `.qqbind` 时用第二个参数指定。

**日志迁移报同名冲突？**
`logs` 表在 `(group_id, name)` 上有唯一索引，先处理同名日志再执行迁移。
群映射本身仍然生效，卡与档案已补绑。

**收不到验证码？**
检查授权码、端口与加密开关；QQ 邮箱使用 `smtp.qq.com:465` 并开启加密。

## 目录结构

```
src/ids.mjs      ID 与命名约定
src/db.mjs       数据库连接与事务
src/backup.mjs   写库前备份
src/cards.mjs    角色卡与群内属性表处理
src/migrate.mjs  用户映射编排
src/logs.mjs     日志迁移
src/groups.mjs   群映射与建议
src/smtp.mjs     SMTP 客户端
src/verify.mjs   邮箱验证码
src/store.mjs    绑定与映射存储
src/service.mjs  业务入口
src/server.mjs   HTTP 服务
src/cli.mjs      命令行
plugin/          海豹插件
```

## 许可

MIT
