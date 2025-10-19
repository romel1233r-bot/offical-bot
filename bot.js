const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ChannelType, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, SlashCommandBuilder, REST, Routes, PermissionsBitField, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

if (!process.env.BOT_TOKEN) {
    console.error('❌ BOT_TOKEN missing!');
    process.exit(1);
}

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
        
        for (let i = 0; i < keys.length - 1; i++) {
            if (!obj[keys[i]]) obj[keys[i]] = {};
            obj = obj[keys[i]];
        }
        
        obj[keys[keys.length - 1]] = value;
        this.write(data);
    }
}

const db = new SpeedDB();

const config = {
    token: process.env.BOT_TOKEN,
    guildId: '1406416544451399832',
    adminRole: '1406420130044313772',
    ticketsChannel: '1406418069181436017',
    vouchChannel: '1429250208016896040',
    transcriptsChannel: '1406761652510134294'
};

if (!config.token) {
    console.error('❌ Invalid token!');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages
    ]
});

const EMOJIS = {
    LIMITEDS: '<:lim:1429231822646018149>',
    DAHOOD: '<:dh:1429232221683712070>',
    SERVICES: '<:discord:1429232874338652260>',
    ROBUX: '<:rp:1429495226359087265>',
    CHECKMARK: '<:checkmark:1406769918866620416>',
    CLOSE: '🔒',
    STAR: '⭐',
    LIGHTNING: '⚡',
    MONEY: '💰',
    TICKET: '🎫',
    AI: '🤖'
};

const vouchSessions = new Map();

// 🧠 SIMPLE ROMEL AI
class RomelAI {
    constructor() {
        this.userSessions = new Map();
    }

    async generateAIResponse(message) {
        const content = message.content.toLowerCase();
        
        // General conversation responses
        const responses = [
            "I'm Romel AI! How can I help you today? 🤖",
            "That's interesting! Tell me more about that. 💭",
            "I understand what you're saying. Our staff can help with that! 👥",
            "Great question! Let me get someone to assist you. 🔔",
            "I'm here to help until our team arrives! What do you need? 🎯",
            "Thanks for sharing! Our experts will handle this shortly. ⚡",
            "I see what you mean. Our staff specializes in this area! 💎",
            "Awesome! Let me notify the team about your inquiry. 📝",
            "I appreciate you reaching out! Help is on the way. 🚀",
            "Noted! Our professionals will take care of this. ✅"
        ];

        // Specific responses for common questions
        if (content.includes('hello') || content.includes('hi') || content.includes('hey')) {
            return "👋 Hello! I'm Romel AI, your assistant! How can I help you today?";
        }
        if (content.includes('how are you')) {
            return "I'm doing great! Ready to help you with anything you need! 😊";
        }
        if (content.includes('thank')) {
            return "You're welcome! Happy to assist! 🙏";
        }
        if (content.includes('price') || content.includes('cost') || content.includes('how much')) {
            return "💰 Our staff will provide you with the best pricing! They'll be here shortly.";
        }
        if (content.includes('stock') || content.includes('available')) {
            return "📊 We have various items in stock! Staff can give you exact details.";
        }
        if (content.includes('time') || content.includes('wait')) {
            return "⏰ Staff usually responds within a few minutes! Hang tight!";
        }

        return responses[Math.floor(Math.random() * responses.length)];
    }

    async sendAIMessage(channel, response) {
        try {
            await channel.sendTyping();
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const aiEmbed = new EmbedBuilder()
                .setDescription(`**🤖 Romel AI:** ${response}`)
                .setColor(0x5865F2)
                .setFooter({ text: 'Romel AI • Always here to help' })
                .setTimestamp();

            await channel.send({ embeds: [aiEmbed] });
        } catch (error) {
            console.log('AI message error:', error);
        }
    }

