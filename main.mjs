// ===== main.mjs =====

// ===== 必要なライブラリ =====
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
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// ===== Bot起動時 =====
client.once('ready', () => {
  console.log(`🎉 ${client.user.tag} が起動しました！`);
});

// ===== メッセージ処理 =====
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // ping
  if (message.content.toLowerCase() === 'ping') {
    await message.reply('🏓 pong!');
  }

  // 認証ボタンを出す
  if (message.content.toLowerCase() === '!auth') {
    // すでにメッセージを送信していれば重複防止
    const existing = message.channel.lastMessage;
    if (existing && existing.author.id === client.user.id) {
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
  }

  // !return コマンド
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
  }
});

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


// ===== Discord ログイン =====
if (!process.env.DISCORD_TOKEN) {
  console.error('❌ DISCORD_TOKEN が未設定です');
  process.exit(1);
}
client.login(process.env.DISCORD_TOKEN);

// ===== Express サーバー =====
const app = express();
const port = process.env.PORT || 3000;
app.set('view engine', 'ejs');
app.set('views', './views');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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

// ===== Discord OAuth2 =====
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

// ===== ページルート =====
app.get('/', (req, res) => res.send('✅ Bot Webサーバー稼働中'));

// 認証開始
app.get('/auth/discord', passport.authenticate('discord'));

// Discordから戻ってくる
app.get(
  '/auth/callback',
  passport.authenticate('discord', { failureRedirect: '/auth/error' }),
  (req, res, next) => {
    try {
      if (!req.user) {
        console.error('❌ OAuth認証に失敗: ユーザー情報がありません');
        return res.redirect('/auth/error');
      }

      console.log(`✅ OAuth認証成功: ${req.user.username || '(不明)'}`);
      return res.redirect('/hcaptcha'); // ← 成功後は確実にhCaptchaへ
    } catch (err) {
      console.error('❌ /auth/callback エラー:', err);
      return res.status(500).send('Internal Server Error');
    }
  }
);



app.get('/hcaptcha', async (req, res) => {
  try {
    if (!req.user) return res.redirect('/auth');

    const linkPath = path.resolve('./link.json');
    let serverName = 'Morx Server';

    if (fs.existsSync(linkPath)) {
      const { returnURL } = JSON.parse(fs.readFileSync(linkPath, 'utf8'));
      const guildId = returnURL.split('/')[4];
      if (guildId && guildId !== '@me') {
        const guild = client.guilds.cache.get(guildId);
        if (guild) serverName = guild.name;
      }
    }

    res.render('hcaptcha', {
      sitekey: process.env.HCAPTCHA_SITEKEY,
      serverName
    });
  } catch (err) {
    console.error('❌ /hcaptcha エラー:', err);
    res.status(500).send('Internal Server Error');
  }
});


app.use(
  session({
    secret: 'super_secret_session',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,  // RenderのFreeプランではtrueにするとセッション維持されないことがある
      maxAge: 1000 * 60 * 10 // 10分有効
    }
  })
);


app.post('/verify', async (req, res) => {
  try {
    const token = req.body['h-captcha-response'];

    // トークンがない場合
    if (!token) {
      return res.status(400).send('HCaptchaトークンが見つかりません。');
    }

    // hCaptcha 検証
    const verifyRes = await fetch('https://hcaptcha.com/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: process.env.HCAPTCHA_SECRET,
        response: token
      })
    });
    const data = await verifyRes.json();

    if (!data.success) {
      console.error('❌ HCaptcha 検証失敗:', data);
      return res.status(400).send('HCaptcha認証に失敗しました。');
    }

    // link.json から returnURL を取得
    const linkPath = path.resolve('./link.json');
    let returnURL = 'https://discord.com/channels/@me';
    let serverName = 'Morx Server';

    if (fs.existsSync(linkPath)) {
      const linkData = JSON.parse(fs.readFileSync(linkPath, 'utf8'));
      returnURL = linkData.returnURL || returnURL;

      const guildId = returnURL.split('/')[4];
      if (guildId && guildId !== '@me') {
        const guild = client.guilds.cache.get(guildId);
        if (guild) serverName = guild.name;
      }
    }

    // ユーザー情報の取得
    const user = req.user || { username: 'ゲスト' };

    // ログ出力
    console.log(`✅ ${user.username} さんが ${serverName} で認証完了`);

    // success.ejs をレンダリング
    res.render('success', {
      serverName,
      user,
      returnURL
    });

  } catch (err) {
    console.error('❌ /verify エラー詳細:', err);
    res.status(500).send('Internal Server Error');
  }
});


// エラー時
app.get('/auth/error', (req, res) => res.send('❌ Discord認証に失敗しました。'));

// サーバー起動
app.listen(port, () => {
  console.log(`🌐 Webサーバー起動: http://localhost:${port}`);
});
