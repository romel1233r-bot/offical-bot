const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ChannelType, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, SlashCommandBuilder, REST, Routes, PermissionsBitField, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// 🚀 ULTRA-FAST SETUP - No delays!
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
        
        for (let i = 0; i < keys.length - 1; i++) {
            if (!obj[keys[i]]) obj[keys[i]] = {};
            obj = obj[keys[i]];
        }
        
        obj[keys[keys.length - 1]] = value;
        this.write(data);
    }
}

const db = new SpeedDB();

// 🎯 CONFIG
const config = {
    token: process.env.BOT_TOKEN,
    guildId: '1406416544451399832',
    adminRole: '1406420130044313772',
    ticketsChannel: '1406418069181436017',
    vouchChannel: '1429250208016896040',
    transcriptsChannel: '1406761652510134294'
};

// 🚀 VALIDATE & LAUNCH
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

// 🎨 SEXY EMOJIS
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
    TICKET: '🎫'
};

const vouchSessions = new Map();
let antiScamMessageId = null;

// ⚡ LIGHTNING COMMANDS
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
        .setDescription('⚡ Instantly close ticket (Staff only)'),
    
    new SlashCommandBuilder()
        .setName('force-close')
        .setDescription('💥 Force close ticket (Admin only)')
].map(command => command.toJSON());

// 🚀 ULTRA-FAST COMMAND REGISTRATION
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

// 🎨 SEXY TRANSCRIPT GENERATOR
async function generateTranscript(messages, ticketData) {
    const transcript = messages.reverse().map(msg => {
        const time = new Date(msg.createdTimestamp).toLocaleString();
        const attachments = msg.attachments.size > 0 ? `\n[${msg.attachments.size} attachment(s)]` : '';
        return `[${time}] ${msg.author.tag}: ${msg.content}${attachments}`;
    }).join('\n');

    return `🎫 TICKET TRANSCRIPT #${ticketData.number}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 USER: ${ticketData.userTag} (${ticketData.userId})
🎯 SERVICE: ${ticketData.description}
🕒 CREATED: ${new Date(ticketData.createdAt).toLocaleString()}
🔒 CLOSED: ${new Date().toLocaleString()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${transcript}`;
}

// ⚡ INSTANT TICKET CLOSER
async function closeTicketInstantly(interaction, ticketData) {
    try {
        const channel = interaction.channel;
        
        // 🚀 ULTRA-FAST MESSAGE FETCH
        const messages = await channel.messages.fetch({ limit: 100 });
        
        // ⚡ INSTANT TRANSCRIPT
        const transcript = await generateTranscript([...messages.values()], ticketData);
        const transcriptBuffer = Buffer.from(transcript, 'utf8');
        const attachment = new AttachmentBuilder(transcriptBuffer, { name: `ticket-${ticketData.number}.txt` });

        // 🎯 SEND TRANSCRIPT & VOUCH IN PARALLEL (NO WAITING!)
        const promises = [];

        // Send transcript
        promises.push(
            client.channels.fetch(config.transcriptsChannel).then(transcriptsChannel => {
                if (transcriptsChannel) {
                    return transcriptsChannel.send({
                        content: `📄 **Instant Transcript** - Ticket #${ticketData.number}`,
                        files: [attachment]
                    });
                }
            }).catch(() => {})
        );

        // Send vouch request
        promises.push(
            client.users.fetch(ticketData.userId).then(user => {
                if (user) {
                    return sendVouchRequest(user, ticketData.description, interaction.user.tag);
                }
            }).catch(() => {})
        );

        // 🗄️ UPDATE DATABASE INSTANTLY
        const userTickets = await db.get(`tickets.${ticketData.userId}`) || [];
        const updatedTickets = userTickets.map(ticket => 
            ticket.channelId === channel.id ? { ...ticket, open: false, closedAt: new Date().toISOString() } : ticket
        );
        await db.set(`tickets.${ticketData.userId}`, updatedTickets);

        // 🎨 SEXY CLOSING EMBED
        const closingEmbed = new EmbedBuilder()
            .setTitle('⚡ **TICKET CLOSED**')
            .setDescription(`**Closed by:** ${interaction.user}\n**Ticket:** #${ticketData.number}\n**Service:** ${ticketData.description}`)
            .addFields(
                { name: `${EMOJIS.LIGHTNING} Speed`, value: '• Instant closure\n• Transcript saved\n• Feedback sent', inline: true },
                { name: `${EMOJIS.CHECKMARK} Status`, value: '• Completed\n• Archived\n• Processed', inline: true }
            )
            .setColor(0x00FF00)
            .setThumbnail('https://media.discordapp.net/attachments/1429234159674593352/1429235801782489160/romels_stock_banner1.png')
            .setFooter({ text: 'Romel\'s Stock • Lightning Fast Service' })
            .setTimestamp();

        await channel.send({ embeds: [closingEmbed] });

        // 💥 INSTANT CHANNEL DELETE (NO DELAY!)
        setTimeout(async () => {
            try {
                await channel.delete();
                console.log(`⚡ Ticket channel ${channel.name} deleted instantly`);
            } catch (error) {
                console.log('Channel deletion error:', error);
            }
        }, 1000); // 🚀 REDUCED TO 1 SECOND!

        // 🎯 WAIT FOR PROMISES
        await Promise.allSettled(promises);

    } catch (error) {
        console.error('Instant close error:', error);
        throw error;
    }
}

