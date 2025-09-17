const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// 中间件
app.use(cors());
app.use(express.json());

// 内存存储（生产环境应使用数据库）
const users = new Map(); // 存储用户信息
const rooms = new Map(); // 存储房间信息
const onlineUsers = new Map(); // 存储在线用户

// 默认用户数据
const defaultUsers = [
  { id: '1', username: 'admin', password: bcrypt.hashSync('admin123', 10), isAdmin: true },
  { id: '2', username: 'user1', password: bcrypt.hashSync('user123', 10), isAdmin: false },
  { id: '3', username: 'user2', password: bcrypt.hashSync('user123', 10), isAdmin: false }
];

// 初始化默认用户
defaultUsers.forEach(user => {
  users.set(user.username, user);
});

// JWT验证中间件
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: '访问令牌缺失' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: '无效的访问令牌' });
    }
    req.user = user;
    next();
  });
};

// 登录接口
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password, isAdmin } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: '用户名和密码不能为空' });
    }

    const user = users.get(username);
    if (!user) {
      return res.status(401).json({ message: '用户名或密码错误' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ message: '用户名或密码错误' });
    }

    // 检查管理员权限
    if (isAdmin && !user.isAdmin) {
      return res.status(403).json({ message: '您没有管理员权限' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, isAdmin: user.isAdmin },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        isAdmin: user.isAdmin
      }
    });
  } catch (error) {
    console.error('登录错误:', error);
    res.status(500).json({ message: '服务器内部错误' });
  }
});

// 获取用户信息接口
app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// 获取房间列表接口（管理员）
app.get('/api/rooms', authenticateToken, (req, res) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ message: '需要管理员权限' });
  }

  const roomList = Array.from(rooms.values()).map(room => ({
    id: room.id,
    userCount: room.users.size,
    createdAt: room.createdAt,
    status: room.users.size > 0 ? 'active' : 'idle',
    users: Array.from(room.users.values())
  }));

  res.json(roomList);
});