    async handleUserMessage(message) {
        try {
            if (message.author.bot || message.content.startsWith('/') || message.content.startsWith('!')) return;
            if (message.member.roles.cache.has(config.adminRole)) return;

            const channel = message.channel;
            const userId = message.author.id;
            
            const userSession = this.userSessions.get(userId) || { lastMessageTime: 0 };
            const now = Date.now();
            
            if (now - userSession.lastMessageTime < 30000) return;
            
            const response = await this.generateAIResponse(message);
            userSession.lastMessageTime = now;
            this.userSessions.set(userId, userSession);
            
            await this.sendAIMessage(channel, response);
            
        } catch (error) {
            console.log('AI handler error:', error);
        }
    }

    cleanupSessions() {
        const now = Date.now();
        for (const [userId, session] of this.userSessions.entries()) {
            if (now - session.lastMessageTime > 600000) {
                this.userSessions.delete(userId);
            }
        }
    }
}

const romelAI = new RomelAI();

const commands = [
    new SlashCommandBuilder()
        .setName('setup-tickets')
        .setDescription('🚀 Create the ticket panel (Admin only)'),
    
    new SlashCommandBuilder()
        .setName('reset-tickets')
        .setDescription('🔄 Reset all ticket data (Staff only)'),
    
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('🏓 Check bot latency'),
    
    new SlashCommandBuilder()
        .setName('close')
        .setDescription('⚡ Close current ticket (Anyone can use)')
].map(command => command.toJSON());

async function registerSlashCommands() {
    try {
        const rest = new REST({ version: '10' }).setToken(config.token);
        console.log('⚡ Registering slash commands...');
        
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, config.guildId),
            { body: commands }
        );
        
        console.log('✅ Slash commands registered!');
    } catch (error) {
        console.error('Command registration error:', error);
    }
}

async function generateTranscript(messages, ticketData) {
    const transcript = messages.reverse().map(msg => {
        const time = new Date(msg.createdTimestamp).toLocaleString();
        return `[${time}] ${msg.author.tag}: ${msg.content}`;
    }).join('\n');

    return `🎫 TICKET #${ticketData.number}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 USER: ${ticketData.userTag} (${ticketData.userId})
🎯 SERVICE: ${ticketData.description}
🕒 CREATED: ${new Date(ticketData.createdAt).toLocaleString()}
🔒 CLOSED: ${new Date().toLocaleString()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${transcript}`;
}

// 🚀 FIXED TICKET CLOSING SYSTEM
async function closeTicketInstantly(interaction, ticketData) {
    try {
        const channel = interaction.channel;
        console.log(`🔧 Closing ticket #${ticketData.number}`);
        
        // Update database FIRST
        const userTickets = await db.get(`tickets.${ticketData.userId}`) || [];
        const updatedTickets = userTickets.map(ticket => 
            ticket.channelId === channel.id ? { ...ticket, open: false, closedAt: new Date().toISOString() } : ticket
        );
        await db.set(`tickets.${ticketData.userId}`, updatedTickets);
        console.log('✅ Database updated');

        // Get messages for transcript
        let messages;
        try {
            messages = await channel.messages.fetch({ limit: 50 });
        } catch (error) {
            messages = new Map();
        }

        // Send transcript
        if (messages.size > 0) {
            try {
                const transcript = await generateTranscript([...messages.values()], ticketData);
                const transcriptBuffer = Buffer.from(transcript, 'utf8');
                const attachment = new AttachmentBuilder(transcriptBuffer, { name: `ticket-${ticketData.number}.txt` });

                const transcriptsChannel = await client.channels.fetch(config.transcriptsChannel);
                if (transcriptsChannel) {
                    await transcriptsChannel.send({
                        content: `📄 Transcript - Ticket #${ticketData.number}`,
                        files: [attachment]
                    });
                }
            } catch (error) {}
        }

        // Send vouch request
        try {
            const user = await client.users.fetch(ticketData.userId);
            if (user) {
                await sendVouchRequest(user, ticketData.description, interaction.user.tag);
            }
        } catch (error) {}

        // Send closing message
        const closingEmbed = new EmbedBuilder()
            .setTitle('⚡ **TICKET CLOSED**')
            .setDescription(`**Closed by:** ${interaction.user}\n**Ticket:** #${ticketData.number}`)
            .setColor(0x00FF00)
            .setTimestamp();

        await channel.send({ embeds: [closingEmbed] });

        // Delete channel immediately
        setTimeout(async () => {
            try {
                await channel.delete();
                console.log(`✅ Ticket channel deleted`);
            } catch (error) {
                console.log('Channel deletion error:', error);
            }
        }, 2000);

    } catch (error) {
        console.error('Close ticket error:', error);
        throw error;
    }
}

