const { Client, GatewayIntentBits, PermissionsBitField, Collection } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ]
});

// Collections for data storage
const customResponses = new Collection();
const userWarnings = new Map();
const reminders = new Map();
const selfAssignableRoles = new Set();

let logChannel = null;

// CHECK IF BOT HAS PERMISSION IN CHANNEL
function hasPermission(channel, permission) {
  return channel.permissionsFor(client.user)?.has(permission) || false;
}

client.once('ready', async () => {
  console.log(`✅ Bot is online as ${client.user.tag}!`);
  
  // Find log channel
  logChannel = client.channels.cache.find(channel => 
    channel.name === 'bot-log' || channel.name === 'bot_log'
  );
  
  if (!logChannel) {
    logChannel = client.channels.cache.get('1438130803983913162'); // Your channel ID
  }
  
  if (logChannel) {
    console.log(`📝 Found log channel: #${logChannel.name}`);
    
    if (!hasPermission(logChannel, PermissionsBitField.Flags.SendMessages)) {
      console.log('❌ Bot cannot send messages in log channel');
      return;
    }
    
    logToChannel('🤖 Bot started and ready!');
    await setupWelcomeChannel();
    await setupAnnouncementsChannel();
    await setupInfoChannels();
    await setupRulesChannel();
    await setupReportsChannel();
  } else {
    console.log('❌ Could not find bot-log channel');
  }
});

// FUNCTION TO LOG TO BOT_LOG CHANNEL
function logToChannel(content) {
  if (!logChannel) {
    console.log('❌ Log channel not found');
    return;
  }
  
  if (!logChannel.permissionsFor(client.user)?.has(PermissionsBitField.Flags.SendMessages)) {
    console.log('❌ Bot missing Send Messages permission in log channel');
    return;
  }
  
  try {
    if (typeof content === 'string') {
      logChannel.send(`\`[${new Date().toLocaleTimeString()}]\` ${content}`)
        .catch(error => {
          console.log('❌ Failed to send log:', error.message);
        });
    } else {
      logChannel.send(content)
        .catch(error => {
          console.log('❌ Failed to send log embed:', error.message);
        });
    }
  } catch (error) {
    console.log('❌ Log channel error:', error.message);
  }
}

// FUNCTION TO LOG BOT RESPONSES
function logBotResponse(originalMessage, botResponse, action = 'Response') {
  logToChannel(`**${action}** in ${originalMessage.channel}\n**User:** ${originalMessage.author.tag} | **Content:** ${originalMessage.content}\n**Bot:** ${botResponse}`);
}

// WELCOME CHANNEL SETUP
async function setupWelcomeChannel() {
  const guild = client.guilds.cache.first();
  if (!guild) return;

  try {
    const welcomeChannel = guild.channels.cache.find(ch => 
      ch.name === 'welcome' || ch.name.includes('welcome')
    );
    
    if (welcomeChannel) {
      const permissions = welcomeChannel.permissionsFor(client.user);
      if (permissions?.has(PermissionsBitField.Flags.SendMessages)) {
        const messages = await welcomeChannel.messages.fetch({ limit: 5 });
        if (messages.size === 0) {
          const welcomeEmbed = {
            color: 0x00ff00,
            title: '👋 Welcome to Our Server!',
            description: `Welcome to **${guild.name}**! We're excited to have you here.`,
            thumbnail: { url: guild.iconURL({ dynamic: true, size: 512 }) },
            fields: [
              {
                name: '🚀 Getting Started',
                value: '1. Read the rules in <#rules>\n2. Check server info in <#server-info>\n3. Introduce yourself\n4. Get roles using `!roles` command\n5. Have fun and be active!',
                inline: false
              },
              {
                name: '📋 Important Channels',
                value: '• <#rules> - Server rules and guidelines\n• <#announcements> - Important updates\n• <#server-info> - Server information\n• <#general> - Main chat and introductions',
                inline: false
              },
              {
                name: '🎯 Useful Commands',
                value: '• `!help` - See all bot commands\n• `!roles` - List available roles\n• `!serverinfo` - Server statistics\n• `!userinfo` - Your profile info',
                inline: false
              }
            ],
            footer: { text: 'Enjoy your stay! 🎉' },
            timestamp: new Date()
          };

          await welcomeChannel.send({ embeds: [welcomeEmbed] });
          
          // Additional welcome message
          await welcomeChannel.send(`
**Quick Tips:**
• Be respectful to everyone in the community
• Use appropriate channels for different topics  
• Don't hesitate to ask staff if you need help
• Most importantly - have fun! 🎮

We're glad to have you here! Feel free to explore and make yourself at home.
          `);

          logToChannel(`✅ Welcome message sent to #${welcomeChannel.name}`);
        } else {
          logToChannel(`📝 #${welcomeChannel.name} already has ${messages.size} messages, skipping setup`);
        }
      } else {
        logToChannel(`❌ No permission to send messages in #${welcomeChannel.name}`);
      }
    } else {
      logToChannel('❌ #welcome channel not found');
    }
  } catch (error) {
    logToChannel(`❌ Failed to setup welcome channel: ${error.message}`);
  }
}

