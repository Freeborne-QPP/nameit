# 麦版正赛阵容取名册 —— 运行与部署说明

一个给《植物大战僵尸》改版「麦版」正赛阵容取名字、点赞的网站。

## 功能

- 全部阵容按期数排开，一行 5 支，支持：
  - 赛季筛选（S1–S7，可多选，默认 S4–S7）
  - 「仅显示冠军」筛选
  - 编号搜索（如输入 `12` 显示第 12、112、121、122 期）
  - 关键字搜索（无视标点；缠/水/草、金/盏/花、坚/胖、若/晶/钻、奶/竹、豌/狙 视为同字）
- 点击任意阵容：查看已有名字与「由来」（默认两行折叠可展开）、贡献名字（可不填由来）、点赞
- 「名字榜」页面：查看所有已取名的阵容，支持同样筛选，可按点赞数排序
- 昵称 + 密码注册登录后才能取名和点赞；可编辑/删除自己贡献的名字
- 管理员密码可编辑/删除任意名字、修改管理员密码

## 本地运行

需要 Node.js 24 以上（使用了内置 SQLite 模块）。

```bash
npm install
npm run build:lineups   # 首次需要，从 Excel 生成阵容数据（数据文件已内置，可不重复执行）
npm start               # 启动后访问 http://localhost:3000
```

默认管理员密码：`admin123456`（登录后可在「管理」里修改）。
所有数据保存在 `data/` 目录（`app.db` 与 `config.json`），想重置就删除这两个文件后重启。

## 云端部署（无需自己电脑常开）

> 所有名字、点赞、账号都保存在服务器上，你的电脑不用开着。

### 方案 A：云服务器 + Docker（推荐，国内访问快）

1. 在腾讯云/阿里云购买一台「轻量应用服务器」（选系统镜像 Ubuntu / Debian，1核1G 即可，约几十元/月）。
2. SSH 登录服务器，安装 Docker（一行命令）：

   ```bash
   curl -fsSL https://get.docker.com | sh
   ```

3. 在服务器上克隆代码：

   ```bash
   git clone https://github.com/Freeborne-QPP/nameit.git
   cd nameit
   ```

4. 配置端口和管理员密码并启动（`.env` 不会被提交，改它不会和后续 `git pull` 冲突）：

   ```bash
   cp .env.example .env
   nano .env                     # 改掉 ADMIN_PASSWORD；端口冲突就改 PORT
   docker compose up -d --build
   ```

5. 在云服务器控制台「防火墙 / 安全组」放行 `.env` 里 `PORT` 对应的端口，然后访问 `http://服务器IP:端口`。
6. 以后更新代码：`git pull` 然后 `docker compose up -d --build`。
7. 建议：绑定域名并用 Nginx 反代 + HTTPS，体验更好。

> 数据保存在服务器上的 `data` 目录（`app.db` 与 `config.json`），容器重建或更新都不会丢。想重置就删掉这两个文件后重启。

### 方案 B：Railway / Render（免费额度，国外节点，国内访问可能较慢）

- 把本项目上传到 GitHub 仓库，然后在 Railway（railway.app）或 Render（render.com）新建项目，选择本仓库，平台会自动识别 Dockerfile 部署。
- 需要把 `data` 目录挂载到持久磁盘（Railway 的 Volume / Render 的 Disk），否则重启会丢数据。

## 常用命令

```bash
npm run build:lineups   # 重新从 Excel 生成阵容数据
npm start               # 启动服务
```

## 数据文件

| 文件 | 说明 |
| --- | --- |
| `data/lineups.json` | 从 Excel 清洗生成的 1600 个阵容（缠→草、盏/花→金、晶/钻→若、胖→坚、竹→奶） |
| `data/app.db` | 名字、点赞、账号数据库 |
| `data/config.json` | 会话密钥与管理员密码（哈希） |
