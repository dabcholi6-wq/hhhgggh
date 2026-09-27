// ==============================================================
// ربات SELF+PLUS - بازی شرط‌بندی + سیستم الماس
// ==============================================================
// نصب: npm install telegraf sqlite3
// اجرا: node bot.js

const { Telegraf } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// ------------------------------
// تنظیمات - این مقادیر رو با مقادیر خودتون جایگزین/تکمیل کنید
// ------------------------------
const TOKEN = process.env.BOT_TOKEN || '8871135899:AAHRj_zEHtsu7OOk9OaXma8c5Hd6OdPLRpA';
const ADMIN_IDS = [7660204118, 8911553102];
const ADMIN_FIXED_DIAMONDS = 1000000000; // موجودی ثابت مدیرها - هیچ‌وقت کم یا زیاد نمی‌شه

// آیدی عددی گروهی که ربات فقط توش کار می‌کنه (بازی + دراپ سریع).
// دیگه استفاده نمی‌شه چون ربات حالا توی همه‌ی گروه‌ها فعاله؛ فقط برای سازگاری نگه داشته شده.
const ALLOWED_GROUP_ID = parseInt(process.env.ALLOWED_GROUP_ID || '0');

const REQUIRED_GROUP_LINK = 'https://t.me/+ag3hVHp9K9cwMTlk';
const REQUIRED_CHANNEL_LINK = 'https://t.me/SelfplusChannel';
const REQUIRED_CHANNEL_USERNAME = '@SelfplusChannel';
// آیدی عددی همون گروه عضویت (برای چک کردن عضویت لازمه؛ مثل بالا از لاگ کنسول بردارید)
const REQUIRED_GROUP_ID = parseInt(process.env.REQUIRED_GROUP_ID || '0');

const SUPPORT_ADMINS = ['@self_plus_admin', '@Ekfjdvkfkgbkdkdj'];
const GAME_IMAGE_URL = 'https://cdn.imgurl.ir/uploads/r1612_IMG_20260925_132917_723.jpg';

const BRAND = '꧁༒ SΞLF†PLU$ ༒꧂';

const bot = new Telegraf(TOKEN);

function isAdmin(userId) {
    return ADMIN_IDS.includes(userId);
}

// ------------------------------
// دیتابیس
// ------------------------------
const dbPath = path.join(__dirname, 'data.db');
const db = new sqlite3.Database(dbPath);

db.run(`
    CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY,
        diamonds INTEGER DEFAULT 0,
        joined_verified INTEGER DEFAULT 0,
        referred_by INTEGER DEFAULT NULL,
        daily_games INTEGER DEFAULT 0,
        daily_reset_at INTEGER DEFAULT 0,
        total_referrals INTEGER DEFAULT 0,
        last_wheel_at INTEGER DEFAULT 0
    )
`);

function ensureUser(userId, callback) {
    db.get('SELECT * FROM users WHERE user_id = ?', [userId], (_err, row) => {
        if (!row) {
            db.run('INSERT INTO users (user_id, diamonds) VALUES (?, 0)', [userId], () => {
                db.get('SELECT * FROM users WHERE user_id = ?', [userId], (_e, newRow) => callback(newRow));
            });
        } else {
            callback(row);
        }
    });
}

// موجودی واقعی از دیتابیس می‌خونه، ولی برای مدیرا همیشه عدد ثابت برمی‌گردونه
function getBalance(userId, callback) {
    if (isAdmin(userId)) {
        return callback(ADMIN_FIXED_DIAMONDS);
    }
    ensureUser(userId, (user) => callback(user.diamonds));
}

// تغییر موجودی با یه مقدار دلتا (مثبت یا منفی). برای مدیرا هیچ تغییری اعمال/ذخیره نمی‌شه.
function adjustDiamonds(userId, delta, callback) {
    if (isAdmin(userId)) {
        return callback(ADMIN_FIXED_DIAMONDS);
    }
    ensureUser(userId, (user) => {
        let newVal = user.diamonds + delta;
        if (newVal < 0) newVal = 0;
        db.run('UPDATE users SET diamonds = ? WHERE user_id = ?', [newVal, userId], () => callback(newVal));
    });
}

