let socket = null;
let currentUser = null;
let inCall = false;
let callUsers = [];

// Инициализация
window.onload = function() {
    checkAuth();
};

// Проверка авторизации
function checkAuth() {
    const savedUser = localStorage.getItem('simplechat_user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        showChat();
        connectSocket();
    }
}

// Вход
async function login() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    
    if (!username || !password) {
        showError('loginError', 'Заполните поля');
        return;
    }
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({username, password})
        });
        
        const data = await response.json();
        
        if (data.success) {
            currentUser = data.user;
            localStorage.setItem('simplechat_user', JSON.stringify(data.user));
            showChat();
            connectSocket();
        } else {
            showError('loginError', data.error);
        }
    } catch (error) {
        showError('loginError', 'Ошибка сервера');
    }
}

// Регистрация
async function register() {
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value;
    
    if (!username || !password) {
        showError('regError', 'Заполните поля');
        return;
    }
    
    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({username, password})
        });
        
        const data = await response.json();
        
        if (data.success) {
            currentUser = data.user;
            localStorage.setItem('simplechat_user', JSON.stringify(data.user));
            showChat();
            connectSocket();
        } else {
            showError('regError', data.error);
        }
    } catch (error) {
        showError('regError', 'Ошибка сервера');
    }
}

// Показать чат
function showChat() {
    document.getElementById('authContainer').style.display = 'none';
    document.getElementById('chatContainer').style.display = 'block';
    
    document.getElementById('userName').textContent = currentUser.username;
    document.getElementById('userAvatar').src = currentUser.avatar;
    
    loadUsers();
    loadMessages();
}

// Подключение WebSocket
function connectSocket() {
    socket = io();
    
    socket.on('connect', () => {
        socket.emit('user_online', currentUser);
        showNotification('Подключено к чату');
    });
    
    socket.on('users_update', (users) => {
        updateUsersList(users);
    });
    
    socket.on('new_message', (message) => {
        addMessage(message);
    });
    
    socket.on('user_joined_call', (userId) => {
        if (inCall) {
            callUsers.push(userId);
            updateCallUsers();
        }
    });
    
    socket.on('user_left_call', (userId) => {
        callUsers = callUsers.filter(id => id !== userId);
        updateCallUsers();
    });
}

// Загрузка пользователей
async function loadUsers() {
    try {
        const response = await fetch('/api/users');
        const users = await response.json();
        updateUsersList(users);
    } catch (error) {
        console.error('Ошибка загрузки пользователей:', error);
    }
}

// Обновление списка пользователей
function updateUsersList(users) {
    const container = document.getElementById('usersList');
    const onlineCount = users.filter(u => u.online).length;
    
    document.getElementById('onlineCount').textContent = onlineCount;
    
    container.innerHTML = '';
    
    users.forEach(user => {
        const div = document.createElement('div');
        div.className = 'user-item';
        
        div.innerHTML = `
            <img src="${user.avatar}" class="avatar" alt="${user.username}">
            <span>${user.username}</span>
            <div class="${user.online ? 'online-dot' : 'offline-dot'}"></div>
        `;
        
        container.appendChild(div);
    });
}

// Загрузка сообщений
async function loadMessages() {
    try {
        const response = await fetch('/api/messages');
        const messages = await response.json();
        
        const container = document.getElementById('messages');
        container.innerHTML = '';
        
        messages.forEach(message => {
            addMessage(message);
        });
        
        // Прокрутка вниз
        container.scrollTop = container.scrollHeight;
    } catch (error) {
        console.error('Ошибка загрузки сообщений:', error);
    }
}

// Добавить сообщение
function addMessage(message) {
    const container = document.getElementById('messages');
    const isCurrentUser = message.userId === currentUser.id;
    
    const div = document.createElement('div');
    div.className = 'message';
    
    div.innerHTML = `
        <div class="message-header">
            <img src="${message.avatar}" class="avatar" style="width: 30px; height: 30px;">
            <strong>${message.username}</strong>
            <span class="message-time">${message.time}</span>
        </div>
        <div>${message.text}</div>
    `;
    
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// Отправить сообщение
async function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    
    if (!text) return;
    
    socket.emit('send_message', {
        userId: currentUser.id,
        username: currentUser.username,
        avatar: currentUser.avatar,
        text: text
    });
    
    input.value = '';
    input.focus();
}

// Звонок
function toggleCall() {
    if (inCall) {
        leaveCall();
    } else {
        joinCall();
    }
}

function joinCall() {
    inCall = true;
    document.getElementById('callPanel').style.display = 'block';
    document.getElementById('callBtn').textContent = 'Выйти из звонка';
    socket.emit('join_call', currentUser.id);
    callUsers.push(currentUser.id);
    updateCallUsers();
}

function leaveCall() {
    inCall = false;
    document.getElementById('callPanel').style.display = 'none';
    document.getElementById('callBtn').textContent = 'Войти в звонок';
    socket.emit('leave_call', currentUser.id);
    callUsers = [];
    updateCallUsers();
}

function updateCallUsers() {
    const container = document.getElementById('callUsers');
    container.innerHTML = '';
    
    // Здесь можно добавить отображение участников звонка
    container.innerHTML = `<div style="font-size: 12px;">Участники: ${callUsers.length}</div>`;
}

// Смена авы
function showAvatarModal() {
    document.getElementById('avatarModal').style.display = 'flex';
    document.getElementById('avatarUrl').value = currentUser.avatar;
}

function hideAvatarModal() {
    document.getElementById('avatarModal').style.display = 'none';
}

async function updateAvatar() {
    const url = document.getElementById('avatarUrl').value.trim();
    
    if (!url) {
        showNotification('Введите ссылку', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/update-avatar', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({userId: currentUser.id, avatar: url})
        });
        
        const data = await response.json();
        
        if (data.success) {
            currentUser.avatar = data.avatar;
            localStorage.setItem('simplechat_user', JSON.stringify(currentUser));
            document.getElementById('userAvatar').src = data.avatar;
            showNotification('Аватар обновлен');
            hideAvatarModal();
            socket.emit('user_online', currentUser); // Обновляем инфо
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Ошибка обновления', 'error');
    }
}

// Выход
function logout() {
    localStorage.removeItem('simplechat_user');
    location.reload();
}

// Утилиты
function showError(elementId, message) {
    document.getElementById(elementId).textContent = message;
    setTimeout(() => {
        document.getElementById(elementId).textContent = '';
    }, 3000);
}

function showNotification(message, type = 'success') {
    const div = document.createElement('div');
    div.className = 'notification';
    div.textContent = message;
    if (type === 'error') {
        div.style.borderLeftColor = 'red';
    }
    
    document.body.appendChild(div);
    
    setTimeout(() => {
        div.remove();
    }, 3000);
}

// Глобальные функции
window.login = login;
window.register = register;
window.sendMessage = sendMessage;
window.toggleCall = toggleCall;
window.leaveCall = leaveCall;
window.showAvatarModal = showAvatarModal;
window.hideAvatarModal = hideAvatarModal;
window.updateAvatar = updateAvatar;
window.logout = logout;
