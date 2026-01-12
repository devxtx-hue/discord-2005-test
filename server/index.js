const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'data');

// Создаем папки
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');

// Инициализация
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, '[]');

const readData = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeData = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

// Хранение активных пользователей
const activeUsers = new Map();

// API
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    
    const users = readData(USERS_FILE);
    
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'Имя занято' });
    }
    
    const newUser = {
        id: Date.now().toString(),
        username,
        password, // В реальном приложении хэшируй!
        avatar: `https://ui-avatars.com/api/?name=${username}&size=64&background=666&color=fff`,
        online: false
    };
    
    users.push(newUser);
    writeData(USERS_FILE, users);
    
    res.json({ success: true, user: { id: newUser.id, username, avatar: newUser.avatar } });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    const users = readData(USERS_FILE);
    const user = users.find(u => u.username === username && u.password === password);
    
    if (!user) return res.status(401).json({ error: 'Неверный логин/пароль' });
    
    res.json({ success: true, user: { id: user.id, username: user.username, avatar: user.avatar } });
});

app.post('/api/update-avatar', (req, res) => {
    const { userId, avatar } = req.body;
    
    const users = readData(USERS_FILE);
    const userIndex = users.findIndex(u => u.id === userId);
    
    if (userIndex === -1) return res.status(404).json({ error: 'Пользователь не найден' });
    
    users[userIndex].avatar = avatar;
    writeData(USERS_FILE, users);
    
    res.json({ success: true, avatar });
});

app.get('/api/users', (req, res) => {
    const users = readData(USERS_FILE);
    res.json(users.map(u => ({
        id: u.id,
        username: u.username,
        avatar: u.avatar,
        online: activeUsers.has(u.id)
    })));
});

app.get('/api/messages', (req, res) => {
    const messages = readData(MESSAGES_FILE);
    res.json(messages);
});

// WebSocket
io.on('connection', (socket) => {
    console.log('Новое подключение:', socket.id);
    
    socket.on('user_online', (userData) => {
        activeUsers.set(userData.id, {
            socketId: socket.id,
            ...userData
        });
        
        io.emit('users_update', Array.from(activeUsers.values()));
    });
    
    socket.on('send_message', (data) => {
        const message = {
            id: Date.now().toString(),
            userId: data.userId,
            username: data.username,
            avatar: data.avatar,
            text: data.text,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            date: new Date().toLocaleDateString()
        };
        
        const messages = readData(MESSAGES_FILE);
        messages.push(message);
        writeData(MESSAGES_FILE, messages);
        
        io.emit('new_message', message);
    });
    
    socket.on('join_call', (userId) => {
        socket.broadcast.emit('user_joined_call', userId);
    });
    
    socket.on('leave_call', (userId) => {
        socket.broadcast.emit('user_left_call', userId);
    });
    
    socket.on('disconnect', () => {
        // Находим пользователя по socket.id и удаляем
        for (let [userId, userData] of activeUsers) {
            if (userData.socketId === socket.id) {
                activeUsers.delete(userId);
                io.emit('users_update', Array.from(activeUsers.values()));
                break;
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`✅ Сервер запущен: http://localhost:${PORT}`);
});