function updateUserFields(userId, data, callback) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const setClause = keys.map((k) => `${k} = ?`).join(', ');
    db.run(`UPDATE users SET ${setClause} WHERE user_id = ?`, [...values, userId], callback || (() => {}));
}

// کش نام‌ها
const nameCache = {};
function rememberName(user) {
    if (user && user.id) nameCache[user.id] = user.first_name || 'کاربر';
}
function nameOf(userId) {
    return nameCache[userId] || `کاربر ${userId}`;
}

bot.use((ctx, next) => {
    if (ctx.from) rememberName(ctx.from);
    return next();
});

// ------------------------------
// جدول کارمزد انتقال الماس
// پله‌ی اول: ۱ تا ۲۵ = ۲ الماس
// از ۲۶ به بعد هر ۱۰ تا مقدار، ۲ الماس به کارمزد اضافه می‌شه (تا هر عددی، حتی میلیاردی)
// ------------------------------
function transferFee(amount) {
    if (amount <= 25) return 2;
    const step = Math.ceil((amount - 25) / 10);
    return 4 + 2 * step;
}

// ------------------------------
// جدول کارمزد بازی شرط‌بندی
// پله‌ی اول: ۲۰ تا ۲۴ = ۲ الماس
// از ۲۵ به بعد هر ۱۰ تا مقدار، ۱ الماس به کارمزد اضافه می‌شه (تا هر عددی)
// ------------------------------
function gameFee(amount) {
    if (amount < 25) return 2;
    const step = Math.ceil((amount - 24) / 10);
    return 2 + step;
}

// ==============================================================
// چک عضویت اجباری (گروه + کانال)
// ==============================================================
async function checkMembership(ctx, userId) {
    try {
        if (REQUIRED_GROUP_ID) {
            const m1 = await ctx.telegram.getChatMember(REQUIRED_GROUP_ID, userId);
            if (['left', 'kicked'].includes(m1.status)) return false;
        }
        const m2 = await ctx.telegram.getChatMember(REQUIRED_CHANNEL_USERNAME, userId);
        if (['left', 'kicked'].includes(m2.status)) return false;
        return true;
    } catch (e) {
        // اگه ربات هنوز توی اون گروه/کانال ادمین نیست یا آیدی گروه ست نشده، محافظه‌کارانه رد می‌کنیم
        return false;
    }
}

function joinGateText(name) {
    return `سلام ${name} برای استفاده از ربات باید داخل کانال و گپ ما عضو بشی`;
}

function joinGateKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'گپ 👥', url: REQUIRED_GROUP_LINK }, { text: 'کانال 📣', url: REQUIRED_CHANNEL_LINK }],
                [{ text: 'عضو شدم✅', callback_data: 'check_join' }]
            ]
        }
    };
}

// ==============================================================
// منوی اصلی خصوصی
// ==============================================================
function mainMenuText(name, diamonds) {
    return `${BRAND}\nسلام ${name}👋\nبه قدرتمندترین ربات سلف خوش آمدید⚡\n\n💎موجودی شما : ${diamonds}\n\n💰برای شارژ حساب خود وارد مینی اپ شوید\n\nیکی از گزینه های زیر را انتخاب کنید👇`;
}

function mainMenuKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'موجودی💰', callback_data: 'menu_balance' }],
                [{ text: 'انتقال الماس💎', callback_data: 'menu_transfer' }, { text: '🎯 چالش روزانه', callback_data: 'menu_daily' }],
                [{ text: '👥زیر مجموعه گیری', callback_data: 'menu_ref' }],
                [{ text: '🎡گردونه شانس', callback_data: 'menu_wheel' }, { text: '💬 پشتیبانی', callback_data: 'menu_support' }]
            ]
        }
    };
}