async function findTicketByChannel(channelId) {
    try {
        const data = db.read();
        for (const userId in data.tickets) {
            const ticket = data.tickets[userId].find(t => t.channelId === channelId && t.open);
            if (ticket) return ticket;
        }
        return null;
    } catch (error) {
        return null;
    }
}

// 🎯 CREATE CATEGORIES FOR TICKETS
async function getOrCreateCategory(guild, categoryName) {
    try {
        // Find existing category
        const existingCategory = guild.channels.cache.find(
            channel => channel.type === ChannelType.GuildCategory && channel.name === categoryName
        );
        
        if (existingCategory) return existingCategory;

        // Create new category
        const category = await guild.channels.create({
            name: categoryName,
            type: ChannelType.GuildCategory,
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionsBitField.Flags.ViewChannel],
                },
                {
                    id: config.adminRole,
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
                },
            ],
        });

        console.log(`✅ Created category: ${categoryName}`);
        return category;
    } catch (error) {
        console.error('Category creation error:', error);
        return null;
    }
}

client.once('ready', async () => {
    console.log(`⚡ ${client.user.tag} is ONLINE!`);
    
    client.user.setPresence({
        activities: [{ name: 'discord.gg/romel | 🤖 AI Powered', type: 3 }],
        status: 'online'
    });

    await registerSlashCommands();
    setInterval(() => romelAI.cleanupSessions(), 300000);
    console.log('✅ Bot is fully operational!');
});

// 🎯 TICKET CREATION WITH CATEGORIES
async function createTicket(interaction, type, description) {
    try {
        const guild = interaction.guild;
        const member = interaction.member;

        // Check for existing tickets
        const userTickets = await db.get(`tickets.${member.id}`) || [];
        const openTicket = userTickets.find(ticket => ticket.open);
        
        if (openTicket) {
            const errorEmbed = new EmbedBuilder()
                .setTitle('🚫 Active Ticket Found')
                .setDescription('You already have an open ticket! Close it first.')
                .setColor(0xFF4444)
                .setTimestamp();

            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }

        await interaction.reply({ 
            content: `${EMOJIS.LIGHTNING} **Creating your ticket...**`, 
            ephemeral: true 
        });

        const ticketNumber = (await db.get('counter') || 0) + 1;
        
        // Determine category based on ticket type
        let categoryName = 'Tickets';
        if (type.includes('buy')) categoryName = 'Buying Tickets';
        if (type.includes('sell')) categoryName = 'Selling Tickets';
        if (type === 'services') categoryName = 'Service Tickets';
        if (type === 'robux') categoryName = 'Robux Tickets';

        const category = await getOrCreateCategory(guild, categoryName);

        const ticketChannel = await guild.channels.create({
            name: `ticket-${ticketNumber}`,
            type: ChannelType.GuildText,
            parent: category ? category.id : null,
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: member.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
                { id: config.adminRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
                { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageChannels] }
            ]
        });

        // Save ticket data
        const ticketData = {
            channelId: ticketChannel.id,
            userId: member.id,
            userTag: member.user.tag,
            type: type,
            description: description,
            open: true,
            createdAt: new Date().toISOString(),
            number: ticketNumber
        };
        
        const currentTickets = await db.get(`tickets.${member.id}`) || [];
        currentTickets.push(ticketData);
        await db.set(`tickets.${member.id}`, currentTickets);
        await db.set('counter', ticketNumber);

        const ticketEmbed = new EmbedBuilder()
            .setTitle(`${EMOJIS.TICKET} **TICKET #${ticketNumber}**`)
            .setDescription(`Welcome to your support channel!`)
            .addFields(
                { name: `${EMOJIS.CHECKMARK} Client`, value: `${member}`, inline: true },
                { name: `${EMOJIS.MONEY} Service`, value: `${description}`, inline: true },
                { name: `${EMOJIS.LIGHTNING} Created`, value: `<t:${Math.floor(Date.now()/1000)}:R>`, inline: true }
            )
            .addFields(
                { name: `${EMOJIS.AI} Romel AI`, value: 'I\'m here to help while you wait for staff!' },
                { name: '🚀 Getting Started', value: 'Tell us what you need - our team will assist you shortly.' }
            )
            .setColor(0x5865F2)
            .setFooter({ text: 'Romel\'s Stock • Premium Support' })
            .setTimestamp();

        const ticketButtons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('instant_close')
                    .setLabel('⚡ CLOSE TICKET')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('⚡')
            );

        await ticketChannel.send({ 
            content: `${member} <@&${config.adminRole}> ${EMOJIS.LIGHTNING}\n\n${EMOJIS.AI} **Romel AI is now active!**`, 
            embeds: [ticketEmbed], 
            components: [ticketButtons] 
        });

        await interaction.editReply({ 
            content: `${EMOJIS.CHECKMARK} **Ticket created!** ${ticketChannel}` 
        });

    } catch (error) {
        console.error('Ticket creation error:', error);
        await interaction.editReply({ 
            content: '❌ Failed to create ticket. Try again.' 
        });
    }
}

