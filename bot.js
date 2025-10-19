// bot.js
// Production-ready Discord ticket + vouch bot with HTML transcripts
// Node 18+, discord.js v14+
// Set BOT_TOKEN in Railway env vars. Other IDs are prefilled but can be overridden with env vars.

const {
  Client, GatewayIntentBits, Partials, Collection, REST, Routes,
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, PermissionsBitField,
  AttachmentBuilder
} = require('discord.js');

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const http = require('http');

//////////////////////////
// --- Configuration ---//
//////////////////////////

const CFG = {
  token: process.env.BOT_TOKEN,
  guildId: process.env.GUILD_ID || '1406416544451399832',
  adminRole: process.env.ADMIN_ROLE || '1406420130044313772',
  ticketsChannel: process.env.TICKETS_CHANNEL || '1406418069181436017',
  vouchChannel: process.env.VOUCH_CHANNEL || '1429250208016896040',
  transcriptChannel: process.env.TRANSCRIPT_CHANNEL || '1406761652510134294', // fixed per user
  dbFile: process.env.DB_FILE || path.join(__dirname, 'tickets.json'),
  antiScamIntervalMin: parseInt(process.env.ANTI_SCAM_MINUTES || '50', 10),
  port: parseInt(process.env.PORT || process.env.RAILWAY_PORT || '3000', 10),
  presence: process.env.PRESENCE || 'discord.gg/romel',
  appName: process.env.APP_NAME || "Romel's Stock"
};

// Validate critical envs
if (!CFG.token) {
  console.error('❌ CRITICAL: BOT_TOKEN environment variable is missing! Set BOT_TOKEN in Railway env vars.');
  process.exit(1);
}

/////////////////////////
// --- Utilities ----- //
/////////////////////////

// Ensure transcripts directory exists
const TRANSCRIPTS_DIR = path.join(__dirname, 'transcripts');
if (!fsSync.existsSync(TRANSCRIPTS_DIR)) {
  fsSync.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
}

// Simple async JSON DB with a write-queue to avoid races
class JsonDB {
  constructor(filePath) {
    this.filePath = filePath;
    this.queue = Promise.resolve();
  }

  async ensureFile() {
    try {
      await fs.access(this.filePath);
    } catch {
      await fs.writeFile(this.filePath, JSON.stringify({ tickets: {}, counter: 0 }, null, 2));
    }
  }

  async _read() {
    await this.ensureFile();
    const raw = await fs.readFile(this.filePath, 'utf8');
    return JSON.parse(raw || '{}');
  }

  async read() {
    // ensure we chain reads/writes so data stays consistent
    this.queue = this.queue.then(() => this._read());
    return this.queue;
  }

  async write(data) {
    this.queue = this.queue.then(async () => {
      await fs.writeFile(this.filePath, JSON.stringify(data, null, 2));
    }).catch(err => console.error('DB write error:', err));
    return this.queue;
  }

  async get(key) {
    const data = await this.read();
    if (!key) return data;
    return key.split('.').reduce((o,k)=>o?.[k], data);
  }

  async set(key, value) {
    const data = await this.read();
    const parts = key.split('.');
    let cur = data;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]]) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
    await this.write(data);
  }
}

const db = new JsonDB(CFG.dbFile);

// emoji constants (preserve yours)
const EMOJIS = {
  LIMITEDS: '<:lim:1429231822646018149>',
  DAHOOD: '<:dh:1429232221683712070>',
  SERVICES: '<:discord:1429232874338652260>',
  CHECKMARK: '<:checkmark:1406769918866620416>'
};

////////////////////////////
// --- Discord Client ---- //
////////////////////////////

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message]
});

client.commands = new Collection();
const vouchSessions = new Map();
let antiScamMeta = { messageId: null, channelId: null };

/////////////////////////////
// --- Slash Commands ----- //
/////////////////////////////