async function sendMainMenu(ctx, userId, name) {
    getBalance(userId, (diamonds) => {
        ctx.reply(mainMenuText(name, diamonds), mainMenuKeyboard());
    });
}

bot.start(async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    const userId = ctx.from.id;
    const name = ctx.from.first_name || 'کاربر';

    // پردازش لینک دعوت زیرمجموعه‌گیری: /start ref_<referrerId>
    const payload = ctx.startPayload;
    let referrerId = null;
    if (payload && payload.startsWith('ref_')) {
        const rid = parseInt(payload.slice(4));
        if (rid && rid !== userId) referrerId = rid;
    }

    ensureUser(userId, async (user) => {
        const isNewUser = user.diamonds === 0 && !user.referred_by && user.total_referrals === 0 && user.daily_games === 0;
        if (referrerId && isNewUser && !user.referred_by) {
            updateUserFields(userId, { referred_by: referrerId }, () => {
                adjustDiamonds(referrerId, 100, () => {
                    updateUserFields(referrerId, {}, () => {});
                    db.run('UPDATE users SET total_referrals = total_referrals + 1 WHERE user_id = ?', [referrerId]);
                    ctx.telegram.sendMessage(referrerId, `${BRAND}\n🎉 یه نفر با لینک دعوتت اومد!\n💎 100 الماس بهت اضافه شد`).catch(() => {});
                });
            });
        }

        const isMember = await checkMembership(ctx, userId);
        if (!isMember) {
            return ctx.reply(joinGateText(name), joinGateKeyboard());
        }
        sendMainMenu(ctx, userId, name);
    });
});

bot.action('check_join', async (ctx) => {
    const userId = ctx.from.id;
    const name = ctx.from.first_name || 'کاربر';
    const isMember = await checkMembership(ctx, userId);
    if (!isMember) {
        return ctx.answerCbQuery('هنوز عضو نشدی', { show_alert: true });
    }
    await ctx.deleteMessage().catch(() => {});
    sendMainMenu(ctx, userId, name);
});

bot.action('menu_back', (ctx) => {
    const userId = ctx.from.id;
    const name = ctx.from.first_name || 'کاربر';
    getBalance(userId, (diamonds) => {
        ctx.editMessageText(mainMenuText(name, diamonds), mainMenuKeyboard()).catch(() => {});
    });
});

// ------------------------------
// موجودی
// ------------------------------
bot.action('menu_balance', (ctx) => {
    const userId = ctx.from.id;
    getBalance(userId, (diamonds) => {
        ctx.editMessageText(
            `${BRAND}\n\n💎موجودی شما: ${diamonds}\n\n${BRAND}`,
            { reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'menu_back' }]] } }
        ).catch(() => {});
    });
});

// ------------------------------
// انتقال الماس
// ------------------------------
const transferState = {}; // userId -> { step: 'awaiting_target'|'awaiting_amount', targetId }

bot.action('menu_transfer', (ctx) => {
    const userId = ctx.from.id;
    transferState[userId] = { step: 'awaiting_target' };
    getBalance(userId, (diamonds) => {
        ctx.editMessageText(
            `${BRAND}\n\nانتقال الماس 💎\n\n💎موجودی شما: ${diamonds}\n\n${BRAND}\n👤آیدی عددی گیرنده رو بفرست`
        ).catch(() => {});
    });
});

bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id;
    const text = ctx.message.text.trim();

    if (ctx.chat.type === 'private' && transferState[userId]) {
        const state = transferState[userId];

        if (state.step === 'awaiting_target') {
            const targetId = parseInt(text);
            if (!targetId || targetId === userId) {
                return ctx.reply('❌ آیدی عددی معتبر بفرست.');
            }
            state.targetId = targetId;
            state.step = 'awaiting_amount';
            return ctx.reply(`${BRAND}\n👤گیرنده: ${nameOf(targetId)}\n${BRAND}\n💎چقدر الماس میخوای انتقال بدی؟\n\nفقط عدد`);
        }

        if (state.step === 'awaiting_amount') {
            const amount = parseInt(text);
            if (!amount || amount <= 0) {
                return ctx.reply('❌ فقط عدد معتبر بفرست.');
            }

            getBalance(userId, (senderBalance) => {
                const fee = transferFee(amount);
                const totalCost = amount + fee;

                if (senderBalance < totalCost) {
                    delete transferState[userId];
                    return ctx.reply(`❌ موجودی کافی نداری. موجودی: ${senderBalance} (نیاز: ${totalCost} شامل کارمزد)`);
                }

                const targetId = state.targetId;
                delete transferState[userId];

                adjustDiamonds(userId, -totalCost, (senderNew) => {
                    adjustDiamonds(targetId, amount, (receiverNew) => {
                        ctx.reply(
                            `💎انتقال الماس با موفقیت انجام شد ❗\n${BRAND}\nگیرنده: ${nameOf(targetId)}\n💎الماس دریافتی گیرنده: ${amount} الماس\n💲کارمزد: ${fee} الماس\n💎موجودی جدید گیرنده: ${receiverNew}\n💎موجودی جدید فرستنده: ${senderNew}`
                        );
                        ctx.telegram.sendMessage(targetId, `${BRAND}\n💎 ${amount} الماس از طرف ${nameOf(userId)} برات اومد!\nموجودی جدیدت: ${receiverNew}`).catch(() => {});
                    });
                });
            });
            return;
        }
    }

    return next();
});

// ------------------------------
// چالش روزانه
// ------------------------------
const DAILY_RESET_MS = 12 * 60 * 60 * 1000;
const DAILY_GAMES_PER_REWARD = 10;
const DAILY_REWARD = 50;
const DAILY_MAX_GAMES = 50;

function dailyChallengeText() {
    return `${BRAND}\n\nشما با هر 10 بازی که توی گپ ایجاد کنید می‌توانید 50 الماس دریافت کنید💎\nسقف پایان چالش: 50 بازی\n⌛هر 12 ساعت چالش ریست میشه\n${BRAND}`;
}

bot.action('menu_daily', (ctx) => {
    ctx.editMessageText(dailyChallengeText(), {
        reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'menu_back' }]] }
    }).catch(() => {});
});

// این تابع هر بار که کاربر توی گروه یه بازی شرط‌بندی می‌سازه صدا زده می‌شه
function registerDailyGame(userId) {
    if (isAdmin(userId)) return;
    ensureUser(userId, (user) => {
        const now = Date.now();
        let games = user.daily_games;
        let resetAt = user.daily_reset_at;

        if (!resetAt || now - resetAt > DAILY_RESET_MS) {
            games = 0;
            resetAt = now;
        }

        games += 1;
        if (games > DAILY_MAX_GAMES) games = DAILY_MAX_GAMES;

        updateUserFields(userId, { daily_games: games, daily_reset_at: resetAt }, () => {
            if (games % DAILY_GAMES_PER_REWARD === 0 && games <= DAILY_MAX_GAMES) {
                adjustDiamonds(userId, DAILY_REWARD, () => {
                    bot.telegram.sendMessage(userId, `${BRAND}\n🎯 چالش روزانه\n💎 با تکمیل ${games} بازی، ${DAILY_REWARD} الماس گرفتی!`).catch(() => {});
                });
            }
        });
    });
}

// ------------------------------
// زیرمجموعه‌گیری
// ------------------------------
bot.action('menu_ref', async (ctx) => {
    const userId = ctx.from.id;
    const me = await ctx.telegram.getMe();
    const link = `https://t.me/${me.username}?start=ref_${userId}`;
    ctx.editMessageText(
        `${BRAND}\nلینک اختصاصی شما:\n${link}\n\nهر کسی با لینک دعوت تو ربات را استارت کنه 100 الماس میگیری💎\n${BRAND}`,
        { reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'menu_back' }]] } }
    ).catch(() => {});
});