// ANNOUNCEMENTS CHANNEL SETUP
async function setupAnnouncementsChannel() {
  const guild = client.guilds.cache.first();
  if (!guild) return;

  try {
    const announcementsChannel = guild.channels.cache.find(ch => 
      ch.name === 'announcements' || ch.name === 'announcement' || ch.name.includes('announce')
    );
    
    if (announcementsChannel) {
      const permissions = announcementsChannel.permissionsFor(client.user);
      if (permissions?.has(PermissionsBitField.Flags.SendMessages)) {
        const messages = await announcementsChannel.messages.fetch({ limit: 5 });
        if (messages.size === 0) {
          const announcementsEmbed = {
            color: 0xffa500,
            title: '📢 ANNOUNCEMENTS & UPDATES',
            description: '**This is where important server news and updates will be posted!**\n\nMake sure to enable notifications to stay informed about server events, rule changes, and community news.',
            thumbnail: { url: guild.iconURL({ dynamic: true, size: 512 }) },
            fields: [
              {
                name: '🔔 How to Get Notifications',
                value: 'To receive notifications from this channel:\n1. **Right-click** this channel\n2. Select **"Notification Settings"**\n3. Choose **"All Messages"**\n4. Click **"Save"**',
                inline: false
              },
              {
                name: '📰 What to Expect Here',
                value: '• Server maintenance announcements\n• Rule updates and changes\n• Community events and contests\n• Important policy changes\n• Staff team updates',
                inline: false
              },
              {
                name: '⏰ Frequency',
                value: 'We only post important updates here to avoid spam. Typically 1-2 announcements per week.',
                inline: false
              }
            ],
            footer: { text: 'Stay informed and never miss an update!' },
            timestamp: new Date()
          };

          await announcementsChannel.send({ embeds: [announcementsEmbed] });
          
          // Additional announcement info
          await announcementsChannel.send(`
**📞 Contact Staff:**
If you have questions about any announcements, please contact the staff team.

**❌ No Chatting:**
Please keep this channel clear for announcements only. Use other channels for discussions.

**✅ Agreement:**
By staying in this server, you agree to read and acknowledge all announcements posted here.
          `);

          logToChannel(`✅ Announcements message sent to #${announcementsChannel.name}`);
        } else {
          logToChannel(`📝 #${announcementsChannel.name} already has ${messages.size} messages, skipping setup`);
        }
      } else {
        logToChannel(`❌ No permission to send messages in #${announcementsChannel.name}`);
      }
    } else {
      logToChannel('❌ #announcements channel not found');
    }
  } catch (error) {
    logToChannel(`❌ Failed to setup announcements channel: ${error.message}`);
  }
}

// RULES CHANNEL SETUP
async function setupRulesChannel() {
  const guild = client.guilds.cache.first();
  if (!guild) return;

  try {
    const rulesChannel = guild.channels.cache.find(ch => 
      ch.name === 'rules' || ch.name === 'rules-and-info'
    );
    
    if (rulesChannel) {
      const permissions = rulesChannel.permissionsFor(client.user);
      if (permissions?.has(PermissionsBitField.Flags.SendMessages)) {
        const messages = await rulesChannel.messages.fetch({ limit: 10 });
        if (messages.size === 0) {
          // Main Rules Embed
          const rulesEmbed = {
            color: 0xff0000,
            title: '📜 OFFICIAL SERVER RULES',
            description: '**Please read and understand all rules before participating in the server.**\n\nBy being in this server, you agree to follow these rules. Failure to comply may result in warnings, kicks, or bans.',
            thumbnail: { url: guild.iconURL({ dynamic: true, size: 512 }) },
            fields: [
              {
                name: '1. RESPECT EVERYONE',
                value: '• Treat all members with respect\n• No harassment, bullying, or hate speech\n• No discrimination based on race, gender, sexuality, religion, etc.\n• Keep arguments civil and constructive',
                inline: false
              },
              {
                name: '2. NO NSFW CONTENT',
                value: '• No pornographic, sexually explicit, or suggestive content\n• No gore, violence, or disturbing imagery\n• Keep all content appropriate for all ages\n• This includes usernames, profile pictures, and statuses',
                inline: false
              },
              {
                name: '3. NO SPAMMING',
                value: '• No message spam in any channels\n• No @everyone or @here without staff permission\n• No chain messages, copypastas, or excessive emojis\n• No advertising in DMs (DM advertising = instant ban)',
                inline: false
              },
              {
                name: '4. NO ADVERTISING',
                value: '• No server invites or promotion without staff approval\n• No self-promotion of social media, YouTube, etc.\n• No referral links or money-making schemes\n• Small content creation in appropriate channels is allowed',
                inline: false
              },
              {
                name: '5. USE APPROPRIATE CHANNELS',
                value: '• Keep topics in their designated channels\n• Read channel topics before posting\n• No off-topic discussions\n• Use threads for extended conversations',
                inline: false
              },
              {
                name: '6. FOLLOW DISCORD TOS',
                value: '• You must follow [Discord Terms of Service](https://discord.com/terms)\n• No illegal content or discussions\n• No raiding, hacking, or exploiting\n• No sharing personal information (doxing)',
                inline: false
              },
              {
                name: '7. ENGLISH ONLY',
                value: '• Keep all messages in English\n• This helps moderators effectively monitor the server\n• Non-English messages will be removed',
                inline: false
              },
              {
                name: '8. NO MINI-MODDING',
                value: '• Let staff handle rule enforcement\n• Do not attempt to moderate other users\n• Use the report feature if you see rule breaking\n• Report issues to staff, don\'t call people out publicly',
                inline: false
              },
              {
                name: '9. VOICE CHAT RULES',
                value: '• No earrape, soundboards, or loud noises\n• No voice changers that disrupt conversation\n• Respect others in voice channels\n• Move to appropriate channels for different activities',
                inline: false
              }
            ],
            footer: { text: 'Rules last updated' },
            timestamp: new Date()
          };

          await rulesChannel.send({ embeds: [rulesEmbed] });

          // Consequences and Additional Info
          await rulesChannel.send(`
**🚨 CONSEQUENCES FOR RULE BREAKING**

• **First offense**: Warning and message deletion
• **Second offense**: Temporary mute (1-24 hours)
• **Third offense**: Kick from server
• **Severe offenses**: Immediate permanent ban

**Severe offenses include**: NSFW content, hate speech, raiding, doxing, DM advertising.

**📞 HOW TO REPORT**

• Use the report channel if available
• DM a staff member directly
• Use the \`!report\` command
• Never engage with rule breakers - let staff handle it

**✅ RULES AGREEMENT**

By continuing to participate in this server, you acknowledge that you have read, understood, and agree to follow all rules above. Staff decisions are final.

**Need clarification? Ask a staff member!** 🛡️
          `);

          logToChannel(`✅ Rules sent to #${rulesChannel.name}`);
        } else {
          logToChannel(`📝 #${rulesChannel.name} already has messages, skipping setup`);
        }
      } else {
        logToChannel(`❌ No permission to send messages in #${rulesChannel.name}`);
      }
    } else {
      logToChannel('❌ #rules channel not found');
    }
  } catch (error) {
    logToChannel(`❌ Failed to setup rules channel: ${error.message}`);
  }
}

