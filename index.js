const { Client, GatewayIntentBits, PermissionsBitField, Collection, EmbedBuilder } = require('discord.js');
const fs = require('fs');
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
const userLevels = new Map(); // Store user levels and XP
const xpCooldowns = new Map(); // Store XP cooldowns

let logChannel = null;

// ==================== EXP/LEVEL SYSTEM CONFIG ====================
const LEVEL_CONFIG = {
  BASE_XP: 100,          // XP needed for level 1
  XP_MULTIPLIER: 1.5,    // How much more XP needed each level
  MIN_XP_PER_MSG: 15,    // Minimum XP per message
  MAX_XP_PER_MSG: 25,    // Maximum XP per message
  COOLDOWN_MS: 30000,    // 30 seconds cooldown between XP gains
  XP_CHANNELS: ['general' , 'gaming' , 'media' , 'memes', 'test-1'], // Channels that give XP
  NO_XP_ROLES: ['muted', 'bot'] // Roles that don't get XP
};

// REASONABLE LEVEL PROGRESSION FUNCTION
function calculateXpForLevel(level) {
  // Simple linear progression with stages
  if (level <= 10) {
    // Levels 1-10: Very easy (15 XP increase per level)
    // This helps new users level up quickly and feel rewarded
    return 100 + ((level - 1) * 15);
  } else if (level <= 30) {
    // Levels 11-30: Easy (25 XP increase per level)
    // Users are hooked, make progression steady
    return 250 + ((level - 10) * 25);
  } else if (level <= 60) {
    // Levels 31-60: Moderate (35 XP increase per level)
    // Dedicated users, reasonable challenge
    return 750 + ((level - 30) * 35);
  } else if (level <= 100) {
    // Levels 61-100: Steady (50 XP increase per level)
    // Veteran users, takes time but achievable
    return 1800 + ((level - 60) * 50);
  } else if (level <= 150) {
    // Levels 101-150: Challenging (75 XP increase per level)
    // Elite users, significant dedication required
    return 3800 + ((level - 100) * 75);
  } else if (level <= 200) {
    // Levels 151-200: Hard (100 XP increase per level)
    return 7550 + ((level - 150) * 100);
  } else {
    // Levels 200+: Very hard but possible (125 XP increase per level)
    return 12550 + ((level - 200) * 125);
  }
}

function calculateTotalXpForLevel(level) {
  let totalXp = 0;
  for (let i = 1; i <= level; i++) {
    totalXp += calculateXpForLevel(i);
  }
  return totalXp;
}

function getUserLevelInfo(userId) {
  const userData = userLevels.get(userId) || { xp: 0, level: 1, totalXp: 0 };
  const xpForCurrentLevel = calculateXpForLevel(userData.level);
  const xpForNextLevel = calculateXpForLevel(userData.level + 1);
  const currentLevelXp = userData.xp;
  const xpNeededForNextLevel = xpForNextLevel - currentLevelXp;
  
  return {
    level: userData.level,
    xp: userData.xp,
    totalXp: userData.totalXp,
    xpForCurrentLevel,
    xpForNextLevel,
    currentLevelXp,
    xpNeededForNextLevel,
    progress: (currentLevelXp / xpForCurrentLevel) * 100
  };
}

function addXpToUser(userId, guildId, xpToAdd) {
  if (!userLevels.has(userId)) {
    userLevels.set(userId, {
      xp: 0,
      level: 1,
      totalXp: 0,
      guildId: guildId,
      lastLevelUp: null
    });
  }
  
  const userData = userLevels.get(userId);
  userData.xp += xpToAdd;
  userData.totalXp += xpToAdd;
  
  const oldLevel = userData.level;
  const xpNeeded = calculateXpForLevel(userData.level);
  
  // Level up if XP exceeds needed amount
  while (userData.xp >= xpNeeded) {
    userData.xp -= xpNeeded;
    userData.level++;
    userData.lastLevelUp = new Date().toISOString();
    
    // Send level up message to log
    logToChannel(`🎉 **Level Up!** <@${userId}> reached level ${userData.level}!`);
  }
  
  return {
    leveledUp: userData.level > oldLevel,
    oldLevel,
    newLevel: userData.level,
    xpAdded: xpToAdd,
    currentXp: userData.xp,
    xpNeeded: calculateXpForLevel(userData.level)
  };
}

function createProgressBar(percentage, length = 20) {
  const filled = Math.round((percentage / 100) * length);
  const empty = length - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${percentage.toFixed(1)}%`;
}

// Function to handle XP gain
async function handleXpGain(message) {
  try {
    // Check if user is on cooldown
    const cooldownKey = `${message.guild.id}-${message.author.id}`;
    const cooldown = xpCooldowns.get(cooldownKey);
    
    if (cooldown && Date.now() - cooldown < LEVEL_CONFIG.COOLDOWN_MS) {
      return; // User is on cooldown
    }
    
    // Check if channel gives XP
    const channelName = message.channel.name.toLowerCase();
    const isXpChannel = LEVEL_CONFIG.XP_CHANNELS.some(xpChannel => 
      channelName.includes(xpChannel.toLowerCase())
    );
    
    if (!isXpChannel) {
      return; // Channel doesn't give XP
    }
    
    // Check if user has roles that block XP
    const member = message.member;
    const hasNoXpRole = LEVEL_CONFIG.NO_XP_ROLES.some(roleName => 
      member.roles.cache.some(role => role.name.toLowerCase() === roleName.toLowerCase())
    );
    
    if (hasNoXpRole) {
      return; // User has role that blocks XP
    }
    
    // Check message quality (anti-spam)
    if (message.content.length < 5) {
      return; // Message too short
    }
    
    // Generate random XP
    const xpGained = Math.floor(
      Math.random() * (LEVEL_CONFIG.MAX_XP_PER_MSG - LEVEL_CONFIG.MIN_XP_PER_MSG + 1)
    ) + LEVEL_CONFIG.MIN_XP_PER_MSG;
    
    // Add XP to user
    const result = addXpToUser(message.author.id, message.guild.id, xpGained);
    
    // Set cooldown
    xpCooldowns.set(cooldownKey, Date.now());
    
    // Send level up message
    if (result.leveledUp) {
      const levelUpEmbed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle(`🎉 Level Up!`)
        .setDescription(`Congratulations <@${message.author.id}>! You've reached **Level ${result.newLevel}**!`)
        .addFields(
          { name: '🎯 New Level', value: `**${result.newLevel}**`, inline: true },
          { name: '✨ XP Gained', value: `+${xpGained} XP`, inline: true },
          { name: '📊 Progress', value: `${result.currentXp}/${result.xpNeeded} XP`, inline: true }
        )
        .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: 'Keep chatting to level up more!' })
        .setTimestamp();
      
      // Send to channel if permission exists
      if (hasPermission(message.channel, PermissionsBitField.Flags.SendMessages)) {
        const sentMessage = await message.channel.send({ embeds: [levelUpEmbed] });
        
        // Delete level up message after 10 seconds
        setTimeout(() => {
          sentMessage.delete().catch(() => {});
        }, 10000);
      }
      
      // Save data on level up
      saveData();
    }
    
    // Log XP gain (every 10 XP gains to avoid spam)
    if (Math.random() < 0.1) { // 10% chance to log
      logToChannel(`✨ **XP Gain** - ${message.author.tag} gained ${xpGained} XP in ${message.channel} (Level ${result.newLevel})`);
    }
    
  } catch (error) {
    console.error('Error in handleXpGain:', error);
  }
}

// ==================== DATA PERSISTENCE SYSTEM ====================
const DATA_FILE = './bot_data.json';

// Function to save all data to file
function saveData() {
  try {
    const data = {
      userWarnings: Array.from(userWarnings.entries()),
      customResponses: Array.from(customResponses.entries()),
      selfAssignableRoles: Array.from(selfAssignableRoles),
      userLevels: Array.from(userLevels.entries()), // Add levels to save
      reminders: Array.from(reminders.entries()).map(([id, reminder]) => ({
        id,
        ...reminder,
        time: reminder.time // Save timestamp
      })),
      lastSaved: new Date().toISOString()
    };
    
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    console.log('💾 Data saved successfully');
    
    // Log to channel if available
    if (logChannel) {
      logToChannel('💾 Bot data saved to file');
    }
  } catch (error) {
    console.error('❌ Failed to save data:', error);
  }
}

// Function to load data from file
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      
      // Load user warnings
      if (data.userWarnings && Array.isArray(data.userWarnings)) {
        userWarnings.clear();
        data.userWarnings.forEach(([userId, warnings]) => {
          userWarnings.set(userId, warnings);
        });
        console.log(`📂 Loaded ${userWarnings.size} users with warnings`);
      }
      
      // Load custom responses
      if (data.customResponses && Array.isArray(data.customResponses)) {
        customResponses.clear();
        data.customResponses.forEach(([trigger, response]) => {
          customResponses.set(trigger, response);
        });
        console.log(`📂 Loaded ${customResponses.size} custom responses`);
      }
      
      // Load self-assignable roles
      if (data.selfAssignableRoles && Array.isArray(data.selfAssignableRoles)) {
        selfAssignableRoles.clear();
        data.selfAssignableRoles.forEach(roleId => {
          selfAssignableRoles.add(roleId);
        });
        console.log(`📂 Loaded ${selfAssignableRoles.size} self-assignable roles`);
      }
      
      // Load user levels
      if (data.userLevels && Array.isArray(data.userLevels)) {
        userLevels.clear();
        data.userLevels.forEach(([userId, levelData]) => {
          userLevels.set(userId, levelData);
        });
        console.log(`📂 Loaded ${userLevels.size} user levels`);
      }
      
      // Load reminders and reschedule them
      if (data.reminders && Array.isArray(data.reminders)) {
        reminders.clear();
        const now = Date.now();
        
        data.reminders.forEach(reminderData => {
          const { id, userId, channelId, text, time } = reminderData;
          
          // Only reschedule reminders that haven't passed yet
          if (time > now) {
            reminders.set(id, { userId, channelId, text, time });
            
            // Calculate time until reminder
            const timeUntilReminder = time - now;
            
            // Reschedule the reminder
            setTimeout(() => {
              const reminder = reminders.get(id);
              if (reminder) {
                const channel = client.channels.cache.get(reminder.channelId);
                if (channel) {
                  const reminderEmbed = createEmbed('⏰ Reminder', `**Reminder:** ${reminder.text}`, 0x00ff00, reminder.userId);
                  channel.send({ content: `<@${reminder.userId}>`, embeds: [reminderEmbed] });
                  logToChannel(`⏰ **Reminder Sent** - User ID: ${reminder.userId}: ${reminder.text}`);
                }
                reminders.delete(id);
                saveData(); // Save after removing reminder
              }
            }, timeUntilReminder);
            
            console.log(`⏰ Rescheduled reminder: ${text} (in ${Math.round(timeUntilReminder/1000)} seconds)`);
          } else {
            console.log(`⚠️ Skipping expired reminder: ${text}`);
          }
        });
        console.log(`📂 Loaded ${reminders.size} active reminders`);
      }
      
      if (data.lastSaved) {
        console.log(`📅 Data last saved: ${new Date(data.lastSaved).toLocaleString()}`);
      }
    } else {
      console.log('📂 No existing data file found, starting fresh');
    }
  } catch (error) {
    console.error('❌ Failed to load data:', error);
  }
}

