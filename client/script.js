// ===== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ =====
let socket = null;
let currentUser = null;
let currentChat = null;
let friends = [];
let activeCall = null;
let peerConnections = {};
let localStream = null;

// ===== ИНИЦИАЛИЗАЦИЯ =====
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    setupEventListeners();
    setupWebRTCHandlers();
});

function checkAuth() {
    const savedUser = localStorage.getItem('chat_user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        showMainUI();
        connectSocket();
        loadUserData();
    }
}

// ===== СОКЕТ =====
function connectSocket() {
    socket = io();
    
    socket.on('connect', () => {
        socket.emit('user_online', currentUser);
        showNotification('✅ Подключено к серверу');
    });
    
    socket.on('user_status', (data) => {
        updateUserStatus(data.userId, data.isOnline, data.status);
    });
    
    socket.on('new_message', (message) => {
        if (currentChat === message.senderId || currentChat === message.receiverId) {
            addMessage(message);
        } else {
            showNotification(`📩 Новое сообщение от ${message.senderName}`);
        }
    });
    
    socket.on('friend_request', (request) => {
        showFriendRequest(request);
    });
    
    socket.on('friend_accepted', (data) => {
        showNotification(`✅ ${data.username} принял ваш запрос в друзья`);
        loadFriends();
    });
    
    socket.on('incoming_call', (data) => {
        showIncomingCall(data);
    });
    
    socket.on('call_started', (data) => {
        activeCall = data.callId;
        showCallUI();
    });
    
    socket.on('call_joined', (data) => {
        activeCall = data.callId;
        showCallUI();
        data.users.forEach(userId => {
            if (userId !== currentUser.id) {
                startPeerConnection(userId);
            }
        });
    });
    
    socket.on('user_joined_call', (data) => {
        startPeerConnection(data.userId);
    });
    
    socket.on('user_left_call', (data) => {
        if (peerConnections[data.userId]) {
            peerConnections[data.userId].close();
            delete peerConnections[data.userId];
        }
    });
    
    socket.on('webrtc_offer', async (data) => {
        await handleOffer(data.from, data.offer);
    });
    
    socket.on('webrtc_answer', async (data) => {
        await handleAnswer(data.from, data.answer);
    });
    
    socket.on('webrtc_ice_candidate', async (data) => {
        await handleIceCandidate(data.from, data.candidate);
    });
    
    socket.on('profile_updated', (data) => {
        if (data.userId === currentUser.id) {
            Object.assign(currentUser, data.updates);
            localStorage.setItem('chat_user', JSON.stringify(currentUser));
            updateUserUI();
        }
        if (friends.find(f => f.id === data.userId)) {
            loadFriends();
        }
    });
    
    socket.on('level_up', (data) => {
        showNotification(`🎉 Поздравляем! Вы достигли ${data.level} уровня!`);
        currentUser.level = data.level;
        currentUser.badges = data.badges;
        updateUserUI();
    });
}

// ===== ВХОД/РЕГИСТРАЦИЯ =====
async function login() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    
    if (!username || !password) {
        showError('loginError', 'Заполните все поля');
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
            localStorage.setItem('chat_user', JSON.stringify(data.user));
            showMainUI();
            connectSocket();
            loadUserData();
        } else {
            showError('loginError', data.error);
        }
    } catch (error) {
        showError('loginError', 'Ошибка сервера');
    }
}

async function register() {
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value;
    const email = document.getElementById('regEmail').value.trim();
    
    if (!username || !password) {
        showError('regError', 'Заполните имя и пароль');
        return;
    }
    
    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({username, password, email})
        });
        
        const data = await response.json();
        
        if (data.success) {
            currentUser = data.user;
            localStorage.setItem('chat_user', JSON.stringify(data.user));
            showMainUI();
            connectSocket();
            loadUserData();
        } else {
            showError('regError', data.error);
        }
    } catch (error) {
        showError('regError', 'Ошибка сервера');
    }
}

// ===== ГЛАВНЫЙ ИНТЕРФЕЙС =====
function showMainUI() {
    document.getElementById('authContainer').style.display = 'none';
    document.getElementById('mainContainer').style.display = 'block';
    
    updateUserUI();
    loadFriends();
    loadSettings();
    
    // Применяем тему
    applyTheme();
}