async function sendVouchRequest(user, ticketDescription, staffMember) {
    try {
        const vouchEmbed = new EmbedBuilder()
            .setTitle('🌟 **Rate Your Experience**')
            .setDescription(`Thank you for choosing **Romel's Stock**!`)
            .addFields(
                { name: '📊 Service Summary', value: `**Service:** ${ticketDescription}\n**Completed:** <t:${Math.floor(Date.now()/1000)}:R>` },
                { name: '⭐ Your Rating', value: 'Select your rating below!' }
            )
            .setColor(0x9B59B6)
            .setFooter({ text: 'Romel\'s Stock • Customer Feedback' })
            .setTimestamp();

        const vouchDropdown = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('vouch_rating')
                    .setPlaceholder('🎯 Select rating...')
                    .addOptions([
                        { label: '5 Stars - Outstanding!', value: 'vouch_5', emoji: '⭐' },
                        { label: '4 Stars - Great Service', value: 'vouch_4', emoji: '⭐' },
                        { label: '3 Stars - Good Service', value: 'vouch_3', emoji: '⭐' },
                        { label: '2 Stars - Fair Experience', value: 'vouch_2', emoji: '⭐' },
                        { label: '1 Star - Poor Experience', value: 'vouch_1', emoji: '⭐' }
                    ])
            );

        await user.send({ embeds: [vouchEmbed], components: [vouchDropdown] });
        return true;
    } catch (error) {
        return false;
    }
}

async function sendVouchToChannel(user, rating, ticketDescription, comment = '') {
    try {
        const vouchChannel = await client.channels.fetch(config.vouchChannel);
        if (!vouchChannel) return false;
        
        const stars = '⭐'.repeat(rating) + '☆'.repeat(5 - rating);
        const ratingColor = [0xe74c3c, 0xe67e22, 0xf39c12, 0x2ecc71, 0x27ae60][rating - 1];

        const vouchEmbed = new EmbedBuilder()
            .setTitle('📝 **Customer Review**')
            .setDescription(`**Rating:** ${rating}/5 ${stars}\n**Service:** ${ticketDescription}`)
            .addFields(
                { name: '👤 Reviewed By', value: `${user.tag}`, inline: true },
                { name: '🕒 Review Time', value: `<t:${Math.floor(Date.now()/1000)}:f>`, inline: true }
            )
            .setColor(ratingColor)
            .setFooter({ text: 'Romel\'s Stock • Customer Feedback' })
            .setTimestamp();

        if (comment) {
            vouchEmbed.addFields({ name: '💬 Feedback', value: `"${comment}"` });
        }

        await vouchChannel.send({ embeds: [vouchEmbed] });
        return true;
    } catch (error) {
        return false;
    }
}

