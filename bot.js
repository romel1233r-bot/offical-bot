const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ChannelType, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, SlashCommandBuilder, REST, Routes, PermissionsBitField, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// 🧠 AI RESPONSE DATABASE
const aiResponses = {
    greetings: [
        "Hey there! 👋 I'm Romel's AI assistant while you wait for staff!",
        "Hello! 🤖 AI assistant here - staff will be with you shortly!",
        "Hi! I'm keeping you company until staff arrives! 🚀",
        "Hey! 👋 I'm here to help until our team joins the conversation!"
    ],
    waiting: [
        "Our staff team has been notified and will be here soon! ⏰",
        "Thanks for your patience! Staff is on the way! 🏃‍♂️",
        "Hang tight! Our team is reviewing your ticket now! 🔍",
        "You're in the queue! Staff will assist you shortly! 📋"
    ],
    questions: {
        "stock": "We currently have various limiteds and Robux in stock! Staff can provide exact details when they arrive. 📊",
        "price": "Pricing varies based on current market rates. Staff will give you the best deal! 💰",
        "time": "Staff response time is usually within a few minutes during active hours! ⏱️",
        "vouch": "Check our vouch channel for hundreds of satisfied customers! 🌟",
        "legit": "We're a trusted service with extensive vouches and reputation! ✅",
        "help": "I can keep you company, but staff will handle all transactions for security! 🔒"
    },
    general: [
        "Interesting question! Our staff will provide detailed answers when they arrive! 💭",
        "Good question! Let me ping staff again for you! 🔔",
        "I've noted your question - staff will address it shortly! 📝",
        "Our team has expertise in that area - they'll help you out! 🎯"
    ],
    fun: [
        "While you wait, did you know we process hundreds of successful trades weekly? 🚀",
        "Fun fact: Our average response time is under 5 minutes! ⚡",
        "Pro tip: Have your Roblox username ready for faster service! 👤",
        "Did you check our current stock in the announcements? 📢"
    ]
};

// 🧠 AI CHAT SYSTEM
class TicketAI {
    constructor() {
        this.userSessions = new Map();
        this.staffRole = '1406420130044313772';
    }

    // 🎯 DETECT IF STAFF IS ACTIVE IN CHANNEL
    async isStaffActive(channel) {
        try {
            const messages = await channel.messages.fetch({ limit: 10 });
            const staffMessages = messages.filter(msg => 
                msg.member && msg.member.roles.cache.has(this.staffRole)
            );
            return staffMessages.size > 0;
        } catch (error) {
            return false;
        }
    }

    // 🧠 GET AI RESPONSE BASED ON USER MESSAGE
    getAIResponse(message) {
        const content = message.content.toLowerCase();
        
        // 🎯 GREETINGS
        if (content.match(/\b(hi|hello|hey|yo|sup|whats up)\b/)) {
            return this.getRandomResponse(aiResponses.greetings);
        }
        
        // ❓ QUESTIONS
        if (content.includes('stock') || content.includes('have') || content.includes('available')) {
            return aiResponses.questions.stock;
        }
        if (content.includes('price') || content.includes('cost') || content.includes('how much')) {
            return aiResponses.questions.price;
        }
        if (content.includes('time') || content.includes('wait') || content.includes('long')) {
            return aiResponses.questions.time;
        }
        if (content.includes('vouch') || content.includes('review') || content.includes('proof')) {
            return aiResponses.questions.vouch;
        }
        if (content.includes('legit') || content.includes('trust') || content.includes('scam')) {
            return aiResponses.questions.legit;
        }
        if (content.includes('help') || content.includes('what can') || content.includes('how to')) {
            return aiResponses.questions.help;
        }
        
        // ❓ QUESTION MARK DETECTION
        if (content.includes('?')) {
            return this.getRandomResponse(aiResponses.general);
        }
        
        // 🎲 RANDOM RESPONSES FOR ENGAGEMENT
        if (Math.random() < 0.3) { // 30% chance to send fun message
            return this.getRandomResponse(aiResponses.fun);
        }
        
        // ⏳ WAITING MESSAGES
        return this.getRandomResponse(aiResponses.waiting);
    }

    getRandomResponse(array) {
        return array[Math.floor(Math.random() * array.length)];
    }

    // 🚀 SEND AI MESSAGE WITH TYPING INDICATOR
    async sendAIMessage(channel, response) {
        try {
            // Show typing indicator
            await channel.sendTyping();
            
            // Random delay to make it feel natural (1-3 seconds)
            const delay = Math.random() * 2000 + 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
            
            // Create AI embed message
            const aiEmbed = new EmbedBuilder()
                .setDescription(`**🤖 Romel's AI:** ${response}`)
                .setColor(0x5865F2)
                .setFooter({ text: 'AI Assistant • While you wait for staff' })
                .setTimestamp();

            await channel.send({ embeds: [aiEmbed] });
        } catch (error) {
            console.log('AI message error:', error);
        }
    }

    // 🎯 MAIN AI MESSAGE HANDLER
    async handleUserMessage(message) {
        try {
            // Ignore bots, commands, and staff messages
            if (message.author.bot || message.content.startsWith('/') || message.content.startsWith('!')) return;
            if (message.member.roles.cache.has(this.staffRole)) return;

            const channel = message.channel;
            
            // Check if staff is active in this channel
            const staffActive = await this.isStaffActive(channel);
            if (staffActive) return; // Don't interfere if staff is talking

            // Get user session
            const userId = message.author.id;
            const userSession = this.userSessions.get(userId) || { messageCount: 0, lastMessageTime: 0 };
            
            // Rate limiting: Max 1 AI response per 30 seconds
            const now = Date.now();
            if (now - userSession.lastMessageTime < 30000) return;
            
            // Only respond to every 2-3 user messages to avoid spam
            userSession.messageCount++;
            if (userSession.messageCount % 2 !== 0 && userSession.messageCount > 1) return;
            
            // Get AI response
            const response = this.getAIResponse(message);
            
            // Update session
            userSession.lastMessageTime = now;
            this.userSessions.set(userId, userSession);
            
            // Send AI response
            await this.sendAIMessage(channel, response);
            
        } catch (error) {
            console.log('AI handler error:', error);
        }
    }

    // 🧹 CLEANUP OLD SESSIONS
    cleanupSessions() {
        const now = Date.now();
        for (const [userId, session] of this.userSessions.entries()) {
            if (now - session.lastMessageTime > 300000) { // 5 minutes
                this.userSessions.delete(userId);
            }
        }
    }
}

// 🚀 ULTRA-FAST SETUP
if (!process.env.BOT_TOKEN) {
    console.error('❌ BOT_TOKEN missing!');
    process.exit(1);
}

// ⚡ LIGHTNING DB
class SpeedDB {
    constructor() {
        this.filePath = path.join(__dirname, 'tickets.json');
        this.cache = null;
        this.ensureFileExists();
    }

    ensureFileExists() {
        if (!fs.existsSync(this.filePath)) {
            fs.writeFileSync(this.filePath, JSON.stringify({ tickets: {}, counter: 0 }));
        }
    }

    read() {
        if (!this.cache) {
            this.cache = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        }
        return this.cache;
    }

    write(data) {
        this.cache = data;
        fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
    }

    async get(key) {
        const data = this.read();
        return key.split('.').reduce((obj, k) => obj?.[k], data);
    }

    async set(key, value) {
        const data = this.read();
        const keys = key.split('.');
        let obj = data;
        
        for (let i =