function updateUserUI() {
    document.getElementById('userAvatar').src = currentUser.avatar;
    document.getElementById('username').textContent = currentUser.username;
    document.getElementById('userStatus').textContent = currentUser.status;
    document.getElementById('userLevel').textContent = `Уровень ${currentUser.level}`;
    
    // XP бар
    const xpPercent = (currentUser.xp % 100);
    document.getElementById('xpProgress').style.width = `${xpPercent}%`;
    
    // Бейджи
    const badgesContainer = document.getElementById('userBadges');
    badgesContainer.innerHTML = currentUser.badges.map(badge => 
        `<span class="badge ${badge}">${getBadgeName(badge)}</span>`
    ).join('');
}

// ===== ДРУЗЬЯ =====
async function loadFriends() {
    try {
        const response = await fetch(`/api/friends/${currentUser.id}`);
        friends = await response.json();
        renderFriends();
    } catch (error) {
        console.error('Ошибка загрузки друзей:', error);
    }
}

function renderFriends() {
    const onlineFriends = friends.filter(f => f.isOnline);
    const offlineFriends = friends.filter(f => !f.isOnline);
    
    const container = document.getElementById('friendsList');
    container.innerHTML = '';
    
    // Онлайн друзья
    if (onlineFriends.length > 0) {
        const onlineHeader = document.createElement('div');
        onlineHeader.className = 'section-title';
        onlineHeader.innerHTML = `<span>Онлайн (${onlineFriends.length})</span>`;
        container.appendChild(onlineHeader);
        
        onlineFriends.forEach(friend => {
            container.appendChild(createFriendElement(friend));
        });
    }
    
    // Офлайн друзья
    if (offlineFriends.length > 0) {
        const offlineHeader = document.createElement('div');
        offlineHeader.className = 'section-title';
        offlineHeader.innerHTML = `<span>Офлайн (${offlineFriends.length})</span>`;
        container.appendChild(offlineHeader);
        
        offlineFriends.forEach(friend => {
            container.appendChild(createFriendElement(friend));
        });
    }
}

function createFriendElement(friend) {
    const div = document.createElement('div');
    div.className = `friend-item ${currentChat === friend.id ? 'active' : ''}`;
    div.onclick = () => openChat(friend);
    
    div.innerHTML = `
        <img src="${friend.avatar}" class="friend-avatar" alt="${friend.username}">
        <div class="friend-info">
            <div class="friend-name">${friend.username}</div>
            <div class="friend-status">
                <span class="status-dot ${friend.isOnline ? 'online' : 'offline'}"></span>
                ${friend.statusMessage || (friend.isOnline ? 'В сети' : 'Не в сети')}
            </div>
        </div>
        ${friend.level ? `<div class="level-badge">${friend.level}</div>` : ''}
    `;
    
    return div;
}

// ===== ЧАТ =====
async function openChat(friend) {
    currentChat = friend.id;
    renderFriends(); // Обновляем активный чат
    
    document.getElementById('chatTitle').textContent = friend.username;
    document.getElementById('chatStatus').textContent = friend.isOnline ? 'В сети' : 'Не в сети';
    
    await loadMessages(friend.id);
}

async function loadMessages(friendId) {
    try {
        const response = await fetch(`/api/messages/${currentUser.id}/${friendId}`);
        const messages = await response.json();
        
        const container = document.getElementById('messagesContainer');
        container.innerHTML = '';
        
        messages.forEach(message => {
            addMessage(message);
        });
        
        container.scrollTop = container.scrollHeight;
    } catch (error) {
        console.error('Ошибка загрузки сообщений:', error);
    }
}

function addMessage(message) {
    const container = document.getElementById('messagesContainer');
    const isSent = message.senderId === currentUser.id;
    
    const div = document.createElement('div');
    div.className = `message ${isSent ? 'sent' : 'received'} fade-in`;
    
    const time = new Date(message.timestamp).toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    div.innerHTML = `
        <div class="message-header">
            <img src="${message.senderAvatar}" class="message-avatar">
            <span class="message-sender">${message.senderName}</span>
            <span class="message-time">${time}</span>
        </div>
        <div class="message-content">
            <div class="message-text">${message.text}</div>
        </div>
    `;
    
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

async function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    
    if (!text || !currentChat) return;
    
    socket.emit('send_message', {
        senderId: currentUser.id,
        receiverId: currentChat,
        senderName: currentUser.username,
        senderAvatar: currentUser.avatar,
        text: text
    });
    
    input.value = '';
    input.focus();
}

