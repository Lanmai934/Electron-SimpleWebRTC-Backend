# Electron-SimpleWebRTC Backend

基于 Node.js + Express + Socket.IO 的视频通话后端服务

## 功能特性

- 🔐 用户认证系统（JWT）
- 🏠 房间管理
- 💬 实时通信（Socket.IO）
- 👥 在线用户管理
- 🛡️ 管理员功能

## 技术栈

- **Node.js** - 运行环境
- **Express** - Web 框架
- **Socket.IO** - 实时通信
- **jsonwebtoken** - JWT 认证
- **cors** - 跨域支持

## 快速开始

### 安装依赖

```bash
npm install
```

### 启动服务

```bash
npm start
```

服务器将运行在 `http://localhost:3001`

## API 接口

### 认证接口

#### POST /api/login
用户登录

**请求体：**
```json
{
  "username": "admin",
  "password": "admin123"
}
```

**响应：**
```json
{
  "token": "jwt_token",
  "user": {
    "username": "admin",
    "role": "admin"
  }
}
```

#### GET /api/user
获取当前用户信息（需要 Authorization header）

### 房间管理

#### GET /api/rooms
获取所有房间列表（管理员权限）

## Socket.IO 事件

### 客户端发送事件

- `join-room` - 加入房间
- `leave-room` - 离开房间
- `get-rooms` - 获取房间列表
- `close-room` - 关闭房间（管理员）

### 服务端发送事件

- `user-joined` - 用户加入房间
- `user-left` - 用户离开房间
- `online-users` - 在线用户列表更新
- `rooms-list` - 房间列表更新
- `room-closed` - 房间被关闭

## 默认账号

- **管理员**: admin / admin123
- **用户1**: user1 / user123
- **用户2**: user2 / user123

## 开发说明

### 项目结构

```
├── index.js          # 主入口文件
├── package.json      # 依赖配置
└── README.md         # 项目说明
```

### 环境变量

可以通过环境变量配置：

- `PORT` - 服务器端口（默认：3001）
- `JWT_SECRET` - JWT 密钥（默认：your-secret-key）

### CORS 配置

默认允许所有来源的跨域请求，生产环境建议配置具体的前端域名。

## 部署

### 生产环境

1. 设置环境变量
2. 安装依赖：`npm install --production`
3. 启动服务：`npm start`

### Docker 部署

```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3001
CMD ["npm", "start"]
```

## 许可证

MIT License