// REPORTS CHANNEL SETUP
async function setupReportsChannel() {
  const guild = client.guilds.cache.first();
  if (!guild) return;

  try {
    const reportsChannel = guild.channels.cache.find(ch => 
      ch.name === 'reports' || ch.name === 'report'
    );
    
    if (reportsChannel) {
      const permissions = reportsChannel.permissionsFor(client.user);
      if (permissions?.has(PermissionsBitField.Flags.SendMessages)) {
        const messages = await reportsChannel.messages.fetch({ limit: 5 });
        if (messages.size === 0) {
          const reportsEmbed = {
            color: 0xff0000,
            title: '🚨 REPORTS CHANNEL',
            description: '**This channel is for reporting rule violations and problematic users.**\n\nStaff will review all reports here.',
            fields: [
              {
                name: '📝 How to Report',
                value: '• Use `!report @user reason` in any channel\n• Or describe the issue here directly\n• Provide evidence if possible (screenshots)',
                inline: false
              },
              {
                name: '🚫 What to Report',
                value: '• Rule breaking\n• Harassment\n• Spam\n• NSFW content\n• Suspicious behavior',
                inline: false
              },
              {
                name: '✅ What Happens Next',
                value: '• Staff will investigate\n• You may be asked for more info\n• Action will be taken if needed\n• All reports are confidential',
                inline: false
              }
            ],
            footer: { text: 'Thank you for helping keep our server safe!' },
            timestamp: new Date()
          };

          await reportsChannel.send({ embeds: [reportsEmbed] });
          logToChannel(`✅ Reports channel setup in #${reportsChannel.name}`);
        } else {
          logToChannel(`📝 #${reportsChannel.name} already has messages, skipping setup`);
        }
      } else {
        logToChannel(`❌ No permission to send messages in #${reportsChannel.name}`);
      }
    } else {
      logToChannel('❌ #reports channel not found');
    }
  } catch (error) {
    logToChannel(`❌ Failed to setup reports channel: ${error.message}`);
  }
}