// ===== ЗВОНКИ =====
async function startCall() {
    if (!currentChat) {
        showNotification('Выберите собеседника для звонка', 'error');
        return;
    }
    
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: true, 
            audio: true 
        });
        
        socket.emit('start_call', {
            callerId: currentUser.id,
            receiverId: currentChat
        });
        
        showLocalVideo();
    } catch (error) {
        showNotification('Ошибка доступа к камере/микрофону', 'error');
    }
}

async function joinCall(callId) {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: true, 
            audio: true 
        });
        
        socket.emit('join_call', { callId, userId: currentUser.id });
        showLocalVideo();
    } catch (error) {
        showNotification('Ошибка доступа к камере/микрофону', 'error');
    }
}

function showLocalVideo() {
    const video = document.getElementById('localVideo');
    if (video && localStream) {
        video.srcObject = localStream;
    }
}

function showCallUI() {
    document.getElementById('callContainer').classList.add('active');
}

function hideCallUI() {
    document.getElementById('callContainer').classList.remove('active');
    
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};
    
    if (activeCall) {
        socket.emit('leave_call', { userId: currentUser.id });
        activeCall = null;
    }
}

// ===== WebRTC =====
function setupWebRTCHandlers() {
    // Обработчики для видеозвонков
}

async function startPeerConnection(userId) {
    const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    const pc = new RTCPeerConnection(configuration);
    
    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }
    
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('webrtc_ice_candidate', {
                to: userId,
                candidate: event.candidate
            });
        }
    };
    
    pc.ontrack = (event) => {
        const remoteVideo = document.getElementById('remoteVideo');
        if (remoteVideo && !remoteVideo.srcObject) {
            remoteVideo.srcObject = event.streams[0];
        }
    };
    
    peerConnections[userId] = pc;
    
    // Создаём offer
    try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        socket.emit('webrtc_offer', {
            to: userId,
            offer: pc.localDescription
        });
    } catch (error) {
        console.error('Ошибка создания offer:', error);
    }
}

async function handleOffer(from, offer) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    
    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }
    
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('webrtc_ice_candidate', {
                to: from,
                candidate: event.candidate
            });
        }
    };
    
    pc.ontrack = (event) => {
        const remoteVideo = document.getElementById('remoteVideo');
        if (remoteVideo && !remoteVideo.srcObject) {
            remoteVideo.srcObject = event.streams[0];
        }
    };
    
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    socket.emit('webrtc_answer', {
        to: from,
        answer: pc.localDescription
    });
    
    peerConnections[from] = pc;
}

async function handleAnswer(from, answer) {
    const pc = peerConnections[from];
    if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
}

async function handleIceCandidate(from, candidate) {
    const pc = peerConnections[from];
    if (pc) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
}

// ===== ПОИСК И ДОБАВЛЕНИЕ ДРУЗЕЙ =====
async function searchUsers() {
    const query = document.getElementById('searchInput').value.trim();
    
    if (query.length < 2) return;
    
    try {
        const response = await fetch(`/api/users/search?query=${encodeURIComponent(query)}`);
        const results = await response.json();
        
        const container = document.getElementById('searchResults');
        container.innerHTML = '';
        
        if (results.length === 0) {
            container.innerHTML = '<div class="no-results">Ничего не найдено</div>';
            return;
        }
        
        results.forEach(user => {
            const div = document.createElement('div');
            div.className = 'user-result';
            
            div.innerHTML = `
                <img src="${user.avatar}" class="friend-avatar">
                <div class="user-info">
                    <div class="user-name">${user.username}</div>
                    <div class="user-status">
                        <span class="status-dot ${user.isOnline ? 'online' : 'offline'}"></span>
                        ${user.status || (user.isOnline ? 'В сети' : 'Не в сети')}
                    </div>
                </div>
                <button class="btn btn-sm btn-primary" onclick="sendFriendRequest('${user.id}')">
                    ${friends.find(f => f.id === user.id) ? 'Друг' : 'Добавить'}
                </button>
            `;
            
            container.appendChild(div);
        });
    } catch (error) {
        console.error('Ошибка поиска:', error);
    }
}

