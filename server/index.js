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

const PORT = 8080;
const HOST = '0.0.0.0';
const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const FRIENDS_FILE = path.join(DATA_DIR, 'friends.json');

const initFiles = () => {
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify([]));
  if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, JSON.stringify([]));
  if (!fs.existsSync(FRIENDS_FILE)) fs.writeFileSync(FRIENDS_FILE, JSON.stringify([]));
};

initFiles();

const hashPassword = (password) => {
  return crypto.createHash('sha256').update(password).digest('hex');
};

const generateId = () => Date.now().toString() + Math.random().toString(36).substr(2, 9);

const readData = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeData = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

// Хранение активных пользователей и звонков
const activeUsers = new Map();
const voiceRooms = new Map(); // {roomId: [socketId1, socketId2]}

// API endpoints

// Регистрация
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) return res.status(400).json({ error: 'Заполните все поля' });
  if (username.length < 3) return res.status(400).json({ error: 'Имя слишком короткое' });
  
  const users = readData(USERS_FILE);
  if (users.find(u => u.username === username)) {
    return res.status(400).json({ error: 'Пользователь уже существует' });
  }
  
  const newUser = {
    id: generateId(),
    username,
    password: hashPassword(password),
    avatar: `https://ui-avatars.com/api/?name=${username}&background=666&color=fff&size=150`,
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
  
  if (!user) return res.status(401).json({ error: 'Неверный логин или пароль' });
  
  res.json({ 
    success: true, 
    user: { 
      id: user.id, 
      username: user.username,
      avatar: user.avatar
    } 
  });
});

// Обновление аватара
app.post('/api/user/update', (req, res) => {
  const { userId, avatar } = req.body;
  
  if (!userId || !avatar) return res.status(400).json({ error: 'Недостаточно данных' });
  
  const users = readData(USERS_FILE);
  const userIndex = users.findIndex(u => u.id === userId);
  
  if (userIndex === -1) return res.status(404).json({ error: 'Пользователь не найден' });
  
  users[userIndex].avatar = avatar;
  writeData(USERS_FILE, users);
  
  res.json({ success: true, avatar });
});

// Поиск пользователя
app.post('/api/user/find', (req, res) => {
  const { username, currentUserId } = req.body;
  
  const users = readData(USERS_FILE);
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.id === currentUserId) return res.status(400).json({ error: 'Это вы' });
  
  // Проверяем друзья ли уже
  const friends = readData(FRIENDS_FILE);
  const alreadyFriends = friends.find(f => 
    (f.userId1 === currentUserId && f.userId2 === user.id) ||
    (f.userId1 === user.id && f.userId2 === currentUserId)
  );
  
  if (alreadyFriends) return res.status(400).json({ error: 'Уже друзья' });
  
  res.json({
    id: user.id,
    username: user.username,
    avatar: user.avatar
  });
});

// Добавить в друзья
app.post('/api/friends/add', (req, res) => {
  const { userId1, userId2 } = req.body;
  
  const friends = readData(FRIENDS_FILE);
  
  // Проверяем, не друзья ли уже
  const existing = friends.find(f => 
    (f.userId1 === userId1 && f.userId2 === userId2) ||
    (f.userId1 === userId2 && f.userId2 === userId1)
  );
  
  if (existing) return res.status(400).json({ error: 'Уже друзья' });
  
  friends.push({
    id: generateId(),
    userId1,
    userId2,
    createdAt: new Date().toISOString()
  });
  
  writeData(FRIENDS_FILE, friends);
  res.json({ success: true });
});

// Получить друзей
app.get('/api/friends/:userId', (req, res) => {
  const friends = readData(FRIENDS_FILE);
  const users = readData(USERS_FILE);
  
  const userFriends = friends
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

// Сообщения
app.get('/api/messages/:userId/:friendId', (req, res) => {
  const messages = readData(MESSAGES_FILE);
  
  const chatMessages = messages.filter(m => 
    (m.fromId === req.params.userId && m.toId === req.params.friendId) ||
    (m.fromId === req.params.friendId && m.toId === req.params.userId)
  ).sort((a, b) => new Date(a.time) - new Date(b.time));
  
  res.json(chatMessages);
});

// WebSocket
io.on('connection', (socket) => {
  console.log('Подключение:', socket.id);
  
  // Присоединение пользователя
  socket.on('user_join', (userData) => {
    activeUsers.set(socket.id, {
      id: userData.id,
      username: userData.username,
      avatar: userData.avatar,
      socketId: socket.id
    });
    
    // Уведомляем всех об изменении статуса
    io.emit('user_online', { userId: userData.id, online: true });
  });
  
  // Сообщения
  socket.on('send_message', (data) => {
    const user = activeUsers.get(socket.id);
    if (!user) return;
    
    const message = {
      id: generateId(),
      fromId: user.id,
      fromName: user.username,
      toId: data.toId,
      text: data.text,
      time: new Date().toISOString()
    };
    
    // Сохраняем
    const messages = readData(MESSAGES_FILE);
    messages.push(message);
    writeData(MESSAGES_FILE, messages);
    
    // Отправляем получателю если онлайн
    const receiver = Array.from(activeUsers.values()).find(u => u.id === data.toId);
    if (receiver) {
      io.to(receiver.socketId).emit('new_message', message);
    }
    
    // Отправляем отправителю
    socket.emit('message_sent', message);
  });
  
  // Войс чат
  socket.on('join_voice', (data) => {
    const { roomId, userId } = data;
    if (!roomId) return;
    
    // Входим в комнату
    socket.join(roomId);
    
    // Сохраняем информацию о комнате
    if (!voiceRooms.has(roomId)) {
      voiceRooms.set(roomId, []);
    }
    
    const roomUsers = voiceRooms.get(roomId);
    if (!roomUsers.includes(socket.id)) {
      roomUsers.push(socket.id);
    }
    
    // Уведомляем других в комнате
    socket.to(roomId).emit('user_joined_voice', {
      userId,
      roomId
    });
    
    console.log(`Пользователь ${userId} вошел в войс комнату ${roomId}`);
  });
  
  // Покидание войс чата
  socket.on('leave_voice', (data) => {
    const { roomId, userId } = data;
    
    socket.leave(roomId);
    
    if (voiceRooms.has(roomId)) {
      const roomUsers = voiceRooms.get(roomId);
      const index = roomUsers.indexOf(socket.id);
      if (index > -1) roomUsers.splice(index, 1);
      
      if (roomUsers.length === 0) {
        voiceRooms.delete(roomId);
      }
    }
    
    // Уведомляем остальных
    socket.to(roomId).emit('user_left_voice', { userId });
  });
  
  // Передача аудио
  socket.on('voice_data', (data) => {
    const { roomId, audioData } = data;
    socket.to(roomId).emit('voice_stream', {
      socketId: socket.id,
      audioData: audioData
    });
  });
  
  // Отключение
  socket.on('disconnect', () => {
    const user = activeUsers.get(socket.id);
    if (user) {
      activeUsers.delete(socket.id);
      io.emit('user_online', { userId: user.id, online: false });
      
      // Выходим из всех войс комнат
      voiceRooms.forEach((users, roomId) => {
        const index = users.indexOf(socket.id);
        if (index > -1) {
          users.splice(index, 1);
          if (users.length === 0) {
            voiceRooms.delete(roomId);
          }
        }
      });
    }
    console.log('Отключение:', socket.id);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Сервер запущен: http://localhost:${PORT}`);
});
