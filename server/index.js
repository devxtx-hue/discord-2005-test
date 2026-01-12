const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

// Создаём структуру
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  ['users', 'messages', 'friends', 'friend_requests', 'settings'].forEach(file => {
    fs.writeFileSync(path.join(DATA_DIR, `${file}.json`), '[]');
  });
}

// Функции для работы с данными
const readData = (file) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${file}.json`), 'utf8'));
const writeData = (file, data) => fs.writeFileSync(path.join(DATA_DIR, `${file}.json`), JSON.stringify(data, null, 2));

// Хэширование пароля
const hashPassword = (pwd) => crypto.createHash('sha256').update(pwd).digest('hex');

// Генерация ID
const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2);

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../client')));

// Активные пользователи и звонки
const activeUsers = new Map(); // userId -> {socketId, userData}
const activeCalls = new Map(); // callId -> [userId1, userId2, ...]
const userCalls = new Map(); // userId -> callId

// ============ API ENDPOINTS ============

// Регистрация с проверкой уникальности
app.post('/api/register', (req, res) => {
  const { username, password, email } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Заполните имя и пароль' });
  }
  
  if (username.length < 3) {
    return res.status(400).json({ error: 'Имя должно быть от 3 символов' });
  }
  
  const users = readData('users');
  
  // Проверка на уникальность
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: 'Имя уже занято' });
  }
  
  if (email && users.find(u => u.email === email)) {
    return res.status(400).json({ error: 'Email уже используется' });
  }
  
  const newUser = {
    id: generateId(),
    username,
    password: hashPassword(password),
    email: email || '',
    avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random&color=fff&size=128`,
    status: 'Онлайн',
    statusMessage: 'Привет! Я новый пользователь',
    customColor: '#0066cc',
    customBg: 'default',
    badges: ['newbie'],
    level: 1,
    xp: 0,
    registrationDate: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    isOnline: false
  };
  
  users.push(newUser);
  writeData('users', users);
  
  // Создаём настройки по умолчанию
  const settings = readData('settings');
  settings.push({
    userId: newUser.id,
    theme: 'light',
    notifications: true,
    sounds: true,
    showOnline: true,
    allowFriendRequests: true,
    language: 'ru'
  });
  writeData('settings', settings);
  
  res.json({ 
    success: true, 
    user: {
      id: newUser.id,
      username: newUser.username,
      avatar: newUser.avatar,
      status: newUser.status,
      level: newUser.level,
      customColor: newUser.customColor
    }
  });
});

// Вход
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  const users = readData('users');
  const user = users.find(u => u.username === username && u.password === hashPassword(password));
  
  if (!user) {
    return res.status(401).json({ error: 'Неверное имя или пароль' });
  }
  
  // Обновляем lastSeen
  user.lastSeen = new Date().toISOString();
  writeData('users', users);
  
  res.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      avatar: user.avatar,
      status: user.status,
      statusMessage: user.statusMessage,
      customColor: user.customColor,
      customBg: user.customBg,
      badges: user.badges,
      level: user.level,
      xp: user.xp
    }
  });
});

// Поиск пользователей
app.get('/api/users/search', (req, res) => {
  const { query } = req.query;
  
  if (!query || query.length < 2) {
    return res.json([]);
  }
  
  const users = readData('users');
  const searchTerm = query.toLowerCase();
  
  const results = users
    .filter(u => 
      u.username.toLowerCase().includes(searchTerm) ||
      u.statusMessage?.toLowerCase().includes(searchTerm)
    )
    .map(u => ({
      id: u.id,
      username: u.username,
      avatar: u.avatar,
      status: u.status,
      level: u.level,
      isOnline: activeUsers.has(u.id)
    }))
    .slice(0, 20); // Ограничиваем результаты
    
  res.json(results);
});

