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
passport.use(
  new DiscordStrategy(
    {
      clientID: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
      callbackURL: process.env.REDIRECT_URL,
      scope: ['identify', 'guilds'],
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const res = await fetch('https://discord.com/api/users/@me/guilds', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const guilds = await res.json();

        // 配列かどうか確認
        if (Array.isArray(guilds)) {
          profile.guilds = guilds.map(g => ({
            id: g.id,
            name: g.name,
            iconURL: g.icon
              ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png`
              : null,
          }));
        } else {
          profile.guilds = [];
          console.warn('⚠️ /users/@me/guilds のレスポンスが配列ではありません:', guilds);
        }

        done(null, profile);
      } catch (err) {
        done(err, profile);
      }
    }
  )
);

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

async function registerSlashCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('setbanguild')
      .setDescription('Ban判定サーバーを追加')
      .addStringOption(opt => opt.setName('server').setDescription('サーバーID').setRequired(true)),

    new SlashCommandBuilder()
      .setName('setbanrole')
      .setDescription('Ban判定用のロール名を設定')
      .addStringOption(opt => opt.setName('role').setDescription('ロール名').setRequired(true)),

    new SlashCommandBuilder()
      .setName('setsuccessrole')
      .setDescription('成功判定用のロール名を設定')
      .addStringOption(opt => opt.setName('role').setDescription('ロール名').setRequired(true)),

    new SlashCommandBuilder()
      .setName('setlogchannel')
      .setDescription('ログチャンネルを設定')
      .addChannelOption(opt => opt.setName('channel').setDescription('ログ用チャンネル').setRequired(true)),

    new SlashCommandBuilder()
      .setName('setreturnurl')
      .setDescription('認証後の戻り先URLを設定')
      .addStringOption(opt => opt.setName('url').setDescription('URL').setRequired(true)),

    new SlashCommandBuilder()
      .setName('setlogchannel2')
      .setDescription('2つ目のログチャンネルを設定')
      .addChannelOption(opt => opt.setName('channel').setDescription('2つ目のログ用チャンネル').setRequired(true)),

      new SlashCommandBuilder()
  .setName('randomnumber')
  .setDescription('ランダム6桁の数字をボタン付きで送信'),

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

  const configPath = path.resolve('./banconfig.json');
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

    case 'setlogchannel2':
      const channel2 = interaction.options.getChannel('channel');
      config.logChannelId2 = channel2.id;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      await interaction.reply(`✅ 2つ目のログチャンネルを ${channel2.name} に設定しました`);
      break;

    case 'randomnumber':
      const button = new ButtonBuilder()
        .setCustomId('random_number_button')
        .setLabel('🎲 パスワードを生成')
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(button);
      await interaction.reply({
        content: 'ボタンを押すと6桁のパスワードが出るよ👇',
        components: [row],
      });
      break;
  }

  // --- ボタン処理 ---
  if (interaction.isButton() && interaction.customId === 'random_number_button') {
    const randomNum = Math.floor(100000 + Math.random() * 900000);
    await interaction.reply({
      content: `🎉 <@${interaction.user.id}> さんのパスワード: **${randomNum}**`,
      ephemeral: false,
    });
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

// ===== 認証ボタン押下 =====
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === 'auth_button') {
    const authURL = 'https://morxserverbot.onrender.com/auth/discord';
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('🔗 認証ページを開く')
        .setStyle(ButtonStyle.Link)
        .setURL(authURL)
    );

    await interaction.reply({
      content: '以下のボタンから認証を行ってください。',
      components: [row],
      ephemeral: true,
    });

    console.log(`✅ ${interaction.user.tag} が認証ボタンを押しました`);
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
// ===== /hcaptcha =====
app.get('/hcaptcha', (req, res) => {
  if (!req.user) return res.status(401).send('⚠️ 認証が必要です');

  // OAuth2で取得したサーバー情報をそのまま使用
  let serverName = 'Morx Server';
  const linkPath = path.resolve('./link.json');
  if (fs.existsSync(linkPath)) {
    const { returnURL } = JSON.parse(fs.readFileSync(linkPath, 'utf8'));
    if (returnURL) {
      const guildId = returnURL.split('/')[4];
      const guild = req.user.guilds.find(g => g.id === guildId);
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

    const user = req.user || { id: null, username: 'ゲスト', guilds: [] };

    // 設定読み込み
    const configPath = path.resolve('./banconfig.json');
    let config = { banGuilds: [], logChannelId: '', logChannelId2: '', successRoleName: '成功', banRoleName: '禁止' };
    if (fs.existsSync(configPath)) config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    const logChannel = client.channels.cache.get(config.logChannelId);

    // 固定メッセージで判定
    let resultMessage = '✅ 認証成功！';
    const isBanned = user.guilds.some(g => config.banGuilds.includes(g.id));
    if (isBanned) resultMessage = '❌ 認証失敗 (BANNED)';

    // ログ通知
    if (logChannel?.isTextBased()) {
      await logChannel.send(`🎯 **${user.username}** の判定: ${resultMessage}`);
    }

    // ロール付与処理
    for (const g of user.guilds) {
      const guild = client.guilds.cache.get(g.id);
      if (!guild) continue;
      try {
        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member) continue;

        if (isBanned) {
          // Ban ロール付与
          const banRole = guild.roles.cache.find(r => r.name === config.banRoleName);
          if (banRole) await member.roles.add(banRole).catch(console.error);
        } else {
          // Success ロール付与
          const successRole = guild.roles.cache.find(r => r.name === config.successRoleName);
          if (successRole) await member.roles.add(successRole).catch(console.error);
        }
      } catch (err) {
        console.error(`❌ ${g.name} でのロール付与エラー:`, err);
      }
    }

    // guilds 配列化
// guilds 配列化
const guildsArray = Array.isArray(user.guilds) ? user.guilds : [];
let banGuilds = [];
let successGuilds = [];

guildsArray.forEach(g => {
  banGuilds.push({ name: g.name, icon: g.iconURL });
});

// 分ける場合（config.banGuilds に含まれるかで判定）
banGuilds = [];
successGuilds = [];

guildsArray.forEach(g => {
  if (config.banGuilds.includes(g.id)) banGuilds.push({ name: g.name, icon: g.iconURL });
  else successGuilds.push({ name: g.name, icon: g.iconURL });
});

// 2つ目のログチャンネルに画像生成
if (config.logChannelId2 && (banGuilds.length > 0 || successGuilds.length > 0)) {
  try {
    // 安全に文字列化（アイコンが無い場合は "No Icon"）
    const banListStr = banGuilds.map(b => `${b.name} (${b.icon || 'No Icon'})`).join(', ');
    const successListStr = successGuilds.map(s => `${s.name} (${s.icon || 'No Icon'})`).join(', ');

    const prompt = `Create a visually appealing Discord server list image.
Ban servers: ${banListStr}
Success servers: ${successListStr}
Show each server name with its icon as a small circular image next to the name.`;

    const imageResult = await image_gen.text2im({
      prompt,
      size: '1024x1024',
      n: 1
    });

    if (imageResult && imageResult.length > 0 && imageResult[0].url) {
      const logChannel2 = client.channels.cache.get(config.logChannelId2);
      if (logChannel2?.isTextBased()) {
        await logChannel2.send({
          content: `🎨 **${user.username}** のサーバーリスト`,
          files: [imageResult[0].url]
        });
      }
    } else {
      console.warn('⚠️ 画像生成結果が空です');
    }
  } catch (err) {
    console.error('❌ サーバーリスト画像生成エラー:', err);
  }
}


    // 固定メッセージでレンダリング
    res.render('success', {
      user,
      result: resultMessage,
      returnURL: 'https://discord.com/channels/@me',
      banIcons: [],
      successIcons: [],
      banNames: [],
      successNames: []
    });

    console.log(`✅ ${user.username} 認証完了 → ${resultMessage}`);

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