const slashCommands = [
  {
    name: 'setup-tickets',
    description: 'Create the ticket panel (Admin only)'
  },
  {
    name: 'reset-tickets',
    description: 'Reset all ticket data (Staff only)'
  },
  {
    name: 'ping',
    description: 'Check bot latency'
  }
];

// helper: register slash commands (guild if available)
async function registerSlashCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(CFG.token);
    console.log('🔄 Registering slash commands...');
    if (CFG.guildId) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, CFG.guildId), { body: slashCommands });
      console.log('✅ Registered guild slash commands.');
    } else {
      await rest.put(Routes.applicationCommands(client.user.id), { body: slashCommands });
      console.log('✅ Registered global slash commands (may take 1 hour to propagate).');
    }
  } catch (err) {
    console.error('Failed to register slash commands:', err);
  }
}

/////////////////////////////
// --- Anti-scam Banner ---//
/////////////////////////////

async function sendAntiScamMessage() {
  try {
    if (!CFG.ticketsChannel) return;
    const ch = await client.channels.fetch(CFG.ticketsChannel).catch(()=>null);
    if (!ch || !ch.isTextBased?.()) return;

    // remove previous if exists
    if (antiScamMeta.messageId && antiScamMeta.channelId === CFG.ticketsChannel) {
      try {
        const old = await ch.messages.fetch(antiScamMeta.messageId);
        if (old) await old.delete().catch(()=>{});
      } catch {}
    }

    const scamEmbed = new EmbedBuilder()
      .setTitle('🚨 SECURITY NOTICE')
      .setDescription('**Staff will __NEVER DM YOU__ after you create a ticket.**\n\nDo not trust anyone claiming they can "see" your ticket — only staff in the ticket channel can assist you.')
      .setColor(0xFF0000)
      .setTimestamp()
      .setFooter({ text: `${CFG.appName} • Security System` });

    const msg = await ch.send({ embeds: [scamEmbed] });
    antiScamMeta = { messageId: msg.id, channelId: CFG.ticketsChannel };
    console.log('Anti-scam posted');
  } catch (err) {
    console.error('sendAntiScamMessage error:', err);
  }
}

function startAntiScamRotation() {
  sendAntiScamMessage();
  setInterval(sendAntiScamMessage, CFG.antiScamIntervalMin * 60 * 1000);
}

/////////////////////////////
// --- Ticket Creation ----//
/////////////////////////////

async function createTicket(interaction, type, description) {
  try {
    const guild = interaction.guild;
    const member = interaction.member;

    // prevent multiple open tickets
    const userTickets = await db.get(`tickets.${member.id}`) || [];
    const openTicket = userTickets.find(t=>t.open);
    if (openTicket) {
      const already = new EmbedBuilder()
        .setTitle('🎫 Active Ticket Found')
        .setDescription('You already have an open ticket. Close it before opening a new one.')
        .setColor(0xe74c3c)
        .setTimestamp();
      return interaction.reply({ embeds: [already], ephemeral: true });
    }

    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('⚡ Creating your ticket...').setColor(0x3498db)], ephemeral: true });

    // increment counter and create channel
    const counter = (await db.get('counter')) || 0;
    const ticketNumber = counter + 1;

    const perms = [
      { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: member.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
      { id: CFG.adminRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
    ];

    const channel = await guild.channels.create({
      name: `ticket-${ticketNumber}`,
      type: ChannelType.GuildText,
      permissionOverwrites: perms
    });

    // save ticket in DB
    const ticketData = {
      channelId: channel.id,
      userId: member.id,
      userTag: member.user.tag,
      type,
      description,
      open: true,
      createdAt: new Date().toISOString(),
      number: ticketNumber
    };

    const current = await db.get(`tickets.${member.id}`) || [];
    current.push(ticketData);
    await db.set(`tickets.${member.id}`, current);
    await db.set('counter', ticketNumber);

    // send initial embed + close button
    const ticketEmbed = new EmbedBuilder()
      .setTitle(`🎫 Ticket #${ticketNumber}`)
      .setDescription(`Welcome ${member}! Our staff will be with you shortly.\n\n**Service:** ${description}\n**Created:** <t:${Math.floor(Date.now()/1000)}:R>`)
      .addFields(
        { name: '📋 Getting Started', value: 'Please give details and any attachments.' },
        { name: '🚨 Security', value: 'Staff will NEVER DM you first. Report suspicious users.' }
      )
      .setColor(0x3498db)
      .setFooter({ text: `${CFG.appName} • Premium Support` })
      .setTimestamp();

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒')
      );

    await channel.send({ content: `<@&${CFG.adminRole}> ${member}`, embeds: [ticketEmbed], components: [row] });

    // confirm creation to user
    const success = new EmbedBuilder()
      .setTitle(`${EMOJIS.CHECKMARK} Ticket Created`)
      .setDescription(`Your ticket has been created: ${channel}\n**Service:** ${description}`)
      .setColor(0x27ae60)
      .setTimestamp();

    await interaction.editReply({ embeds: [success] });

  } catch (err) {
    console.error('createTicket error:', err);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: '❌ Failed to create ticket. Try again later.' });
      } else {
        await interaction.reply({ content: '❌ Failed to create ticket. Try again later.', ephemeral: true });
      }
    } catch {}
  }
}