// Отправка запроса в друзья
app.post('/api/friends/request', (req, res) => {
  const { fromUserId, toUserId } = req.body;
  
  if (fromUserId === toUserId) {
    return res.status(400).json({ error: 'Нельзя добавить себя в друзья' });
  }
  
  const users = readData('users');
  const fromUser = users.find(u => u.id === fromUserId);
  const toUser = users.find(u => u.id === toUserId);
  
  if (!fromUser || !toUser) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }
  
  // Проверяем, уже ли друзья
  const friends = readData('friends');
  const alreadyFriends = friends.find(f => 
    (f.userId1 === fromUserId && f.userId2 === toUserId) ||
    (f.userId1 === toUserId && f.userId2 === fromUserId)
  );
  
  if (alreadyFriends) {
    return res.status(400).json({ error: 'Уже друзья' });
  }
  
  // Проверяем, есть ли уже запрос
  const friendRequests = readData('friend_requests');
  const existingRequest = friendRequests.find(r => 
    r.fromUserId === fromUserId && r.toUserId === toUserId && r.status === 'pending'
  );
  
  if (existingRequest) {
    return res.status(400).json({ error: 'Запрос уже отправлен' });
  }
  
  const newRequest = {
    id: generateId(),
    fromUserId,
    toUserId,
    fromUsername: fromUser.username,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  
  friendRequests.push(newRequest);
  writeData('friend_requests', friendRequests);
  
  // Уведомляем получателя если онлайн
  const toUserSocket = activeUsers.get(toUserId);
  if (toUserSocket) {
    io.to(toUserSocket.socketId).emit('friend_request', {
      id: newRequest.id,
      fromUserId,
      fromUsername: fromUser.username,
      fromAvatar: fromUser.avatar
    });
  }
  
  res.json({ success: true });
});