// ------------------------------
// گردونه‌ی شانس
// ------------------------------
const WHEEL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

bot.action('menu_wheel', (ctx) => {
    const userId = ctx.from.id;

    if (isAdmin(userId)) {
        const amount = Math.floor(Math.random() * 101);
        return ctx.editMessageText(
            `${BRAND}\n💎امروز ${amount} الماس دریافت کردی\n⌛فردا دوباره بچرخون!\n${BRAND}`,
            { reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'menu_back' }]] } }
        ).catch(() => {});
    }

    ensureUser(userId, (user) => {
        const now = Date.now();
        if (user.last_wheel_at && now - user.last_wheel_at < WHEEL_COOLDOWN_MS) {
            return ctx.answerCbQuery('⌛ فردا دوباره بچرخون!', { show_alert: true });
        }

        const amount = Math.floor(Math.random() * 101); // 0 تا 100
        updateUserFields(userId, { last_wheel_at: now }, () => {
            adjustDiamonds(userId, amount, () => {
                ctx.editMessageText(
                    `${BRAND}\n💎امروز ${amount} الماس دریافت کردی\n⌛فردا دوباره بچرخون!\n${BRAND}`,
                    { reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'menu_back' }]] } }
                ).catch(() => {});
            });
        });
    });
});

// ------------------------------
// پشتیبانی
// ------------------------------
bot.action('menu_support', (ctx) => {
    ctx.editMessageText(
        `${BRAND}\n💬هر سوالی داشتی به ادمین ها پیام بده\n${SUPPORT_ADMINS.join('\n')}\n${BRAND}`,
        { reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'menu_back' }]] } }
    ).catch(() => {});
});

// ==============================================================
// محدود کردن ربات فقط به گروه مجاز (برای دستورات گروهی)
// ==============================================================
// ==============================================================
// ثبت خودکار همه‌ی گروه‌هایی که ربات توشونه (برای ارسال دراپ سریع به همه‌شون)
// ==============================================================
db.run(`
    CREATE TABLE IF NOT EXISTS groups (
        chat_id INTEGER PRIMARY KEY,
        title TEXT
    )
`);

function registerGroup(chatId, title) {
    db.run('INSERT OR REPLACE INTO groups (chat_id, title) VALUES (?, ?)', [chatId, title || '']);
}

function getAllGroups(callback) {
    db.all('SELECT chat_id FROM groups', [], (_err, rows) => {
        callback((rows || []).map((r) => r.chat_id));
    });
}

bot.use((ctx, next) => {
    if (ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup')) {
        registerGroup(ctx.chat.id, ctx.chat.title);
        console.log(`چت: ${ctx.chat.id}  |  عنوان: ${ctx.chat.title}`);
    }
    return next();
});

// ==============================================================
// بازی شرط‌بندی (گروهی)
// ==============================================================
const betGames = {};
const BET_MIN = 20;

function gameStartCaption(creatorId, amount) {
    return (
        `${BRAND}\n\n` +
        `🎮بازی جدید🎮\n` +
        `👤سازنده : ${nameOf(creatorId)}\n` +
        `💎مقدار:${amount}\n` +
        `${BRAND}\n` +
        `⌛منتظر رقیب.....`
    );
}

function gameCancelledCaption() {
    return `${BRAND}\n\n❌ بازی توسط سازنده لغو شد\n\n${BRAND}`;
}

function gameResultCaption(winnerId, loserId, reward, fee) {
    return (
        `${BRAND}\n\n` +
        `🏆 برنده: ${nameOf(winnerId)}\n` +
        `💔بازنده: ${nameOf(loserId)}\n` +
        `🎁جایزه: ${reward} الماس\n` +
        `💲 کارمزد: ${fee} الماس\n` +
        `${BRAND}`
    );
}