// SETUP SERVER-INFO AND STAFF CHANNELS
async function setupInfoChannels() {
  const guild = client.guilds.cache.first();
  if (!guild) return;

  logToChannel('🔄 Setting up information channels...');

  // Server Info Channel Setup
  try {
    const serverInfoChannel = guild.channels.cache.find(ch => 
      ch.name === 'server-info' || ch.name === 'server-information'
    );
    
    if (serverInfoChannel) {
      const permissions = serverInfoChannel.permissionsFor(client.user);
      if (permissions?.has(PermissionsBitField.Flags.SendMessages)) {
        const messages = await serverInfoChannel.messages.fetch({ limit: 10 });
        if (messages.size === 0) {
          // Fetch all members to ensure accurate counting
          await guild.members.fetch();
          
          const totalMembers = guild.memberCount;
          const botCount = guild.members.cache.filter(member => member.user.bot).size;
          const humanCount = totalMembers - botCount;

          const serverInfoEmbed = {
            color: 0x0099ff,
            title: '🏠 Server Information',
            description: `Welcome to **${guild.name}**! Here's everything you need to know about our server.`,
            thumbnail: { url: guild.iconURL({ dynamic: true, size: 512 }) },
            fields: [
              {
                name: '📊 Server Statistics',
                value: `**Members:** ${totalMembers}\n**Humans:** ${humanCount}\n**Bots:** ${botCount}\n**Channels:** ${guild.channels.cache.size}\n**Roles:** ${guild.roles.cache.size}\n**Boosts:** ${guild.premiumSubscriptionCount || 0}`,
                inline: true
              },
              {
                name: '📅 Server Created',
                value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`,
                inline: true
              },
              {
                name: '👑 Server Owner',
                value: `<@${guild.ownerId}>`,
                inline: true
              },
              {
                name: '🔒 Verification Level',
                value: guild.verificationLevel.toString(),
                inline: true
              },
              {
                name: '⭐ Boost Level',
                value: `Level ${guild.premiumTier}`,
                inline: true
              },
              {
                name: '🎨 Emojis',
                value: `${guild.emojis.cache.size} emojis`,
                inline: true
              }
            ],
            footer: { text: 'Last updated' },
            timestamp: new Date()
          };

          await serverInfoChannel.send({ embeds: [serverInfoEmbed] });
          
          // Additional server rules/info
          await serverInfoChannel.send(`
**📜 Quick Rules:**
• Be respectful to everyone
• No spam or self-promotion
• Keep content appropriate
• Use the right channels for topics

**🎯 Getting Started:**
1. Read the rules in <#${guild.channels.cache.find(c => c.name === 'rules')?.id || '#rules'}>
2. Introduce yourself in <#${guild.channels.cache.find(c => c.name === 'general')?.id || '#general'}>
3. Get roles using \`!roles\` command
4. Have fun! 🎉
          `);
          
          logToChannel(`✅ Server info sent to #${serverInfoChannel.name}`);
        } else {
          logToChannel(`📝 #${serverInfoChannel.name} already has messages, skipping setup`);
        }
      } else {
        logToChannel(`❌ No permission to send messages in #${serverInfoChannel.name}`);
      }
    } else {
      logToChannel('❌ #server-info channel not found');
    }
  } catch (error) {
    logToChannel(`❌ Failed to setup server-info: ${error.message}`);
  }

  // Staff Info Channel Setup
  try {
    const staffChannel = guild.channels.cache.find(ch => 
      ch.name === 'staff' || ch.name === 'staff-info' || ch.name === 'moderators'
    );
    
    if (staffChannel) {
      const permissions = staffChannel.permissionsFor(client.user);
      if (permissions?.has(PermissionsBitField.Flags.SendMessages)) {
        const messages = await staffChannel.messages.fetch({ limit: 10 });
        if (messages.size === 0) {
          const staffInfoEmbed = {
            color: 0xff0000,
            title: '🛡️ Staff Information & Guidelines',
            description: 'Welcome to the staff channel! This is for moderator discussions and coordination.',
            fields: [
              {
                name: '📋 Staff Guidelines',
                value: '• Lead by example\n• Be active and responsive\n• Use proper moderation commands\n• Document actions in bot-logs\n• Keep sensitive discussions here',
                inline: false
              },
              {
                name: '⚡ Bot Commands',
                value: '**Moderation:**\n`!kick @user [reason]`\n`!ban @user [reason]`\n`!warn @user [reason]`\n`!clear 1-100`\n\n**Utility:**\n`!addassignablerole @role`\n`!addresponse trigger response`',
                inline: true
              },
              {
                name: '📝 Important Notes',
                value: `• All moderation commands are silent in public channels\n• Everything is logged in bot-logs\n• Use DMs for sensitive user issues\n• Coordinate major actions in ${guild.channels.cache.find(c => c.name === 'mod-chat')?.toString() || '#mod-chat'}`,
                inline: true
              }
            ],
            footer: { text: 'Staff Guidelines' },
            timestamp: new Date()
          };

          await staffChannel.send({ embeds: [staffInfoEmbed] });
          
          // Staff role management info
          await staffChannel.send(`
**🔧 Role Management:**
Use these commands to manage self-assignable roles:
\`!addassignablerole @RoleName\` - Make role self-assignable
\`!removeassignablerole @RoleName\` - Remove from self-assignable
\`!roles\` - List all self-assignable roles

**🎯 Auto-Responses:**
Set up automatic bot responses:
\`!addresponse hello Hey there! 👋\`
\`!listresponses\` - View all auto-responses
\`!removeresponse hello\` - Remove auto-response
          `);
          
          logToChannel(`✅ Staff info sent to #${staffChannel.name}`);
        } else {
          logToChannel(`📝 #${staffChannel.name} already has messages, skipping setup`);
        }
      } else {
        logToChannel(`❌ No permission to send messages in #${staffChannel.name}`);
      }
    } else {
      logToChannel('❌ #staff channel not found');
    }
  } catch ( error) {
    logToChannel(`❌ Failed to setup staff channel: ${error.message}`);
  }
  
  logToChannel('✅ Information channels setup completed!');
}

// LOG ALL MESSAGES THE BOT SENDS
client.channels.cache.__proto__.send = function(...args) {
  const channel = this;
  const originalSend = Object.getPrototypeOf(this).send;
  return originalSend.apply(this, args).then(sentMessage => {
    if (channel.id !== logChannel?.id && sentMessage.author?.id === client.user.id) {
      logToChannel(`**Bot Message** in ${channel}\n**Content:** ${args[0]}`);
    }
    return sentMessage;
  });
};

// WELCOME NEW MEMBERS
client.on('guildMemberAdd', async (member) => {
  const welcomeChannel = member.guild.channels.cache.find(channel => 
    channel.name === 'welcome'
  );
  
  if (welcomeChannel) {
    const rulesChannel = member.guild.channels.cache.find(c => c.name === 'rules');
    const serverInfoChannel = member.guild.channels.cache.find(c => c.name === 'server-info');
    
    welcomeChannel.send({
      embeds: [{
        color: 0x00ff00,
        title: `👋 Welcome ${member.user.username}!`,
        description: `Welcome to **${member.guild.name}**!\n\nPlease read the rules in ${rulesChannel || '#rules'} and check out ${serverInfoChannel || '#server-info'} for server information!`,
        thumbnail: { url: member.user.displayAvatarURL() },
        footer: { text: `Member #${member.guild.memberCount}` },
        timestamp: new Date()
      }]
    });
    
    logToChannel(`👋 **Member Joined** - ${member.user.tag} (${member.id})`);
  }
});

// MODERATION COMMANDS (SILENT IN ORIGINAL CHANNEL)
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith('!')) return;

  const args = message.content.slice(1).split(/ +/);
  const command = args.shift().toLowerCase();

  // Log all commands received
  logToChannel(`**Command Received** in ${message.channel}\n**User:** ${message.author.tag} | **Command:** ${message.content}`);

  // SETUP INFO CHANNELS COMMAND
  if (command === 'setupinfo') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      logToChannel(`❌ **Permission Denied** - ${message.author.tag} tried to use !setupinfo`);
      return;
    }

    message.delete().catch(() => {});
    await setupWelcomeChannel();
    await setupAnnouncementsChannel();
    await setupInfoChannels();
    await setupRulesChannel();
    await setupReportsChannel();
    message.author.send('✅ All channels have been set up successfully!').catch(() => {});
    return;
  }

  // REPORT COMMAND
  if (command === 'report') {
    const reportedUser = message.mentions.users.first();
    const reason = args.slice(1).join(' ');

    if (!reportedUser || !reason) {
      message.reply('❌ Usage: `!report @user <reason>`').then(botMsg => {
        logBotResponse(message, botMsg.content, 'Error');
      });
      return;
    }

    // Find reports channel
    const reportsChannel = message.guild.channels.cache.find(ch => 
      ch.name === 'reports' || ch.name === 'report'
    );

    if (!reportsChannel) {
      message.reply('❌ Reports channel not found. Please contact staff directly.').then(botMsg => {
        logBotResponse(message, botMsg.content, 'Error');
      });
      return;
    }

    // Check if bot has permission in reports channel
    if (!hasPermission(reportsChannel, PermissionsBitField.Flags.SendMessages)) {
      message.reply('❌ Cannot send to reports channel. Contact staff directly.').then(botMsg => {
        logBotResponse(message, botMsg.content, 'Error');
      });
      return;
    }

    const reportEmbed = {
      color: 0xff0000,
      title: '🚨 USER REPORT',
      fields: [
        { name: 'Reported User', value: `${reportedUser.tag} (${reportedUser.id})`, inline: true },
        { name: 'Reported By', value: `${message.author.tag} (${message.author.id})`, inline: true },
        { name: 'Channel', value: message.channel.toString(), inline: true },
        { name: 'Reason', value: reason, inline: false },
        { name: 'Time', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
      ],
      footer: { text: 'Please investigate this report' },
      timestamp: new Date()
    };

    reportsChannel.send({ content: `@here New user report`, embeds: [reportEmbed] })
      .then(() => {
        message.reply('✅ Your report has been sent to the staff team. Thank you!').then(botMsg => {
          logBotResponse(message, botMsg.content, 'Report Success');
        });
        logToChannel(`🚨 **Report Filed** - ${message.author.tag} reported ${reportedUser.tag} for: ${reason}`);
      })
      .catch(error => {
        message.reply('❌ Failed to send report. Please contact staff directly.').then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        logToChannel(`❌ **Report Failed** - ${message.author.tag}: ${error.message}`);
      });
  }

  // SET LOG CHANNEL COMMAND
  if (command === 'setlogchannel') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      message.reply('❌ You need **Administrator** permission.').then(botMsg => {
        logBotResponse(message, botMsg.content, 'Error');
      });
      return;
    }

    const channel = message.mentions.channels.first();
    if (!channel) {
      message.reply('❌ Please mention a channel.').then(botMsg => {
        logBotResponse(message, botMsg.content, 'Error');
      });
      return;
    }

    logChannel = channel;
    logToChannel(`📝 Log channel set to ${channel} by ${message.author.tag}`);
    message.reply(`✅ Log channel set to ${channel}`).then(botMsg => {
      logBotResponse(message, botMsg.content, 'Config Update');
    });
  }

  // KICK COMMAND (SILENT)
  if (command === 'kick') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
      logToChannel(`❌ **Permission Denied** - ${message.author.tag} tried to use !kick`);
      return;
    }

    const member = message.mentions.members.first();
    if (!member) {
      logToChannel(`❌ **Invalid Usage** - ${message.author.tag} used !kick without mentioning user`);
      return;
    }

    const reason = args.slice(1).join(' ') || 'No reason provided';
    
    member.kick(reason)
      .then(() => {
        logToChannel({
          embeds: [{
            color: 0xff0000,
            title: '🛡️ User Kicked',
            fields: [
              { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
              { name: 'Moderator', value: message.author.tag, inline: true },
              { name: 'Reason', value: reason, inline: true },
              { name: 'Channel', value: message.channel.toString(), inline: true }
            ],
            timestamp: new Date()
          }]
        });
        
        member.send(`You have been kicked from **${message.guild.name}** for: ${reason}`)
          .catch(() => logToChannel('❌ Could not DM kicked user'));
      })
      .catch(error => {
        logToChannel(`❌ **Kick Failed** - ${message.author.tag} tried to kick ${member.user.tag}: ${error}`);
      });
  }

  // BAN COMMAND (SILENT)
  if (command === 'ban') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
      logToChannel(`❌ **Permission Denied** - ${message.author.tag} tried to use !ban`);
      return;
    }

    const member = message.mentions.members.first();
    if (!member) {
      logToChannel(`❌ **Invalid Usage** - ${message.author.tag} used !ban without mentioning user`);
      return;
    }

    const reason = args.slice(1).join(' ') || 'No reason provided';
    
    member.ban({ reason })
      .then(() => {
        logToChannel({
          embeds: [{
            color: 0xff0000,
            title: '🛡️ User Banned',
            fields: [
              { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
              { name: 'Moderator', value: message.author.tag, inline: true },
              { name: 'Reason', value: reason, inline: true },
              { name: 'Channel', value: message.channel.toString(), inline: true }
            ],
            timestamp: new Date()
          }]
        });
        
        member.send(`You have been banned from **${message.guild.name}** for: ${reason}`)
          .catch(() => logToChannel('❌ Could not DM banned user'));
      })
      .catch(error => {
        logToChannel(`❌ **Ban Failed** - ${message.author.tag} tried to ban ${member.user.tag}: ${error}`);
      });
  }

  // WARN COMMAND (SILENT)
  if (command === 'warn') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
      logToChannel(`❌ **Permission Denied** - ${message.author.tag} tried to use !warn`);
      return;
    }

    const member = message.mentions.members.first();
    if (!member) {
      logToChannel(`❌ **Invalid Usage** - ${message.author.tag} used !warn without mentioning user`);
      return;
    }

    const reason = args.slice(1).join(' ') || 'No reason provided';
    const userId = member.id;

    if (!userWarnings.has(userId)) {
      userWarnings.set(userId, []);
    }

    userWarnings.get(userId).push({
      reason,
      moderator: message.author.tag,
      timestamp: new Date(),
      channel: message.channel.name
    });

    const totalWarnings = userWarnings.get(userId).length;
    
    logToChannel({
      embeds: [{
        color: 0xffa500,
        title: '⚠️ User Warned',
        fields: [
          { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
          { name: 'Moderator', value: message.author.tag, inline: true },
          { name: 'Reason', value: reason, inline: true },
          { name: 'Total Warnings', value: totalWarnings.toString(), inline: true },
          { name: 'Channel', value: message.channel.toString(), inline: true }
        ],
        timestamp: new Date()
      }]
    });

    member.send(`You have been warned in **${message.guild.name}** for: ${reason}\nThis is warning #${totalWarnings}.`)
      .catch(() => logToChannel('❌ Could not DM warned user'));
  }

  // WARNINGS COMMAND (SILENT)
  if (command === 'warnings') {
    const member = message.mentions.members.first() || message.member;
    const warnings = userWarnings.get(member.id) || [];

    if (warnings.length === 0) {
      logToChannel(`📝 **Warnings Check** - ${message.author.tag} checked ${member.user.tag} - No warnings`);
      return;
    }

    logToChannel(`📝 **Warnings Check** - ${message.author.tag} checked ${member.user.tag} - ${warnings.length} warnings total`);
  }

  // CLEAR WARNINGS COMMAND (SILENT)
  if (command === 'clearwarnings') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
      logToChannel(`❌ **Permission Denied** - ${message.author.tag} tried to use !clearwarnings`);
      return;
    }

    const member = message.mentions.members.first();
    if (!member) {
      logToChannel(`❌ **Invalid Usage** - ${message.author.tag} used !clearwarnings without mentioning user`);
      return;
    }

    const warningsCount = userWarnings.get(member.id)?.length || 0;
    userWarnings.delete(member.id);
    
    logToChannel({
      embeds: [{
        color: 0x00ff00,
        title: '✅ Warnings Cleared',
        fields: [
          { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
          { name: 'Moderator', value: message.author.tag, inline: true },
          { name: 'Warnings Cleared', value: warningsCount.toString(), inline: true },
          { name: 'Channel', value: message.channel.toString(), inline: true }
        ],
        timestamp: new Date()
      }]
    });
  }

  // CLEAR MESSAGES COMMAND (SILENT)
  if (command === 'clear') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
      logToChannel(`❌ **Permission Denied** - ${message.author.tag} tried to use !clear`);
      return;
    }

    const amount = parseInt(args[0]);
    if (isNaN(amount) || amount < 1 || amount > 100) {
      logToChannel(`❌ **Invalid Usage** - ${message.author.tag} used !clear with invalid amount: ${args[0]}`);
      return;
    }

    message.channel.bulkDelete(amount + 1, true)
      .then(messages => {
        logToChannel(`🧹 **Messages Cleared** - ${message.author.tag} cleared ${messages.size - 1} messages in ${message.channel}`);
      })
      .catch(error => {
        logToChannel(`❌ **Clear Failed** - ${message.author.tag} in ${message.channel}: ${error}`);
      });
  }

  // SERVER INFO COMMAND (WITH FIXED MEMBER COUNTING)
  if (command === 'serverinfo') {
    // Check if bot has permission to send messages in this channel
    if (!hasPermission(message.channel, PermissionsBitField.Flags.SendMessages)) {
      logToChannel(`❌ Missing Send Messages permission in ${message.channel}`);
      return;
    }

    const guild = message.guild;
    
    // Fetch all members to ensure accurate counting
    await guild.members.fetch();
    
    const totalMembers = guild.memberCount;
    const botCount = guild.members.cache.filter(member => member.user.bot).size;
    const humanCount = totalMembers - botCount;
    
    const serverInfoEmbed = {
      color: 0x0099ff,
      title: `📊 ${guild.name} Server Information`,
      thumbnail: { url: guild.iconURL({ dynamic: true, size: 512 }) },
      fields: [
        { name: '👑 Owner', value: `<@${guild.ownerId}>`, inline: true },
        { name: '🆔 Server ID', value: guild.id, inline: true },
        { name: '📅 Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
        { name: '👥 Members', value: `**Total:** ${totalMembers}\n**Humans:** ${humanCount}\n**Bots:** ${botCount}`, inline: true },
        { name: '📈 Boosts', value: `**Level:** ${guild.premiumTier}\n**Boosts:** ${guild.premiumSubscriptionCount || 0}`, inline: true },
        { name: '🔊 Channels', value: `**Text:** ${guild.channels.cache.filter(c => c.type === 0).size}\n**Voice:** ${guild.channels.cache.filter(c => c.type === 2).size}\n**Categories:** ${guild.channels.cache.filter(c => c.type === 4).size}`, inline: true },
        { name: '🎭 Roles', value: `${guild.roles.cache.size} roles`, inline: true },
        { name: '🔒 Verification', value: guild.verificationLevel.toString(), inline: true },
        { name: '🚀 Features', value: guild.features.length > 0 ? guild.features.slice(0, 5).join(', ') : 'None', inline: true }
      ],
      footer: { text: `Requested by ${message.author.tag}` },
      timestamp: new Date()
    };

    message.reply({ embeds: [serverInfoEmbed] }).then(botMsg => {
      logBotResponse(message, 'Server information displayed', 'Server Info');
    });
  }

  // USER INFO COMMAND (WITH PERMISSION CHECK)
  if (command === 'userinfo' || command === 'whois') {
    // Check if bot has permission to send messages in this channel
    if (!hasPermission(message.channel, PermissionsBitField.Flags.SendMessages)) {
      logToChannel(`❌ Missing Send Messages permission in ${message.channel}`);
      return;
    }

    const member = message.mentions.members.first() || message.member;
    const user = member.user;
    
    const roles = member.roles.cache
      .filter(role => role.id !== message.guild.id)
      .sort((a, b) => b.position - a.position)
      .map(role => role.toString())
      .slice(0, 10);

    const userInfoEmbed = {
      color: 0x0099ff,
      author: { name: `${user.tag}`, icon_url: user.displayAvatarURL({ dynamic: true, size: 512 }) },
      thumbnail: { url: user.displayAvatarURL({ dynamic: true, size: 512 }) },
      fields: [
        { name: '🆔 User ID', value: user.id, inline: true },
        { name: '🤖 Bot', value: user.bot ? 'Yes' : 'No', inline: true },
        { name: '📅 Account Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
        { name: '📥 Joined Server', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
        { name: `🎭 Roles [${roles.length}]`, value: roles.length > 0 ? roles.join(' ') : 'No roles', inline: false },
        { name: '🎨 Color', value: member.displayHexColor, inline: true },
        { name: '📛 Nickname', value: member.nickname || 'None', inline: true },
        { name: '🚀 Boosting', value: member.premiumSince ? `<t:${Math.floor(member.premiumSinceTimestamp / 1000)}:R>` : 'Not boosting', inline: true }
      ],
      footer: { text: `Requested by ${message.author.tag}` },
      timestamp: new Date()
    };

    message.reply({ embeds: [userInfoEmbed] })
      .then(botMsg => {
        logBotResponse(message, `User info for ${user.tag}`, 'User Info');
      })
      .catch(error => {
        logToChannel(`❌ Failed to send userinfo in ${message.channel}: ${error.message}`);
      });
  }

  // REMINDER COMMAND
  if (command === 'remindme') {
    // Check if bot has permission to send messages in this channel
    if (!hasPermission(message.channel, PermissionsBitField.Flags.SendMessages)) {
      logToChannel(`❌ Missing Send Messages permission in ${message.channel}`);
      return;
    }

    const timeString = args[0];
    const reminderText = args.slice(1).join(' ');

    if (!timeString || !reminderText) {
      message.reply('❌ Usage: `!remindme <time> <message>`\nExample: `!remindme 2h Take out the trash`').then(botMsg => {
        logBotResponse(message, botMsg.content, 'Error');
      });
      return;
    }

    const timeMatch = timeString.match(/^(\d+)([smhdw])$/);
    if (!timeMatch) {
      message.reply('❌ Invalid time format. Use: 1m, 30min, 2h, 1d, 1w').then(botMsg => {
        logBotResponse(message, botMsg.content, 'Error');
      });
      return;
    }

    const amount = parseInt(timeMatch[1]);
    const unit = timeMatch[2];
    
    let milliseconds;
    switch (unit) {
      case 's': milliseconds = amount * 1000; break;
      case 'm': milliseconds = amount * 60 * 1000; break;
      case 'h': milliseconds = amount * 60 * 60 * 1000; break;
      case 'd': milliseconds = amount * 24 * 60 * 60 * 1000; break;
      case 'w': milliseconds = amount * 7 * 24 * 60 * 60 * 1000; break;
      default: milliseconds = amount * 60 * 1000;
    }

    if (milliseconds > 7 * 24 * 60 * 60 * 1000) {
      message.reply('❌ Maximum reminder time is 1 week.').then(botMsg => {
        logBotResponse(message, botMsg.content, 'Error');
      });
      return;
    }

    const reminderId = Date.now().toString();
    const reminderTime = Date.now() + milliseconds;

    reminders.set(reminderId, {
      userId: message.author.id,
      channelId: message.channel.id,
      text: reminderText,
      time: reminderTime
    });

    message.reply(`✅ I'll remind you in ${timeString}: "${reminderText}"`).then(botMsg => {
      logBotResponse(message, botMsg.content, 'Reminder Set');
    });

    setTimeout(() => {
      const reminder = reminders.get(reminderId);
      if (reminder) {
        const channel = client.channels.cache.get(reminder.channelId);
        if (channel) {
          channel.send(`⏰ <@${reminder.userId}> Reminder: ${reminder.text}`);
          logToChannel(`⏰ **Reminder Sent** - ${message.author.tag}: ${reminder.text}`);
        }
        reminders.delete(reminderId);
      }
    }, milliseconds);
  }

  // ROLE MANAGEMENT COMMANDS

  // ADD SELF-ASSIGNABLE ROLE (Admin/Mod only)
  if (command === 'addassignablerole') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      message.reply('❌ You need **Manage Roles** permission.').then(botMsg => {
        logBotResponse(message, botMsg.content, 'Error');
      });
      return;
    }

    const role = message.mentions.roles.first();
    if (!role) {
      message.reply('❌ Please mention a role to make self-assignable.').then(botMsg => {
        logBotResponse(message, botMsg.content, 'Error');
      });
      return;
    }

    selfAssignableRoles.add(role.id);
    message.reply(`✅ Added **${role.name}** as a self-assignable role.`).then(botMsg => {
      logBotResponse(message, botMsg.content, 'Role Config');
    });
  }

  // REMOVE SELF-ASSIGNABLE ROLE (Admin/Mod only)
  if (command === 'removeassignablerole') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      message.reply('❌ You need **Manage Roles** permission.').then(botMsg => {
        logBotResponse(message, botMsg.content, 'Error');
      });
      return;
    }

    const role = message.mentions.roles.first();
    if (!role) {
      message.reply('❌ Please mention a role to remove from self-assignable.').then(botMsg => {
        logBotResponse(message, botMsg.content, 'Error');
      });
      return;
    }

    selfAssignableRoles.delete(role.id);
    message.reply(`✅ Removed **${role.name}** from self-assignable roles.`).then(botMsg => {
      logBotResponse(message, botMsg.content, 'Role Config');
    });
  }

  // LIST SELF-ASSIGNABLE ROLES
  if (command === 'roles' || command === 'listroles') {
    // Check if bot has permission to send messages in this channel
    if (!hasPermission(message.channel, PermissionsBitField.Flags.SendMessages)) {
      logToChannel(`❌ Missing Send Messages permission in ${message.channel}`);
      return;
    }

    const roles = Array.from(selfAssignableRoles)
      .map(roleId => {
        const role = message.guild.roles.cache.get(roleId);
        return role ? `• ${role.toString()} - ${role.name}` : null;
      })
      .filter(Boolean);

    if (roles.length === 0) {
      message.reply('📝 No self-assignable roles available.').then(botMsg => {
        logBotResponse(message, botMsg.content, 'Role List');
      });
      return;
    }

    const rolesEmbed = {
      color: 0x0099ff,
      title: '🎭 Self-Assignable Roles',
      description: 'Use `!iam <role>` to get a role or `!iamnot <role>` to remove it.\n\n' + roles.join('\n'),
      footer: { text: `Requested by ${message.author.tag}` },
      timestamp: new Date()
    };

    message.reply({ embeds: [rolesEmbed] }).then(botMsg => {
      logBotResponse(message, 'Self-assignable roles listed', 'Role List');
    });
  }

  // ASSIGN ROLE TO SELF
  if (command === 'iam') {
    // Check if bot has permission to send messages in this channel
    if (!hasPermission(message.channel, PermissionsBitField.Flags.SendMessages)) {
      logToChannel(`❌ Missing Send Messages permission in ${message.channel}`);
      return;
    }

    const roleName = args.join(' ').toLowerCase();
    const role = message.guild.roles.cache.find(r => 
      r.name.toLowerCase() === roleName && selfAssignableRoles.has(r.id)
    );

    if (!role) {
      message.reply('❌ Role not found or not self-assignable. Use `!roles` to see available roles.').then(botMsg => {
        logBotResponse(message, botMsg.content, 'Error');
      });
      return;
    }

    if (message.member.roles.cache.has(role.id)) {
      message.reply(`❌ You already have the **${role.name}** role.`).then(botMsg => {
        logBotResponse(message, botMsg.content, 'Error');
      });
      return;
    }

    message.member.roles.add(role)
      .then(() => {
        message.reply(`✅ You now have the **${role.name}** role!`).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Role Added');
        });
      })
      .catch(error => {
        message.reply('❌ I cannot assign that role. Check my permissions and role hierarchy.').then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
      });
  }

  // REMOVE ROLE FROM SELF
  if (command === 'iamnot') {
    // Check if bot has permission to send messages in this channel
    if (!hasPermission(message.channel, PermissionsBitField.Flags.SendMessages)) {
      logToChannel(`❌ Missing Send Messages permission in ${message.channel}`);
      return;
    }

    const roleName = args.join(' ').toLowerCase();
    const role = message.guild.roles.cache.find(r => 
      r.name.toLowerCase() === roleName && selfAssignableRoles.has(r.id)
    );

    if (!role) {
      message.reply('❌ Role not found or not self-assignable.').then(botMsg => {
        logBotResponse(message, botMsg.content, 'Error');
      });
      return;
    }

    if (!message.member.roles.cache.has(role.id)) {
      message.reply(`❌ You don't have the **${role.name}** role.`).then(botMsg => {
        logBotResponse(message, botMsg.content, 'Error');
      });
      return;
    }

    message.member.roles.remove(role)
      .then(() => {
        message.reply(`✅ Removed the **${role.name}** role from you.`).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Role Removed');
        });
      })
      .catch(error => {
        message.reply('❌ I cannot remove that role. Check my permissions.').then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
      });
  }

  // HELP COMMAND (SEND TO DM)
  if (command === 'help') {
    message.delete().catch(() => {});
    
    const helpEmbed = {
      color: 0x0099ff,
      title: '🤖 Bot Commands',
      description: `Here are all available commands:`,
      fields: [
        {
          name: '🛡️ Silent Moderation',
          value: '`!kick @user [reason]` - Kick user (no channel response)\n`!ban @user [reason]` - Ban user (no channel response)\n`!warn @user [reason]` - Warn user (no channel response)\n`!warnings @user` - Check warnings (no channel response)\n`!clearwarnings @user` - Clear warnings (no channel response)\n`!clear 1-100` - Clear messages (no channel response)'
        },
        {
          name: '📊 Information',
          value: '`!serverinfo` - Show server stats\n`!userinfo [@user]` - Show user information\n`!roles` - List self-assignable roles'
        },
        {
          name: '⏰ Utility',
          value: '`!remindme 2h message` - Set a reminder\n`!iam <role>` - Give yourself a role\n`!iamnot <role>` - Remove a role'
        },
        {
          name: '🆘 Safety',
          value: '`!report @user reason` - Report a user to staff'
        },
        {
          name: '🔧 Role Management (Mods+)',
          value: '`!addassignablerole @role` - Make role self-assignable\n`!removeassignablerole @role` - Remove from self-assignable'
        },
        {
          name: '⚙️ Configuration (Admin)',
          value: '`!setupinfo` - Setup info channels\n`!setlogchannel #channel` - Set log channel'
        }
      ],
      footer: { text: `Requested by ${message.author.tag}` },
      timestamp: new Date().toISOString(),
    };

    message.author.send({ embeds: [helpEmbed] })
      .then(() => {
        logToChannel(`📬 **Help Sent to DM** - ${message.author.tag} requested help in ${message.channel}`);
        
        message.channel.send(`📬 ${message.author}, check your DMs for help!`)
          .then(botMsg => {
            setTimeout(() => botMsg.delete().catch(() => {}), 5000);
            logBotResponse(message, 'Check your DMs for help!', 'Help Redirect');
          });
      })
      .catch(error => {
        logToChannel(`❌ **DM Failed** - Could not send help to ${message.author.tag}: ${error}`);
        
        helpEmbed.description = `Here are all available commands (DMs unavailable):`;
        message.channel.send({ embeds: [helpEmbed] }).then(botMsg => {
          logBotResponse(message, 'Help command (DM failed)', 'Help Fallback');
        });
      });
  }

  // PING COMMAND
  // PING COMMAND