// Получение входящих запросов
app.get('/api/friends/requests/:userId', (req, res) => {
  const friendRequests = readData('friend_requests');
  const users = readData('users');
  
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

// Принятие/отклонение запроса
app.post('/api/friends/respond', (req, res) => {
  const { requestId, action } = req.body; // accept или reject
  
  const friendRequests = readData('friend_requests');
  const requestIndex = friendRequests.findIndex(r => r.id === requestId);
  
  if (requestIndex === -1) {
    return res.status(404).json({ error: 'Запрос не найден' });
  }
  
  const request = friendRequests[requestIndex];
  
  if (action === 'accept') {
    // Добавляем в друзья
    const friends = readData('friends');
    friends.push({
      id: generateId(),
      userId1: request.fromUserId,
      userId2: request.toUserId,
      createdAt: new Date().toISOString()
    });
    writeData('friends', friends);
    
    // Уведомляем отправителя
    const fromUserSocket = activeUsers.get(request.fromUserId);
    if (fromUserSocket) {
      io.to(fromUserSocket.socketId).emit('friend_accepted', {
        userId: request.toUserId,
        username: request.fromUsername
      });
    }
  }
  
  // Удаляем запрос
  friendRequests.splice(requestIndex, 1);
  writeData('friend_requests', friendRequests);
  
  res.json({ success: true });
});

// Получение списка друзей
app.get('/api/friends/:userId', (req, res) => {
  const friends = readData('friends');
  const users = readData('users');
  
  const userFriends = friends
    .filter(f => f.userId1 === req.params.userId || f.userId2 === req.params.userId)
    .map(f => {
      const friendId = f.userId1 === req.params.userId ? f.userId2 : f.userId1;
      const friend = users.find(u => u.id === friendId);
      return {
        id: friend.id,
        username: friend.username,
        avatar: friend.avatar,
        status: friend.status,
        statusMessage: friend.statusMessage,
        level: friend.level,
        isOnline: activeUsers.has(friend.id),
        customColor: friend.customColor
      };
    });
    
  res.json(userFriends);
});

// Сообщения
app.get('/api/messages/:userId/:friendId', (req, res) => {
  const messages = readData('messages');
  
  const chatMessages = messages.filter(m => 
    (m.senderId === req.params.userId && m.receiverId === req.params.friendId) ||
    (m.senderId === req.params.friendId && m.receiverId === req.params.userId)
  ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  
  res.json(chatMessages);
});

// Обновление профиля
app.post('/api/profile/update', (req, res) => {
  const { userId, updates } = req.body;
  
  const users = readData('users');
  const userIndex = users.findIndex(u => u.id === userId);
  
  if (userIndex === -1) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }
  
  // Обновляем только разрешённые поля
  const allowedUpdates = ['status', 'statusMessage', 'avatar', 'customColor', 'customBg'];
  allowedUpdates.forEach(key => {
    if (updates[key] !== undefined) {
      users[userIndex][key] = updates[key];
    }
  });
  
  writeData('users', users);
  
  // Уведомляем всех об изменении профиля
  io.emit('profile_updated', {
    userId,
    updates: Object.keys(updates).filter(k => allowedUpdates.includes(k))
      .reduce((obj, key) => ({ ...obj, [key]: updates[key] }), {})
  });
  
  res.json({ success: true, user: users[userIndex] });
});

// Настройки
app.get('/api/settings/:userId', (req, res) => {
  const settings = readData('settings');
  const userSettings = settings.find(s => s.userId === req.params.userId) || {
    theme: 'light',
    notifications: true,
    sounds: true,
    showOnline: true,
    allowFriendRequests: true,
    language: 'ru'
  };
  
  res.json(userSettings);
});

app.post('/api/settings/update', (req, res) => {
  const { userId, settings } = req.body;
  
  const allSettings = readData('settings');
  const settingsIndex = allSettings.findIndex(s => s.userId === userId);
  
  if (settingsIndex === -1) {
    allSettings.push({ userId, ...settings });
  } else {
    allSettings[settingsIndex] = { ...allSettings[settingsIndex], ...settings };
  }
  
  writeData('settings', allSettings);
  res.json({ success: true });
});

// Получение пользователя по ID
app.get('/api/user/:userId', (req, res) => {
  const users = readData('users');
  const user = users.find(u => u.id === req.params.userId);
  
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }
  
  // Не отправляем пароль
  const { password, ...safeUser } = user;
  safeUser.isOnline = activeUsers.has(user.id);
  
  res.json(safeUser);
});

// ============ WEBSOCKET EVENTS ============

io.on('connection', (socket) => {
  console.log('Новое подключение:', socket.id);
  
  // Вход пользователя
  socket.on('user_online', (userData) => {
    activeUsers.set(userData.id, {
      socketId: socket.id,
      ...userData
    });
    
    // Обновляем статус в базе
    const users = readData('users');
    const userIndex = users.findIndex(u => u.id === userData.id);
    if (userIndex !== -1) {
      users[userIndex].isOnline = true;
      users[userIndex].lastSeen = new Date().toISOString();
      writeData('users', users);
    }
    
    io.emit('user_status', {
      userId: userData.id,
      isOnline: true,
      status: userData.status || 'Онлайн'
    });
    
    console.log(`👤 ${userData.username} онлайн`);
  });
  
  // Отправка сообщения
  socket.on('send_message', (data) => {
    const message = {
      id: generateId(),
      senderId: data.senderId,
      receiverId: data.receiverId,
      senderName: data.senderName,
      senderAvatar: data.senderAvatar,
      text: data.text,
      timestamp: new Date().toISOString(),
      read: false
    };
    
    // Сохраняем сообщение
    const messages = readData('messages');
    messages.push(message);
    writeData('messages', messages);
    
    // Отправляем получателю если онлайн
    const receiver = activeUsers.get(data.receiverId);
    if (receiver) {
      io.to(receiver.socketId).emit('new_message', message);
    }
    
    // Отправляем отправителю для подтверждения
    socket.emit('message_sent', message);
    
    // Добавляем XP за сообщение
    addXP(data.senderId, 5);
  });
  
  // Звонки
  socket.on('start_call', ({ callerId, receiverId }) => {
    const callId = generateId();
    activeCalls.set(callId, [callerId]);
    userCalls.set(callerId, callId);
    
    // Уведомляем получателя
    const receiver = activeUsers.get(receiverId);
    if (receiver) {
      io.to(receiver.socketId).emit('incoming_call', {
        callId,
        callerId,
        callerName: activeUsers.get(callerId)?.username || 'Неизвестный'
      });
    }
    
    socket.emit('call_started', { callId });
  });
  
  socket.on('join_call', ({ callId, userId }) => {
    if (!activeCalls.has(callId)) {
      activeCalls.set(callId, []);
    }
    
    const callUsers = activeCalls.get(callId);
    if (!callUsers.includes(userId)) {
      callUsers.push(userId);
    }
    
    userCalls.set(userId, callId);
    
    // Уведомляем всех в звонке о новом участнике
    callUsers.forEach(uId => {
      const user = activeUsers.get(uId);
      if (user && uId !== userId) {
        io.to(user.socketId).emit('user_joined_call', { userId });
      }
    });
    
    socket.emit('call_joined', { callId, users: callUsers });
  });
  
  socket.on('leave_call', ({ userId }) => {
    const callId = userCalls.get(userId);
    if (callId && activeCalls.has(callId)) {
      const callUsers = activeCalls.get(callId);
      const index = callUsers.indexOf(userId);
      if (index > -1) callUsers.splice(index, 1);
      
      if (callUsers.length === 0) {
        activeCalls.delete(callId);
      } else {
        // Уведомляем остальных о выходе
        callUsers.forEach(uId => {
          const user = activeUsers.get(uId);
          if (user) {
            io.to(user.socketId).emit('user_left_call', { userId });
          }
        });
      }
      
      userCalls.delete(userId);
    }
  });
  
  // WebRTC сигналы
  socket.on('webrtc_offer', ({ to, offer }) => {
    const toUser = activeUsers.get(to);
    if (toUser) {
      io.to(toUser.socketId).emit('webrtc_offer', {
        from: socket.userId,
        offer
      });
    }
  });
  
  socket.on('webrtc_answer', ({ to, answer }) => {
    const toUser = activeUsers.get(to);
    if (toUser) {
      io.to(toUser.socketId).emit('webrtc_answer', {
        from: socket.userId,
        answer
      });
    }
  });
  
  socket.on('webrtc_ice_candidate', ({ to, candidate }) => {
    const toUser = activeUsers.get(to);
    if (toUser) {
      io.to(toUser.socketId).emit('webrtc_ice_candidate', {
        from: socket.userId,
        candidate
      });
    }
  });
  
  // Изменение статуса
  socket.on('update_status', ({ userId, status }) => {
    const users = readData('users');
    const userIndex = users.findIndex(u => u.id === userId);
    if (userIndex !== -1) {
      users[userIndex].status = status;
      writeData('users', users);
      
      io.emit('user_status_updated', { userId, status });
    }
  });
  
  // Отключение
  socket.on('disconnect', () => {
    let disconnectedUser = null;
    
    // Находим пользователя по socket.id
    for (let [userId, userData] of activeUsers) {
      if (userData.socketId === socket.id) {
        disconnectedUser = { userId, ...userData };
        activeUsers.delete(userId);
        
        // Обновляем статус в базе
        const users = readData('users');
        const userIndex = users.findIndex(u => u.id === userId);
        if (userIndex !== -1) {
          users[userIndex].isOnline = false;
          users[userIndex].lastSeen = new Date().toISOString();
          writeData('users', users);
        }
        
        // Выходим из звонков
        const callId = userCalls.get(userId);
        if (callId) {
          const callUsers = activeCalls.get(callId);
          if (callUsers) {
            const index = callUsers.indexOf(userId);
            if (index > -1) callUsers.splice(index, 1);
            
            if (callUsers.length === 0) {
              activeCalls.delete(callId);
            } else {
              // Уведомляем остальных
              callUsers.forEach(uId => {
                const user = activeUsers.get(uId);
                if (user) {
                  io.to(user.socketId).emit('user_left_call', { userId });
                }
              });
            }
          }
          userCalls.delete(userId);
        }
        
        break;
      }
    }
    
    if (disconnectedUser) {
      io.emit('user_status', {
        userId: disconnectedUser.userId,
        isOnline: false,
        status: 'Офлайн'
      });
      
      console.log(`👋 ${disconnectedUser.username} отключился`);
    }
  });
});

// ============ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ============

function addXP(userId, xpAmount) {
  const users = readData('users');
  const userIndex = users.findIndex(u => u.id === userId);
  
  if (userIndex !== -1) {
    users[userIndex].xp += xpAmount;
    
    // Проверяем уровень (каждые 100 XP = новый уровень)
    const newLevel = Math.floor(users[userIndex].xp / 100) + 1;
    if (newLevel > users[userIndex].level) {
      users[userIndex].level = newLevel;
      
      // Награждаем бейджами
      if (newLevel >= 5 && !users[userIndex].badges.includes('veteran')) {
        users[userIndex].badges.push('veteran');
      }
      if (newLevel >= 10 && !users[userIndex].badges.includes('expert')) {
        users[userIndex].badges.push('expert');
      }
      
      // Уведомляем пользователя
      const userSocket = activeUsers.get(userId);
      if (userSocket) {
        io.to(userSocket.socketId).emit('level_up', {
          level: newLevel,
          badges: users[userIndex].badges
        });
      }
    }
    
    writeData('users', users);
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
});
