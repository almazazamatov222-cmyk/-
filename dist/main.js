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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const axios_1 = __importDefault(require("axios"));
const bot_1 = require("./bot");
const transcription_1 = require("./transcription");
const app = (0, express_1.default)();
const http = (0, http_1.createServer)(app);
const io = new socket_io_1.Server(http, { cors: { origin: '*' } });
app.use(express_1.default.json());
const FE_DIST = path.join(__dirname, '../frontend/dist');
app.use(express_1.default.static(path.join(__dirname, '../public')));
app.use(express_1.default.static(FE_DIST));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('*', (_req, res) => {
    res.sendFile(path.join(FE_DIST, 'index.html'));
});
const PORT = process.env.PORT || 3000;
// ── Persistent storage ──────────────────────────────────────────────────────
function getDataDir() {
    for (const d of ['/var/lib/twitch-boost', '/app/data', '/tmp/twitch-boost', path.join(__dirname, '../data')]) {
        try {
            fs.mkdirSync(d, { recursive: true });
            return d;
        }
        catch { /* try next */ }
    }
    return '/tmp';
}
const DATA_DIR = getDataDir();
const CONFIG_FILE = path.join(DATA_DIR, 'saved-config.json');
console.log('[config] data dir:', DATA_DIR);
function loadSaved() {
    try {
        if (fs.existsSync(CONFIG_FILE))
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
    catch (e) {
        console.warn('[config] load error:', e.message);
    }
    return { personas: {}, phraseGroups: {} };
}
function saveToDisk(data) {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
    }
    catch (e) {
        console.error('[config] save error:', e.message);
    }
}
// ── Env config ──────────────────────────────────────────────────────────────
function extractChannel(raw) {
    return raw.trim()
        .replace(/https?:\/\//g, '').replace(/www\.twitch\.tv\//g, '')
        .replace(/twitch\.tv\//g, '').replace(/^#/, '').replace(/\/$/, '')
        .trim().toLowerCase();
}
function readEnvConfig() {
    const channel = extractChannel(process.env.TWITCH_CHANNEL || '');
    const groqKey = (process.env.GROQ_API_KEY || '').trim();
    const language = (process.env.ORIGINAL_STREAM_LANGUAGE || 'ru').trim();
    const context = (process.env.STREAM_CONTEXT || '').trim();
    const bots = [];
    for (let i = 1; i <= 50; i++) {
        const u = process.env['BOT' + i + '_USERNAME']?.trim();
        const t = (process.env['BOT' + i + '_OAUTH'] || process.env['BOT' + i + '_OAUTH_TOKEN'])?.trim();
        if (u && t)
            bots.push({ username: u, token: t });
    }
    return { channel, groqKey, language, context, bots };
}
// ── Helix ───────────────────────────────────────────────────────────────────
let appToken = null;
async function getAppToken() {
    const cid = process.env.TWITCH_CLIENT_ID?.trim(), cs = process.env.TWITCH_CLIENT_SECRET?.trim();
    if (!cid || !cs)
        return null;
    try {
        const r = await axios_1.default.post('https://id.twitch.tv/oauth2/token', null, { params: { client_id: cid, client_secret: cs, grant_type: 'client_credentials' } });
        return r.data.access_token;
    }
    catch {
        return null;
    }
}
async function getStreamData(channel) {
    const cid = process.env.TWITCH_CLIENT_ID?.trim();
    if (!cid || !channel)
        return { live: false };
    if (!appToken)
        appToken = await getAppToken();
    if (!appToken)
        return { live: false };
    try {
        const [uRes, sRes] = await Promise.all([
            axios_1.default.get('https://api.twitch.tv/helix/users', { params: { login: channel }, headers: { 'Client-ID': cid, Authorization: 'Bearer ' + appToken } }),
            axios_1.default.get('https://api.twitch.tv/helix/streams', { params: { user_login: channel }, headers: { 'Client-ID': cid, Authorization: 'Bearer ' + appToken } }),
        ]);
        const userId = uRes.data.data?.[0]?.id;
        const s = sRes.data.data?.[0];
        if (s)
            return { live: true, viewers: s.viewer_count, game: s.game_name, userId };
        return { live: false, userId };
    }
    catch (e) {
        if (e.response?.status === 401)
            appToken = null;
        return { live: false };
    }
}
// ── State ───────────────────────────────────────────────────────────────────
let manager = null;
let transcriber = null;
let streamPoll = null;
let startedBots = [];
let isStarted = false;
let saved = loadSaved();
let channelId = null;
console.log('[config] personas:', Object.keys(saved.personas).join(', ') || 'none');
// ── REST ────────────────────────────────────────────────────────────────────
app.get('/api/transcript', (_req, res) => res.json(manager?.getTranscriptLog()?.slice(-100) || []));
app.get('/api/personas', (_req, res) => res.json(saved.personas));
app.get('/api/phrases', (_req, res) => res.json(saved.phraseGroups));
app.get('/api/presence', (_req, res) => res.json(manager?.getPresenceStatus() || {}));
app.get('/api/points', (_req, res) => res.json(manager?.getPointsBalances() || {}));
app.post('/api/claim-points', async (_req, res) => {
    if (!manager)
        return res.json({ error: 'Боты не запущены' });
    await manager.claimAllBonusChests();
    res.json({ ok: true });
});
// ── Socket.IO ───────────────────────────────────────────────────────────────
io.on('connection', socket => {
    console.log('[server] connected', socket.id);
    const cfg = readEnvConfig();
    socket.emit('config', { channel: cfg.channel, botsPerTranscript: saved.botsPerTranscript || 2 });
    socket.emit('personas:update', saved.personas);
    socket.emit('phrases:update', saved.phraseGroups);
    if (isStarted && startedBots.length > 0) {
        socket.emit('bots:started', { bots: startedBots });
        startedBots.forEach(u => socket.emit('bot:status', { username: u, state: 'connected', message: 'Подключён' }));
        if (manager) {
            socket.emit('presence:update', manager.getPresenceStatus());
            socket.emit('points:all', manager.getPointsBalances());
        }
    }
    socket.on('send:manual', async (data) => {
        if (manager && data.targets?.length && data.message)
            await manager.sendManual(data.targets, data.message);
    });
    socket.on('set:persona', (data) => {
        const k = data.username.toLowerCase(), cfg2 = { role: data.role, sys: data.sys };
        saved.personas[k] = cfg2;
        saveToDisk(saved);
        if (manager)
            manager.setPersona(data.username, cfg2);
        io.emit('personas:update', saved.personas);
        socket.emit('persona:saved', { username: data.username, ok: true });
    });
    socket.on('del:persona', (data) => {
        delete saved.personas[data.username.toLowerCase()];
        saveToDisk(saved);
        io.emit('personas:update', saved.personas);
    });
    socket.on('set:phrases', (data) => {
        saved.phraseGroups = data;
        saveToDisk(saved);
        io.emit('phrases:update', saved.phraseGroups);
    });
    socket.on('set:bots_per_transcript', (data) => {
        const n = Math.max(1, parseInt(String(data.n)) || 2);
        saved.botsPerTranscript = n;
        saveToDisk(saved);
        if (manager)
            manager.setBotsPerTranscript(n);
        io.emit('config', { botsPerTranscript: n });
    });
    socket.on('get:personas', () => socket.emit('personas:update', saved.personas));
    socket.on('get:phrases', () => socket.emit('phrases:update', saved.phraseGroups));
    socket.on('claim:points', async () => {
        if (manager)
            await manager.claimAllBonusChests();
        socket.emit('points:claimed_all', { ok: true });
    });
    socket.on('disconnect', () => console.log('[server] disconnected', socket.id));
});
// ── Auto-start ───────────────────────────────────────────────────────────────
async function autoStart() {
    const cfg = readEnvConfig();
    console.log('[server] channel="' + cfg.channel + '" bots=' + cfg.bots.length + ' groq=' + (cfg.groqKey ? 'OK' : 'MISSING'));
    if (!cfg.channel || !cfg.groqKey || !cfg.bots.length) {
        console.warn('[server] missing config');
        return;
    }
    if (manager) {
        await manager.stop();
        manager = null;
    }
    if (transcriber) {
        transcriber.stop();
        transcriber = null;
    }
    await new Promise(r => setTimeout(r, 1500));
    const info = await getStreamData(cfg.channel);
    channelId = info.userId || null;
    console.log('[server] channelId=' + channelId + ' live=' + info.live);
    manager = new bot_1.BotManager(cfg.bots, cfg.channel, cfg.groqKey, {
        language: cfg.language, context: cfg.context,
        settings: { useEmoji: true, chatContext: true },
        savedPersonas: saved.personas,
        botsPerTranscript: saved.botsPerTranscript || 2,
        channelId: channelId || undefined,
        clientId: process.env.TWITCH_CLIENT_ID?.trim(),
    }, (event, data) => {
        io.emit(event, data);
        if (event === 'presence:active' && manager)
            io.emit('presence:update', manager.getPresenceStatus());
        if (event === 'points:balance')
            io.emit('points:all', manager?.getPointsBalances() || {});
    });
    startedBots = manager.getUsernames();
    isStarted = true;
    io.emit('bots:started', { bots: startedBots });
    console.log('[server] started', startedBots.length, 'bots');
    // Start transcription
    transcriber = new transcription_1.TranscriptionService(cfg.groqKey, cfg.channel);
    transcriber.start((result) => {
        console.log('[transcription] TEXT:', result.text.slice(0, 100));
        io.emit('transcription:new', { text: result.text, timestamp: result.timestamp });
        if (manager)
            manager.onTranscription(result.text);
    });
    io.emit('stream:info', { live: info.live, game: info.game, viewers: info.viewers });
    if (streamPoll)
        clearInterval(streamPoll);
    streamPoll = setInterval(async () => {
        const si = await getStreamData(cfg.channel);
        if (si.userId && !channelId)
            channelId = si.userId;
        io.emit('stream:info', { live: si.live, game: si.game, viewers: si.viewers });
        if (si.viewers != null)
            io.emit('stream:viewers', { viewers: si.viewers });
    }, 30000);
}
http.listen(PORT, () => {
    console.log('\nTwitchBoost at http://localhost:' + PORT + '\n');
    setTimeout(autoStart, 1500);
});
process.on('SIGTERM', async () => {
    if (streamPoll)
        clearInterval(streamPoll);
    if (transcriber)
        transcriber.stop();
    if (manager)
        await manager.stop();
    process.exit(0);
});
//# sourceMappingURL=main.js.map