// 🎯 FIND TICKET - LIGHTNING FAST
async function findTicketByChannel(channelId) {
    try {
        const data = db.read();
        for (const userId in data.tickets) {
            const ticket = data.tickets[userId].find(t => t.channelId === channelId && t.open);
            if (ticket) return ticket;
        }
        return null;
    } catch (error) {
        console.error('Ticket find error:', error);
        return null;
    }
}

// 🚀 BOT READY - ULTRA FAST
client.once('ready', async () => {
    console.log(`⚡ ${client.user.tag} is ONLINE! Ready to dominate!`);
    
    client.user.setPresence({
        activities: [{ name: 'discord.gg/romel | ⚡ LIGHTNING FAST', type: 3 }],
        status: 'online'
    });

    await registerSlashCommands();
    console.log('✅ Bot is fully operational!');
});

// 🎨 SEXY TICKET CREATION
async function createTicket(interaction, type, description) {
    try {
        const guild = interaction.guild;
        const member = interaction.member;

        // 🚀 INSTANT DUPLICATE CHECK
        const userTickets = await db.get(`tickets.${member.id}`) || [];
        const openTicket = userTickets.find(ticket => ticket.open);
        
        if (openTicket) {
            const errorEmbed = new EmbedBuilder()
                .setTitle('🚫 Active Ticket Found')
                .setDescription('You already have an open ticket! Close it first to create a new one.')
                .setColor(0xFF4444)
                .setFooter({ text: 'Romel\'s Stock • One Ticket at a Time' })
                .setTimestamp();

            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }

        await interaction.reply({ 
            content: `${EMOJIS.LIGHTNING} **Creating your ticket...**`, 
            ephemeral: true 
        });

        // ⚡ INSTANT TICKET CREATION
        const ticketNumber = (await db.get('counter') || 0) + 1;
        const ticketChannel = await guild.channels.create({
            name: `ticket-${ticketNumber}`,
            type: ChannelType.GuildText,
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: member.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
                { id: config.adminRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
                { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageChannels] }
            ]
        });

        // 💾 INSTANT DATA SAVE
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

        // 🎨 SEXY TICKET EMBED
        const ticketEmbed = new EmbedBuilder()
            .setTitle(`${EMOJIS.TICKET} **TICKET #${ticketNumber}**`)
            .setDescription(`Welcome to your **premium support channel**!`)
            .addFields(
                { name: `${EMOJIS.CHECKMARK} Client`, value: `${member}`, inline: true },
                { name: `${EMOJIS.MONEY} Service`, value: `${description}`, inline: true },
                { name: `${EMOJIS.LIGHTNING} Created`, value: `<t:${Math.floor(Date.now()/1000)}:R>`, inline: true }
            )
            .addFields(
                { name: '🚀 Getting Started', value: 'Provide details about what you need. Our team will assist you shortly.' },
                { name: '🔒 Security Notice', value: 'Staff will **NEVER** DM you first. Only trust messages in this ticket.' }
            )
            .setColor(0x5865F2)
            .setThumbnail('https://media.discordapp.net/attachments/1429234159674593352/1429235801782489160/romels_stock_banner1.png')
            .setFooter({ text: 'Romel\'s Stock • Lightning Fast Support' })
            .setTimestamp();

        const ticketButtons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('instant_close')
                    .setLabel('⚡ INSTANT CLOSE')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('⚡')
            );

        await ticketChannel.send({ 
            content: `${member} <@&${config.adminRole}> ${EMOJIS.LIGHTNING}`, 
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

// 🎯 VOUCH SYSTEM - OPTIMIZED
async function sendVouchRequest(user, ticketDescription, staffMember) {
    try {
        const vouchEmbed = new EmbedBuilder()
            .setTitle('🌟 **Rate Your Experience**')
            .setDescription(`Thank you for choosing **Romel's Stock**!\n\nYour feedback helps us maintain **lightning-fast service**.`)
            .addFields(
                { name: '📊 Service Summary', value: `**Service:** ${ticketDescription}\n**Staff:** ${staffMember}\n**Completed:** <t:${Math.floor(Date.now()/1000)}:R>` },
                { name: '⭐ Your Rating', value: 'Select your rating below!' }
            )
            .setColor(0x9B59B6)
            .setThumbnail('https://media.discordapp.net/attachments/1429234159674593352/1429235801782489160/romels_stock_banner1.png')
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
                { name: '🆔 User ID', value: `\`${user.id}\``, inline: true },
                { name: '🕒 Review Time', value: `<t:${Math.floor(Date.now()/1000)}:f>`, inline: true }
            )
            .setColor(ratingColor)
            .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
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

// ⚡ LIGHTNING INTERACTION HANDLER
client.on('interactionCreate', async (interaction) => {
    try {
        // 🎯 SLASH COMMANDS
        if (interaction.isChatInputCommand()) {
            switch (interaction.commandName) {
                case 'setup-tickets':
                    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                        return await interaction.reply({ content: '❌ Admin only!', ephemeral: true });
                    }

                    // 🎨 SEXY PANEL EMBED
                    const embed = new EmbedBuilder()
                        .setTitle(`${EMOJIS.LIGHTNING} **ROMEL'S STOCK** ${EMOJIS.MONEY}`)
                        .setDescription(`**Professional trading & services**\n\n${EMOJIS.CHECKMARK} **Check stock before opening tickets**\n${EMOJIS.LIGHTNING} **Lightning-fast support**\n${EMOJIS.STAR} **Premium service guaranteed**`)
                        .setColor(0x5865F2)
                        .setImage('https://media.discordapp.net/attachments/1429234159674593352/1429235801782489160/romels_stock_banner1.png')
                        .setFooter({ text: 'Romel\'s Stock • Elite Trading Services', iconURL: client.user.displayAvatarURL() })
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
                case 'force-close':
                    if (!interaction.member.roles.cache.has(config.adminRole)) {
                        return await interaction.reply({ content: '❌ Staff only!', ephemeral: true });
                    }

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
                        content: `🏓 **PONG!** Latency: ${latency}ms | API: ${Math.round(client.ws.ping)}ms ${EMOJIS.LIGHTNING}`,
                        ephemeral: true 
                    });
                    break;
            }
            return;
        }

        // 🎯 SELECT MENUS
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

            // BUY/SELL SELECTION
            if (interaction.customId.startsWith('buy_sell_')) {
                const [action, type] = interaction.values[0].split('_');
                const serviceName = type === 'limiteds' ? 'Limiteds' : 'Dahood Skins';
                const description = `${action === 'buy' ? 'Buying' : 'Selling'} ${serviceName}`;
                
                await createTicket(interaction, `${action}-${type}`, description);
            }

            // VOUCH RATING
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

        // 🎯 MODAL SUBMITS
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

        // ⚡ INSTANT CLOSE BUTTON
        if (interaction.isButton() && interaction.customId === 'instant_close') {
            const ticketData = await findTicketByChannel(interaction.channel.id);
            if (!ticketData) {
                return await interaction.reply({ content: '❌ Ticket data missing!', ephemeral: true });
            }

            if (!interaction.member.roles.cache.has(config.adminRole)) {
                return await interaction.reply({ content: '❌ Staff only!', ephemeral: true });
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

// 🚀 LAUNCH THE BEAST
client.login(config.token).catch(error => {
    console.error('❌ Login failed:', error.message);
    process.exit(1);
});