async function sendFriendRequest(userId) {
    try {
        const response = await fetch('/api/friends/request', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                fromUserId: currentUser.id,
                toUserId: userId
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Запрос в друзья отправлен');
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Ошибка отправки запроса', 'error');
    }
}

function showFriendRequest(request) {
    const modal = document.createElement('div');
    modal.className = 'notification success';
    modal.innerHTML = `
        <strong>Новый запрос в друзья!</strong>
        <p>${request.fromUsername} хочет добавить вас в друзья</p>
        <div style="display: flex; gap: 10px; margin-top: 10px;">
            <button class="btn btn-sm btn-success" onclick="acceptFriendRequest('${request.id}')">Принять</button>
            <button class="btn btn-sm btn-danger" onclick="rejectFriendRequest('${request.id}')">Отклонить</button>
        </div>
    `;
    
    document.body.appendChild(modal);
    setTimeout(() => modal.remove(), 10000);
}

async function acceptFriendRequest(requestId) {
    await respondToFriendRequest(requestId, 'accept');
}

async function rejectFriendRequest(requestId) {
    await respondToFriendRequest(requestId, 'reject');
}

async function respondToFriendRequest(requestId, action) {
    try {
        const response = await fetch('/api/friends/respond', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ requestId, action })
        });
        
        if (response.ok) {
            showNotification(action === 'accept' ? 'Запрос принят' : 'Запрос отклонен');
            loadFriends();
        }
    } catch (error) {
        showNotification('Ошибка обработки запроса', 'error');
    }
}

// ===== НАСТРОЙКИ И КАСТОМИЗАЦИЯ =====
async function loadSettings() {
    try {
        const response = await fetch(`/api/settings/${currentUser.id}`);
        const settings = await response.json();
        
        // Применяем настройки
        if (settings.theme) {
            document.body.className = `theme-${settings.theme}`;
        }
        
        // Заполняем форму настроек
        Object.keys(settings).forEach(key => {
            const element = document.getElementById(`setting_${key}`);
            if (element) {
                if (element.type === 'checkbox') {
                    element.checked = settings[key];
                } else {
                    element.value = settings[key];
                }
            }
        });
    } catch (error) {
        console.error('Ошибка загрузки настроек:', error);
    }
}

async function saveSettings() {
    const settings = {
        theme: document.getElementById('setting_theme').value,
        notifications: document.getElementById('setting_notifications').checked,
        sounds: document.getElementById('setting_sounds').checked,
        showOnline: document.getElementById('setting_showOnline').checked,
        allowFriendRequests: document.getElementById('setting_allowFriendRequests').checked,
        language: document.getElementById('setting_language').value
    };
    
    try {
        const response = await fetch('/api/settings/update', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                userId: currentUser.id,
                settings
            })
        });
        
        if (response.ok) {
            showNotification('Настройки сохранены');
            applyTheme();
        }
    } catch (error) {
        showNotification('Ошибка сохранения настроек', 'error');
    }
}

function applyTheme() {
    const theme = document.getElementById('setting_theme').value;
    document.body.className = `theme-${theme}`;
    
    // Сохраняем в localStorage для быстрого применения
    localStorage.setItem('chat_theme', theme);
}

async function updateProfile() {
    const updates = {
        status: document.getElementById('profile_status').value,
        statusMessage: document.getElementById('profile_statusMessage').value,
        avatar: document.getElementById('profile_avatar').value,
        customColor: document.getElementById('profile_color').value,
        customBg: document.getElementById('profile_bg').value
    };
    
    try {
        const response = await fetch('/api/profile/update', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                userId: currentUser.id,
                updates
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            currentUser = { ...currentUser, ...updates };
            localStorage.setItem('chat_user', JSON.stringify(currentUser));
            updateUserUI();
            showNotification('Профиль обновлён');
        }
    } catch (error) {
        showNotification('Ошибка обновления профиля', 'error');
    }
}

// ===== УТИЛИТЫ =====
function showNotification(message, type = 'success') {
    const div = document.createElement('div');
    div.className = `notification ${type}`;
    div.textContent = message;
    
    document.body.appendChild(div);
    
    setTimeout(() => div.remove(), 5000);
}

function showError(elementId, message) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = message;
        setTimeout(() => element.textContent = '', 3000);
    }
}

function logout() {
    localStorage.removeItem('chat_user');
    localStorage.removeItem('chat_theme');
    location.reload();
}

function getBadgeName(badge) {
    const badges = {
        'newbie': 'Новичок',
        'veteran': 'Ветеран',
        'expert': 'Эксперт',
        'premium': 'Премиум',
        'moderator': 'Модератор'
    };
    return badges[badge] || badge;
}

function updateUserStatus(userId, isOnline, status) {
    const friend = friends.find(f => f.id === userId);
    if (friend) {
        friend.isOnline = isOnline;
        friend.status = status;
        renderFriends();
        
        if (currentChat === userId) {
            document.getElementById('chatStatus').textContent = isOnline ? 'В сети' : 'Не в сети';
        }
    }
}

