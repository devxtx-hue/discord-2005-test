class SimpleChat {
    constructor() {
        this.socket = null;
        this.currentUser = null;
        this.currentChat = null;
        this.friends = [];
        this.messages = {};
        this.init();
    }

    init() {
        this.bindEvents();
        this.checkAuth();
    }

    bindEvents() {
        // Аутентификация
        document.getElementById('registerBtn')?.addEventListener('click', (e) => this.register(e));
        document.getElementById('loginBtn')?.addEventListener('click', (e) => this.login(e));
        
        // Навигация
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });
        
        // Чат
        document.getElementById('sendMessageBtn')?.addEventListener('click', () => this.sendMessage());
        document.getElementById('messageInput')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
        
        // Поиск друзей
        document.getElementById('searchUserBtn')?.addEventListener('click', () => this.searchUser());
        document.getElementById('searchFriend')?.addEventListener('input', (e) => this.filterFriends(e.target.value));
        
        // Глобальные функции
        window.showLogin = () => {
            document.getElementById('registerForm').style.display = 'none';
            document.getElementById('loginForm').style.display = 'block';
        };
        
        window.showRegister = () => {
            document.getElementById('loginForm').style.display = 'none';
            document.getElementById('registerForm').style.display = 'block';
        };
    }

    async register(e) {
        e.preventDefault();
        const username = document.getElementById('regUsername').value.trim();
        const password = document.getElementById('regPassword').value;
        
        if (!username || !password) {
            this.showNotification('Заполните все поля', 'error');
            return;
        }
        
        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.currentUser = data.user;
                localStorage.setItem('simplechat_user', JSON.stringify(data.user));
                this.showMainInterface();
                this.connectSocket();
            } else {
                this.showNotification(data.error, 'error');
            }
        } catch (error) {
            this.showNotification('Ошибка соединения', 'error');
        }
    }

    async login(e) {
        e.preventDefault();
        const username = document.getElementById('loginUsername').value.trim();
        const password = document.getElementById('loginPassword').value;
        
        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.currentUser = data.user;
                localStorage.setItem('simplechat_user', JSON.stringify(data.user));
                this.showMainInterface();
                this.connectSocket();
                this.loadFriends();
                this.loadFriendRequests();
            } else {
                this.showNotification(data.error, 'error');
            }
        } catch (error) {
            this.showNotification('Ошибка соединения', 'error');
        }
    }

    checkAuth() {
        const savedUser = localStorage.getItem('simplechat_user');
        if (savedUser) {
            this.currentUser = JSON.parse(savedUser);
            this.showMainInterface();
            this.connectSocket();
            this.loadFriends();
            this.loadFriendRequests();
        }
    }

    showMainInterface() {
        document.getElementById('authContainer').style.display = 'none';
        document.getElementById('mainContainer').style.display = 'flex';
        
        // Обновляем информацию о пользователе
        document.getElementById('userUsername').textContent = this.currentUser.username;
        document.getElementById('userId').textContent = `ID: ${this.currentUser.id}`;
        document.getElementById('userAvatar').src = this.currentUser.avatar;
    }

    connectSocket() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            this.socket.emit('user_join', this.currentUser);
            this.showNotification('Подключено к серверу', 'success');
        });
        
        this.socket.on('new_message', (message) => {
            if (this.currentChat === message.senderId) {
                this.addMessageToChat(message);
                this.markMessagesAsRead(message.senderId);
            } else {
                // Показать уведомление о новом сообщении
                this.showNotification(`Новое сообщение от ${message.senderUsername}`, 'info');
            }
        });
        
        this.socket.on('message_sent', (message) => {
            this.addMessageToChat(message);
        });
        
        this.socket.on('friend_request', (data) => {
            this.showNotification(`Новый запрос в друзья от ${data.fromUsername}`, 'info');
            this.loadFriendRequests();
        });
        
        this.socket.on('friend_accepted', (data) => {
            this.showNotification(`${data.username} принял(а) ваш запрос в друзья`, 'success');
            this.loadFriends();
        });
        
        this.socket.on('user_status_change', (data) => {
            this.updateFriendStatus(data.userId, data.isOnline);
        });
    }

    async loadFriends() {
        try {
            const response = await fetch(`/api/friends/${this.currentUser.id}`);
            const friends = await response.json();
            this.friends = friends;
            this.renderFriendsList();
        } catch (error) {
            console.error('Ошибка загрузки друзей:', error);
        }
    }

    renderFriendsList() {
        const list = document.getElementById('friendsList');
        list.innerHTML = '';
        
        this.friends.forEach(friend => {
            const li = document.createElement('li');
            li.className = 'friend-item';
            if (this.currentChat === friend.id) {
                li.classList.add('active');
            }
            
            li.innerHTML = `
                <img src="${friend.avatar}" class="friend-avatar" alt="${friend.username}">
                <div class="friend-details">
                    <div class="friend-name">
                        ${friend.username}
                        <div class="${friend.isOnline ? 'online-dot' : 'offline-dot'}"></div>
                    </div>
                    <div class="last-message">Нажмите, чтобы написать</div>
                </div>
            `;
            
            li.addEventListener('click', () => this.openChat(friend));
            list.appendChild(li);
        });
    }

    async openChat(friend) {
        this.currentChat = friend.id;
        this.renderFriendsList(); // Обновляем активный чат
        
        // Показываем интерфейс чата
        document.getElementById('emptyChat').style.display = 'none';
        document.getElementById('chatContainer').style.display = 'flex';
        
        // Обновляем информацию в заголовке чата
        document.getElementById('chatFriendName').textContent = friend.username;
        document.getElementById('chatFriendAvatar').src = friend.avatar;
        document.getElementById('chatFriendStatus').textContent = friend.isOnline ? 'Онлайн' : 'Офлайн';
        document.getElementById('chatFriendStatus').style.color = friend.isOnline ? '#2ecc71' : '#95a5a6';
        
        // Загружаем историю сообщений
        await this.loadChatHistory(friend.id);
        
        // Помечаем сообщения как прочитанные
        this.markMessagesAsRead(friend.id);
        
        // Фокусируемся на поле ввода
        document.getElementById('messageInput').focus();
    }

    async loadChatHistory(friendId) {
        try {
            const response = await fetch(`/api/messages/${this.currentUser.id}/${friendId}`);
            const messages = await response.json();
            this.messages[friendId] = messages;
            this.renderChatMessages(messages);
        } catch (error) {
            console.error('Ошибка загрузки истории:', error);
        }
    }

    renderChatMessages(messages) {
        const container = document.getElementById('chatMessages');
        container.innerHTML = '';
        
        messages.forEach(message => {
            const isSent = message.senderId === this.currentUser.id;
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
            
            const time = new Date(message.timestamp).toLocaleTimeString([], { 
                hour: '2-digit', 
                minute: '2-digit' 
            });
            
            messageDiv.innerHTML = `
                <div class="message-info">
                    <span>${isSent ? 'Вы' : message.senderUsername}</span>
                    <span class="message-time">${time}</span>
                </div>
                <div class="message-content">${message.message}</div>
            `;
            
            container.appendChild(messageDiv);
        });
        
        // Прокручиваем вниз
        container.scrollTop = container.scrollHeight;
    }

    async sendMessage() {
        const input = document.getElementById('messageInput');
        const message = input.value.trim();
        
        if (!message || !this.currentChat) return;
        
        this.socket.emit('send_message', {
            receiverId: this.currentChat,
            message: message
        });
        
        input.value = '';
    }

    addMessageToChat(message) {
        if (!this.messages[this.currentChat]) {
            this.messages[this.currentChat] = [];
        }
        
        this.messages[this.currentChat].push(message);
        
        // Если это текущий чат - отображаем сообщение
        if (this.currentChat === message.senderId || 
            (this.currentChat === message.receiverId && message.senderId === this.currentUser.id)) {
            this.renderChatMessages(this.messages[this.currentChat]);
        }
    }

    async markMessagesAsRead(friendId) {
        if (this.socket) {
            this.socket.emit('mark_as_read', {
                senderId: friendId,
                receiverId: this.currentUser.id
            });
        }
    }

    updateFriendStatus(userId, isOnline) {
        const friendIndex = this.friends.findIndex(f => f.id === userId);
        if (friendIndex !== -1) {
            this.friends[friendIndex].isOnline = isOnline;
            this.renderFriendsList();
            
            // Если это текущий чат - обновляем статус
            if (this.currentChat === userId) {
                document.getElementById('chatFriendStatus').textContent = isOnline ? 'Онлайн' : 'Офлайн';
                document.getElementById('chatFriendStatus').style.color = isOnline ? '#2ecc71' : '#95a5a6';
            }
        }
    }

    switchTab(tabName) {
        // Обновляем активную вкладку
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });
        
        // Показываем соответствующую панель
        document.getElementById('friendsPanel').style.display = tabName === 'friends' ? 'block' : 'none';
        document.getElementById('addFriendPanel').style.display = tabName === 'add-friend' ? 'block' : 'none';
        document.getElementById('requestsPanel').style.display = tabName === 'requests' ? 'block' : 'none';
    }

    async searchUser() {
        const username = document.getElementById('searchUsername').value.trim();
        if (!username) return;
        
        try {
            const response = await fetch('/api/user/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    username, 
                    currentUserId: this.currentUser.id 
                })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                const resultsDiv = document.getElementById('searchResults');
                resultsDiv.innerHTML = `
                    <div class="search-result">
                        <img src="${data.avatar}" class="avatar" alt="${data.username}">
                        <div class="result-details">
                            <div style="font-weight: bold;">${data.username}</div>
                            <div style="font-size: 12px; color: #666;">ID: ${data.id}</div>
                        </div>
                        <button class="add-friend-btn" onclick="app.sendFriendRequest('${data.id}')">
                            Добавить в друзья
                        </button>
                    </div>
                `;
            } else {
                this.showNotification(data.error, 'error');
            }
        } catch (error) {
            this.showNotification('Ошибка поиска', 'error');
        }
    }

    async sendFriendRequest(userId) {
        try {
            const response = await fetch('/api/friend/request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fromUserId: this.currentUser.id,
                    toUserId: userId
                })
            });
            
            if (response.ok) {
                this.showNotification('Запрос отправлен', 'success');
                document.getElementById('searchResults').innerHTML = '';
                document.getElementById('searchUsername').value = '';
            } else {
                const data = await response.json();
                this.showNotification(data.error, 'error');
            }
        } catch (error) {
            this.showNotification('Ошибка отправки запроса', 'error');
        }
    }

    async loadFriendRequests() {
        try {
            const response = await fetch(`/api/friend/requests/${this.currentUser.id}`);
            const requests = await response.json();
            this.renderFriendRequests(requests);
        } catch (error) {
            console.error('Ошибка загрузки запросов:', error);
        }
    }

    renderFriendRequests(requests) {
        const container = document.getElementById('friendRequests');
        container.innerHTML = '';
        
        if (requests.length === 0) {
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">Запросов нет</div>';
            return;
        }
        
        requests.forEach(request => {
            const requestDiv = document.createElement('div');
            requestDiv.className = 'request-item';
            
            requestDiv.innerHTML = `
                <img src="${request.fromAvatar}" class="avatar" alt="${request.fromUsername}">
                <div style="flex: 1;">
                    <div style="font-weight: bold;">${request.fromUsername}</div>
                    <div style="font-size: 12px; color: #666;">
                        ${new Date(request.createdAt).toLocaleDateString()}
                    </div>
                    <div class="request-actions">
                        <button class="accept-btn" onclick="app.respondToRequest('${request.id}', 'accept')">
                            Принять
                        </button>
                        <button class="reject-btn" onclick="app.respondToRequest('${request.id}', 'reject')">
                            Отклонить
                        </button>
                    </div>
                </div>
            `;
            
            container.appendChild(requestDiv);
        });
    }

    async respondToRequest(requestId, action) {
        try {
            const response = await fetch('/api/friend/respond', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestId, action })
            });
            
            if (response.ok) {
                if (action === 'accept') {
                    this.showNotification('Запрос принят', 'success');
                    this.loadFriends();
                } else {
                    this.showNotification('Запрос отклонен', 'info');
                }
                this.loadFriendRequests();
            }
        } catch (error) {
            this.showNotification('Ошибка обработки запроса', 'error');
        }
    }

    filterFriends(searchText) {
        const friends = document.querySelectorAll('.friend-item');
        friends.forEach(friend => {
            const name = friend.querySelector('.friend-name').textContent.toLowerCase();
            friend.style.display = name.includes(searchText.toLowerCase()) ? 'flex' : 'none';
        });
    }

    async updateAvatar() {
        const url = document.getElementById('avatarUrl').value.trim();
        if (!url) return;
        
        try {
            const response = await fetch('/api/user/avatar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: this.currentUser.id,
                    avatarUrl: url
                })
            });
            
            if (response.ok) {
                this.currentUser.avatar = url;
                localStorage.setItem('simplechat_user', JSON.stringify(this.currentUser));
                
                // Обновляем аватар везде
                document.getElementById('userAvatar').src = url;
                if (this.currentChat) {
                    document.getElementById('chatFriendAvatar').src = url;
                }
                
                this.showNotification('Аватар обновлен', 'success');
                this.hideAvatarModal();
            }
        } catch (error) {
            this.showNotification('Ошибка обновления аватара', 'error');
        }
    }

    showAvatarModal() {
        document.getElementById('avatarModal').classList.add('active');
        document.getElementById('avatarUrl').value = this.currentUser.avatar;
    }

    hideAvatarModal() {
        document.getElementById('avatarModal').classList.remove('active');
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
}

// Инициализация приложения
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new SimpleChat();
    window.app = app; // Делаем глобальным для обработчиков
});