// ==================== EMBED HELPER FUNCTIONS ====================
function createEmbed(title, description, color = 0x0099ff, mentionUser = null) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp();
  
  if (mentionUser) {
    embed.setFooter({ text: `For: ${mentionUser}` });
  }
  
  return embed;
}

function createErrorEmbed(description) {
  return createEmbed('❌ Error', description, 0xff0000);
}

function createSuccessEmbed(description) {
  return createEmbed('✅ Success', description, 0x00ff00);
}

function createInfoEmbed(description) {
  return createEmbed('ℹ️ Information', description, 0x0099ff);
}

function createWarningEmbed(description) {
  return createEmbed('⚠️ Warning', description, 0xffa500);
}

// ==================== STATUS NOTIFICATION FUNCTIONS ====================
async function sendStartupMessage() {
  try {
    // Find the test-1 channel
    const testChannel = client.channels.cache.find(channel => 
      channel.name === 'test-1'
    );
    
    if (testChannel) {
      // Check if bot has permission to send messages
      if (hasPermission(testChannel, PermissionsBitField.Flags.SendMessages)) {
        const startupEmbed = new EmbedBuilder()
          .setColor(0x00ff00)
          .setTitle('🤖 Bot Status: ONLINE')
          .setDescription('The bot has successfully started and is now online!')
          .addFields(
            {
              name: '📊 Startup Information',
              value: `• Bot: ${client.user.tag}\n• Loaded ${userWarnings.size} warned users\n• Loaded ${customResponses.size} custom responses\n• Loaded ${selfAssignableRoles.size} self-assignable roles\n• Loaded ${reminders.size} active reminders\n• Loaded ${userLevels.size} user levels`,
              inline: false
            },
            {
              name: '🕐 Start Time',
              value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
              inline: true
            },
            {
              name: '📈 Uptime',
              value: 'Just started',
              inline: true
            }
          )
          .setFooter({ text: 'Bot Startup Notification' })
          .setTimestamp();

        await testChannel.send({ embeds: [startupEmbed] });
        console.log(`✅ Startup message sent to #${testChannel.name}`);
      } else {
        console.log(`❌ No permission to send messages in #test-1`);
      }
    } else {
      console.log('❌ #test-1 channel not found');
    }
  } catch (error) {
    console.error('❌ Failed to send startup message:', error);
  }
}

async function sendShutdownMessage() {
  try {
    // Find the test-1 channel
    const testChannel = client.channels.cache.find(channel => 
      channel.name === 'test-1'
    );
    
    if (testChannel) {
      // Check if bot has permission to send messages
      if (hasPermission(testChannel, PermissionsBitField.Flags.SendMessages)) {
        const shutdownEmbed = new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle('🤖 Bot Status: OFFLINE')
          .setDescription('The bot is shutting down...')
          .addFields(
            {
              name: '📊 Shutdown Information',
              value: `• Bot: ${client.user.tag}\n• Saved ${userWarnings.size} warned users\n• Saved ${customResponses.size} custom responses\n• Saved ${selfAssignableRoles.size} self-assignable roles\n• Saved ${reminders.size} active reminders\n• Saved ${userLevels.size} user levels`,
              inline: false
            },
            {
              name: '🕐 Shutdown Time',
              value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
              inline: true
            },
            {
              name: '⚠️ Status',
              value: 'Bot is going offline',
              inline: true
            }
          )
          .setFooter({ text: 'Bot Shutdown Notification' })
          .setTimestamp();

        await testChannel.send({ embeds: [shutdownEmbed] });
        console.log(`✅ Shutdown message sent to #${testChannel.name}`);
      } else {
        console.log(`❌ No permission to send messages in #test-1`);
      }
    } else {
      console.log('❌ #test-1 channel not found');
    }
  } catch (error) {
    console.error('❌ Failed to send shutdown message:', error);
  }
}

// Auto-save every 5 minutes
setInterval(saveData, 5 * 60 * 1000);

// Save on process exit
process.on('SIGINT', async () => {
  console.log('💾 Saving data before shutdown...');
  await sendShutdownMessage();
  saveData();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('💾 Saving data before shutdown...');
  await sendShutdownMessage();
  saveData();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  console.error('❌ Uncaught Exception:', error);
  await sendShutdownMessage();
  saveData();
  process.exit(1);
});

process.on('unhandledRejection', async (error) => {
  console.error('❌ Unhandled Rejection:', error);
  await sendShutdownMessage();
  saveData();
  process.exit(1);
});

// ==================== UTILITY FUNCTIONS ====================
// CHECK IF BOT HAS PERMISSION IN CHANNEL
function hasPermission(channel, permission) {
  return channel.permissionsFor(client.user)?.has(permission) || false;
}

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

// ==================== EVENT HANDLERS ====================
client.once('ready', async () => {
  console.log(`✅ Bot is online as ${client.user.tag}!`);
  
  // Load saved data
  loadData();
  
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
    logToChannel(`📊 Loaded data: ${userWarnings.size} warned users, ${customResponses.size} custom responses, ${selfAssignableRoles.size} self-assignable roles, ${userLevels.size} user levels`);
    
    // Send startup message to test-1 channel
    await sendStartupMessage();
    
    await setupWelcomeChannel();
    await setupAnnouncementsChannel();
    await setupInfoChannels();
    await setupRulesChannel();
    await setupReportsChannel();
  } else {
    console.log('❌ Could not find bot-log channel');
    // Still send startup message even if log channel not found
    await sendStartupMessage();
  }
});

// ==================== CHANNEL SETUP FUNCTIONS ====================
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
          const welcomeEmbed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('👋 Welcome to Our Server!')
            .setDescription(`Welcome to **${guild.name}**! We're excited to have you here.`)
            .setThumbnail(guild.iconURL({ dynamic: true, size: 512 }))
            .addFields(
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
                value: '• `!help` - See all bot commands\n• `!roles` - List available roles\n• `!serverinfo` - Server statistics\n• `!userinfo` - Your profile info\n• `!level` - Check your level',
                inline: false
              }
            )
            .setFooter({ text: 'Enjoy your stay! 🎉' })
            .setTimestamp();

          await welcomeChannel.send({ embeds: [welcomeEmbed] });
          
          // Additional welcome message
          const welcomeTextEmbed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('Quick Tips')
            .setDescription(`
**Quick Tips:**
• Be respectful to everyone in the community
• Use appropriate channels for different topics  
• Don't hesitate to ask staff if you need help
• Most importantly - have fun! 🎮

We're glad to have you here! Feel free to explore and make yourself at home.
            `)
            .setTimestamp();

          await welcomeChannel.send({ embeds: [welcomeTextEmbed] });

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
          const announcementsEmbed = new EmbedBuilder()
            .setColor(0xffa500)
            .setTitle('📢 ANNOUNCEMENTS & UPDATES')
            .setDescription('**This is where important server news and updates will be posted!**\n\nMake sure to enable notifications to stay informed about server events, rule changes, and community news.')
            .setThumbnail(guild.iconURL({ dynamic: true, size: 512 }))
            .addFields(
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
            )
            .setFooter({ text: 'Stay informed and never miss an update!' })
            .setTimestamp();

          await announcementsChannel.send({ embeds: [announcementsEmbed] });
          
          // Additional announcement info
          const announcementInfoEmbed = new EmbedBuilder()
            .setColor(0xffa500)
            .setTitle('Announcement Guidelines')
            .setDescription(`
**📞 Contact Staff:**
If you have questions about any announcements, please contact the staff team.

**❌ No Chatting:**
Please keep this channel clear for announcements only. Use other channels for discussions.

**✅ Agreement:**
By staying in this server, you agree to read and acknowledge all announcements posted here.
            `)
            .setTimestamp();

          await announcementsChannel.send({ embeds: [announcementInfoEmbed] });

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
          const rulesEmbed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('📜 OFFICIAL SERVER RULES')
            .setDescription('**Please read and understand all rules before participating in the server.**\n\nBy being in this server, you agree to follow these rules. Failure to comply may result in warnings, kicks, or bans.')
            .setThumbnail(guild.iconURL({ dynamic: true, size: 512 }))
            .addFields(
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
            )
            .setFooter({ text: 'Rules last updated' })
            .setTimestamp();

          await rulesChannel.send({ embeds: [rulesEmbed] });

          // Consequences and Additional Info
          const consequencesEmbed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('🚨 Consequences & Reporting')
            .setDescription(`
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
            `)
            .setTimestamp();

          await rulesChannel.send({ embeds: [consequencesEmbed] });

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
          const reportsEmbed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('🚨 REPORTS CHANNEL')
            .setDescription('**This channel is for reporting rule violations and problematic users.**\n\nStaff will review all reports here.')
            .addFields(
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
            )
            .setFooter({ text: 'Thank you for helping keep our server safe!' })
            .setTimestamp();

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

          const serverInfoEmbed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle('🏠 Server Information')
            .setDescription(`Welcome to **${guild.name}**! Here's everything you need to know about our server.`)
            .setThumbnail(guild.iconURL({ dynamic: true, size: 512 }))
            .addFields(
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
            )
            .setFooter({ text: 'Last updated' })
            .setTimestamp();

          await serverInfoChannel.send({ embeds: [serverInfoEmbed] });
          
          // Additional server rules/info
          const serverRulesEmbed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle('📜 Quick Rules & Getting Started')
            .setDescription(`
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
            `)
            .setTimestamp();
          
          await serverInfoChannel.send({ embeds: [serverRulesEmbed] });
          
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
          const staffInfoEmbed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('🛡️ Staff Information & Guidelines')
            .setDescription('Welcome to the staff channel! This is for moderator discussions and coordination.')
            .addFields(
              {
                name: '📋 Staff Guidelines',
                value: '• Lead by example\n• Be active and responsive\n• Use proper moderation commands\n• Document actions in bot-logs\n• Keep sensitive discussions here',
                inline: false
              },
              {
                name: '⚡ Bot Commands',
                value: '**Moderation:**\n`!kick @user [reason]`\n`!ban @user [reason]`\n`!warn @user [reason]`\n`!clear 1-100`\n\n**Utility:**\n`!addassignablerole @role`\n`!addresponse trigger response`\n\n**Level System:**\n`!addlevel @user amount`\n`!setlevel @user level`\n`!givexp @user amount`\n`!xpconfig`',
                inline: true
              },
              {
                name: '📝 Important Notes',
                value: `• All moderation commands are silent in public channels\n• Everything is logged in bot-logs\n• Use DMs for sensitive user issues\n• Coordinate major actions in ${guild.channels.cache.find(c => c.name === 'mod-chat')?.toString() || '#mod-chat'}`,
                inline: true
              }
            )
            .setFooter({ text: 'Staff Guidelines' })
            .setTimestamp();

          await staffChannel.send({ embeds: [staffInfoEmbed] });
          
          // Staff role management info
          const staffCommandsEmbed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('🔧 Staff Commands')
            .setDescription(`
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

**📈 Level System:**
Manage the XP and level system:
\`!addlevel @user amount\` - Add levels to user
\`!setlevel @user level\` - Set user to specific level
\`!removelevel @user amount\` - Remove levels from user
\`!givexp @user amount\` - Give XP to user
\`!xpconfig\` - View XP settings
\`!bulklevel action amount @role\` - Manage levels for role members
            `)
            .setTimestamp();
          
          await staffChannel.send({ embeds: [staffCommandsEmbed] });
          
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
  } catch (error) {
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
    
    const welcomeEmbed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle(`👋 Welcome ${member.user.username}!`)
      .setDescription(`Welcome to **${member.guild.name}**!\n\nPlease read the rules in ${rulesChannel || '#rules'} and check out ${serverInfoChannel || '#server-info'} for server information!`)
      .setThumbnail(member.user.displayAvatarURL())
      .setFooter({ text: `Member #${member.guild.memberCount}` })
      .setTimestamp();
    
    welcomeChannel.send({ embeds: [welcomeEmbed] });
    
    logToChannel(`👋 **Member Joined** - ${member.user.tag} (${member.id})`);
  }
});

