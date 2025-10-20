// ===== main.mjs =====

// ===== 必要なライブラリ =====
import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  ChannelType,
  REST,
  Routes,
  SlashCommandBuilder
} from 'discord.js';
import dotenv from 'dotenv';
import express from 'express';
import ejs from 'ejs';
import session from 'express-session';
import passport from 'passport';
import { Strategy as DiscordStrategy } from 'passport-discord';
import fetch from 'node-fetch';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ===== Discord Bot =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

// ===== Bot起動時 =====
client.once('ready', async () => {
  console.log(`🎉 ${client.user.tag} が起動しました！`);
  await registerSlashCommands();
});

// ===== Express サーバー =====
const app = express();
const port = process.env.PORT || 3000;
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'super_secret_session',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 1000 * 60 * 10 } // 10分
}));
app.use(passport.initialize());
app.use(passport.session());

// ===== Discord OAuth2 =====
passport.use(new DiscordStrategy({
  clientID: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  callbackURL: process.env.REDIRECT_URL,
  scope: ['identify','guilds']
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const res = await fetch('https://discord.com/api/users/@me/guilds', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const guilds = await res.json();
    profile.guilds = guilds.map(g => ({
      id: g.id,
      name: g.name,
      iconURL: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null
    }));
    done(null, profile);
  } catch (err) {
    done(err, profile);
  }
}));
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// ===== スラッシュコマンド登録 =====
async function registerSlashCommands() {
  const commands = [
    new SlashCommandBuilder().setName('setbanguild').setDescription('Ban判定サーバーを追加')
      .addStringOption(opt => opt.setName('server').setDescription('サーバーID').setRequired(true)),
    new SlashCommandBuilder().setName('setbanrole').setDescription('Ban判定用のロール名を設定')
      .addStringOption(opt => opt.setName('role').setDescription('ロール名').setRequired(true)),
    new SlashCommandBuilder().setName('setsuccessrole').setDescription('成功判定用のロール名を設定')
      .addStringOption(opt => opt.setName('role').setDescription('ロール名').setRequired(true)),
    new SlashCommandBuilder().setName('setlogchannel').setDescription('ログチャンネルを設定')
      .addChannelOption(opt => opt.setName('channel').setDescription('ログ用チャンネル').setRequired(true)),
    new SlashCommandBuilder().setName('setreturnurl').setDescription('認証後の戻り先URLを設定')
      .addStringOption(opt => opt.setName('url').setDescription('URL').setRequired(true))
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ スラッシュコマンド登録完了');
  } catch (err) {
    console.error('❌ スラッシュコマンド登録失敗', err);
  }
}

// ===== interactionCreate イベント =====
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // 管理者権限確認
  if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return interaction.reply({ content: '⚠️ 管理者のみ使用可能です', ephemeral: true });
  }

  const configPath = path.resolve('./banConfig.json');
  let config = { banGuilds: [], banRoleName: '禁止', successRoleName: '成功', logChannelId: '', returnURL: '' };
  if (fs.existsSync(configPath)) config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  switch (interaction.commandName) {
    case 'setbanguild':
      const serverId = interaction.options.getString('server');
      if (!config.banGuilds.includes(serverId)) config.banGuilds.push(serverId);
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      await interaction.reply(`✅ Ban判定サーバーに ${serverId} を追加しました`);
      break;

    case 'setbanrole':
      config.banRoleName = interaction.options.getString('role');
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      await interaction.reply(`✅ Banロール名を ${config.banRoleName} に設定しました`);
      break;

    case 'setsuccessrole':
      config.successRoleName = interaction.options.getString('role');
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      await interaction.reply(`✅ 成功ロール名を ${config.successRoleName} に設定しました`);
      break;

    case 'setlogchannel':
      const channel = interaction.options.getChannel('channel');
      config.logChannelId = channel.id;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      await interaction.reply(`✅ ログチャンネルを ${channel.name} に設定しました`);
      break;

    case 'setreturnurl':
      config.returnURL = interaction.options.getString('url');
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      fs.writeFileSync(path.resolve('./link.json'), JSON.stringify({ returnURL: config.returnURL }, null, 2));
      await interaction.reply(`✅ 認証後の戻り先URLを設定しました: ${config.returnURL}`);
      break;
  }
});

