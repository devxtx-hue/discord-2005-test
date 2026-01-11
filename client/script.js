class SimpleChat {
    constructor() {
        this.socket = null;
        this.user = null;
        this.currentChat = null;
        this.friends = [];
        this.voiceActive = false;
        this.mediaStream = null;
        this.audioContext = null;
        this.isMicActive = false;
        this.voiceRoom = null;
        
        this.init();
    }
    
    init() {
        this.bindEvents();
        this.checkAuth();
        this.initResponsive();
    }
    
    bindEvents() {
        // Аутентификация
        document.getElementById('loginBtn').addEventListener('click', () => this.login());
        document.getElementById('registerBtn').addEventListener('click', () => this.register());
        document.getElementById('messageInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
        
        // Глобальные функции
        window.showRegister = () => {
            document.getElementById('loginForm').style.display = 'none';
            document.getElementById('registerForm').style.display = 'block';
            document.getElementById('authError').textContent = '';
        };
        
        window.showLogin = () => {
            document.getElementById('registerForm').style.display = 'none';
            document.getElementById('loginForm').style.display = 'block';
            document.getElementById('regError').textContent = '';
        };
        
        window.toggleSidebar = () => {
            document.getElementById('sidebar').classList.toggle('active');
        };
        
        window.switchTab = (tab) => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.getElementById('friendsTab').style.display = 'none';
            document.getElementById('addTab').style.display = 'none';
            
            if (tab === 'friends') {
                document.querySelector('.tab:nth-child(1)').classList.add('active');
                document.getElementById('friendsTab').style.display = 'block';
            } else {
                document.querySelector('.tab:nth-child(2)').classList.add('active');
                document.getElementById('addTab').style.display = 'block';
            }
        };
        
        window.showAvatarModal = () => {
            document.getElementById('avatarModal').classList.add('show');
            document.getElementById('avatarUrl').value = this.user.avatar;
        };
        
        window.hideAvatarModal = () => {
            document.getElementById('avatarModal').classList.remove('show');
        };
        
        window.updateAvatar = () => {
            const url = document.getElementById('avatarUrl').value.trim();
            if (!url) {
                this.showError('Введите URL аватара');
                return;
            }
            
            fetch('/api/user/update', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({userId: this.user.id, avatar: url})
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    this.user.avatar = data.avatar;
                    localStorage.setItem('user', JSON.stringify(this.user));
                    document.getElementById('userAvatar').src = data.avatar;
                    if (this.currentChat) {
                        document.getElementById('chatAvatar').src = data.avatar;
                    }
                    this.showNotification('Аватар обновлен');
                    hideAvatarModal();
                } else {
                    this.showError(data.error);
                }
            })
            .catch(() => this.showError('Ошибка обновления'));
        };
        
        window.findUser = () => {
            const username = document.getElementById('searchUserInput').value.trim();
            if (!username) {
                this.showError('Введите имя пользователя');
                return;
            }
            
            fetch('/api/user/find', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    username: username,
                    currentUserId: this.user.id
                })
            })
            .then(res => res.json())
            .then(data => {
                if (data.error) {
                    this.showError(data.error);
                    return;
                }
                
                const results = document.getElementById('searchResults');
                results.innerHTML = `
                    <div class="user-result">
                        <img src="${data.avatar}" class="friend-avatar">
                        <div>
                            <div style="font-weight: bold;">${data.username}</div>
                            <div style="font-size: 12px; color: #a0aec0;">ID: ${data.id}</div>
                        </div>
                        <button class="add-friend" onclick="app.addFriend('${data.id}')">
                            <i class="fas fa-user-plus"></i> Добавить
                        </button>
                    </div>
                `;
            })
            .catch(() => this.showError('Ошибка поиска'));
        };
        
        window.searchFriends = () => {
            const search = document.getElementById('searchFriends').value.toLowerCase();
            const friends = document.querySelectorAll('.friend');
            friends.forEach(friend => {
                const name = friend.querySelector('.friend-name').textContent.toLowerCase();
                friend.style.display = name.includes(search) ? 'flex' : 'none';
            });
        };
        
        window.toggleVoiceChat = () => {
            if (!this.currentChat) {
                this.showError('Выберите чат для войса');
                return;
            }
            
            if (!this.voiceActive) {
                this.joinVoiceChat();
            } else {
                this.leaveVoiceChat();
            }
        };
        
        window.toggleMicrophone = () => {
            if (this.mediaStream) {
                const audioTracks = this.mediaStream.getAudioTracks();
                audioTracks.forEach(track => {
                    track.enabled = !track.enabled;
                });
                this.isMicActive = !this.isMicActive;
                document.getElementById('micBtn').innerHTML = 
                    this.isMicActive ? 
                    '<i class="fas fa-microphone-slash"></i> Выключить микрофон' :
                    '<i class="fas fa-microphone"></i> Включить микрофон';
                document.getElementById('micBtn').classList.toggle('active', this.isMicActive);
            }
        };
        
        window.leaveVoiceChat = () => {
            this.leaveVoiceChat();
        };
        
        // Делаем методы глобальными
        window.app = this;
    }
    
    initResponsive() {
        window.addEventListener('resize', () => {
            if (window.innerWidth > 768) {
                document.getElementById('sidebar').style.display = 'block';
            } else {
                document.getElementById('sidebar').style.display = 'none';
            }
        });
    }
    
    async login() {
        const username = document.getElementById('loginUsername').value.trim();
        const password = document.getElementById('loginPassword').value;
        
        if (!username || !password) {
            this.showAuthError('Заполните все поля');
            return;
        }
        
        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({username, password})
            });
            
            const data = await res.json();
            
            if (data.success) {
                this.user = data.user;
                localStorage.setItem('user', JSON.stringify(data.user));
                this.showMainApp();
                this.connectSocket();
                this.loadFriends();
            } else {
                this.showAuthError(data.error);
            }
        } catch {
            this.showAuthError('Ошибка соединения');
        }
    }
    
    async register() {
        const username = document.getElementById('regUsername').value.trim();
        const password = document.getElementById('regPassword').value;
        
        if (!username || !password) {
            this.showRegError('Заполните все поля');
            return;
        }
        
        if (username.length < 3) {
            this.showRegError('Имя слишком короткое');
            return;
        }
        
        try {
            const res = await fetch('/api/register', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({username, password})
            });
            
            const data = await res.json();
            
            if (data.success) {
                this.user = data.user;
                localStorage.setItem('user', JSON.stringify(data.user));
                this.showMainApp();
                this.connectSocket();
                this.loadFriends();
            } else {
                this.showRegError(data.error);
            }
        } catch {
            this.showRegError('Ошибка соединения');
        }
    }
    
    showAuthError(msg) {
        document.getElementById('authError').textContent = msg;
    }
    
    showRegError(msg) {
        document.getElementById('regError').textContent = msg;
    }
    
    checkAuth() {
        const saved = localStorage.getItem('user');
        if (saved) {
            this.user = JSON.parse(saved);
            this.showMainApp();
            this.connectSocket();
            this.loadFriends();
        }
    }
    
    showMainApp() {
        document.getElementById('authScreen').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        
        // Обновляем информацию пользователя
        document.getElementById('userName').textContent = this.user.username;
        document.getElementById('userId').textContent = `ID: ${this.user.id}`;
        document.getElementById('userAvatar').src = this.user.avatar;
        
        // Адаптивность
        if (window.innerWidth <= 768) {
            document.getElementById('sidebar').style.display = 'none';
        }
    }
    
    connectSocket() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            this.socket.emit('user_join', this.user);
            this.showNotification('Подключено к серверу');
        });
        
        this.socket.on('new_message', (msg) => {
            if (this.currentChat === msg.fromId) {
                this.addMessage(msg);
            } else {
                this.showNotification(`Новое сообщение от ${msg.fromName}`);
            }
        });
        
        this.socket.on('message_sent', (msg) => {
            this.addMessage(msg);
        });
        
        this.socket.on('user_online', (data) => {
            this.updateFriendStatus(data.userId, data.online);
        });
        
        this.socket.on('user_joined_voice', (data) => {
            this.addVoiceUser(data.userId);
        });
        
        this.socket.on('user_left_voice', (data) => {
            this.removeVoiceUser(data.userId);
        });
        
        this.socket.on('voice_stream', (data) => {
            this.playAudio(data.audioData);
        });
    }
    
    async loadFriends() {
        try {
            const res = await fetch(`/api/friends/${this.user.id}`);
            this.friends = await res.json();
            this.renderFriends();
        } catch {
            this.showError('Ошибка загрузки друзей');
        }
    }
    
    renderFriends() {
        const container = document.getElementById('friendsContainer');
        container.innerHTML = '';
        
        if (this.friends.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 20px; color: #a0aec0;">Друзей нет</div>';
            return;
        }
        
        this.friends.forEach(friend => {
            const div = document.createElement('div');
            div.className = 'friend';
            if (this.currentChat === friend.id) {
                div.classList.add('active');
            }
            
            div.innerHTML = `
                <img src="${friend.avatar}" class="friend-avatar">
                <div class="friend-info">
                    <div class="friend-name">
                        ${friend.username}
                        <span class="status ${friend.isOnline ? 'online' : 'offline'}"></span>
                    </div>
                    <div class="last-msg">Нажмите для чата</div>
                </div>
            `;
            
            div.onclick = () => this.openChat(friend);
            container.appendChild(div);
        });
    }
    
    async openChat(friend) {
        this.currentChat = friend.id;
        this.renderFriends(); // Обновляем активный чат
        
        // Показываем интерфейс чата
        document.getElementById('emptyChat').style.display = 'none';
        document.getElementById('chatContainer').style.display = 'flex';
        document.getElementById('chatHeader').style.display = 'flex';
        document.getElementById('voiceBtn').style.display = 'block';
        
        // Обновляем информацию чата
        document.getElementById('chatFriendName').textContent = friend.username;
        document.getElementById('chatAvatar').src = friend.avatar;
        document.getElementById('chatStatus').className = `status ${friend.isOnline ? 'online' : 'offline'}`;
        
        // Загружаем историю сообщений
        await this.loadMessages(friend.id);
        
        // Фокус на поле ввода
        document.getElementById('messageInput').focus();
        
        // Закрываем боковую панель на мобилке
        if (window.innerWidth <= 768) {
            document.getElementById('sidebar').classList.remove('active');
        }
    }
    
    async loadMessages(friendId) {
        try {
            const res = await fetch(`/api/messages/${this.user.id}/${friendId}`);
            const messages = await res.json();
            
            const container = document.getElementById('messages');
            container.innerHTML = '';
            
            messages.forEach(msg => {
                this.addMessage(msg);
            });
            
            // Прокрутка вниз
            container.scrollTop = container.scrollHeight;
        } catch {
            this.showError('Ошибка загрузки сообщений');
        }
    }
    
    addMessage(msg) {
        const container = document.getElementById('messages');
        const isMe = msg.fromId === this.user.id;
        
        const div = document.createElement('div');
        div.className = `message ${isMe ? 'sent' : 'received'}`;
        
        const time = new Date(msg.time).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
        
        div.innerHTML = `
            <div class="msg-content">${msg.text}</div>
            <div class="msg-info">${time} • ${isMe ? 'Вы' : msg.fromName}</div>
        `;
        
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }
    
    async sendMessage() {
        const input = document.getElementById('messageInput');
        const text = input.value.trim();
        
        if (!text || !this.currentChat) return;
        
        this.socket.emit('send_message', {
            toId: this.currentChat,
            text: text
        });
        
        input.value = '';
    }
    
    async addFriend(friendId) {
        try {
            const res = await fetch('/api/friends/add', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    userId1: this.user.id,
                    userId2: friendId
                })
            });
            
            const data = await res.json();
            
            if (data.success) {
                this.showNotification('Друг добавлен');
                this.loadFriends();
                document.getElementById('searchResults').innerHTML = '';
                document.getElementById('searchUserInput').value = '';
            } else {
                this.showError(data.error);
            }
        } catch {
            this.showError('Ошибка добавления друга');
        }
    }
    
    updateFriendStatus(userId, isOnline) {
        const friend = this.friends.find(f => f.id === userId);
        if (friend) {
            friend.isOnline = isOnline;
            this.renderFriends();
            
            if (this.currentChat === userId) {
                document.getElementById('chatStatus').className = `status ${isOnline ? 'online' : 'offline'}`;
            }
        }
    }
    
    async joinVoiceChat() {
        try {
            // Запрашиваем доступ к микрофону
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false
            });
            
            this.isMicActive = true;
            this.voiceRoom = `voice_${this.user.id}_${this.currentChat}`;
            
            // Входим в комнату
            this.socket.emit('join_voice', {
                roomId: this.voiceRoom,
                userId: this.user.id
            });
            
            this.voiceActive = true;
            document.getElementById('voiceBtn').classList.add('active');
            document.getElementById('voiceBtn').innerHTML = '<i class="fas fa-phone-slash"></i> Выйти из войса';
            document.getElementById('voiceChat').classList.add('active');
            
            // Обновляем список пользователей
            this.updateVoiceUsers();
            
            // Начинаем передачу аудио
            this.startAudioStreaming();
            
            this.showNotification('Войс чат подключен');
            
        } catch (error) {
            this.showError('Ошибка доступа к микрофону');
            console.error('Voice error:', error);
        }
    }
    
    async leaveVoiceChat() {
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }
        
        if (this.voiceActive) {
            this.socket.emit('leave_voice', {
                roomId: this.voiceRoom,
                userId: this.user.id
            });
        }
        
        this.voiceActive = false;
        this.voiceRoom = null;
        this.isMicActive = false;
        
        document.getElementById('voiceBtn').classList.remove('active');
        document.getElementById('voiceBtn').innerHTML = '<i class="fas fa-phone"></i> Войс чат';
        document.getElementById('voiceChat').classList.remove('active');
        document.getElementById('micBtn').innerHTML = '<i class="fas fa-microphone"></i> Включить микрофон';
        document.getElementById('micBtn').classList.remove('active');
        document.getElementById('voiceUsers').innerHTML = '';
    }
    
    startAudioStreaming() {
        // Здесь будет код для захвата и передачи аудио
        // Для простоты оставляем базовую структуру
        console.log('Audio streaming started');
    }
    
    playAudio(audioData) {
        // Воспроизведение полученного аудио
        // Базовый пример для демонстрации
    }
    
    updateVoiceUsers() {
        const container = document.getElementById('voiceUsers');
        // Здесь будет обновление списка пользователей в войсе
        container.innerHTML = `
            <div class="voice-user">
                <span class="status online"></span>
                <span>${this.user.username} (Вы)</span>
            </div>
        `;
    }
    
    addVoiceUser(userId) {
        const container = document.getElementById('voiceUsers');
        // Добавление пользователя в список войса
    }
    
    removeVoiceUser(userId) {
        // Удаление пользователя из списка войса
    }
    
    showNotification(message) {
        const div = document.createElement('div');
        div.className = 'notification';
        div.textContent = message;
        
        document.body.appendChild(div);
        
        setTimeout(() => {
            div.remove();
        }, 3000);
    }
    
    showError(message) {
        this.showNotification(message);
    }
}

// Запуск приложения
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new SimpleChat();
});