/////////////////////////////
// --- Vouch Flow ---------//
/////////////////////////////

async function sendVouchRequest(user, ticketDescription, staffMemberTag) {
  try {
    const vouchEmbed = new EmbedBuilder()
      .setTitle('🌟 Rate Your Experience')
      .setDescription(`Thanks for using **${CFG.appName}** for **${ticketDescription}**`)
      .addFields(
        { name: 'Service', value: `${ticketDescription}`, inline: true },
        { name: 'Handled by', value: `${staffMemberTag || 'Support Team'}`, inline: true }
      )
      .setColor(0x9B59B6)
      .setTimestamp();

    const vouchMenu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('vouch_rating')
        .setPlaceholder('Select rating...')
        .addOptions([
          { label: '5 - Outstanding', value: 'vouch_5', description: 'Perfect service' , emoji: '⭐' },
          { label: '4 - Great', value: 'vouch_4', description: 'Very good' , emoji: '⭐' },
          { label: '3 - Good', value: 'vouch_3', description: 'Satisfactory' , emoji: '⭐' },
          { label: '2 - Fair', value: 'vouch_2', description: 'Could improve' , emoji: '⭐' },
          { label: '1 - Poor', value: 'vouch_1', description: 'Needs work' , emoji: '⭐' }
        ])
    );

    await user.send({ embeds: [vouchEmbed], components: [vouchMenu] });
    return true;
  } catch (err) {
    console.log('sendVouchRequest failed:', err);
    return false;
  }
}

async function postVouchToChannel(user, rating, ticketDescription, comment='') {
  try {
    if (!CFG.vouchChannel) return false;
    const ch = await client.channels.fetch(CFG.vouchChannel).catch(()=>null);
    if (!ch || !ch.isTextBased?.()) return false;

    const stars = '⭐'.repeat(rating) + '☆'.repeat(5-rating);
    const color = rating === 5 ? 0x27ae60 : rating ===4 ? 0x2ecc71 : rating===3 ? 0xf39c12 : rating===2 ? 0xe67e22 : 0xe74c3c;

    const embed = new EmbedBuilder()
      .setTitle('📝 Customer Review')
      .setDescription(`**Rating:** ${rating}/5 ${stars}\n**Service:** ${ticketDescription}`)
      .addFields(
        { name: 'Reviewer', value: `${user.tag}`, inline: true },
        { name: 'User ID', value: `\`${user.id}\``, inline: true },
        { name: 'Time', value: `<t:${Math.floor(Date.now()/1000)}:f>`, inline: true }
      )
      .setColor(color)
      .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
      .setTimestamp();

    if (comment && comment.trim()) embed.addFields({ name: 'Comment', value: comment });

    await ch.send({ embeds: [embed] });
    return true;
  } catch (err) {
    console.error('postVouchToChannel error:', err);
    return false;
  }
}

