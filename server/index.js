const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

// Создаем папки для данных
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

// Файлы данных
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const FRIENDSHIPS_FILE = path.join(DATA_DIR, 'friendships.json');
const FRIEND_REQUESTS_FILE = path.join(DATA_DIR, 'friendRequests.json');

// Инициализация файлов
const initFiles = () => {
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify([]));
  if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, JSON.stringify([]));
  if (!fs.existsSync(FRIENDSHIPS_FILE)) fs.writeFileSync(FRIENDSHIPS_FILE, JSON.stringify([]));
  if (!fs.existsSync(FRIEND_REQUESTS_FILE)) fs.writeFileSync(FRIEND_REQUESTS_FILE, JSON.stringify([]));
};

initFiles();

// Хэширование пароля
const hashPassword = (password) => {
  return crypto.createHash('sha256').update(password).digest('hex');
};

// Генерация ID
const generateId = () => Date.now().toString() + Math.random().toString(36).substr(2, 9);

// Чтение/запись данных
const readData = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeData = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

// Хранение активных пользователей
const activeUsers = new Map();

// API endpoints

// Регистрация
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Заполните все поля' });
  }
  
  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ error: 'Имя пользователя должно быть от 3 до 20 символов' });
  }
  
  const users = readData(USERS_FILE);
  
  if (users.find(u => u.username === username)) {
    return res.status(400).json({ error: 'Пользователь уже существует' });
  }
  
  const newUser = {
    id: generateId(),
    username,
    password: hashPassword(password),
    avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random&color=fff&size=128`,
    createdAt: new Date().toISOString()
  };
  
  users.push(newUser);
  writeData(USERS_FILE, users);
  
  res.json({ 
    success: true, 
    user: { 
      id: newUser.id, 
      username: newUser.username,
      avatar: newUser.avatar
    } 
  });
});

// Вход
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  const users = readData(USERS_FILE);
  const user = users.find(u => u.username === username && u.password === hashPassword(password));
  
  if (!user) {
    return res.status(401).json({ error: 'Неверное имя пользователя или пароль' });
  }
  
  res.json({ 
    success: true, 
    user: { 
      id: user.id, 
      username: user.username,
      avatar: user.avatar
    } 
  });
});

// Получение информации о пользователе по ID
app.get('/api/user/:id', (req, res) => {
  const users = readData(USERS_FILE);
  const user = users.find(u => u.id === req.params.id);
  
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }
  
  res.json({
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    createdAt: user.createdAt
  });
});

// Поиск пользователя по юзернейму
app.post('/api/user/search', (req, res) => {
  const { username, currentUserId } = req.body;
  
  if (!username) {
    return res.status(400).json({ error: 'Введите имя пользователя' });
  }
  
  const users = readData(USERS_FILE);
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }
  
  if (user.id === currentUserId) {
    return res.status(400).json({ error: 'Нельзя добавить себя в друзья' });
  }
  
  // Проверяем, уже ли друзья
  const friendships = readData(FRIENDSHIPS_FILE);
  const alreadyFriends = friendships.find(f => 
    (f.userId1 === currentUserId && f.userId2 === user.id) ||
    (f.userId1 === user.id && f.userId2 === currentUserId)
  );
  
  if (alreadyFriends) {
    return res.status(400).json({ error: 'Пользователь уже в друзьях' });
  }
  
  // Проверяем, есть ли уже запрос
  const friendRequests = readData(FRIEND_REQUESTS_FILE);
  const existingRequest = friendRequests.find(r => 
    (r.fromUserId === currentUserId && r.toUserId === user.id) ||
    (r.fromUserId === user.id && r.toUserId === currentUserId)
  );
  
  if (existingRequest) {
    return res.status(400).json({ error: 'Запрос уже отправлен' });
  }
  
  res.json({
    id: user.id,
    username: user.username,
    avatar: user.avatar
  });
});

// Отправка запроса в друзья
app.post('/api/friend/request', (req, res) => {
  const { fromUserId, toUserId } = req.body;
  
  const friendRequests = readData(FRIEND_REQUESTS_FILE);
  
  // Проверяем, нет ли уже запроса
  const existingRequest = friendRequests.find(r => 
    r.fromUserId === fromUserId && r.toUserId === toUserId
  );
  
  if (existingRequest) {
    return res.status(400).json({ error: 'Запрос уже отправлен' });
  }
  
  const newRequest = {
    id: generateId(),
    fromUserId,
    toUserId,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  
  friendRequests.push(newRequest);
  writeData(FRIEND_REQUESTS_FILE, friendRequests);
  
  // Отправляем уведомление получателю, если он онлайн
  const toUserSocket = Array.from(activeUsers.values()).find(u => u.id === toUserId);
  if (toUserSocket) {
    io.to(toUserSocket.socketId).emit('friend_request', {
      fromUserId,
      fromUsername: activeUsers.get(Array.from(activeUsers.keys()).find(k => activeUsers.get(k).id === fromUserId))?.username
    });
  }
  
  res.json({ success: true });
});

// Получение списка запросов в друзья
app.get('/api/friend/requests/:userId', (req, res) => {
  const friendRequests = readData(FRIEND_REQUESTS_FILE);
  const users = readData(USERS_FILE);
  
  const requests = friendRequests
    .filter(r => r.toUserId === req.params.userId && r.status === 'pending')
    .map(r => {
      const fromUser = users.find(u => u.id === r.fromUserId);
      return {
        id: r.id,
        fromUserId: r.fromUserId,
        fromUsername: fromUser.username,
        fromAvatar: fromUser.avatar,
        createdAt: r.createdAt
      };
    });
  
  res.json(requests);
});

// Принятие/отклонение запроса в друзья
app.post('/api/friend/respond', (req, res) => {
  const { requestId, action } = req.body; // action: 'accept' или 'reject'
  
  const friendRequests = readData(FRIEND_REQUESTS_FILE);
  const request = friendRequests.find(r => r.id === requestId);
  
  if (!request) {
    return res.status(404).json({ error: 'Запрос не найден' });
  }
  
  if (action === 'accept') {
    // Добавляем в друзья
    const friendships = readData(FRIENDSHIPS_FILE);
    
    friendships.push({
      id: generateId(),
      userId1: request.fromUserId,
      userId2: request.toUserId,
      createdAt: new Date().toISOString()
    });
    
    writeData(FRIENDSHIPS_FILE, friendships);
    
    // Отправляем уведомление отправителю, если он онлайн
    const fromUserSocket = Array.from(activeUsers.values()).find(u => u.id === request.fromUserId);
    if (fromUserSocket) {
      const toUser = activeUsers.get(Array.from(activeUsers.keys()).find(k => activeUsers.get(k).id === request.toUserId));
      io.to(fromUserSocket.socketId).emit('friend_accepted', {
        userId: request.toUserId,
        username: toUser?.username
      });
    }
  }
  
  // Удаляем запрос
  const updatedRequests = friendRequests.filter(r => r.id !== requestId);
  writeData(FRIEND_REQUESTS_FILE, updatedRequests);
  
  res.json({ success: true });
});

// Получение списка друзей
app.get('/api/friends/:userId', (req, res) => {
  const friendships = readData(FRIENDSHIPS_FILE);
  const users = readData(USERS_FILE);
  
  const userFriends = friendships
    .filter(f => f.userId1 === req.params.userId || f.userId2 === req.params.userId)
    .map(f => {
      const friendId = f.userId1 === req.params.userId ? f.userId2 : f.userId1;
      const friend = users.find(u => u.id === friendId);
      return {
        id: friend.id,
        username: friend.username,
        avatar: friend.avatar,
        isOnline: Array.from(activeUsers.values()).some(u => u.id === friend.id)
      };
    });
  
  res.json(userFriends);
});

// Получение истории сообщений
app.get('/api/messages/:userId/:friendId', (req, res) => {
  const messages = readData(MESSAGES_FILE);
  
  const chatMessages = messages.filter(m => 
    (m.senderId === req.params.userId && m.receiverId === req.params.friendId) ||
    (m.senderId === req.params.friendId && m.receiverId === req.params.userId)
  ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  
  res.json(chatMessages);
});

// Обновление аватара
app.post('/api/user/avatar', (req, res) => {
  const { userId, avatarUrl } = req.body;
  
  if (!avatarUrl) {
    return res.status(400).json({ error: 'Укажите URL аватара' });
  }
  
  const users = readData(USERS_FILE);
  const userIndex = users.findIndex(u => u.id === userId);
  
  if (userIndex === -1) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }
  
  users[userIndex].avatar = avatarUrl;
  writeData(USERS_FILE, users);
  
  res.json({ success: true, avatar: avatarUrl });
});

// WebSocket соединения
io.on('connection', (socket) => {
  console.log('Новое соединение:', socket.id);
  
  socket.on('user_join', (userData) => {
    activeUsers.set(socket.id, {
      id: userData.id,
      username: userData.username,
      avatar: userData.avatar,
      socketId: socket.id
    });
    
    // Отправляем список друзей с обновленным статусом онлайн
    io.emit('user_status_change', { userId: userData.id, isOnline: true });
  });
  
  socket.on('send_message', (data) => {
    const user = activeUsers.get(socket.id);
    if (!user) return;
    
    const message = {
      id: generateId(),
      senderId: user.id,
      receiverId: data.receiverId,
      senderUsername: user.username,
      message: data.message,
      timestamp: new Date().toISOString(),
      isRead: false
    };
    
    // Сохраняем сообщение
    const messages = readData(MESSAGES_FILE);
    messages.push(message);
    writeData(MESSAGES_FILE, messages);
    
    // Отправляем получателю, если он онлайн
    const receiverSocket = Array.from(activeUsers.values()).find(u => u.id === data.receiverId);
    if (receiverSocket) {
      io.to(receiverSocket.socketId).emit('new_message', message);
    }
    
    // Отправляем отправителю (для подтверждения)
    socket.emit('message_sent', message);
  });
  
  socket.on('mark_as_read', (data) => {
    const messages = readData(MESSAGES_FILE);
    const updatedMessages = messages.map(m => {
      if (m.senderId === data.senderId && m.receiverId === data.receiverId && !m.isRead) {
        return { ...m, isRead: true };
      }
      return m;
    });
    writeData(MESSAGES_FILE, updatedMessages);
  });
  
  socket.on('disconnect', () => {
    const user = activeUsers.get(socket.id);
    if (user) {
      activeUsers.delete(socket.id);
      io.emit('user_status_change', { userId: user.id, isOnline: false });
    }
    console.log('Пользователь отключен:', socket.id);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
});