bot.hears(/^بازی (\d+)$/, (ctx) => {
    if (ctx.chat.type === 'private') return ctx.reply('❌ بازی فقط داخل گروه انجام می‌شه.');

    const userId = ctx.from.id;
    const amount = parseInt(ctx.match[1]);
    if (amount < BET_MIN) return ctx.reply(`❌ حداقل شرط ${BET_MIN} الماسه.`);

    getBalance(userId, (balance) => {
        if (balance < amount) return ctx.reply(`❌ الماس کافی نداری. موجودی: ${balance}`);

        adjustDiamonds(userId, -amount, () => {
            const gameId = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
            betGames[gameId] = { creator: userId, amount, players: [userId], status: 'waiting' };

            ctx.replyWithPhoto(GAME_IMAGE_URL, {
                caption: gameStartCaption(userId, amount),
                reply_markup: {
                    inline_keyboard: [[
                        { text: 'لغو بازی❌', callback_data: `bet_cancel_${gameId}` },
                        { text: 'پیوستن✅', callback_data: `bet_join_${gameId}` }
                    ]]
                }
            });

            registerDailyGame(userId);
        });
    });
});

bot.action(/^bet_cancel_([\w]+)$/, (ctx) => {
    const gameId = ctx.match[1];
    const userId = ctx.from.id;
    const game = betGames[gameId];

    if (!game) return ctx.answerCbQuery('❌ این بازی وجود نداره.', { show_alert: true });
    if (game.creator !== userId) return ctx.answerCbQuery('❌ فقط سازنده می‌تونه لغو کنه.', { show_alert: true });
    if (game.status !== 'waiting') return ctx.answerCbQuery('❌ بازی شروع شده.', { show_alert: true });

    adjustDiamonds(userId, game.amount, () => {
        delete betGames[gameId];
        ctx.editMessageCaption(gameCancelledCaption()).catch(() => {});
    });
});

bot.action(/^bet_join_([\w]+)$/, (ctx) => {
    const gameId = ctx.match[1];
    const userId = ctx.from.id;
    const game = betGames[gameId];

    if (!game) return ctx.answerCbQuery('❌ این بازی وجود نداره.', { show_alert: true });
    if (game.status !== 'waiting') return ctx.answerCbQuery('❌ بازی تموم شده.', { show_alert: true });
    if (game.creator === userId) return ctx.answerCbQuery('❌ نمی‌تونی به بازی خودت بپیوندی.', { show_alert: true });

    getBalance(userId, (balance) => {
        if (balance < game.amount) {
            return ctx.answerCbQuery(`❌ الماس کافی نداری. موجودی: ${balance}`, { show_alert: true });
        }

        adjustDiamonds(userId, -game.amount, () => {
            game.players.push(userId);
            game.status = 'complete';
            registerDailyGame(userId);

            const winner = game.players[Math.floor(Math.random() * game.players.length)];
            const loser = game.players.find((p) => p !== winner);
            const pot = game.amount * 2;
            const fee = gameFee(game.amount);
            const reward = pot - fee;

            adjustDiamonds(winner, reward, () => {
                delete betGames[gameId];
                ctx.editMessageCaption(gameResultCaption(winner, loser, reward, fee)).catch(() => {});
            });
        });
    });
});

// ------------------------------
// موجودی توی گروه (با ریپلای)
// ------------------------------
bot.hears('موجودی', (ctx) => {
    if (ctx.chat.type === 'private') return;

    const userId = ctx.from.id;
    getBalance(userId, (diamonds) => {
        ctx.reply(`${BRAND}\n\n💎موجودی شما: ${diamonds}\n\n${BRAND}`, {
            reply_to_message_id: ctx.message.message_id
        });
    });
});

