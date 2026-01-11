class Discord2005 {
    constructor() {
        this.socket = null;
        this.currentUser = null;
        this.selectedUser = null;
        this.isPrivateChat = false;
        this.init();
    }

    init() {
        this.checkAuth();
        this.bindEvents();
    }

    checkAuth() {
        const savedUser = localStorage.getItem('discord2005_user');
        if (savedUser) {
            this.currentUser = JSON.parse(savedUser);
            this.showChat();
            this.connectSocket();
        }
    }

    bindEvents() {
        // Форма регистрации
        document.getElementById('registerBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.register();
        });

        // Форма входа
        document.getElementById('loginBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.login();
        });

        // Выход
        document.getElementById('logoutBtn')?.addEventListener('click', () => {
            this.logout();
        });

        // Отправка сообщения
        document.getElementById('messageForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.sendMessage();
        });

        // Публичный чат
        document.getElementById('publicChatBtn')?.addEventListener('click', () => {
            this.isPrivateChat = false;
            this.selectedUser = null;
            this.updateChatHeader();
        });
    }

    async register() {
        const username = document.getElementById('regUsername').value;
        const password = document.getElementById('regPassword').value;

        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (response.ok) {
                this.showMessage('success', data.message);
                document.getElementById('regUsername').value = '';
                document.getElementById('regPassword').value = '';
            } else {
                this.showMessage('error', data.error);
            }
        } catch (error) {
            this.showMessage('error', 'Ошибка соединения с сервером');
        }
    }

    async login() {
        const username = document.getElementById('loginUsername').value;
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
                localStorage.setItem('discord2005_user', JSON.stringify(this.currentUser));
                this.showChat();
                this.connectSocket();
            } else {
                this.showMessage('error', data.error);
            }
        } catch (error) {
            this.showMessage('error', 'Ошибка соединения с сервером');
        }
    }

    connectSocket() {
        this.socket = io();

        this.socket.on('connect', () => {
            this.socket.emit('user_join', this.currentUser);
            this.updateStatus('Подключено к серверу');
        });

        this.socket.on('active_users', (users) => {
            this.updateUserList(users);
        });

        this.socket.on('new_message', (message) => {
            this.addMessage(message);
        });

        this.socket.on('new_private_message', (message) => {
            this.addPrivateMessage(message);
        });

        this.socket.on('system_message', (message) => {
            this.addSystemMessage(message);
        });

        this.socket.on('disconnect', () => {
            this.updateStatus('Отключено от сервера');
        });
    }

    sendMessage() {
        const input = document.getElementById('messageInput');
        const message = input.value.trim();

        if (!message) return;

        if (this.isPrivateChat && this.selectedUser) {
            this.socket.emit('private_message', {
                toUserId: this.selectedUser.id,
                message: message
            });
        } else {
            this.socket.emit('send_message', { message });
        }

        input.value = '';
        input.focus();
    }

    selectUser(user) {
        this.selectedUser = user;
        this.isPrivateChat = true;
        this.updateChatHeader();
        
        // Прокручиваем к приватным сообщениям с этим пользователем
        const messages = document.querySelectorAll('.message.private');
        if (messages.length > 0) {
            messages[messages.length - 1].scrollIntoView();
        }
    }

    updateUserList(users) {
        const userList = document.getElementById('userList');
        userList.innerHTML = '';

        users.forEach(user => {
            if (user.id === this.currentUser.id) return;

            const li = document.createElement('li');
            li.className = 'user-item';
            if (this.selectedUser && this.selectedUser.id === user.id) {
                li.classList.add('active');
            }
            li.textContent = user.username;
            li.onclick = () => this.selectUser(user);
            userList.appendChild(li);
        });
    }

    addMessage(message) {
        const messagesContainer = document.getElementById('messagesContainer');
        const messageDiv = this.createMessageElement(message, false);
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    addPrivateMessage(message) {
        const messagesContainer = document.getElementById('messagesContainer');
        const messageDiv = this.createMessageElement(message, true);
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    addSystemMessage(message) {
        const messagesContainer = document.getElementById('messagesContainer');
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message system';
        
        const date = new Date(message.timestamp);
        const timeString = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        messageDiv.innerHTML = `
            <div class="message-header">
                <span class="username">${message.username}</span>
                <span class="timestamp">${timeString}</span>
            </div>
            <div class="message-content">${message.message}</div>
        `;
        
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    createMessageElement(message, isPrivate) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isPrivate ? 'private' : ''}`;
        messageDiv.dataset.senderId = message.userId || message.from?.id;
        
        const date = new Date(message.timestamp);
        const timeString = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        const username = isPrivate 
            ? `${message.from.username} → ${message.to.username} (приватно)`
            : message.username;
        
        messageDiv.innerHTML = `
            <div class="message-header">
                <span class="username">${username}</span>
                <span class="timestamp">${timeString}</span>
            </div>
            <div class="message-content">${message.message}</div>
        `;
        
        return messageDiv;
    }

    showChat() {
        document.getElementById('authContainer').style.display = 'none';
        document.getElementById('chatContainer').style.display = 'block';
        document.getElementById('currentUsername').textContent = this.currentUser.username;
        this.updateChatHeader();
    }

    updateChatHeader() {
        const header = document.getElementById('chatHeader');
        if (this.isPrivateChat && this.selectedUser) {
            header.textContent = `Приватный чат с ${this.selectedUser.username}`;
        } else {
            header.textContent = 'Общий чат';
        }
    }

    updateStatus(text) {
        document.getElementById('statusText').textContent = text;
    }

    showMessage(type, text) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `${type}-message`;
        messageDiv.textContent = text;
        
        const forms = document.querySelectorAll('.auth-form');
        forms.forEach(form => {
            const existingMessage = form.querySelector(`.${type}-message`);
            if (existingMessage) {
                existingMessage.remove();
            }
            form.insertBefore(messageDiv, form.firstChild.nextSibling);
        });
        
        setTimeout(() => messageDiv.remove(), 5000);
    }

    logout() {
        if (this.socket) {
            this.socket.disconnect();
        }
        localStorage.removeItem('discord2005_user');
        this.currentUser = null;
        this.selectedUser = null;
        
        document.getElementById('chatContainer').style.display = 'none';
        document.getElementById('authContainer').style.display = 'block';
        document.getElementById('messagesContainer').innerHTML = '';
        document.getElementById('userList').innerHTML = '';
    }
}

// Инициализация приложения
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new Discord2005();
});