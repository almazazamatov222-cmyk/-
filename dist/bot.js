"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BotManager = void 0;
const tmi = __importStar(require("tmi.js"));
const ai_1 = require("./ai");
const points_1 = require("./points");
class BotManager {
    constructor(configs, channel, groqKey, opts, emit) {
        this.bots = new Map();
        this.stopped = false;
        this.readerClient = null;
        this.transcriptResponseIdx = 0;
        this.botsPerTranscript = 2;
        this.pointsService = null;
        this.channel = channel.toLowerCase().replace(/^#/, '');
        this.language = opts.language;
        this.emit = emit;
        this.botsPerTranscript = opts.botsPerTranscript || 2;
        this.ai = new ai_1.AIService(groqKey, opts.settings, opts.savedPersonas);
        // Init points service if we have channel ID
        if (opts.channelId && opts.clientId) {
            this.pointsService = new points_1.ChannelPointsService(this.channel, opts.channelId, opts.clientId, emit);
        }
        configs.forEach((cfg, idx) => this.initBot(cfg, idx));
        this.initReader();
    }
    async onTranscription(text) {
        if (this.stopped || !text.trim())
            return;
        const allBots = Array.from(this.bots.values()).filter(b => b.connected);
        if (!allBots.length)
            return;
        const count = Math.min(this.botsPerTranscript, allBots.length);
        const responding = [];
        for (let i = 0; i < count; i++) {
            responding.push(allBots[(this.transcriptResponseIdx + i) % allBots.length]);
        }
        this.transcriptResponseIdx = (this.transcriptResponseIdx + count) % allBots.length;
        for (let i = 0; i < responding.length; i++) {
            const bot = responding[i];
            const delay = i * (3000 + Math.random() * 5000);
            setTimeout(async () => {
                if (this.stopped || !bot.connected)
                    return;
                if (Date.now() - bot.lastMsgTime < 5000)
                    return;
                try {
                    const msg = await this.ai.generateFromTranscription(bot.username, text, this.language, bot.index);
                    if (!msg || this.stopped)
                        return;
                    console.log('[bot]', bot.username, '→', '"' + msg + '"');
                    await bot.client.say('#' + this.channel, msg);
                    bot.messages++;
                    bot.lastMsgTime = Date.now();
                    this.emit('bot:message', { username: bot.username, message: msg, count: bot.messages });
                    const log = this.ai.transcriptLog;
                    if (log.length)
                        this.emit('transcript:entry', log[log.length - 1]);
                }
                catch (e) {
                    const m = String(e?.message || e);
                    if (!m.includes('Not connected') && !m.includes('No response'))
                        this.emit('bot:error', { username: bot.username, code: 'say_error', message: m });
                }
            }, delay);
        }
    }
    async sendTagReply(bot, original) {
        if (!bot.connected || this.stopped)
            return;
        if (Date.now() - bot.lastMsgTime < 3000)
            return;
        try {
            const msg = await this.ai.generateFromTranscription(bot.username, '', this.language, bot.index, original);
            if (!msg)
                return;
            await bot.client.say('#' + this.channel, msg);
            bot.messages++;
            bot.lastMsgTime = Date.now();
            this.emit('bot:message', { username: bot.username, message: msg, count: bot.messages });
        }
        catch (e) {
            console.error('[bot] tag reply', bot.username, e.message);
        }
    }
    initReader() {
        if (this.stopped)
            return;
        this.readerClient = new tmi.Client({
            options: { debug: false, skipMembership: true },
            channels: ['#' + this.channel],
            connection: { reconnect: true, secure: true },
        });
        this.readerClient.on('message', (_ch, tags, message, _self) => {
            const senderLower = (tags.username || '').toLowerCase();
            const isBotAccount = this.bots.has(senderLower);
            this.emit('chat:message', {
                username: tags.username || '', displayName: tags['display-name'] || tags.username || '',
                message, color: tags.color || null, isBot: isBotAccount, id: tags.id || String(Date.now()),
            });
            if (!isBotAccount) {
                this.ai.addRealMessage(tags['display-name'] || tags.username || 'viewer', message);
                for (const [botKey, bot] of this.bots) {
                    if (!bot.connected)
                        continue;
                    if (message.toLowerCase().includes('@' + botKey) || message.toLowerCase().includes('@' + bot.username.toLowerCase())) {
                        setTimeout(() => { if (!this.stopped)
                            this.sendTagReply(bot, message); }, 1500 + Math.random() * 2500);
                    }
                }
            }
        });
        this.readerClient.connect().catch((e) => console.error('[reader]', e.message));
    }
    initBot(cfg, idx) {
        const token = cfg.token.replace(/^oauth:/i, '');
        const client = new tmi.Client({
            options: { debug: false, skipMembership: true },
            identity: { username: cfg.username, password: 'oauth:' + token },
            channels: ['#' + this.channel],
            connection: { reconnect: true, maxReconnectAttempts: 20, reconnectInterval: 3000, secure: true },
        });
        const bot = {
            client, username: cfg.username, token,
            connected: false, connectTimer: null, messages: 0, index: idx,
            lastMsgTime: 0, presenceInterval: null, presenceActive: false, pointsBalance: null,
        };
        this.bots.set(cfg.username.toLowerCase(), bot);
        client.on('connected', () => {
            if (this.stopped) {
                client.disconnect().catch(() => { });
                return;
            }
            bot.connected = true;
            this.emit('bot:status', { username: cfg.username, state: 'connected', message: 'Подключён' });
            this.startPresence(bot);
            // Connect to PubSub for channel points
            if (this.pointsService) {
                this.pointsService.connectBot(cfg.username, token).catch(() => { });
            }
            // Fetch initial points balance
            this.fetchBalance(bot);
        });
        client.on('disconnected', (reason) => {
            bot.connected = false;
            if (bot.presenceInterval) {
                clearInterval(bot.presenceInterval);
                bot.presenceInterval = null;
                bot.presenceActive = false;
            }
            if (!this.stopped)
                this.emit('bot:status', { username: cfg.username, state: 'reconnecting', message: reason });
        });
        client.on('reconnect', () => {
            if (!this.stopped)
                this.emit('bot:status', { username: cfg.username, state: 'connecting', message: 'Переподключение...' });
        });
        client.on('notice', (_ch, msgid, message) => {
            this.emit('bot:error', { username: cfg.username, code: msgid, message });
        });
        this.emit('bot:status', { username: cfg.username, state: 'connecting', message: 'Подключение...' });
        bot.connectTimer = setTimeout(() => {
            if (!this.stopped)
                client.connect().catch((e) => {
                    this.emit('bot:status', { username: cfg.username, state: 'error', message: e.message });
                });
        }, idx * 1500);
    }
    async fetchBalance(bot) {
        if (!this.pointsService)
            return;
        const balance = await this.pointsService.getBalance(bot.username, bot.token, '');
        if (balance != null) {
            bot.pointsBalance = balance;
            this.emit('points:balance', { username: bot.username, balance });
        }
    }
    // Manually trigger bonus chest claim for all bots
    async claimAllBonusChests() {
        if (!this.pointsService)
            return;
        for (const bot of this.bots.values()) {
            if (bot.connected) {
                await this.pointsService.claimBonusChest(bot.username, bot.token, bot.username);
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }
    async startPresence(bot) {
        if (this.stopped || bot.presenceActive)
            return;
        bot.presenceActive = true;
        console.log('[presence] Starting for', bot.username);
        const poll = async () => {
            if (this.stopped || !bot.connected)
                return;
            try {
                const { default: axios } = await Promise.resolve().then(() => __importStar(require('axios')));
                const gql = await axios.post('https://gql.twitch.tv/gql', [{
                        operationName: 'PlaybackAccessToken_Template',
                        query: `query PlaybackAccessToken_Template($login:String!,$isLive:Boolean!,$vodID:ID!,$isVod:Boolean!,$playerType:String!){streamPlaybackAccessToken(channelName:$login,params:{platform:"web",playerBackend:"mediaplayer",playerType:$playerType})@include(if:$isLive){value signature}}`,
                        variables: { login: this.channel, isLive: true, isVod: false, vodID: '', playerType: 'embed' },
                    }], {
                    headers: {
                        'Authorization': 'OAuth ' + bot.token,
                        'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
                        'Content-Type': 'application/json',
                    },
                    timeout: 10000,
                });
                const token = gql.data?.[0]?.data?.streamPlaybackAccessToken;
                if (!token?.value)
                    return;
                const sig = token.signature, tok = encodeURIComponent(token.value), p = Math.floor(Math.random() * 999999);
                const m3u8 = `https://usher.twitchapps.com/api/channel/hls/${this.channel}.m3u8?sig=${sig}&token=${tok}&allow_source=true&fast_bread=true&p=${p}`;
                const h = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36',
                    'Origin': 'https://www.twitch.tv', 'Referer': 'https://www.twitch.tv/',
                    'Authorization': 'OAuth ' + bot.token,
                };
                const masterRes = await axios.get(m3u8, { headers: h, timeout: 10000 });
                const lines = masterRes.data.split('\n');
                const playlistUrl = lines.find((l) => l.startsWith('http') && l.includes('160p'))
                    || lines.find((l) => l.startsWith('http'));
                if (playlistUrl) {
                    const mediaRes = await axios.get(playlistUrl.trim(), { headers: h, timeout: 10000 });
                    const segUrl = mediaRes.data.split('\n').find((l) => l.startsWith('http'));
                    if (segUrl) {
                        await axios.get(segUrl.trim(), { headers: h, timeout: 15000, responseType: 'arraybuffer', maxContentLength: 300 * 1024 });
                        console.log('[presence]', bot.username, '✓');
                        this.emit('presence:active', { username: bot.username });
                    }
                }
            }
            catch { /* stream offline or error — silent */ }
        };
        await poll();
        bot.presenceInterval = setInterval(() => {
            if (this.stopped || !bot.connected) {
                if (bot.presenceInterval)
                    clearInterval(bot.presenceInterval);
                return;
            }
            poll();
        }, 20000);
    }
    async sendManual(usernames, message) {
        for (const u of usernames) {
            if (this.stopped)
                return;
            const bot = this.bots.get(u.toLowerCase()) || this.bots.get(u);
            if (!bot?.connected)
                continue;
            try {
                await bot.client.say('#' + this.channel, message);
                bot.messages++;
                bot.lastMsgTime = Date.now();
                this.emit('bot:message', { username: bot.username, message, count: bot.messages });
            }
            catch (e) {
                this.emit('bot:error', { username: bot.username, code: 'say_error', message: e.message });
            }
        }
    }
    setPersona(username, cfg) { this.ai.setPersona(username, cfg); }
    getPersonas() { return this.ai.getPersonas(); }
    setBotsPerTranscript(n) { this.botsPerTranscript = Math.max(1, n); }
    async stop() {
        console.log('[manager] stopping...');
        this.stopped = true;
        if (this.pointsService) {
            this.pointsService.stop();
            this.pointsService = null;
        }
        for (const bot of this.bots.values()) {
            if (bot.presenceInterval) {
                clearInterval(bot.presenceInterval);
                bot.presenceInterval = null;
            }
            if (bot.connectTimer) {
                clearTimeout(bot.connectTimer);
                bot.connectTimer = null;
            }
            bot.connected = false;
        }
        if (this.readerClient) {
            this.readerClient.disconnect().catch(() => { });
            this.readerClient = null;
        }
        await Promise.allSettled(Array.from(this.bots.values()).map(b => b.client.disconnect().catch(() => { })));
        this.bots.clear();
        console.log('[manager] stopped');
    }
    getUsernames() { return Array.from(this.bots.values()).map(b => b.username); }
    getTranscriptLog() { return this.ai.transcriptLog; }
    getPresenceStatus() {
        const out = {};
        for (const [k, b] of this.bots)
            out[k] = b.presenceActive && b.connected;
        return out;
    }
    getPointsBalances() {
        const out = {};
        for (const [k, b] of this.bots)
            out[k] = b.pointsBalance;
        return out;
    }
}
exports.BotManager = BotManager;
//# sourceMappingURL=bot.js.map