// ==============================================================
// دستور کسر الماس توسط مدیر (ریپلای روی پیام کاربر)
// ==============================================================
bot.hears(/^کسر (\d+)$/, (ctx) => {
    if (ctx.chat.type === 'private') return;
    const adminId = ctx.from.id;
    if (!isAdmin(adminId)) return;

    const reply = ctx.message.reply_to_message;
    if (!reply) return;

    const targetId = reply.from.id;
    const amount = parseInt(ctx.match[1]);

    adjustDiamonds(targetId, -amount, () => {
        ctx.reply(`${BRAND}\nاز ${nameOf(targetId)} ${amount}💎 کم شد\n${BRAND}`, {
            reply_to_message_id: ctx.message.message_id
        });
    });
});

// ==============================================================
// دراپ سریع - یه بار در روز، ساعت تصادفی بین ۱۶ تا ۲۳ به وقت ایران
// ==============================================================
const DROP_REWARD = 200;
let dropTargetMinute = null; // دقیقه‌ی روز (۰ تا ۱۴۳۹) که دراپ باید ارسال بشه
let dropFiredToday = false;
let lastDropCheckDate = null;
const activeDrops = {}; // chatId -> { messageId, claimed }

function getTehranNow() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tehran' }));
}

function pickNewDropTarget() {
    const startMinute = 16 * 60;
    const endMinute = 23 * 60; // تا قبل از ساعت ۲۳:۰۰
    dropTargetMinute = startMinute + Math.floor(Math.random() * (endMinute - startMinute));
    dropFiredToday = false;
}

async function sendQuickDrop() {
    getAllGroups(async (groupIds) => {
        for (const chatId of groupIds) {
            try {
                const msg = await bot.telegram.sendMessage(
                    chatId,
                    `${BRAND}\nدراپ سریع ⚡\n\nاولین کسی که روی این پیام ریپلای کنه ${DROP_REWARD}💎 دریافت میکنه\nسریع باش🏃\n${BRAND}`
                );
                activeDrops[chatId] = { messageId: msg.message_id, claimed: false };
            } catch (e) {
                // احتمالاً ربات از اون گروه حذف شده، رد می‌شیم
            }
        }
    });
}

setInterval(() => {
    const now = getTehranNow();
    const dateStr = now.toDateString();

    if (lastDropCheckDate !== dateStr) {
        lastDropCheckDate = dateStr;
        pickNewDropTarget();
    }

    const minuteOfDay = now.getHours() * 60 + now.getMinutes();
    if (!dropFiredToday && dropTargetMinute !== null && minuteOfDay >= dropTargetMinute) {
        dropFiredToday = true;
        sendQuickDrop();
    }
}, 60 * 1000);

// مقداردهی اولیه‌ی هدف امروز، همین موقع روشن شدن ربات
lastDropCheckDate = getTehranNow().toDateString();
pickNewDropTarget();

// گرفتن جایزه‌ی دراپ سریع - اولین کسی که روی پیام دراپ ریپلای کنه (هر نوع پیامی)
bot.on('message', (ctx, next) => {
    if (ctx.chat.type === 'private') return next();

    const drop = activeDrops[ctx.chat.id];
    if (!drop || drop.claimed) return next();

    const reply = ctx.message.reply_to_message;
    if (!reply || reply.message_id !== drop.messageId) return next();

    drop.claimed = true;
    const userId = ctx.from.id;

    adjustDiamonds(userId, DROP_REWARD, () => {
        ctx.reply(
            `${BRAND}\nسریعترین بودی ⚡\n${DROP_REWARD}💎 به موجودی شما اضافه شد✅\n${BRAND}`,
            { reply_to_message_id: ctx.message.message_id }
        );
    });

    return next();
});

// ------------------------------
// اجرا
// ------------------------------
bot.launch();
console.log('✅ ربات SELF+PLUS با موفقیت اجرا شد');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