// 🧠 MESSAGE HANDLER FOR AI
client.on('messageCreate', async (message) => {
    if (message.channel.name.startsWith('ticket-') && !message.author.bot) {
        await romelAI.handleUserMessage(message);
    }
});

// ⚡ INTERACTION HANDLER
client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            switch (interaction.commandName) {
                case 'setup-tickets':
                    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                        return await interaction.reply({ content: '❌ Admin only!', ephemeral: true });
                    }

                    const embed = new EmbedBuilder()
                        .setTitle(`🎫 **ROMEL'S STOCK TICKETS**`)
                        .setDescription(`**Professional Trading & Services**\n\n${EMOJIS.CHECKMARK} **Verified & Trusted**\n${EMOJIS.AI} **Romel AI Assistant**\n${EMOJIS.LIGHTNING} **Instant Support**`)
                        .setColor(0x5865F2)
                        .setFooter({ text: 'Romel\'s Stock • Elite Services' })
                        .setTimestamp();

                    const row = new ActionRowBuilder()
                        .addComponents(
                            new StringSelectMenuBuilder()
                                .setCustomId('ticket_type')
                                .setPlaceholder('🎫 Choose your service...')
                                .addOptions([
                                    {
                                        label: 'Limiteds',
                                        description: 'Buy or sell Limited items',
                                        value: 'limiteds',
                                        emoji: EMOJIS.LIMITEDS.replace(/[<>]/g, '').split(':')[2]
                                    },
                                    {
                                        label: 'Dahood Skins',
                                        description: 'Buy or sell Dahood skins',
                                        value: 'dahood',
                                        emoji: EMOJIS.DAHOOD.replace(/[<>]/g, '').split(':')[2]
                                    },
                                    {
                                        label: 'Buying Services',
                                        description: 'Professional buying services',
                                        value: 'services',
                                        emoji: EMOJIS.SERVICES.replace(/[<>]/g, '').split(':')[2]
                                    },
                                    {
                                        label: 'Buy Robux',
                                        description: 'Purchase Robux securely',
                                        value: 'robux',
                                        emoji: EMOJIS.ROBUX.replace(/[<>]/g, '').split(':')[2]
                                    }
                                ])
                        );

                    await interaction.reply({ content: '✅ **Panel created!**', ephemeral: true });
                    await interaction.channel.send({ embeds: [embed], components: [row] });
                    break;

                case 'close':
                    // 🎯 ANYONE CAN CLOSE TICKETS NOW!
                    const ticketData = await findTicketByChannel(interaction.channel.id);
                    if (!ticketData) {
                        return await interaction.reply({ content: '❌ Not a ticket channel!', ephemeral: true });
                    }

                    await interaction.reply({ content: `${EMOJIS.LIGHTNING} **Closing ticket...**` });
                    await closeTicketInstantly(interaction, ticketData);
                    break;

                case 'reset-tickets':
                    if (!interaction.member.roles.cache.has(config.adminRole)) {
                        return await interaction.reply({ content: '❌ Staff only!', ephemeral: true });
                    }

                    const data = db.read();
                    data.tickets = {};
                    db.write(data);

                    await interaction.reply({ content: '✅ Database reset!', ephemeral: true });
                    break;

                case 'ping':
                    const latency = Date.now() - interaction.createdTimestamp;
                    await interaction.reply({ 
                        content: `🏓 **PONG!** Latency: ${latency}ms | API: ${Math.round(client.ws.ping)}ms`,
                        ephemeral: true 
                    });
                    break;
            }
            return;
        }

        if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'ticket_type') {
                const selected = interaction.values[0];
                
                if (selected === 'robux') {
                    await createTicket(interaction, 'robux', `${EMOJIS.ROBUX} Buy Robux`);
                    return;
                }
                
                if (selected === 'limiteds' || selected === 'dahood') {
                    const serviceName = selected === 'limiteds' ? 'Limiteds' : 'Dahood Skins';
                    const serviceEmoji = selected === 'limiteds' ? EMOJIS.LIMITEDS : EMOJIS.DAHOOD;
                    
                    const buySellEmbed = new EmbedBuilder()
                        .setTitle(`${serviceEmoji} ${serviceName}`)
                        .setDescription(`Choose your transaction type:`)
                        .setColor(0x3498db)
                        .setTimestamp();

                    const row = new ActionRowBuilder()
                        .addComponents(
                            new StringSelectMenuBuilder()
                                .setCustomId(`buy_sell_${selected}`)
                                .setPlaceholder('💫 Select transaction type...')
                                .addOptions([
                                    {
                                        label: `Buy ${serviceName}`,
                                        description: `Purchase ${serviceName.toLowerCase()}`,
                                        value: `buy_${selected}`,
                                        emoji: selected === 'limiteds' ? EMOJIS.LIMITEDS.replace(/[<>]/g, '').split(':')[2] : EMOJIS.DAHOOD.replace(/[<>]/g, '').split(':')[2]
                                    },
                                    {
                                        label: `Sell ${serviceName}`,
                                        description: `Sell your ${serviceName.toLowerCase()}`,
                                        value: `sell_${selected}`,
                                        emoji: selected === 'limiteds' ? EMOJIS.LIMITEDS.replace(/[<>]/g, '').split(':')[2] : EMOJIS.DAHOOD.replace(/[<>]/g, '').split(':')[2]
                                    }
                                ])
                        );

                    await interaction.reply({ embeds: [buySellEmbed], components: [row], ephemeral: true });
                } else if (selected === 'services') {
                    await createTicket(interaction, 'services', `${EMOJIS.SERVICES} Buying Services`);
                }
            }

            if (interaction.customId.startsWith('buy_sell_')) {
                const [action, type] = interaction.values[0].split('_');
                const serviceName = type === 'limiteds' ? 'Limiteds' : 'Dahood Skins';
                const description = `${action === 'buy' ? 'Buying' : 'Selling'} ${serviceName}`;
                
                await createTicket(interaction, `${action}-${type}`, description);
            }

            if (interaction.customId === 'vouch_rating') {
                const rating = parseInt(interaction.values[0].split('_')[1]);
                vouchSessions.set(interaction.user.id, { rating });

                const modal = new ModalBuilder()
                    .setCustomId('vouch_comment_modal')
                    .setTitle('💬 Add Feedback (Optional)');

                const commentInput = new TextInputBuilder()
                    .setCustomId('vouch_comment')
                    .setLabel('Share your experience...')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setMaxLength(1000);

                modal.addComponents(new ActionRowBuilder().addComponents(commentInput));
                await interaction.showModal(modal);
            }
        }

        if (interaction.isModalSubmit() && interaction.customId === 'vouch_comment_modal') {
            const comment = interaction.fields.getTextInputValue('vouch_comment');
            const vouchData = vouchSessions.get(interaction.user.id);
            
            if (vouchData?.rating) {
                await sendVouchToChannel(interaction.user, vouchData.rating, 'Service', comment);
                vouchSessions.delete(interaction.user.id);

                const thankYouEmbed = new EmbedBuilder()
                    .setTitle('🎉 **Thank You!**')
                    .setDescription('Your feedback helps us improve!')
                    .setColor(0x27ae60)
                    .setTimestamp();

                await interaction.reply({ embeds: [thankYouEmbed], ephemeral: true });
            }
        }

        // ⚡ INSTANT CLOSE BUTTON - ANYONE CAN USE!
        if (interaction.isButton() && interaction.customId === 'instant_close') {
            const ticketData = await findTicketByChannel(interaction.channel.id);
            if (!ticketData) {
                return await interaction.reply({ content: '❌ Not a ticket!', ephemeral: true });
            }

            await interaction.deferUpdate();
            await closeTicketInstantly(interaction, ticketData);
        }

    } catch (error) {
        console.error('Interaction error:', error);
        try {
            await interaction.reply({ content: '❌ Error occurred!', ephemeral: true });
        } catch (e) {}
    }
});

// 🚀 LAUNCH
client.login(config.token).catch(error => {
    console.error('❌ Login failed:', error.message);
    process.exit(1);
});