/////////////////////////////
// --- Transcript maker ---//
/////////////////////////////

async function generateHtmlTranscript(channel) {
  try {
    // fetch messages (up to 5000 by paging) - but Discord has limits, we page until exhausted
    const messages = [];
    let lastId;
    while (true) {
      const opts = { limit: 100 };
      if (lastId) opts.before = lastId;
      const batch = await channel.messages.fetch(opts);
      if (!batch.size) break;
      for (const msg of batch.values()) messages.push(msg);
      lastId = batch.last().id;
      if (batch.size < 100) break;
      if (messages.length >= 5000) break;
    }

    // messages are in reverse order (newest first), reverse them
    messages.reverse();

    // Build simple HTML
    const htmlParts = [];
    htmlParts.push(`<!doctype html><html><head><meta charset="utf-8"><title>Transcript - ${channel.name}</title>`);
    htmlParts.push(`<style>body{font-family:Arial,Helvetica,sans-serif;background:#0f1720;color:#e6eef6;padding:20px} .msg{padding:8px;border-bottom:1px solid #19202a} .meta{font-size:12px;color:#9aa6b2} .content{margin-top:4px}</style>`);
    htmlParts.push(`</head><body>`);
    htmlParts.push(`<h2>Transcript for #${channel.name}</h2>`);
    htmlParts.push(`<p>Generated: ${new Date().toISOString()}</p>`);
    htmlParts.push(`<hr/>`);

    for (const m of messages) {
      const time = new Date(m.createdTimestamp).toISOString();
      const author = `${m.author.tag}`;
      const content = m.content ? escapeHtml(m.content) : '';
      let attachmentsHtml = '';
      if (m.attachments && m.attachments.size) {
        for (const att of m.attachments.values()) {
          attachmentsHtml += `<div><a href="${att.url}" target="_blank">${escapeHtml(att.name || att.id)}</a></div>`;
        }
      }
      htmlParts.push(`<div class="msg"><div class="meta">${escapeHtml(author)} • ${time}</div><div class="content">${content}${attachmentsHtml}</div></div>`);
    }

    htmlParts.push('</body></html>');
    const html = htmlParts.join('');
    const fileName = `transcript-${channel.name}-${Date.now()}.html`;
    const filePath = path.join(TRANSCRIPTS_DIR, fileName);
    await fs.writeFile(filePath, html, 'utf8');
    return { filePath, fileName };
  } catch (err) {
    console.error('generateHtmlTranscript error:', err);
    throw err;
  }
}