// PING COMMAND WITH LATENCY
if (command === 'ping') {
  // Check if bot has permission to send messages in this channel
  if (!hasPermission(message.channel, PermissionsBitField.Flags.SendMessages)) {
    logToChannel(`❌ Missing Send Messages permission in ${message.channel}`);
    return;
  }

  const sent = await message.reply('🏓 Calculating ping...');
  const latency = sent.createdTimestamp - message.createdTimestamp;
  const apiLatency = Math.round(client.ws.ping);

  const pingEmbed = {
    color: 0x0099ff,
    title: '🏓 Pong!',
    fields: [
      {
        name: '📡 Bot Latency',
        value: `**${latency}ms**`,
        inline: true
      },
      {
        name: '🌐 API Latency',
        value: `**${apiLatency}ms**`,
        inline: true
      },
      {
        name: '💓 Heartbeat',
        value: `**${client.ws.ping}ms**`,
        inline: true
      }
    ],
    footer: { text: `Requested by ${message.author.tag}` },
    timestamp: new Date()
  };

  sent.edit({ content: null, embeds: [pingEmbed] });
  logBotResponse(message, `Ping: ${latency}ms | API: ${apiLatency}ms`, 'Ping');
}

  

  // ADD CUSTOM RESPONSE
  if (command === 'addresponse') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
      message.reply('❌ You need **Manage Messages** permission.').then(botMsg => {
        logBotResponse(message, botMsg.content, 'Error');
      });
      return;
    }

    const trigger = args[0];
    const response = args.slice(1).join(' ');

    if (!trigger || !response) {
      message.reply('❌ Usage: `!addresponse <trigger> <response>`').then(botMsg => {
        logBotResponse(message, botMsg.content, 'Error');
      });
      return;
    }

    customResponses.set(trigger.toLowerCase(), response);
    message.reply(`✅ Added custom response for trigger: **${trigger}**`).then(botMsg => {
      logBotResponse(message, botMsg.content, 'Config Update');
    });
  }

  // LIST CUSTOM RESPONSES
  if (command === 'listresponses') {
    // Check if bot has permission to send messages in this channel
    if (!hasPermission(message.channel, PermissionsBitField.Flags.SendMessages)) {
      logToChannel(`❌ Missing Send Messages permission in ${message.channel}`);
      return;
    }

    if (customResponses.size === 0) {
      message.reply('📝 No custom responses set up yet.').then(botMsg => {
        logBotResponse(message, botMsg.content);
      });
      return;
    }

    const responseList = Array.from(customResponses.entries())
      .map(([trigger, response]) => `**${trigger}** → ${response}`)
      .join('\n');

    message.reply(`📋 Custom Responses:\n${responseList}`).then(botMsg => {
      logBotResponse(message, botMsg.content);
    });
  }

  // REMOVE CUSTOM RESPONSE
  if (command === 'removeresponse') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
      message.reply('❌ You need **Manage Messages** permission.').then(botMsg => {
        logBotResponse(message, botMsg.content, 'Error');
      });
      return;
    }

    const trigger = args[0];
    if (!trigger) {
      message.reply('❌ Please specify a trigger to remove.').then(botMsg => {
        logBotResponse(message, botMsg.content, 'Error');
      });
      return;
    }

    if (customResponses.delete(trigger.toLowerCase())) {
      message.reply(`✅ Removed custom response for: **${trigger}**`).then(botMsg => {
        logBotResponse(message, botMsg.content, 'Config Update');
      });
    } else {
      message.reply('❌ No custom response found for that trigger.').then(botMsg => {
        logBotResponse(message, botMsg.content, 'Error');
      });
    }
  }
});

// AUTO-RESPONSES (LOG TO BOT_LOG)
client.on('messageCreate', (message) => {
  if (message.author.bot) return;

  const content = message.content.toLowerCase();
  
  // Check for custom responses
  for (const [trigger, response] of customResponses) {
    if (content.includes(trigger)) {
      message.reply(response).then(botMsg => {
        logBotResponse(message, botMsg.content, 'Auto-Response');
      });
      break;
    }
  }

  // Built-in auto-responses
  if (content.includes('thank')) {
    message.react('❤️');
    logToChannel(`❤️ **Auto-Reaction** - Thank you reaction sent to ${message.author.tag} in ${message.channel}`);
  }
  
  if (content.includes('good bot')) {
    message.reply('😊 Thank you!').then(botMsg => {
      logBotResponse(message, botMsg.content, 'Auto-Response');
    });
  }
});

client.login(process.env.DISCORD_TOKEN);