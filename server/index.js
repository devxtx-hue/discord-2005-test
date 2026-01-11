const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
const USERS_FILE = path.join(__dirname, 'users.json');

// Инициализация файла пользователей
if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([]));
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

// Хранение активных пользователей
const activeUsers = new Map();

// API для регистрации
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }
    
    if (username.length < 3 || username.length > 20) {
        return res.status(400).json({ error: 'Имя пользователя должно быть от 3 до 20 символов' });
    }
    
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'Пользователь уже существует' });
    }
    
    const newUser = {
        id: Date.now().toString(),
        username,
        password, // В реальном приложении нужно хэшировать!
        registered: new Date().toISOString()
    };
    
    users.push(newUser);
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    
    res.json({ success: true, message: 'Регистрация успешна!' });
});

// API для входа
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    const user = users.find(u => u.username === username && u.password === password);
    
    if (!user) {
        return res.status(401).json({ error: 'Неверное имя пользователя или пароль' });
    }
    
    res.json({ 
        success: true, 
        user: { 
            id: user.id, 
            username: user.username 
        } 
    });
});

// WebSocket соединения
io.on('connection', (socket) => {
    console.log('Новое соединение:', socket.id);
    
    socket.on('user_join', (userData) => {
        activeUsers.set(socket.id, {
            id: userData.id,
            username: userData.username,
            socketId: socket.id
        });
        
        // Отправляем список активных пользователей всем
        io.emit('active_users', Array.from(activeUsers.values()));
        io.emit('system_message', {
            username: 'Система',
            message: `${userData.username} присоединился к чату`,
            timestamp: new Date().toISOString()
        });
    });
    
    socket.on('send_message', (data) => {
        const user = activeUsers.get(socket.id);
        if (user) {
            const message = {
                id: Date.now().toString(),
                userId: user.id,
                username: user.username,
                message: data.message,
                timestamp: new Date().toISOString()
            };
            
            // Отправляем сообщение всем пользователям
            io.emit('new_message', message);
        }
    });
    
    socket.on('private_message', (data) => {
        const fromUser = activeUsers.get(socket.id);
        const toUser = Array.from(activeUsers.values()).find(u => u.id === data.toUserId);
        
        if (fromUser && toUser) {
            const privateMsg = {
                id: Date.now().toString(),
                from: fromUser,
                to: toUser,
                message: data.message,
                timestamp: new Date().toISOString(),
                private: true
            };
            
            // Отправляем приватное сообщение только отправителю и получателю
            socket.emit('new_private_message', privateMsg);
            io.to(toUser.socketId).emit('new_private_message', privateMsg);
        }
    });
    
    socket.on('disconnect', () => {
        const user = activeUsers.get(socket.id);
        if (user) {
            activeUsers.delete(socket.id);
            io.emit('active_users', Array.from(activeUsers.values()));
            io.emit('system_message', {
                username: 'Система',
                message: `${user.username} покинул чат`,
                timestamp: new Date().toISOString()
            });
        }
        console.log('Пользователь отключен:', socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
    console.log(`Чтобы друзья подключились, дайте им ваш IP-адрес:`);
    console.log(`http://ваш-локальный-ip:${PORT}`);
});