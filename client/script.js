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
            this.showNotification