// ==================== MESSAGE CREATE EVENT ====================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  
  // Handle XP gain for non-command messages
  if (!message.content.startsWith('!')) {
    await handleXpGain(message);
  } else {
    // Handle commands
    const args = message.content.slice(1).split(/ +/);
    const command = args.shift().toLowerCase();

    // Log all commands received
    logToChannel(`**Command Received** in ${message.channel}\n**User:** ${message.author.tag} | **Command:** ${message.content}`);

    // ==================== LEVEL MANAGEMENT COMMANDS ====================

        // ADD LEVEL COMMAND (Admin/Mod only)
    if (command === 'addlevel' || command === 'levelup') {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        const errorEmbed = createErrorEmbed('❌ You need **Manage Messages** permission.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      const targetMember = message.mentions.members.first();
      const levelsToAdd = parseInt(args[1]) || 1;

      if (!targetMember) {
        const errorEmbed = createErrorEmbed('❌ Usage: `!addlevel @user [amount]`\nExample: `!addlevel @User 5`');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      if (levelsToAdd < 1 || levelsToAdd > 50) {
        const errorEmbed = createErrorEmbed('❌ You can only add between 1 and 50 levels at once.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      // Get current user data or initialize
      if (!userLevels.has(targetMember.id)) {
        userLevels.set(targetMember.id, {
          xp: 0,
          level: 1,
          totalXp: 0,
          guildId: message.guild.id,
          lastLevelUp: null
        });
      }

      const userData = userLevels.get(targetMember.id);
      const oldLevel = userData.level;
      const oldTotalXp = userData.totalXp;
      const oldXp = userData.xp; // Current XP in current level
      
      // CORRECTED: Calculate XP needed to reach the new level
      // First, calculate total XP needed to reach old level (without current XP)
      let totalXpForOldLevel = 0;
      for (let i = 1; i < oldLevel; i++) { // Note: i < oldLevel, not <=
        totalXpForOldLevel += calculateXpForLevel(i);
      }
      
      // Now calculate total XP needed to reach new level
      const newLevel = oldLevel + levelsToAdd;
      let totalXpForNewLevel = 0;
      for (let i = 1; i < newLevel; i++) { // Note: i < newLevel, not <=
        totalXpForNewLevel += calculateXpForLevel(i);
      }
      
      // The XP to add is the difference between the two totals
      const xpToAdd = totalXpForNewLevel - totalXpForOldLevel;
      
      // Add the XP (this will handle leveling up properly)
      const result = addXpToUser(targetMember.id, message.guild.id, xpToAdd);
      
      // Ensure we end up at exactly the right level
      if (result.newLevel !== newLevel) {
        // Manual adjustment if needed
        userData.level = newLevel;
        userData.xp = 0; // Start fresh at new level
        userData.totalXp = totalXpForNewLevel + oldXp; // Keep any overflow XP
        
        // Recalculate result for display
        result.newLevel = newLevel;
        result.leveledUp = newLevel > oldLevel;
      }
      
      const addLevelEmbed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('📈 Level Added')
        .addFields(
          { name: '👤 User', value: targetMember.user.tag, inline: true },
          { name: '📊 Levels Added', value: `+${levelsToAdd}`, inline: true },
          { name: '🎯 Old Level', value: oldLevel.toString(), inline: true },
          { name: '🏆 New Level', value: result.newLevel.toString(), inline: true },
          { name: '✨ Total Levels Gained', value: `${result.newLevel - oldLevel}`, inline: true },
          { name: '📈 XP Added', value: `${xpToAdd.toLocaleString()} XP`, inline: true }
        )
        .setFooter({ text: `Added by ${message.author.tag}` })
        .setTimestamp();

      message.reply({ embeds: [addLevelEmbed] }).then(botMsg => {
        logBotResponse(message, botMsg.content, 'Add Level');
      });
      
      // Save data
      saveData();
      
      // Send level up celebration if levels were added
      if (result.newLevel > oldLevel) {
        const levelUpEmbed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle(`🎉 LEVEL UP CELEBRATION!`)
          .setDescription(`**Congratulations <@${targetMember.id}>!**\nYou've been promoted by staff!`)
          .addFields(
            { name: '🚀 Level Boost', value: `From **Level ${oldLevel}** → **Level ${result.newLevel}**`, inline: false },
            { name: '📈 Levels Gained', value: `**+${result.newLevel - oldLevel} levels**`, inline: true },
            { name: '✨ XP Awarded', value: `**+${xpToAdd.toLocaleString()} XP**`, inline: true }
          )
          .setThumbnail(targetMember.user.displayAvatarURL({ dynamic: true }))
          .setFooter({ text: 'Level boost granted by staff!' })
          .setTimestamp();
        
        if (hasPermission(message.channel, PermissionsBitField.Flags.SendMessages)) {
          const celebrationMsg = await message.channel.send({ 
            content: `<@${targetMember.id}>`, 
            embeds: [levelUpEmbed] 
          });
          
          // Add celebration reactions
          celebrationMsg.react('🎉').catch(() => {});
          celebrationMsg.react('🚀').catch(() => {});
          celebrationMsg.react('🏆').catch(() => {});
        }
      }
    }

    // SET LEVEL COMMAND (Admin only)
    if (command === 'setlevel') {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        const errorEmbed = createErrorEmbed('❌ You need **Administrator** permission.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      const targetMember = message.mentions.members.first();
      const targetLevel = parseInt(args[1]);

      if (!targetMember || isNaN(targetLevel) || targetLevel < 1) {
        const errorEmbed = createErrorEmbed('❌ Usage: `!setlevel @user <level>`\nExample: `!setlevel @User 25`');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      if (targetLevel > 1000) {
        const errorEmbed = createErrorEmbed('❌ Maximum level is 1000.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      // Get current user data or initialize
      if (!userLevels.has(targetMember.id)) {
        userLevels.set(targetMember.id, {
          xp: 0,
          level: 1,
          totalXp: 0,
          guildId: message.guild.id,
          lastLevelUp: null
        });
      }

      const userData = userLevels.get(targetMember.id);
      const oldLevel = userData.level;
      
      // Calculate total XP for the target level
      let totalXpNeeded = 0;
      for (let i = 1; i <= targetLevel; i++) {
        totalXpNeeded += calculateXpForLevel(i);
      }
      
      // Set new values
      userData.level = targetLevel;
      userData.xp = 0; // Reset XP for current level
      userData.totalXp = totalXpNeeded;
      userData.lastLevelUp = new Date().toISOString();
      
      const setLevelEmbed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('⚙️ Level Set')
        .addFields(
          { name: '👤 User', value: targetMember.user.tag, inline: true },
          { name: '📊 Old Level', value: oldLevel.toString(), inline: true },
          { name: '🏆 New Level', value: targetLevel.toString(), inline: true },
          { name: '📈 Level Change', value: `${oldLevel < targetLevel ? '+' : ''}${targetLevel - oldLevel}`, inline: true },
          { name: '✨ Total XP', value: `${totalXpNeeded.toLocaleString()} XP`, inline: true },
          { name: '🎯 XP for Next Level', value: `${calculateXpForLevel(targetLevel + 1).toLocaleString()} XP`, inline: true }
        )
        .setFooter({ text: `Set by ${message.author.tag}` })
        .setTimestamp();

      message.reply({ embeds: [setLevelEmbed] }).then(botMsg => {
        logBotResponse(message, botMsg.content, 'Set Level');
      });
      
      // Save data
      saveData();
      
      // Log to channel
      logToChannel(`⚙️ **Level Set** - ${message.author.tag} set ${targetMember.user.tag} from level ${oldLevel} to level ${targetLevel}`);
    }

    // REMOVE LEVEL COMMAND (Admin/Mod only)
    if (command === 'removelevel' || command === 'leveldown') {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        const errorEmbed = createErrorEmbed('❌ You need **Manage Messages** permission.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      const targetMember = message.mentions.members.first();
      const levelsToRemove = parseInt(args[1]) || 1;

      if (!targetMember) {
        const errorEmbed = createErrorEmbed('❌ Usage: `!removelevel @user [amount]`\nExample: `!removelevel @User 3`');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      if (!userLevels.has(targetMember.id)) {
        const errorEmbed = createErrorEmbed(`❌ ${targetMember.user.tag} doesn't have any level data.`);
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      const userData = userLevels.get(targetMember.id);
      const oldLevel = userData.level;
      
      // Calculate new level (minimum 1)
      const newLevel = Math.max(1, oldLevel - levelsToRemove);
      
      if (newLevel === oldLevel) {
        const errorEmbed = createErrorEmbed(`❌ ${targetMember.user.tag} is already at minimum level (1).`);
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }
      
      // Calculate total XP for the new level
      let totalXpNeeded = 0;
      for (let i = 1; i <= newLevel; i++) {
        totalXpNeeded += calculateXpForLevel(i);
      }
      
      // Update user data
      userData.level = newLevel;
      userData.xp = 0; // Reset XP for current level
      userData.totalXp = totalXpNeeded;
      userData.lastLevelUp = new Date().toISOString();
      
      const removeLevelEmbed = new EmbedBuilder()
        .setColor(0xff6b6b)
        .setTitle('📉 Level Removed')
        .addFields(
          { name: '👤 User', value: targetMember.user.tag, inline: true },
          { name: '📊 Levels Removed', value: `-${levelsToRemove}`, inline: true },
          { name: '🎯 Old Level', value: oldLevel.toString(), inline: true },
          { name: '🏆 New Level', value: newLevel.toString(), inline: true },
          { name: '📈 Level Change', value: `-${oldLevel - newLevel}`, inline: true },
          { name: '✨ Total XP', value: `${totalXpNeeded.toLocaleString()} XP`, inline: true }
        )
        .setFooter({ text: `Removed by ${message.author.tag}` })
        .setTimestamp();

      message.reply({ embeds: [removeLevelEmbed] }).then(botMsg => {
        logBotResponse(message, botMsg.content, 'Remove Level');
      });
      
      // Save data
      saveData();
      
      // Log to channel
      logToChannel(`📉 **Level Removed** - ${message.author.tag} removed ${levelsToRemove} levels from ${targetMember.user.tag} (${oldLevel} → ${newLevel})`);
    }

    // VIEW USER'S LEVEL DETAILS COMMAND
    if (command === 'leveldetails' || command === 'xpdetails') {
      // Check if bot has permission
      if (!hasPermission(message.channel, PermissionsBitField.Flags.SendMessages)) {
        logToChannel(`❌ Missing Send Messages permission in ${message.channel}`);
        return;
      }

      const targetMember = message.mentions.members.first() || message.member;
      const userInfo = getUserLevelInfo(targetMember.id);
      
      // Calculate XP needed for next 5 levels
      let nextLevelsInfo = '';
      for (let i = 1; i <= 5; i++) {
        const nextLevel = userInfo.level + i;
        const xpForLevel = calculateXpForLevel(nextLevel);
        const totalXpForLevel = calculateTotalXpForLevel(nextLevel);
        nextLevelsInfo += `**Level ${nextLevel}:** ${xpForLevel.toLocaleString()} XP needed (Total: ${totalXpForLevel.toLocaleString()} XP)\n`;
      }
      
      // Calculate rank (position on leaderboard)
      const allUsers = Array.from(userLevels.entries())
        .map(([userId, data]) => ({
          userId,
          totalXp: data.totalXp || 0,
          level: data.level || 1
        }))
        .sort((a, b) => (b.totalXp || 0) - (a.totalXp || 0));
      
      const rank = allUsers.findIndex(user => user.userId === targetMember.id) + 1;
      const totalUsers = allUsers.length;
      
      const detailsEmbed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setAuthor({ 
          name: targetMember.user.tag, 
          iconURL: targetMember.user.displayAvatarURL({ dynamic: true }) 
        })
        .setTitle('📊 Detailed Level Information')
        .setThumbnail(targetMember.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
          { 
            name: '🏆 Current Stats', 
            value: `**Level:** ${userInfo.level}\n**Current XP:** ${userInfo.currentLevelXp}/${userInfo.xpForCurrentLevel}\n**Total XP:** ${userInfo.totalXp.toLocaleString()}\n**Progress:** ${createProgressBar(userInfo.progress)}`, 
            inline: false 
          },
          { 
            name: '📈 Next Level', 
            value: `**XP Needed:** ${userInfo.xpNeededForNextLevel.toLocaleString()} XP\n**Progress:** ${((userInfo.currentLevelXp / userInfo.xpForCurrentLevel) * 100).toFixed(1)}%\n**Est. Messages:** ${Math.ceil(userInfo.xpNeededForNextLevel / ((LEVEL_CONFIG.MIN_XP_PER_MSG + LEVEL_CONFIG.MAX_XP_PER_MSG) / 2))}`, 
            inline: true 
          },
          { 
            name: '🥇 Rank', 
            value: rank > 0 ? `**Rank:** #${rank}/${totalUsers}\n**Top:** ${((rank / totalUsers) * 100).toFixed(1)}%` : 'Not ranked yet', 
            inline: true 
          },
          { 
            name: '🎯 Next 5 Levels', 
            value: nextLevelsInfo, 
            inline: false 
          }
        )
        .setFooter({ text: `Requested by ${message.author.tag}` })
        .setTimestamp();

      message.reply({ embeds: [detailsEmbed] }).then(botMsg => {
        logBotResponse(message, `Detailed level info for ${targetMember.user.tag}`, 'Level Details');
      });
    }

    // BULK LEVEL MANAGEMENT COMMAND (Admin only)
    if (command === 'bulklevel') {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        const errorEmbed = createErrorEmbed('❌ You need **Administrator** permission.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      const action = args[0]?.toLowerCase();
      const amount = parseInt(args[1]);
      const role = message.mentions.roles.first();

      if (!action || !['add', 'remove', 'set'].includes(action) || isNaN(amount) || !role) {
        const errorEmbed = createErrorEmbed('❌ Usage: `!bulklevel <add|remove|set> <amount> @role`\nExamples:\n`!bulklevel add 5 @VIP`\n`!bulklevel set 10 @Members`\n`!bulklevel remove 3 @Muted`');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      if (amount < 1 || (action === 'set' && amount > 1000) || (action !== 'set' && amount > 50)) {
        const errorEmbed = createErrorEmbed('❌ Invalid amount. Max 50 for add/remove, max 1000 for set.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      // Get all members with the role
      const membersWithRole = role.members.filter(member => !member.user.bot);
      
      if (membersWithRole.size === 0) {
        const errorEmbed = createErrorEmbed(`❌ No members found with the role ${role.name}.`);
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      const processingEmbed = new EmbedBuilder()
        .setColor(0xf39c12)
        .setTitle('🔄 Processing Bulk Level Update')
        .setDescription(`Processing **${membersWithRole.size}** members with role ${role.toString()}...`)
        .setFooter({ text: 'This may take a moment' })
        .setTimestamp();

      const processingMsg = await message.reply({ embeds: [processingEmbed] });
      
      let updatedCount = 0;
      let failedCount = 0;
      let totalLevelsChanged = 0;
      
      // Process each member
      for (const member of membersWithRole.values()) {
        try {
          // Initialize user data if not exists
          if (!userLevels.has(member.id)) {
            userLevels.set(member.id, {
              xp: 0,
              level: 1,
              totalXp: 0,
              guildId: message.guild.id,
              lastLevelUp: null
            });
          }
          
          const userData = userLevels.get(member.id);
          const oldLevel = userData.level;
          let newLevel = oldLevel;
          
          if (action === 'add') {
            newLevel = oldLevel + amount;
          } else if (action === 'remove') {
            newLevel = Math.max(1, oldLevel - amount);
          } else if (action === 'set') {
            newLevel = amount;
          }
          
          // Calculate total XP for new level
          let totalXpNeeded = 0;
          for (let i = 1; i <= newLevel; i++) {
            totalXpNeeded += calculateXpForLevel(i);
          }
          
          // Update user data
          userData.level = newLevel;
          userData.xp = 0;
          userData.totalXp = totalXpNeeded;
          userData.lastLevelUp = new Date().toISOString();
          
          updatedCount++;
          totalLevelsChanged += Math.abs(newLevel - oldLevel);
          
        } catch (error) {
          failedCount++;
          console.error(`Failed to update level for ${member.user.tag}:`, error);
        }
      }
      
      // Save data
      saveData();
      
      const resultEmbed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('✅ Bulk Level Update Complete')
        .addFields(
          { name: '🎯 Action', value: action.toUpperCase(), inline: true },
          { name: '📊 Amount', value: amount.toString(), inline: true },
          { name: '🎭 Role', value: role.toString(), inline: true },
          { name: '✅ Updated', value: `${updatedCount} members`, inline: true },
          { name: '❌ Failed', value: `${failedCount} members`, inline: true },
          { name: '📈 Total Levels Changed', value: `${totalLevelsChanged} levels`, inline: true }
        )
        .setFooter({ text: `Executed by ${message.author.tag}` })
        .setTimestamp();
      
      await processingMsg.edit({ embeds: [resultEmbed] });
      
      logToChannel(`📊 **Bulk Level Update** - ${message.author.tag} ${action}ed ${amount} levels to ${updatedCount} members with role ${role.name}`);
    }

    // LEVEL REWARD ROLE COMMAND (Admin only)
    if (command === 'levelrewardrole') {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        const errorEmbed = createErrorEmbed('❌ You need **Administrator** permission.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      const level = parseInt(args[0]);
      const role = message.mentions.roles.first();

      if (isNaN(level) || level < 1 || !role) {
        const errorEmbed = createErrorEmbed('❌ Usage: `!levelrewardrole <level> @role`\nExample: `!levelrewardrole 10 @VIP`');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      if (level > 1000) {
        const errorEmbed = createErrorEmbed('❌ Maximum level is 1000.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      // Store level reward roles (you might want to add this to your save/load system)
      // For now, we'll just show a confirmation
      const rewardEmbed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle('🎁 Level Reward Role Configured')
        .addFields(
          { name: '🎯 Level Requirement', value: `Level ${level}`, inline: true },
          { name: '🎭 Reward Role', value: role.toString(), inline: true },
          { name: '👥 Role Members', value: `${role.members.size} members`, inline: true }
        )
        .setDescription(`**Note:** This is a visual configuration. You'll need to manually assign this role or create an automated system.\n\nUsers who reach level ${level} will be eligible for the ${role.name} role.`)
        .setFooter({ text: `Configured by ${message.author.tag}` })
        .setTimestamp();

      message.reply({ embeds: [rewardEmbed] }).then(botMsg => {
        logBotResponse(message, botMsg.content, 'Level Reward Role');
      });
      
      logToChannel(`🎁 **Level Reward Role** - ${message.author.tag} set level ${level} reward to ${role.name} role`);
    }

    // CHECK LEVEL REQUIREMENTS COMMAND
    if (command === 'levelreq' || command === 'levelrequirements') {
      // Check if bot has permission
      if (!hasPermission(message.channel, PermissionsBitField.Flags.SendMessages)) {
        logToChannel(`❌ Missing Send Messages permission in ${message.channel}`);
        return;
      }

      const targetLevel = parseInt(args[0]) || 10; // Default to showing level 10 requirements

      if (isNaN(targetLevel) || targetLevel < 1) {
        const errorEmbed = createErrorEmbed('❌ Usage: `!levelreq [level]`\nExample: `!levelreq 50`');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      if (targetLevel > 1000) {
        const errorEmbed = createErrorEmbed('❌ Maximum level is 1000.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      // Calculate XP requirements
      let totalXp = 0;
      let requirements = '```\n';
      
      for (let i = 1; i <= targetLevel; i++) {
        const xpForLevel = calculateXpForLevel(i);
        totalXp += xpForLevel;
        
        if (i <= 20 || i === targetLevel || i % 10 === 0) {
          requirements += `Level ${i.toString().padEnd(4)}: ${xpForLevel.toLocaleString().padEnd(10)} XP | Total: ${totalXp.toLocaleString()} XP\n`;
        }
      }
      
      requirements += '```';
      
      // Calculate estimated messages needed
      const avgXpPerMsg = (LEVEL_CONFIG.MIN_XP_PER_MSG + LEVEL_CONFIG.MAX_XP_PER_MSG) / 2;
      const estimatedMessages = Math.ceil(totalXp / avgXpPerMsg);
      const estimatedHours = Math.ceil(estimatedMessages * (LEVEL_CONFIG.COOLDOWN_MS / 1000) / 3600);
      const estimatedDays = (estimatedHours / 24).toFixed(1);
      
      const reqEmbed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle(`📊 Level ${targetLevel} Requirements`)
        .setDescription(`**Total XP Needed:** ${totalXp.toLocaleString()} XP`)
        .addFields(
          { name: '📈 XP Breakdown', value: requirements, inline: false },
          { name: '⏰ Time Estimates', value: `**Messages:** ~${estimatedMessages.toLocaleString()}\n**Hours (Active):** ~${estimatedHours.toLocaleString()}\n**Days:** ~${estimatedDays}`, inline: true },
          { name: '🎯 Current Rate', value: `**Min XP/msg:** ${LEVEL_CONFIG.MIN_XP_PER_MSG}\n**Max XP/msg:** ${LEVEL_CONFIG.MAX_XP_PER_MSG}\n**Avg XP/msg:** ${avgXpPerMsg.toFixed(1)}\n**Cooldown:** ${LEVEL_CONFIG.COOLDOWN_MS/1000}s`, inline: true }
        )
        .setFooter({ text: `Requested by ${message.author.tag}` })
        .setTimestamp();

      message.reply({ embeds: [reqEmbed] }).then(botMsg => {
        logBotResponse(message, `Level requirements for level ${targetLevel}`, 'Level Requirements');
      });
    }

    // ==================== EXISTING LEVEL SYSTEM COMMANDS ====================

    // LEVEL COMMAND - Show user's level
    if (command === 'level' || command === 'rank' || command === 'xp') {
      // Check if bot has permission
      if (!hasPermission(message.channel, PermissionsBitField.Flags.SendMessages)) {
        logToChannel(`❌ Missing Send Messages permission in ${message.channel}`);
        return;
      }

      const targetMember = message.mentions.members.first() || message.member;
      const userInfo = getUserLevelInfo(targetMember.id);
      
      const levelEmbed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setAuthor({ 
          name: targetMember.user.tag, 
          iconURL: targetMember.user.displayAvatarURL({ dynamic: true }) 
        })
        .setTitle('📊 Level Statistics')
        .setThumbnail(targetMember.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
          { 
            name: '🏆 Level', 
            value: `**${userInfo.level}**`, 
            inline: true 
          },
          { 
            name: '✨ XP', 
            value: `**${userInfo.currentLevelXp}** / **${userInfo.xpForCurrentLevel}**`, 
            inline: true 
          },
          { 
            name: '📈 Total XP', 
            value: `**${userInfo.totalXp.toLocaleString()}**`, 
            inline: true 
          },
          { 
            name: '🎯 Progress to Next Level', 
            value: createProgressBar(userInfo.progress), 
            inline: false 
          },
          { 
            name: '📊 Next Level', 
            value: `**${userInfo.xpNeededForNextLevel}** XP needed for level **${userInfo.level + 1}**`, 
            inline: false 
          }
        )
        .setFooter({ text: 'Keep chatting to earn more XP!' })
        .setTimestamp();

      message.reply({ embeds: [levelEmbed] }).then(botMsg => {
        logBotResponse(message, `Level info for ${targetMember.user.tag}`, 'Level Command');
      });
    }

    // LEADERBOARD COMMAND - Show top users
    if (command === 'leaderboard' || command === 'top' || command === 'lb') {
      // Check if bot has permission
      if (!hasPermission(message.channel, PermissionsBitField.Flags.SendMessages)) {
        logToChannel(`❌ Missing Send Messages permission in ${message.channel}`);
        return;
      }

      if (userLevels.size === 0) {
        const errorEmbed = createErrorEmbed('📊 No level data available yet. Start chatting to earn XP!');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Leaderboard Error');
        });
        return;
      }

      // Convert to array and sort by total XP
      const sortedUsers = Array.from(userLevels.entries())
        .map(([userId, data]) => ({
          userId,
          ...data,
          totalXp: data.totalXp || 0
        }))
        .sort((a, b) => (b.totalXp || 0) - (a.totalXp || 0))
        .slice(0, 10); // Top 10

      let leaderboardText = '';
      for (let i = 0; i < sortedUsers.length; i++) {
        const user = sortedUsers[i];
        const member = message.guild.members.cache.get(user.userId);
        const username = member ? member.user.tag : `Unknown User (${user.userId})`;
        
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        
        leaderboardText += `${medal} **${username}**\n`;
        leaderboardText += `   Level: ${user.level} | Total XP: ${user.totalXp.toLocaleString()}\n\n`;
      }

      const leaderboardEmbed = new EmbedBuilder()
        .setColor(0xffd700)
        .setTitle('🏆 Leaderboard - Top 10 Users')
        .setDescription(leaderboardText || 'No users on the leaderboard yet.')
        .setThumbnail(message.guild.iconURL({ dynamic: true }))
        .addFields(
          { 
            name: '📊 Total Users', 
            value: userLevels.size.toString(), 
            inline: true 
          },
          { 
            name: '🎯 How to Gain XP', 
            value: 'Chat in active channels to earn XP!', 
            inline: true 
          }
        )
        .setFooter({ text: `Requested by ${message.author.tag}` })
        .setTimestamp();

      message.reply({ embeds: [leaderboardEmbed] }).then(botMsg => {
        logBotResponse(message, 'Leaderboard displayed', 'Leaderboard Command');
      });
    }

    // GIVE XP COMMAND (Admin/Mod only)
    if (command === 'givexp' || command === 'addxp') {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        const errorEmbed = createErrorEmbed('❌ You need **Manage Messages** permission.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      const targetMember = message.mentions.members.first();
      const xpAmount = parseInt(args[1]);

      if (!targetMember || isNaN(xpAmount) || xpAmount <= 0) {
        const errorEmbed = createErrorEmbed('❌ Usage: `!givexp @user <amount>`');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      if (xpAmount > 1000) {
        const errorEmbed = createErrorEmbed('❌ Maximum XP to give is 1000.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      const result = addXpToUser(targetMember.id, message.guild.id, xpAmount);
      
      const giveXpEmbed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('✨ XP Given')
        .addFields(
          { name: '👤 User', value: targetMember.user.tag, inline: true },
          { name: '🎯 XP Given', value: `+${xpAmount}`, inline: true },
          { name: '🏆 New Level', value: result.newLevel.toString(), inline: true },
          { name: '📊 Current XP', value: `${result.currentXp}/${result.xpNeeded}`, inline: true }
        )
        .setFooter({ text: `Given by ${message.author.tag}` })
        .setTimestamp();

      message.reply({ embeds: [giveXpEmbed] }).then(botMsg => {
        logBotResponse(message, botMsg.content, 'Give XP');
      });
      
      // Save data after giving XP
      saveData();
    }

    // RESET XP COMMAND (Admin only)
    if (command === 'resetxp') {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        const errorEmbed = createErrorEmbed('❌ You need **Administrator** permission.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      const targetMember = message.mentions.members.first();
      
      if (!targetMember) {
        const errorEmbed = createErrorEmbed('❌ Usage: `!resetxp @user`');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      userLevels.delete(targetMember.id);
      
      const resetEmbed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('🔄 XP Reset')
        .setDescription(`**${targetMember.user.tag}'s** XP and level have been reset to 0.`)
        .setFooter({ text: `Reset by ${message.author.tag}` })
        .setTimestamp();

      message.reply({ embeds: [resetEmbed] }).then(botMsg => {
        logBotResponse(message, botMsg.content, 'Reset XP');
      });
      
      saveData();
    }

    // XP CONFIG COMMAND (Admin only)
    if (command === 'xpconfig') {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        const errorEmbed = createErrorEmbed('❌ You need **Administrator** permission.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      const configEmbed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle('⚙️ XP System Configuration')
        .addFields(
          { name: '🎯 Base XP', value: LEVEL_CONFIG.BASE_XP.toString(), inline: true },
          { name: '📈 Multiplier', value: LEVEL_CONFIG.XP_MULTIPLIER.toString(), inline: true },
          { name: '⬇️ Min XP/Message', value: LEVEL_CONFIG.MIN_XP_PER_MSG.toString(), inline: true },
          { name: '⬆️ Max XP/Message', value: LEVEL_CONFIG.MAX_XP_PER_MSG.toString(), inline: true },
          { name: '⏰ Cooldown', value: `${LEVEL_CONFIG.COOLDOWN_MS / 1000} seconds`, inline: true },
          { name: '📊 Total Users', value: userLevels.size.toString(), inline: true },
          { 
            name: '💬 XP Channels', 
            value: LEVEL_CONFIG.XP_CHANNELS.map(ch => `• ${ch}`).join('\n') || 'All channels', 
            inline: false 
          },
          { 
            name: '🚫 No-XP Roles', 
            value: LEVEL_CONFIG.NO_XP_ROLES.map(role => `• ${role}`).join('\n') || 'None', 
            inline: false 
          }
        )
        .setFooter({ text: 'Use !xpconfigset to change values' })
        .setTimestamp();

      message.reply({ embeds: [configEmbed] }).then(botMsg => {
        logBotResponse(message, 'XP config displayed', 'XP Config');
      });
    }

    // XP CONFIG SET COMMAND (Admin only)
    if (command === 'xpconfigset') {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        const errorEmbed = createErrorEmbed('❌ You need **Administrator** permission.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      const setting = args[0]?.toLowerCase();
      const value = args[1];

      if (!setting || !value) {
        const errorEmbed = createErrorEmbed('❌ Usage: `!xpconfigset <setting> <value>`\nSettings: basexp, multiplier, minxp, maxxp, cooldown');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      let parsedValue;
      let success = false;
      let messageText = '';

      switch (setting) {
        case 'basexp':
          parsedValue = parseInt(value);
          if (!isNaN(parsedValue) && parsedValue > 0) {
            LEVEL_CONFIG.BASE_XP = parsedValue;
            success = true;
            messageText = `Base XP set to ${parsedValue}`;
          }
          break;
          
        case 'multiplier':
          parsedValue = parseFloat(value);
          if (!isNaN(parsedValue) && parsedValue > 1) {
            LEVEL_CONFIG.XP_MULTIPLIER = parsedValue;
            success = true;
            messageText = `XP multiplier set to ${parsedValue}`;
          }
          break;
          
        case 'minxp':
          parsedValue = parseInt(value);
          if (!isNaN(parsedValue) && parsedValue > 0) {
            LEVEL_CONFIG.MIN_XP_PER_MSG = parsedValue;
            success = true;
            messageText = `Minimum XP per message set to ${parsedValue}`;
          }
          break;
          
        case 'maxxp':
          parsedValue = parseInt(value);
          if (!isNaN(parsedValue) && parsedValue > LEVEL_CONFIG.MIN_XP_PER_MSG) {
            LEVEL_CONFIG.MAX_XP_PER_MSG = parsedValue;
            success = true;
            messageText = `Maximum XP per message set to ${parsedValue}`;
          }
          break;
          
        case 'cooldown':
          parsedValue = parseInt(value);
          if (!isNaN(parsedValue) && parsedValue > 0) {
            LEVEL_CONFIG.COOLDOWN_MS = parsedValue * 1000;
            success = true;
            messageText = `Cooldown set to ${parsedValue} seconds`;
          }
          break;
      }

      if (success) {
        const successEmbed = createSuccessEmbed(`✅ ${messageText}`);
        message.reply({ embeds: [successEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'XP Config Update');
        });
        saveData();
      } else {
        const errorEmbed = createErrorEmbed('❌ Invalid value or setting. Check the values and try again.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
      }
    }

    // LEVEL REWARDS COMMAND
    if (command === 'levelrewards') {
      if (!hasPermission(message.channel, PermissionsBitField.Flags.SendMessages)) {
        logToChannel(`❌ Missing Send Messages permission in ${message.channel}`);
        return;
      }

      const rewardsEmbed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle('🎁 Level Rewards')
        .setDescription('Special rewards for reaching certain levels!')
        .addFields(
          { name: '🎯 Level 5', value: '• Special role color\n• Access to #level-5-chat', inline: true },
          { name: '🏆 Level 10', value: '• Custom emoji perms\n• Early access features', inline: true },
          { name: '🌟 Level 20', value: '• VIP role\n• Custom nickname color', inline: true },
          { name: '👑 Level 30', value: '• Special badge in profile\n• Mention in announcements', inline: true },
          { name: '💎 Level 50', value: '• Legendary role\n• Custom voice channel', inline: true },
          { name: '🚀 Level 100', value: '• Server Hall of Fame\n• Special bot commands', inline: true }
        )
        .setFooter({ text: 'Keep leveling up to unlock rewards!' })
        .setTimestamp();

      message.reply({ embeds: [rewardsEmbed] }).then(botMsg => {
        logBotResponse(message, 'Level rewards displayed', 'Level Rewards');
      });
    }

    // ==================== EXISTING COMMANDS (STARTING FROM HERE) ====================

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
      
      const setupEmbed = createSuccessEmbed('✅ All channels have been set up successfully!');
      message.author.send({ embeds: [setupEmbed] }).catch(() => {});
      return;
    }

    // REPORT COMMAND - FIXED VERSION
    if (command === 'report') {
      try {
        console.log(`📝 Report command received from ${message.author.tag}: ${message.content}`);
        
        const reportedUser = message.mentions.users.first();
        const reason = args.slice(1).join(' ');

        if (!reportedUser || !reason) {
          console.log(`⚠️ Missing parameters in report command`);
          const errorEmbed = createErrorEmbed('❌ Usage: `!report @user <reason>`');
          const errorMsg = await message.reply({ embeds: [errorEmbed] });
          logBotResponse(message, 'Report usage error', 'Error');
          // Delete the error message after 5 seconds
          setTimeout(() => errorMsg.delete().catch(() => {}), 5000);
          return;
        }

        console.log(`📝 Report details - User: ${reportedUser.tag}, Reason: ${reason}`);

        // Find reports channel
        const reportsChannel = message.guild.channels.cache.find(ch => 
          ch.name === 'reports' || ch.name === 'report'
        );

        if (!reportsChannel) {
          console.log(`❌ Reports channel not found`);
          const errorEmbed = createErrorEmbed('❌ Reports channel not found. Please contact staff directly.');
          const errorMsg = await message.reply({ embeds: [errorEmbed] });
          logBotResponse(message, 'Reports channel not found', 'Error');
          // Delete the error message after 5 seconds
          setTimeout(() => errorMsg.delete().catch(() => {}), 5000);
          return;
        }

        console.log(`📝 Found reports channel: #${reportsChannel.name}`);

        // Check if bot has permission in reports channel
        if (!hasPermission(reportsChannel, PermissionsBitField.Flags.SendMessages)) {
          console.log(`❌ No permission to send messages in #${reportsChannel.name}`);
          const errorEmbed = createErrorEmbed('❌ Cannot send to reports channel. Contact staff directly.');
          const errorMsg = await message.reply({ embeds: [errorEmbed] });
          logBotResponse(message, 'No permission in reports channel', 'Error');
          // Delete the error message after 5 seconds
          setTimeout(() => errorMsg.delete().catch(() => {}), 5000);
          return;
        }

        console.log(`📝 Bot has permission to send in #${reportsChannel.name}`);

        const reportEmbed = new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle('🚨 USER REPORT')
          .addFields(
            { name: 'Reported User', value: `${reportedUser.tag} (${reportedUser.id})`, inline: true },
            { name: 'Reported By', value: `${message.author.tag} (${message.author.id})`, inline: true },
            { name: 'Channel', value: message.channel.toString(), inline: true },
            { name: 'Reason', value: reason, inline: false },
            { name: 'Time', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
          )
          .setFooter({ text: 'Please investigate this report' })
          .setTimestamp();

        console.log(`📝 Sending report embed to #${reportsChannel.name}`);
        
        // Send report to reports channel
        await reportsChannel.send({ content: `@here New user report`, embeds: [reportEmbed] });
        console.log(`✅ Report sent to #${reportsChannel.name}`);

        // Send confirmation BEFORE deleting the original message
        const confirmationEmbed = createSuccessEmbed('✅ Your report has been sent privately to the staff. Thank you!');
        const confirmationMsg = await message.channel.send({ embeds: [confirmationEmbed] });
        console.log(`✅ Sent confirmation to user`);
        logBotResponse(message, 'Report sent successfully', 'Report Success');
        
        // Now delete the user's original report command
        try {
          await message.delete();
          console.log(`✅ Deleted user's report command`);
        } catch (deleteError) {
          console.error(`❌ Could not delete report command: ${deleteError.message}`);
          logToChannel(`❌ Could not delete report command from ${message.author.tag}: ${deleteError.message}`);
        }
        
        // Delete the bot's confirmation after 5 seconds
        setTimeout(() => {
          confirmationMsg.delete().catch(() => {
            console.log(`⚠️ Could not delete confirmation message`);
          });
        }, 5000);
        
        logToChannel(`🚨 **Report Filed** - ${message.author.tag} reported ${reportedUser.tag} for: ${reason}`);
        console.log(`✅ Report process completed successfully`);
        
      } catch (error) {
        console.error(`❌ CRITICAL ERROR in report command: ${error.message}`);
        console.error(error.stack);
        
        // Log detailed error information
        logToChannel(`❌ **Report Command CRASHED** - User: ${message.author.tag}, Error: ${error.message}\nStack: ${error.stack.substring(0, 500)}...`);
        
        // Try to send error to user without crashing
        try {
          const errorEmbed = createErrorEmbed('❌ An error occurred while processing your report. Please try again or contact staff directly.');
          await message.channel.send({ embeds: [errorEmbed] });
        } catch (sendError) {
          console.error(`❌ Could not send error message to user: ${sendError.message}`);
        }
      }
    }

    // SET LOG CHANNEL COMMAND
    if (command === 'setlogchannel') {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        const errorEmbed = createErrorEmbed('❌ You need **Administrator** permission.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      const channel = message.mentions.channels.first();
      if (!channel) {
        const errorEmbed = createErrorEmbed('❌ Please mention a channel.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      logChannel = channel;
      logToChannel(`📝 Log channel set to ${channel} by ${message.author.tag}`);
      saveData(); // Save after changing log channel
      
      const successEmbed = createSuccessEmbed(`✅ Log channel set to ${channel}`);
      message.reply({ embeds: [successEmbed] }).then(botMsg => {
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
          const kickEmbed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('🛡️ User Kicked')
            .addFields(
              { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
              { name: 'Moderator', value: message.author.tag, inline: true },
              { name: 'Reason', value: reason, inline: true },
              { name: 'Channel', value: message.channel.toString(), inline: true }
            )
            .setTimestamp();
          
          logToChannel({ embeds: [kickEmbed] });
          
          const dmEmbed = createEmbed('🚪 You have been kicked', `You have been kicked from **${message.guild.name}** for: ${reason}`, 0xff0000);
          member.send({ embeds: [dmEmbed] })
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
          const banEmbed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('🛡️ User Banned')
            .addFields(
              { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
              { name: 'Moderator', value: message.author.tag, inline: true },
              { name: 'Reason', value: reason, inline: true },
              { name: 'Channel', value: message.channel.toString(), inline: true }
            )
            .setTimestamp();
          
          logToChannel({ embeds: [banEmbed] });
          
          const dmEmbed = createEmbed('🔨 You have been banned', `You have been banned from **${message.guild.name}** for: ${reason}`, 0xff0000);
          member.send({ embeds: [dmEmbed] })
            .catch(() => logToChannel('❌ Could not DM banned user'));
        })
        .catch(error => {
          logToChannel(`❌ **Ban Failed** - ${message.author.tag} tried to ban ${member.user.tag}: ${error}`);
        });
    }

    // WARN COMMAND (SILENT) - NOW SAVED
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
        timestamp: new Date().toISOString(),
        channel: message.channel.name
      });

      const totalWarnings = userWarnings.get(userId).length;
      
      const warnEmbed = new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle('⚠️ User Warned')
        .addFields(
          { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
          { name: 'Moderator', value: message.author.tag, inline: true },
          { name: 'Reason', value: reason, inline: true },
          { name: 'Total Warnings', value: totalWarnings.toString(), inline: true },
          { name: 'Channel', value: message.channel.toString(), inline: true }
        )
        .setTimestamp();
      
      logToChannel({ embeds: [warnEmbed] });

      const dmEmbed = createEmbed('⚠️ You have been warned', `You have been warned in **${message.guild.name}** for: ${reason}\nThis is warning #${totalWarnings}.`, 0xffa500);
      member.send({ embeds: [dmEmbed] })
        .catch(() => logToChannel('❌ Could not DM warned user'));
      
      // Save data after warning
      saveData();
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
      
      // Optionally, you can show warnings to the user
      if (hasPermission(message.channel, PermissionsBitField.Flags.SendMessages)) {
        const warningList = warnings.map((w, i) => 
          `${i+1}. **${w.reason}** - By ${w.moderator} on ${new Date(w.timestamp).toLocaleDateString()}`
        ).join('\n');
        
        const warningsEmbed = new EmbedBuilder()
          .setColor(0xffa500)
          .setTitle(`⚠️ Warnings for ${member.user.tag}`)
          .setDescription(`Total warnings: **${warnings.length}**\n\n${warningList}`)
          .setFooter({ text: `Checked by ${message.author.tag}` })
          .setTimestamp();
        
        message.reply({ embeds: [warningsEmbed] }).then(botMsg => {
          setTimeout(() => botMsg.delete().catch(() => {}), 10000);
        });
      }
    }

    // CLEAR WARNINGS COMMAND (SILENT) - NOW SAVED
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
      
      const clearEmbed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('✅ Warnings Cleared')
        .addFields(
          { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
          { name: 'Moderator', value: message.author.tag, inline: true },
          { name: 'Warnings Cleared', value: warningsCount.toString(), inline: true },
          { name: 'Channel', value: message.channel.toString(), inline: true }
        )
        .setTimestamp();
      
      logToChannel({ embeds: [clearEmbed] });
      
      // Save data after clearing warnings
      saveData();
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
      
      const serverInfoEmbed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle(`📊 ${guild.name} Server Information`)
        .setThumbnail(guild.iconURL({ dynamic: true, size: 512 }))
        .addFields(
          { name: '👑 Owner', value: `<@${guild.ownerId}>`, inline: true },
          { name: '🆔 Server ID', value: guild.id, inline: true },
          { name: '📅 Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
          { name: '👥 Members', value: `**Total:** ${totalMembers}\n**Humans:** ${humanCount}\n**Bots:** ${botCount}`, inline: true },
          { name: '📈 Boosts', value: `**Level:** ${guild.premiumTier}\n**Boosts:** ${guild.premiumSubscriptionCount || 0}`, inline: true },
          { name: '🔊 Channels', value: `**Text:** ${guild.channels.cache.filter(c => c.type === 0).size}\n**Voice:** ${guild.channels.cache.filter(c => c.type === 2).size}\n**Categories:** ${guild.channels.cache.filter(c => c.type === 4).size}`, inline: true },
          { name: '🎭 Roles', value: `${guild.roles.cache.size} roles`, inline: true },
          { name: '🔒 Verification', value: guild.verificationLevel.toString(), inline: true },
          { name: '🚀 Features', value: guild.features.length > 0 ? guild.features.slice(0, 5).join(', ') : 'None', inline: true }
        )
        .setFooter({ text: `Requested by ${message.author.tag}` })
        .setTimestamp();

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

      const userWarningsCount = userWarnings.get(member.id)?.length || 0;
      const userLevelInfo = getUserLevelInfo(member.id);
      
      const userInfoEmbed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setAuthor({ name: `${user.tag}`, iconURL: user.displayAvatarURL({ dynamic: true, size: 512 }) })
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 512 }))
        .addFields(
          { name: '🆔 User ID', value: user.id, inline: true },
          { name: '🤖 Bot', value: user.bot ? 'Yes' : 'No', inline: true },
          { name: '📅 Account Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
          { name: '📥 Joined Server', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
          { name: `🎭 Roles [${roles.length}]`, value: roles.length > 0 ? roles.join(' ') : 'No roles', inline: false },
          { name: '🎨 Color', value: member.displayHexColor, inline: true },
          { name: '📛 Nickname', value: member.nickname || 'None', inline: true },
          { name: '🚀 Boosting', value: member.premiumSince ? `<t:${Math.floor(member.premiumSinceTimestamp / 1000)}:R>` : 'Not boosting', inline: true },
          { name: '⚠️ Warnings', value: userWarningsCount.toString(), inline: true },
          { name: '📈 Level', value: `Level ${userLevelInfo.level} (${userLevelInfo.currentLevelXp}/${userLevelInfo.xpForCurrentLevel} XP)`, inline: true }
        )
        .setFooter({ text: `Requested by ${message.author.tag}` })
        .setTimestamp();

      message.reply({ embeds: [userInfoEmbed] })
        .then(botMsg => {
          logBotResponse(message, `User info for ${user.tag}`, 'User Info');
        })
        .catch(error => {
          logToChannel(`❌ Failed to send userinfo in ${message.channel}: ${error.message}`);
        });
    }

    // REMINDER COMMAND - NOW SAVED
    if (command === 'remindme') {
      // Check if bot has permission to send messages in this channel
      if (!hasPermission(message.channel, PermissionsBitField.Flags.SendMessages)) {
        logToChannel(`❌ Missing Send Messages permission in ${message.channel}`);
        return;
      }

      const timeString = args[0];
      const reminderText = args.slice(1).join(' ');

      if (!timeString || !reminderText) {
        const errorEmbed = createErrorEmbed('❌ Usage: `!remindme <time> <message>`\nExample: `!remindme 2h Take out the trash`');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      const timeMatch = timeString.match(/^(\d+)([smhdw])$/);
      if (!timeMatch) {
        const errorEmbed = createErrorEmbed('❌ Invalid time format. Use: 1m, 30min, 2h, 1d, 1w');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
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
        const errorEmbed = createErrorEmbed('❌ Maximum reminder time is 1 week.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
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

      const successEmbed = createSuccessEmbed(`✅ I'll remind you in ${timeString}: "${reminderText}"`);
      message.reply({ embeds: [successEmbed] }).then(botMsg => {
        logBotResponse(message, botMsg.content, 'Reminder Set');
      });

      // Save data after setting reminder
      saveData();

      setTimeout(() => {
        const reminder = reminders.get(reminderId);
        if (reminder) {
          const channel = client.channels.cache.get(reminder.channelId);
          if (channel) {
            const reminderEmbed = createEmbed('⏰ Reminder', `**Reminder:** ${reminder.text}`, 0x00ff00, reminder.userId);
            channel.send({ content: `<@${reminder.userId}>`, embeds: [reminderEmbed] });
            logToChannel(`⏰ **Reminder Sent** - User ID: ${reminder.userId}: ${reminder.text}`);
          }
          reminders.delete(reminderId);
          saveData(); // Save after removing reminder
        }
      }, milliseconds);
    }

    // ROLE MANAGEMENT COMMANDS

    // ADD SELF-ASSIGNABLE ROLE (Admin/Mod only) - NOW SAVED
    if (command === 'addassignablerole') {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        const errorEmbed = createErrorEmbed('❌ You need **Manage Roles** permission.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      const role = message.mentions.roles.first();
      if (!role) {
        const errorEmbed = createErrorEmbed('❌ Please mention a role to make self-assignable.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      selfAssignableRoles.add(role.id);
      const successEmbed = createSuccessEmbed(`✅ Added **${role.name}** as a self-assignable role.`);
      message.reply({ embeds: [successEmbed] }).then(botMsg => {
        logBotResponse(message, botMsg.content, 'Role Config');
      });
      
      // Save data after adding role
      saveData();
    }

    // REMOVE SELF-ASSIGNABLE ROLE (Admin/Mod only) - NOW SAVED
    if (command === 'removeassignablerole') {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        const errorEmbed = createErrorEmbed('❌ You need **Manage Roles** permission.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      const role = message.mentions.roles.first();
      if (!role) {
        const errorEmbed = createErrorEmbed('❌ Please mention a role to remove from self-assignable.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      selfAssignableRoles.delete(role.id);
      const successEmbed = createSuccessEmbed(`✅ Removed **${role.name}** from self-assignable roles.`);
      message.reply({ embeds: [successEmbed] }).then(botMsg => {
        logBotResponse(message, botMsg.content, 'Role Config');
      });
      
      // Save data after removing role
      saveData();
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
        const infoEmbed = createInfoEmbed('📝 No self-assignable roles available.');
        message.reply({ embeds: [infoEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Role List');
        });
        return;
      }

      const rolesEmbed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle('🎭 Self-Assignable Roles')
        .setDescription('Use `!iam <role>` to get a role or `!iamnot <role>` to remove it.\n\n' + roles.join('\n'))
        .setFooter({ text: `Requested by ${message.author.tag}` })
        .setTimestamp();

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
        const errorEmbed = createErrorEmbed('❌ Role not found or not self-assignable. Use `!roles` to see available roles.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      if (message.member.roles.cache.has(role.id)) {
        const errorEmbed = createErrorEmbed(`❌ You already have the **${role.name}** role.`);
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      message.member.roles.add(role)
        .then(() => {
          const successEmbed = createSuccessEmbed(`✅ You now have the **${role.name}** role!`);
          message.reply({ embeds: [successEmbed] }).then(botMsg => {
            logBotResponse(message, botMsg.content, 'Role Added');
          });
        })
        .catch(error => {
          const errorEmbed = createErrorEmbed('❌ I cannot assign that role. Check my permissions and role hierarchy.');
          message.reply({ embeds: [errorEmbed] }).then(botMsg => {
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
        const errorEmbed = createErrorEmbed('❌ Role not found or not self-assignable.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      if (!message.member.roles.cache.has(role.id)) {
        const errorEmbed = createErrorEmbed(`❌ You don't have the **${role.name}** role.`);
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      message.member.roles.remove(role)
        .then(() => {
          const successEmbed = createSuccessEmbed(`✅ Removed the **${role.name}** role from you.`);
          message.reply({ embeds: [successEmbed] }).then(botMsg => {
            logBotResponse(message, botMsg.content, 'Role Removed');
          });
        })
        .catch(error => {
          const errorEmbed = createErrorEmbed('❌ I cannot remove that role. Check my permissions.');
          message.reply({ embeds: [errorEmbed] }).then(botMsg => {
            logBotResponse(message, botMsg.content, 'Error');
          });
        });
    }

    // HELP COMMAND (SEND TO DM)
    if (command === 'help') {
      message.delete().catch(() => {});
      
      const helpEmbed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle('🤖 Bot Commands')
        .setDescription('Here are all available commands:')
        .addFields(
          {
            name: '🛡️ Silent Moderation',
            value: '`!kick @user [reason]` - Kick user (no channel response)\n`!ban @user [reason]` - Ban user (no channel response)\n`!warn @user [reason]` - Warn user (no channel response)\n`!warnings @user` - Check warnings (no channel response)\n`!clearwarnings @user` - Clear warnings (no channel response)\n`!clear 1-100` - Clear messages (no channel response)',
            inline: false
          },
          {
            name: '📊 Information',
            value: '`!serverinfo` - Show server stats\n`!userinfo [@user]` - Show user information\n`!roles` - List self-assignable roles',
            inline: false
          },
          {
            name: '📈 Level System (Everyone)',
            value: '`!level [@user]` - Check your/other\'s level\n`!leaderboard` - Show top 10 users\n`!leveldetails [@user]` - Detailed level info\n`!levelrewards` - See level reward tiers\n`!levelreq [level]` - Check level requirements',
            inline: false
          },
          {
            name: '📈 Level Management (Admin/Mod)',
            value: '`!addlevel @user [amount]` - Add levels to user\n`!removelevel @user [amount]` - Remove levels from user\n`!setlevel @user level` - Set user to specific level\n`!givexp @user amount` - Give XP to user\n`!resetxp @user` - Reset user\'s XP\n`!bulklevel <add|remove|set> amount @role` - Manage levels for role members\n`!levelrewardrole level @role` - Set role reward for level',
            inline: false
          },
          {
            name: '⏰ Utility',
            value: '`!remindme 2h message` - Set a reminder\n`!iam <role>` - Give yourself a role\n`!iamnot <role>` - Remove a role',
            inline: false
          },
          {
            name: '🆘 Safety',
            value: '`!report @user reason` - Report a user to staff',
            inline: false
          },
          {
            name: '🔧 Role Management (Mods+)',
            value: '`!addassignablerole @role` - Make role self-assignable\n`!removeassignablerole @role` - Remove from self-assignable',
            inline: false
          },
          {
            name: '⚙️ Configuration (Admin)',
            value: '`!setupinfo` - Setup info channels\n`!setlogchannel #channel` - Set log channel\n`!xpconfig` - View XP settings\n`!xpconfigset setting value` - Change XP settings',
            inline: false
          }
        )
        .setFooter({ text: `Requested by ${message.author.tag}` })
        .setTimestamp();

      message.author.send({ embeds: [helpEmbed] })
        .then(() => {
          logToChannel(`📬 **Help Sent to DM** - ${message.author.tag} requested help in ${message.channel}`);
          
          const redirectEmbed = createInfoEmbed(`📬 ${message.author}, check your DMs for help!`);
          message.channel.send({ embeds: [redirectEmbed] })
            .then(botMsg => {
              setTimeout(() => botMsg.delete().catch(() => {}), 5000);
              logBotResponse(message, 'Check your DMs for help!', 'Help Redirect');
            });
        })
        .catch(error => {
          logToChannel(`❌ **DM Failed** - Could not send help to ${message.author.tag}: ${error}`);
          
          helpEmbed.setDescription('Here are all available commands (DMs unavailable):');
          message.channel.send({ embeds: [helpEmbed] }).then(botMsg => {
            logBotResponse(message, 'Help command (DM failed)', 'Help Fallback');
          });
        });
    }

    // PING COMMAND
    if (command === 'ping') {
      // Check if bot has permission to send messages in this channel
      if (!hasPermission(message.channel, PermissionsBitField.Flags.SendMessages)) {
        logToChannel(`❌ Missing Send Messages permission in ${message.channel}`);
        return;
      }

      const pingEmbed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle('🏓 Calculating ping...')
        .setTimestamp();

      const sent = await message.reply({ embeds: [pingEmbed] });
      const latency = sent.createdTimestamp - message.createdTimestamp;
      const apiLatency = Math.round(client.ws.ping);

      const updatedPingEmbed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle('🏓 Pong!')
        .addFields(
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
        )
        .setFooter({ text: `Requested by ${message.author.tag}` })
        .setTimestamp();

      sent.edit({ embeds: [updatedPingEmbed] });
      logBotResponse(message, `Ping: ${latency}ms | API: ${apiLatency}ms`, 'Ping');
    }

    // ADD CUSTOM RESPONSE - NOW SAVED
    if (command === 'addresponse') {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        const errorEmbed = createErrorEmbed('❌ You need **Manage Messages** permission.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      const trigger = args[0];
      const response = args.slice(1).join(' ');

      if (!trigger || !response) {
        const errorEmbed = createErrorEmbed('❌ Usage: `!addresponse <trigger> <response>`');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      customResponses.set(trigger.toLowerCase(), response);
      const successEmbed = createSuccessEmbed(`✅ Added custom response for trigger: **${trigger}**`);
      message.reply({ embeds: [successEmbed] }).then(botMsg => {
        logBotResponse(message, botMsg.content, 'Config Update');
      });
      
      // Save data after adding response
      saveData();
    }

    // LIST CUSTOM RESPONSES
    if (command === 'listresponses') {
      // Check if bot has permission to send messages in this channel
      if (!hasPermission(message.channel, PermissionsBitField.Flags.SendMessages)) {
        logToChannel(`❌ Missing Send Messages permission in ${message.channel}`);
        return;
      }

      if (customResponses.size === 0) {
        const infoEmbed = createInfoEmbed('📝 No custom responses set up yet.');
        message.reply({ embeds: [infoEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content);
        });
        return;
      }

      const responseList = Array.from(customResponses.entries())
        .map(([trigger, response]) => `**${trigger}** → ${response}`)
        .join('\n');

      const responsesEmbed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle('📋 Custom Responses')
        .setDescription(responseList)
        .setTimestamp();

      message.reply({ embeds: [responsesEmbed] }).then(botMsg => {
        logBotResponse(message, botMsg.content);
      });
    }

    // REMOVE CUSTOM RESPONSE - NOW SAVED
    if (command === 'removeresponse') {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        const errorEmbed = createErrorEmbed('❌ You need **Manage Messages** permission.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      const trigger = args[0];
      if (!trigger) {
        const errorEmbed = createErrorEmbed('❌ Please specify a trigger to remove.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }

      if (customResponses.delete(trigger.toLowerCase())) {
        const successEmbed = createSuccessEmbed(`✅ Removed custom response for: **${trigger}**`);
        message.reply({ embeds: [successEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Config Update');
        });
        
        // Save data after removing response
        saveData();
      } else {
        const errorEmbed = createErrorEmbed('❌ No custom response found for that trigger.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
      }
    }
    
    // SAVEDATA COMMAND (Force save)
    if (command === 'savedata') {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        const errorEmbed = createErrorEmbed('❌ You need **Administrator** permission.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }
      
      saveData();
      const successEmbed = createSuccessEmbed('💾 Data saved successfully!');
      message.reply({ embeds: [successEmbed] }).then(botMsg => {
        logBotResponse(message, botMsg.content, 'Data Save');
      });
    }
    
    // VIEWDATA COMMAND (View saved data stats)
    if (command === 'viewdata') {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        const errorEmbed = createErrorEmbed('❌ You need **Administrator** permission.');
        message.reply({ embeds: [errorEmbed] }).then(botMsg => {
          logBotResponse(message, botMsg.content, 'Error');
        });
        return;
      }
      
      // Calculate total XP
      const totalXp = Array.from(userLevels.values()).reduce((sum, user) => sum + (user.totalXp || 0), 0);
      
      const statsEmbed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle('📊 Bot Data Statistics')
        .addFields(
          { name: '⚠️ Users with Warnings', value: userWarnings.size.toString(), inline: true },
          { name: '📝 Total Warnings', value: Array.from(userWarnings.values()).reduce((sum, warnings) => sum + warnings.length, 0).toString(), inline: true },
          { name: '🤖 Custom Responses', value: customResponses.size.toString(), inline: true },
          { name: '🎭 Self-Assignable Roles', value: selfAssignableRoles.size.toString(), inline: true },
          { name: '📈 User Levels', value: userLevels.size.toString(), inline: true },
          { name: '✨ Total XP Awarded', value: totalXp.toLocaleString(), inline: true },
          { name: '⏰ Active Reminders', value: reminders.size.toString(), inline: true },
          { name: '💾 Data File', value: fs.existsSync(DATA_FILE) ? 'Exists ✅' : 'Missing ❌', inline: true }
        )
        .setFooter({ text: `Requested by ${message.author.tag}` })
        .setTimestamp();
      
      message.reply({ embeds: [statsEmbed] }).then(botMsg => {
        logBotResponse(message, 'Data statistics viewed', 'Data Stats');
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
      const responseEmbed = createEmbed('🤖 Bot Response', response, 0x0099ff);
      message.reply({ embeds: [responseEmbed] }).then(botMsg => {
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
    const goodBotEmbed = createEmbed('😊 Thank you!', 'I appreciate your kind words!', 0x00ff00);
    message.reply({ embeds: [goodBotEmbed] }).then(botMsg => {
      logBotResponse(message, botMsg.content, 'Auto-Response');
    });
  }
});

client.login(process.env.DISCORD_TOKEN);