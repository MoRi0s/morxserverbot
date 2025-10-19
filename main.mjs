// ===== main.mjs =====

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

// ===== 初期化 =====
dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ===== Discord Bot =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// ===== Bot起動 =====
client.once('ready', () => {
  console.log(`✅ ${client.user.tag} が起動しました`);
});

// ===== メッセージコマンド =====
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // ping応答
  if (message.content.toLowerCase() === 'ping') {
    return message.reply('🏓 pong!');
  }

  // !auth コマンド
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

  // !return コマンド（管理者専用）
  if (message.content.startsWith('!return ')) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply('⚠️ このコマンドは管理者のみ使用できます。');
    }

    const url = message.content.split(' ')[1];
    if (!url || !url.startsWith('https://discord.com/channels/')) {
      return message.reply('❌ 正しいチャンネルリンクを入力してください。');
    }

    fs.writeFileSync('./link.json', JSON.stringify({ returnURL: url }, null, 2));
    message.reply(`✅ 「サーバーに戻る」ボタンを更新しました。\n→ ${url}`);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== 'auth_button') return;

  try {
    const authURL = 'https://morxserverbot.onrender.com/auth'; // ← 1か所だけに統一！

    // すぐ応答（flagsでephemeral指定）
    await interaction.reply({
      content: `こちらから認証を行ってください:\n🔗 ${authURL}`,
      flags: 64 // ← ephemeral: true の代わり
    });

    console.log(`✅ ${interaction.user.tag} が認証ボタンを押しました`);
  } catch (err) {
    console.error('❌ interactionエラー:', err);
  }
});


// ===== Discordログイン =====
client.login(process.env.DISCORD_TOKEN).catch(console.error);

// ===== Express Webサーバー（Render） =====
const app = express();
const port = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));

// セッション設定
app.use(
  session({
    secret: 'super_secret_session',
    resave: false,
    saveUninitialized: false,
  })
);

// ===== Passport (Discord OAuth2) =====
app.use(passport.initialize());
app.use(passport.session());

passport.use(
  new DiscordStrategy(
    {
      clientID: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
      callbackURL: process.env.REDIRECT_URL, // 例: https://morxserverbot.onrender.com/auth/callback
      scope: ['identify'],
    },
    (accessToken, refreshToken, profile, done) => done(null, profile)
  )
);

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// ===== ルーティング =====

// 動作確認
app.get('/', (req, res) => res.json({ status: 'OK', uptime: process.uptime() }));

// GitHub Pagesから飛ばすRenderのエントリポイント
app.get('/auth', (req, res) => res.render('login'));

// Discord OAuth2
app.get('/auth/discord', passport.authenticate('discord'));

// Discord OAuth2 コールバック
app.get(
  '/auth/callback',
  passport.authenticate('discord', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/hcaptcha');
  }
);

// hCaptcha ページ
app.get('/hcaptcha', (req, res) => {
  if (!req.user) return res.redirect('/auth');
  res.render('hcaptcha', { sitekey: process.env.HCAPTCHA_SITEKEY });
});

// hCaptcha 検証
app.post('/verify', async (req, res) => {
  const token = req.body['h-captcha-response'];
  if (!token) return res.send('❌ トークンがありません。');

  const verify = await fetch('https://hcaptcha.com/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      secret: process.env.HCAPTCHA_SECRET,
      response: token,
    }),
  }).then((r) => r.json());

  if (verify.success) {
    console.log(`✅ ${req.user?.username || 'Anonymous'} が認証に成功`);
    res.redirect('/success');
  } else {
    console.log('❌ hCaptcha失敗:', verify);
    res.send('❌ hCaptcha認証に失敗しました。もう一度お試しください。');
  }
});

// 認証成功ページ
app.get('/success', (req, res) => {
  const linkPath = path.resolve('./link.json');
  let returnURL = '#';
  try {
    const data = JSON.parse(fs.readFileSync(linkPath, 'utf8'));
    returnURL = data.returnURL || '#';
  } catch (e) {
    console.log('⚠️ returnURL未設定');
  }
  res.render('success', { user: req.user, returnURL });
});

// ===== サーバー起動 =====
app.listen(port, () => {
  console.log(`🌐 Webサーバー起動中 → http://localhost:${port}`);
});