// ===== !auth メッセージコマンド =====
client.on('messageCreate', async (message) => {
  if (message.content.toLowerCase() !== '!auth') return;
  if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return message.reply('⚠️ 管理者のみ使用可能です');
  }

  const lastMsg = await message.channel.messages.fetch({ limit: 1 }).then(col => col.first());
  if (lastMsg && lastMsg.author.id === client.user.id) {
    return message.reply('⚠️ 認証ボタンはすでに送信済みです。');
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('auth_button')
      .setLabel('認証する')
      .setStyle(ButtonStyle.Primary)
  );

  await message.channel.send({
    content: '以下のボタンから認証を開始してください👇',
    components: [row],
  });
});

// ===== ボタン押下時 =====
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId === 'auth_button') {
    const authURL = '/auth/discord';
    await interaction.reply({ content: `[認証ページはこちら](${authURL})`, ephemeral: true });
  }
});


// ===== ページルート & OAuth2 =====
app.get('/', (req, res) => res.send('✅ Bot Webサーバー稼働中'));
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/callback', passport.authenticate('discord', { failureRedirect: '/auth/error' }), (req, res) => {
  if (!req.user) return res.redirect('/auth/error');
  console.log(`✅ OAuth認証成功: ${req.user.username}`);
  res.redirect('/hcaptcha');
});
app.get('/hcaptcha', (req, res) => {
  if (!req.user) return res.redirect('/auth');
  let serverName = 'Morx Server';
  const linkPath = path.resolve('./link.json');
  if (fs.existsSync(linkPath)) {
    const { returnURL } = JSON.parse(fs.readFileSync(linkPath, 'utf8'));
    const guildId = returnURL.split('/')[4];
    if (guildId && guildId !== '@me') {
      const guild = client.guilds.cache.get(guildId);
      if (guild) serverName = guild.name;
    }
  }
  res.render('hcaptcha', { sitekey: process.env.HCAPTCHA_SITEKEY, serverName });
});

// ===== /verify =====
app.post('/verify', async (req, res) => {
  try {
    const token = req.body['h-captcha-response'];
    if (!token) return res.status(400).send('HCaptchaトークンが見つかりません。');

    // hCaptcha 検証
    const verifyRes = await fetch('https://hcaptcha.com/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: process.env.HCAPTCHA_SECRET, response: token })
    });
    const data = await verifyRes.json();
    if (!data.success) return res.status(400).send('HCaptcha認証に失敗しました。');

    const user = req.user || { username: 'ゲスト', guilds: [] };

    // 設定読み込み
    const configPath = path.resolve('./banConfig.json');
    let config = { banGuilds: [], banRoleName: '禁止', successRoleName: '成功', logChannelId: '' };
    if (fs.existsSync(configPath)) config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const logChannel = client.channels.cache.get(config.logChannelId);

    // Ban判定
    let result = '';
    if (user.guilds.some(g => config.banGuilds.includes(g.id))) {
      result = `❌ ${config.banRoleName}扱い`;
    } else {
      result = `✅ ${config.successRoleName}扱い`;
    }

    // サーバーアイコン配列
    let banIcons = [], successIcons = [], banNames = [], successNames = [];
    user.guilds.forEach(g => {
      if (config.banGuilds.includes(g.id)) {
        if (g.iconURL) banIcons.push(g.iconURL);
        banNames.push(g.name);
      } else {
        if (g.iconURL) successIcons.push(g.iconURL);
        successNames.push(g.name);
      }
    });

    // ログ通知
    if (logChannel?.isTextBased()) {
      await logChannel.send(`🎯 **${user.username}** の判定: ${result}`);
    }

    // returnURLはlink.jsonから
    let returnURL = 'https://discord.com/channels/@me';
    const linkPath = path.resolve('./link.json');
    if (fs.existsSync(linkPath)) {
      const linkData = JSON.parse(fs.readFileSync(linkPath, 'utf8'));
      returnURL = linkData.returnURL || returnURL;
    }

    // レンダリング
    res.render('success', {
      user,
      result,
      returnURL,
      banIcons,
      successIcons,
      banNames,
      successNames
    });

    console.log(`✅ ${user.username} 認証完了 → ${result}`);

  } catch (err) {
    console.error('❌ /verify エラー詳細:', err);
    res.status(500).send('Internal Server Error');
  }
});


// エラー
app.get('/auth/error', (req, res) => res.send('❌ Discord認証に失敗しました。'));

// サーバー起動
app.listen(port, () => console.log(`🌐 Webサーバー起動: http://localhost:${port}`));

// ===== Discord ログイン =====
if (!process.env.DISCORD_TOKEN) {
  console.error('❌ DISCORD_TOKEN が未設定です');
  process.exit(1);
}
client.login(process.env.DISCORD_TOKEN);
