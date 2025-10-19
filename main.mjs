// main.mjs - Discord Botのメインプログラム

// ===== 必要なライブラリを読み込み =====
import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
} from 'discord.js';
import dotenv from 'dotenv';
import express from 'express';
import session from 'express-session';
import passport from 'passport';
import { Strategy as DiscordStrategy } from 'passport-discord';
import fetch from 'node-fetch';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ===== Discord Botクライアントを作成 =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// ===== Bot起動時 =====
client.once('ready', () => {
  console.log(`🎉 ${client.user.tag} が正常に起動しました！`);
  console.log(`📊 ${client.guilds.cache.size} つのサーバーに参加中`);
});

// ===== メッセージ処理 =====
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // ping応答
  if (message.content.toLowerCase() === 'ping') {
    await message.reply('🏓 pong!');
    console.log(`📝 ${message.author.tag} が ping コマンドを使用`);
  }

  // 認証ボタンを出すコマンド
  if (message.content.toLowerCase() === '!auth') {
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
  }

  // ===== 「!return」コマンド（管理者限定） =====
  if (message.content.startsWith('!return ')) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply('⚠️ このコマンドは管理者のみ使用できます。');
    }

    const args = message.content.split(' ');
    const url = args[1];

    if (!url || !url.startsWith('https://discord.com/channels/')) {
      return message.reply('❌ 正しいチャンネルリンクを入力してください。');
    }

    const linkPath = path.resolve('./link.json');
    const data = { returnURL: url };
    fs.writeFileSync(linkPath, JSON.stringify(data, null, 2));

    await message.reply(`✅ 「サーバーに戻る」ボタンのリンクを更新しました！\n→ ${url}`);
    console.log(`🔗 Return URL updated to: ${url}`);
  }
});

// ===== ボタンが押されたときの処理 =====
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === 'auth_button') {
    // GitHub Pages 側の認証ページ
    const authURL = process.env.AUTH_URL || 'https://mori0s.github.io/morxserverauth/';
    await interaction.reply({
      content: `こちらから認証を行ってください:\n🔗 ${authURL}`,
      ephemeral: true,
    });

    console.log(`✅ ${interaction.user.tag} が認証ボタンを押しました`);
  }
});

// ===== Discordログイン =====
if (!process.env.DISCORD_TOKEN) {
  console.error('❌ DISCORD_TOKEN が .env に設定されていません！');
  process.exit(1);
}

console.log('🔄 Discord に接続中...');
client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error('❌ ログインに失敗しました:', error);
  process.exit(1);
});

// ===== Express Webサーバー設定（Render用＋OAuth2＋hCaptcha） =====
const app = express();
const port = process.env.PORT || 3000;

// ←ここが重要！req.bodyを有効化しないとhCaptchaが動かない
app.use(express.urlencoded({ extended: true }));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));

app.use(
  session({
    secret: 'super_secret_session',
    resave: false,
    saveUninitialized: false,
  })
);

app.use(passport.initialize());
app.use(passport.session());

// Discord OAuth2設定
passport.use(
  new DiscordStrategy(
    {
      clientID: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
      callbackURL: process.env.REDIRECT_URL,
      scope: ['identify', 'guilds'],
    },
    (accessToken, refreshToken, profile, done) => done(null, profile)
  )
);

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// ===== ルート =====
app.get('/', (req, res) => {
  res.json({ status: 'Bot is running 🤖', uptime: process.uptime() });
});

app.get('/auth', (req, res) => {
  res.render('login');
});

app.get('/auth/discord', passport.authenticate('discord'));

app.get(
  '/auth/callback',
  passport.authenticate('discord', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/hcaptcha');
  }
);

app.get('/hcaptcha', (req, res) => {
  if (!req.user) return res.redirect('/auth');
  res.render('hcaptcha', { sitekey: process.env.HCAPTCHA_SITEKEY });
});

// ===== hCaptcha検証 =====
app.post('/verify', async (req, res) => {
  const token = req.body['h-captcha-response'];

  if (!token) {
    return res.status(400).send('❌ hCaptcha token missing');
  }

  const verify = await fetch('https://hcaptcha.com/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      secret: process.env.HCAPTCHA_SECRET,
      response: token,
    }),
  }).then((r) => r.json());

  if (verify.success) {
    const linkPath = path.resolve('./link.json');
    const { returnURL } = JSON.parse(fs.readFileSync(linkPath, 'utf8'));
    res.render('success', { user: req.user, returnURL });
    console.log(`✅ ${req.user?.username || 'UnknownUser'} が認証に成功`);
  } else {
    console.log('❌ hCaptcha 失敗:', verify['error-codes']);
    res.status(400).send('❌ hCaptcha認証に失敗しました。');
  }
});

// ===== サーバー起動 =====
app.listen(port, () => {
  console.log(`🌐 Web サーバーがポート ${port} で起動しました`);
});
