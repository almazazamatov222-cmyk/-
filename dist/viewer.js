"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ViewerSimulator = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("./logger");
const HEADERS = {
    'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Origin': 'https://www.twitch.tv',
    'Referer': 'https://www.twitch.tv/',
};
const GQL_QUERY = `query PlaybackAccessToken_Template($login:String!,$isLive:Boolean!,$vodID:ID!,$isVod:Boolean!,$playerType:String!){streamPlaybackAccessToken(channelName:$login,params:{platform:"web",playerBackend:"mediaplayer",playerType:$playerType})@include(if:$isLive){value signature __typename}videoPlaybackAccessToken(id:$vodID,params:{platform:"web",playerBackend:"mediaplayer",playerType:$playerType})@include(if:$isVod){value signature __typename}}`;
class ViewerSimulator {
    constructor(channelName) {
        this.isRunning = false;
        this.playlistUrl = null;
        this.segInterval = null;
        this.refreshTimer = null;
        this.channelName = channelName;
    }
    get running() { return this.isRunning; }
    async start() {
        if (this.isRunning)
            return;
        logger_1.logger.info(`ViewerSim[${this.channelName}]: starting`);
        await this.refreshPlaylist();
        this.isRunning = true;
        this.segInterval = setInterval(() => this.fetchSegment(), 4000);
        this.refreshTimer = setInterval(() => this.refreshPlaylist().catch(() => { }), 180000);
        logger_1.logger.info(`ViewerSim[${this.channelName}]: running`);
    }
    stop() {
        if (this.segInterval)
            clearInterval(this.segInterval);
        if (this.refreshTimer)
            clearInterval(this.refreshTimer);
        this.isRunning = false;
        this.playlistUrl = null;
        logger_1.logger.info(`ViewerSim[${this.channelName}]: stopped`);
    }
    async refreshPlaylist() {
        const tokenResp = await axios_1.default.post('https://gql.twitch.tv/gql', {
            operationName: 'PlaybackAccessToken_Template',
            query: GQL_QUERY,
            variables: { isLive: true, login: this.channelName, isVod: false, vodID: '', playerType: 'site' }
        }, { headers: HEADERS, timeout: 15000 });
        const td = tokenResp.data?.data?.streamPlaybackAccessToken;
        if (!td?.value)
            throw new Error('No GQL token for viewer');
        const masterUrl = `https://usher.ttvnw.net/api/channel/hls/${this.channelName}.m3u8`
            + `?client_id=kimne78kx3ncx6brgo4mv6wki5h1ko&token=${encodeURIComponent(td.value)}&sig=${td.signature}&allow_source=true&allow_spectre=true`;
        const masterResp = await axios_1.default.get(masterUrl, { responseType: 'text', timeout: 10000, headers: HEADERS });
        const lines = masterResp.data.split('\n');
        // Prefer audio_only for minimal bandwidth
        let chosen = '';
        for (let i = 0; i < lines.length; i++) {
            const l = lines[i].trim();
            if (!l || l.startsWith('#'))
                continue;
            if (!chosen)
                chosen = l; // first playlist as fallback
            // Check if previous line mentions audio_only
            const prev = lines[i - 1] || '';
            const prev2 = lines[i - 2] || '';
            if (prev.includes('audio_only') || prev2.includes('audio_only')) {
                chosen = l;
                break;
            }
        }
        if (!chosen)
            throw new Error('No variant in master playlist');
        this.playlistUrl = chosen.startsWith('http') ? chosen : new URL(chosen, masterUrl).href;
        logger_1.logger.info(`ViewerSim[${this.channelName}]: playlist refreshed`);
    }
    async fetchSegment() {
        if (!this.playlistUrl || !this.isRunning)
            return;
        try {
            const resp = await axios_1.default.get(this.playlistUrl, { responseType: 'text', timeout: 8000, headers: HEADERS });
            for (const line of resp.data.split('\n')) {
                const t = line.trim();
                if (t && !t.startsWith('#') && (t.includes('.ts') || t.includes('.aac') || t.startsWith('http'))) {
                    const segUrl = t.startsWith('http') ? t : new URL(t, this.playlistUrl).href;
                    // Fetch just enough bytes for Twitch to register us
                    await axios_1.default.get(segUrl, {
                        responseType: 'stream', timeout: 5000,
                        headers: { ...HEADERS, 'Range': 'bytes=0-4096' }
                    }).then(r => r.data.destroy()).catch(() => { });
                    break;
                }
            }
        }
        catch (_) {
            try {
                await this.refreshPlaylist();
            }
            catch (e) {
                logger_1.logger.warn(`ViewerSim[${this.channelName}]: lost stream, stopping`);
                this.stop();
            }
        }
    }
}
exports.ViewerSimulator = ViewerSimulator;
//# sourceMappingURL=viewer.js.map