function escapeHtml(unsafe) {
  return unsafe
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/////////////////////////////
// --- Interaction logic -- //
/////////////////////////////

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;
      if (name === 'setup-tickets') {
        // check admin
        const member = interaction.member;
        if (!member.roles?.cache?.has(CFG.adminRole) && !member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.reply({ content: '❌ You need administrator permissions to use this command.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
          .setTitle(`${EMOJIS.LIMITEDS} Romels Tickets`)
          .setDescription(`**Open a ticket to purchase our stock.**\n\n${EMOJIS.CHECKMARK} **Check our current stock before opening a ticket.**`)
          .setColor(0x3498db)
          .setFooter({ text: `${CFG.appName} • Quality Service` })
          .setTimestamp();

        const menu = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('ticket_type')
            .setPlaceholder('🎫 Choose a service...')
            .addOptions([
              { label: 'Limiteds', description: 'Buy or sell Limited items', value: 'limiteds', emoji: EMOJIS.LIMITEDS.replace(/[<>]/g, '').split(':')[2] },
              { label: 'Dahood Skins', description: 'Buy or sell Dahood skins', value: 'dahood', emoji: EMOJIS.DAHOOD.replace(/[<>]/g, '').split(':')[2] },
              { label: 'Buying Services', description: 'Professional buying services', value: 'services', emoji: EMOJIS.SERVICES.replace(/[<>]/g, '').split(':')[2] }
            ])
        );

        await interaction.reply({ content: '✅ Ticket panel created!', ephemeral: true });
        const dest = await interaction.channel;
        await dest.send({ embeds: [embed], components: [menu] });
        return;
      }

      if (name === 'reset-tickets') {
        const member = interaction.member;
        if (!member.roles?.cache?.has(CFG.adminRole) && !member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.reply({ content: '❌ Staff role required.', ephemeral: true });
        }
        const data = await db.get();
        data.tickets = {};
        data.counter = 0;
        await db.write(data);
        return interaction.reply({ content: '✅ All ticket data reset.', ephemeral: true });
      }

      if (name === 'ping') {
        const latency = Date.now() - interaction.createdTimestamp;
        return interaction.reply({ content: `🏓 Pong! Latency: ${latency}ms | WS: ${Math.round(client.ws.ping)}ms`, ephemeral: true });
      }
      return;
    }

    // Handle select menus and buttons
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'ticket_type') {
        const choice = interaction.values[0];
        if (choice === 'limiteds' || choice === 'dahood') {
          const label = choice === 'limiteds' ? 'Limiteds' : 'Dahood Skins';
          const select = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`buy_sell_${choice}`)
              .setPlaceholder('Select transaction...')
              .addOptions([
                { label: `Buy ${label}`, description: `Purchase ${label}`, value: `buy_${choice}`, emoji: choice === 'limiteds' ? EMOJIS.LIMITEDS.replace(/[<>]/g, '').split(':')[2] : EMOJIS.DAHOOD.replace(/[<>]/g, '').split(':')[2] },
                { label: `Sell ${label}`, description: `Sell ${label}`, value: `sell_${choice}`, emoji: choice === 'limiteds' ? EMOJIS.LIMITEDS.replace(/[<>]/g, '').split(':')[2] : EMOJIS.DAHOOD.replace(/[<>]/g, '').split(':')[2] }
              ])
          );
          return interaction.reply({ embeds: [new EmbedBuilder().setTitle(`${choice}`).setDescription('Choose buy or sell').setColor(0x3498db)], components: [select], ephemeral: true });
        } else if (choice === 'services') {
          return createTicket(interaction, 'services', `${EMOJIS.SERVICES} Buying Services`);
        }
      }

      if (interaction.customId.startsWith('buy_sell_')) {
        const val = interaction.values[0];
        const parts = val.split('_'); // e.g., buy_limiteds
        const action = parts[0] === 'buy' ? 'Buying' : 'Selling';
        const type = parts[1] === 'limiteds' ? 'Limiteds' : 'Dahood Skins';
        return createTicket(interaction, `${action.toLowerCase()}-${type.toLowerCase()}`, `${action} ${type}`);
      }

      if (interaction.customId === 'vouch_rating') {
        const rating = parseInt(interaction.values[0].split('_')[1]);
        vouchSessions.set(interaction.user.id, { rating });
        const modal = new ModalBuilder().setCustomId('vouch_comment_modal').setTitle('Add optional feedback');
        const input = new TextInputBuilder().setCustomId('vouch_comment').setLabel('Comment').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000).setPlaceholder('Optional comment...');
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'vouch_comment_modal') {
        const comment = interaction.fields.getTextInputValue('vouch_comment');
        const session = vouchSessions.get(interaction.user.id);
        if (session && session.rating) {
          await postVouchToChannel(interaction.user, session.rating, 'Service', comment);
          vouchSessions.delete(interaction.user.id);
          return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🎉 Thanks!').setDescription('Feedback recorded.').setColor(0x27ae60)], ephemeral: true });
        } else {
          return interaction.reply({ content: '❌ Could not save rating.', ephemeral: true });
        }
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'close_ticket') {
        // show confirm buttons
        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('confirm_close').setLabel('Confirm Close').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('cancel_close').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
        );
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🔒 Close Ticket').setDescription('Are you sure you want to close this ticket?').setColor(0xe74c3c)], components: [confirmRow], ephemeral: true });
      }

      if (interaction.customId === 'cancel_close') {
        return interaction.update({ content: '✅ Ticket closure cancelled.', components: [], embeds: [] });
      }

      if (interaction.customId === 'confirm_close') {
        await interaction.deferUpdate();
        const channel = interaction.channel;
        // find the ticket owner from DB (search tickets for channelId)
        const data = await db.get();
        let ticketOwnerId = null;
        for (const [uid, arr] of Object.entries(data.tickets || {})) {
          for (const t of arr) {
            if (t.channelId === channel.id && t.open) {
              ticketOwnerId = t.userId;
              t.open = false;
              t.closedAt = new Date().toISOString();
              // update DB for this user
              await db.set(`tickets.${uid}`, arr);
              break;
            }
          }
          if (ticketOwnerId) break;
        }

        // send vouch request if found
        if (ticketOwnerId) {
          const member = await channel.guild.members.fetch(ticketOwnerId).catch(()=>null);
          if (member) {
            await sendVouchRequest(member.user, 'Service', interaction.user.tag).catch(()=>{});
          }
        }

        // generate transcript and post
        try {
          const { filePath, fileName } = await generateHtmlTranscript(channel);
          const transcriptCh = await client.channels.fetch(CFG.transcriptChannel).catch(()=>null);
          if (transcriptCh && transcriptCh.isTextBased?.()) {
            const file = new AttachmentBuilder(filePath, { name: fileName });
            const embed = new EmbedBuilder()
              .setTitle('📜 Ticket Transcript')
              .setDescription(`Transcript for ${channel.name}`)
              .addFields({ name: 'Closed by', value: `${interaction.user.tag}`, inline: true }, { name: 'Channel', value: `${channel.name}`, inline: true })
              .setTimestamp()
              .setFooter({ text: CFG.appName });
            await transcriptCh.send({ embeds: [embed], files: [file] });
          } else {
            console.warn('Transcript channel not found or not text channel');
          }
          // remove local file after posting
          try { await fs.unlink(filePath); } catch {}
        } catch (err) {
          console.error('Transcript generation failed:', err);
        }

        // Inform and delete channel after short delay
        await channel.send({ embeds: [new EmbedBuilder().setTitle('🎉 Ticket Closed').setDescription(`Closed by ${interaction.user}`).setColor(0x95a5a6)] });
        setTimeout(async () => {
          try { await channel.delete(); } catch (err) { console.error('Failed to delete channel:', err); }
        }, 3000);
        return;
      }
    }

  } catch (err) {
    console.error('interactionCreate error:', err);
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ content: '❌ An error occurred.', embeds: [] });
      } else {
        await interaction.reply({ content: '❌ An error occurred.', ephemeral: true });
      }
    } catch {}
  }
});

/////////////////////////////
// --- Ready / Login ----- //
/////////////////////////////

client.once('ready', async () => {
  console.log(`✅ ${client.user.tag} is online!`);
  client.user.setPresence({ activities: [{ name: CFG.presence, type: 3 }], status: 'online' });

  // register commands
  await registerSlashCommands().catch(()=>{});

  // start anti-scam rotation if configured
  if (CFG.ticketsChannel) startAntiScamRotation();

  console.log('Bot ready and configured:');
  console.log(`Guild: ${CFG.guildId}`);
  console.log(`Admin role: ${CFG.adminRole}`);
  console.log(`Tickets channel: ${CFG.ticketsChannel}`);
  console.log(`Vouch channel: ${CFG.vouchChannel}`);
  console.log(`Transcript channel: ${CFG.transcriptChannel}`);
});

// small HTTP server for Railway healthchecks
http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('OK');
  }
  res.writeHead(404);
  res.end();
}).listen(CFG.port, () => console.log(`Health endpoint listening on port ${CFG.port}`));

client.login(CFG.token).catch(err => {
  console.error('Failed to login:', err);
  process.exit(1);
});