function showIncomingCall(data) {
    const modal = document.createElement('div');
    modal.className = 'notification info pulse';
    modal.innerHTML = `
        <strong>📞 Входящий звонок!</strong>
        <p>${data.callerName} звонит вам</p>
        <div style="display: flex; gap: 10px; margin-top: 10px;">
            <button class="btn btn-sm btn-success" onclick="joinCall('${data.callId}'); this.parentElement.parentElement.remove()">Принять</button>
            <button class="btn btn-sm btn-danger" onclick="this.parentElement.parentElement.remove()">Отклонить</button>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// ===== ОБРАБОТЧИКИ СОБЫТИЙ =====
function setupEventListeners() {
    // Enter для отправки сообщения
    document.getElementById('messageInput')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
    
    // Поиск при вводе
    document.getElementById('searchInput')?.addEventListener('input', searchUsers);
    
    // Загрузка файла авы
    document.getElementById('avatarUpload')?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = async (e) => {
                const base64 = e.target.result;
                await updateProfileField('avatar', base64);
            };
            reader.readAsDataURL(file);
        }
    });
    
    // Переключение тем
    document.querySelectorAll('.color-option').forEach(option => {
        option.addEventListener('click', function() {
            document.querySelectorAll('.color-option').forEach(o => o.classList.remove('active'));
            this.classList.add('active');
            document.getElementById('profile_color').value = this.style.backgroundColor;
        });
    });
    
    // Сохранение настроек
    document.getElementById('saveSettingsBtn')?.addEventListener('click', saveSettings);
    
    // Сохранение профиля
    document.getElementById('saveProfileBtn')?.addEventListener('click', updateProfile);
    
    // Выход
    document.getElementById('logoutBtn')?.addEventListener('click', logout);
}

async function updateProfileField(field, value) {
    const updates = { [field]: value };
    
    try {
        const response = await fetch('/api/profile/update', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                userId: currentUser.id,
                updates
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            currentUser[field] = value;
            localStorage.setItem('chat_user', JSON.stringify(currentUser));
            updateUserUI();
            showNotification('Обновлено');
        }
    } catch (error) {
        showNotification('Ошибка обновления', 'error');
    }
}

// ===== ГОЛОСОВЫЕ КОМАНДЫ =====
function setupVoiceCommands() {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.lang = 'ru-RU';
        recognition.continuous = false;
        recognition.interimResults = false;
        
        recognition.onresult = function(event) {
            const command = event.results[0][0].transcript.toLowerCase();
            handleVoiceCommand(command);
        };
        
        document.getElementById('voiceBtn')?.addEventListener('click', () => {
            recognition.start();
            showNotification('Слушаю...');
        });
    }
}

function handleVoiceCommand(command) {
    if (command.includes('привет') || command.includes('hello')) {
        showNotification('Привет! Чем могу помочь?');
    } else if (command.includes('статус')) {
        const status = command.includes('офлайн') ? 'Офлайн' : 
                      command.includes('не беспокоить') ? 'Не беспокоить' : 'В сети';
        socket.emit('update_status', { userId: currentUser.id, status });
    } else if (command.includes('поиск') && command.length > 10) {
        const query = command.replace('поиск', '').trim();
        document.getElementById('searchInput').value = query;
        searchUsers();
    }
}

// ===== ГАМЕФИКАЦИЯ =====
function addXP(amount) {
    // XP добавляется через сервер при отправке сообщений
    // Здесь можно добавить визуальные эффекты
    const xpBar = document.getElementById('xpProgress');
    const currentWidth = parseInt(xpBar.style.width) || 0;
    const newWidth = Math.min(currentWidth + amount, 100);
    
    xpBar.style.width = `${newWidth}%`;
    
    if (newWidth >= 100) {
        xpBar.style.width = '0%';
        showNotification('🎉 Уровень повышен!');
    }
}

// ===== ИНИЦИАЛИЗАЦИЯ ГОЛОСОВЫХ КОМАНД =====
setupVoiceCommands();

// ===== ГЛОБАЛЬНЫЕ ФУНКЦИИ ДЛЯ HTML =====
window.login = login;
window.register = register;
window.sendMessage = sendMessage;
window.startCall = startCall;
window.hideCallUI = hideCallUI;
window.searchUsers = searchUsers;
window.sendFriendRequest = sendFriendRequest;
window.acceptFriendRequest = acceptFriendRequest;
window.rejectFriendRequest = rejectFriendRequest;
window.saveSettings = saveSettings;
window.updateProfile = updateProfile;
window.logout = logout;