// Socket.IO 连接处理
io.on('connection', (socket) => {
  console.log('用户连接:', socket.id);

  const { userId, username, isAdmin } = socket.handshake.auth;

  if (!userId || !username) {
    socket.disconnect();
    return;
  }

  // 添加到在线用户列表
  const userInfo = {
    id: userId,
    username,
    isAdmin: isAdmin || false,
    socketId: socket.id,
    roomId: null,
    joinedAt: new Date()
  };

  onlineUsers.set(socket.id, userInfo);

  // 广播在线用户更新
  io.emit('users-update', Array.from(onlineUsers.values()));

  // 加入房间
  socket.on('join-room', ({ roomId }) => {
    try {
      // 离开之前的房间
      if (userInfo.roomId) {
        socket.leave(userInfo.roomId);
        const oldRoom = rooms.get(userInfo.roomId);
        if (oldRoom) {
          oldRoom.users.delete(socket.id);
          if (oldRoom.users.size === 0) {
            rooms.delete(userInfo.roomId);
          }
        }
      }

      // 加入新房间
      socket.join(roomId);
      userInfo.roomId = roomId;
      onlineUsers.set(socket.id, userInfo);

      // 创建或更新房间信息
      if (!rooms.has(roomId)) {
        rooms.set(roomId, {
          id: roomId,
          users: new Map(),
          createdAt: new Date()
        });
      }

      const room = rooms.get(roomId);
      room.users.set(socket.id, userInfo);

      // 通知房间内其他用户
      socket.to(roomId).emit('user-joined', {
        user: userInfo,
        roomId
      });

      // 发送房间用户列表
      const roomUsers = Array.from(room.users.values());
      io.to(roomId).emit('room-users-update', roomUsers);

      // 广播在线用户和房间更新
      io.emit('users-update', Array.from(onlineUsers.values()));
      io.emit('rooms-update', Array.from(rooms.values()).map(r => ({
        id: r.id,
        userCount: r.users.size,
        createdAt: r.createdAt,
        status: r.users.size > 0 ? 'active' : 'idle'
      })));

      console.log(`用户 ${username} 加入房间 ${roomId}`);
    } catch (error) {
      console.error('加入房间错误:', error);
      socket.emit('error', { message: '加入房间失败' });
    }
  });

  // 离开房间
  socket.on('leave-room', ({ roomId }) => {
    try {
      socket.leave(roomId);
      
      const room = rooms.get(roomId);
      if (room) {
        room.users.delete(socket.id);
        
        // 通知房间内其他用户
        socket.to(roomId).emit('user-left', {
          user: userInfo,
          roomId
        });

        // 发送更新的房间用户列表
        const roomUsers = Array.from(room.users.values());
        io.to(roomId).emit('room-users-update', roomUsers);

        // 如果房间为空，删除房间
        if (room.users.size === 0) {
          rooms.delete(roomId);
        }
      }

      userInfo.roomId = null;
      onlineUsers.set(socket.id, userInfo);

      // 广播更新
      io.emit('users-update', Array.from(onlineUsers.values()));
      io.emit('rooms-update', Array.from(rooms.values()).map(r => ({
        id: r.id,
        userCount: r.users.size,
        createdAt: r.createdAt,
        status: r.users.size > 0 ? 'active' : 'idle'
      })));

      console.log(`用户 ${username} 离开房间 ${roomId}`);
    } catch (error) {
      console.error('离开房间错误:', error);
    }
  });

  // 获取房间列表（管理员）
  socket.on('get-rooms', () => {
    if (userInfo.isAdmin) {
      const roomList = Array.from(rooms.values()).map(room => ({
        id: room.id,
        userCount: room.users.size,
        createdAt: room.createdAt,
        status: room.users.size > 0 ? 'active' : 'idle',
        users: Array.from(room.users.values())
      }));
      socket.emit('rooms-update', roomList);
    }
  });

  // 强制关闭房间（管理员）
  socket.on('close-room', ({ roomId }) => {
    if (userInfo.isAdmin) {
      const room = rooms.get(roomId);
      if (room) {
        // 通知房间内所有用户
        io.to(roomId).emit('room-closed', {
          roomId,
          message: '房间已被管理员强制关闭'
        });

        // 让所有用户离开房间
        room.users.forEach((user, socketId) => {
          const userSocket = io.sockets.sockets.get(socketId);
          if (userSocket) {
            userSocket.leave(roomId);
            const onlineUser = onlineUsers.get(socketId);
            if (onlineUser) {
              onlineUser.roomId = null;
              onlineUsers.set(socketId, onlineUser);
            }
          }
        });

        // 删除房间
        rooms.delete(roomId);

        // 广播更新
        io.emit('users-update', Array.from(onlineUsers.values()));
        io.emit('rooms-update', Array.from(rooms.values()).map(r => ({
          id: r.id,
          userCount: r.users.size,
          createdAt: r.createdAt,
          status: r.users.size > 0 ? 'active' : 'idle'
        })));

        console.log(`管理员 ${username} 强制关闭房间 ${roomId}`);
      }
    }
  });

  // 发送消息
  socket.on('send-message', ({ roomId, message }) => {
    if (userInfo.roomId === roomId) {
      io.to(roomId).emit('new-message', {
        user: userInfo,
        message,
        timestamp: new Date()
      });
    }
  });

  // 断开连接
  socket.on('disconnect', () => {
    console.log('用户断开连接:', socket.id);

    // 从房间中移除用户
    if (userInfo.roomId) {
      const room = rooms.get(userInfo.roomId);
      if (room) {
        room.users.delete(socket.id);
        
        // 通知房间内其他用户
        socket.to(userInfo.roomId).emit('user-left', {
          user: userInfo,
          roomId: userInfo.roomId
        });

        // 发送更新的房间用户列表
        const roomUsers = Array.from(room.users.values());
        io.to(userInfo.roomId).emit('room-users-update', roomUsers);

        // 如果房间为空，删除房间
        if (room.users.size === 0) {
          rooms.delete(userInfo.roomId);
        }
      }
    }

    // 从在线用户列表中移除
    onlineUsers.delete(socket.id);

    // 广播更新
    io.emit('users-update', Array.from(onlineUsers.values()));
    io.emit('rooms-update', Array.from(rooms.values()).map(r => ({
      id: r.id,
      userCount: r.users.size,
      createdAt: r.createdAt,
      status: r.users.size > 0 ? 'active' : 'idle'
    })));
  });
});

// 启动服务器
server.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
  console.log(`WebSocket服务器已启动`);
  console.log('默认用户账号:');
  console.log('管理员: admin / admin123');
  console.log('用户1: user1 / user123');
  console.log('用户2: user2 / user123');
});