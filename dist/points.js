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
exports.ChannelPointsService = void 0;
const ws_1 = __importDefault(require("ws"));
class ChannelPointsService {
    constructor(channel, channelId, clientId, emit) {
        this.connections = new Map();
        this.stopped = false;
        this.channel = channel;
        this.channelId = channelId;
        this.clientId = clientId;
        this.emit = emit;
    }
    async connectBot(username, token) {
        if (this.stopped)
            return;
        const cleanToken = token.replace(/^oauth:/i, '');
        // Get bot user ID via validation
        let userId = '';
        try {
            const { default: axios } = await Promise.resolve().then(() => __importStar(require('axios')));
            const res = await axios.get('https://id.twitch.tv/oauth2/validate', {
                headers: { Authorization: 'OAuth ' + cleanToken },
                timeout: 5000,
            });
            userId = res.data.user_id;
            if (!userId) {
                console.warn('[points]', username, 'no user_id from token');
                return;
            }
        }
        catch (e) {
            console.warn('[points]', username, 'validate error:', e.message);
            return;
        }
        this.startPubSub(username, cleanToken, userId);
    }
    startPubSub(username, token, userId) {
        if (this.stopped)
            return;
        const ws = new ws_1.default('wss://pubsub-edge.twitch.tv/v1');
        this.connections.set(username, { ws, token, userId });
        ws.on('open', () => {
            console.log('[points]', username, 'PubSub connected');
            // Subscribe to channel points for this user on this channel
            const topics = [
                `community-points-channel-v1.${this.channelId}`,
                `community-points-user-v1.${userId}`,
            ];
            ws.send(JSON.stringify({
                type: 'LISTEN',
                nonce: username + '_' + Date.now(),
                data: {
                    topics,
                    auth_token: token,
                },
            }));
            // Ping every 4 minutes to keep alive
            const pingInterval = setInterval(() => {
                if (ws.readyState === ws_1.default.OPEN) {
                    ws.send(JSON.stringify({ type: 'PING' }));
                }
                else {
                    clearInterval(pingInterval);
                }
            }, 240000);
        });
        ws.on('message', (raw) => {
            if (this.stopped)
                return;
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.type === 'MESSAGE') {
                    const data = JSON.parse(msg.data?.message || '{}');
                    this.handlePointsEvent(username, token, userId, data);
                }
                else if (msg.type === 'RESPONSE' && msg.error) {
                    console.warn('[points]', username, 'LISTEN error:', msg.error);
                }
            }
            catch { /* ignore parse errors */ }
        });
        ws.on('close', () => {
            if (!this.stopped) {
                console.log('[points]', username, 'reconnecting in 10s...');
                setTimeout(() => this.startPubSub(username, token, userId), 10000);
            }
        });
        ws.on('error', (e) => {
            console.warn('[points]', username, 'WS error:', e.message);
        });
    }
    async handlePointsEvent(username, token, userId, data) {
        const type = data.type;
        // Auto-claim bonus chest (appears every ~15 min)
        if (type === 'community-point-reward-channel-subscription-gift-received' ||
            type === 'reward-redeemed') {
            // Just log for now
            const balance = data.data?.balance?.balance;
            if (balance != null) {
                console.log('[points]', username, 'balance:', balance);
                this.emit('points:balance', { username, balance });
            }
        }
        // Claim bonus chest when it appears
        if (type === 'community-moments-channel-v1' || data.type?.includes('claim')) {
            const claimId = data.data?.claim?.id;
            if (claimId) {
                await this.claimBonusChest(username, token, userId, claimId);
            }
        }
        // Channel points balance update
        if (data.type === 'points-earned' || data.balance) {
            const balance = data.balance?.balance || data.data?.balance?.balance;
            if (balance != null) {
                this.emit('points:balance', { username, balance, gained: data.gained });
            }
        }
    }
    async claimBonusChest(username, token, userId, claimId) {
        try {
            const { default: axios } = await Promise.resolve().then(() => __importStar(require('axios')));
            // Use GQL mutation to claim
            const mutation = claimId ? [{
                    operationName: 'ClaimCommunityPoints',
                    variables: { input: { channelID: this.channelId, claimID: claimId } },
                    extensions: {
                        persistedQuery: {
                            version: 1,
                            sha256Hash: '46aaeebe02c99afdf4fc97c7c0cba964124bf6b0af229395f1f6d1feed05b3d0',
                        },
                    },
                }] : [{
                    operationName: 'JoinCommunityPoints',
                    variables: { channelID: this.channelId },
                    extensions: {
                        persistedQuery: {
                            version: 1,
                            sha256Hash: '9ca1e3641c4fc39a1e8b5fa02aa0f7c72e9d55aae23f42e08b26a50d5aef47d0',
                        },
                    },
                }];
            await axios.post('https://gql.twitch.tv/gql', mutation, {
                headers: {
                    'Authorization': 'OAuth ' + token,
                    'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
                    'Content-Type': 'application/json',
                },
                timeout: 5000,
            });
            console.log('[points]', username, '✓ claimed bonus chest');
            this.emit('points:claimed', { username });
        }
        catch (e) {
            console.warn('[points]', username, 'claim error:', e.message);
        }
    }
    // Get current points balance for a bot
    async getBalance(username, token, channelId) {
        try {
            const { default: axios } = await Promise.resolve().then(() => __importStar(require('axios')));
            const res = await axios.post('https://gql.twitch.tv/gql', [{
                    operationName: 'ChannelPointsContext',
                    variables: { channelLogin: this.channel, includeGoalTypes: ['CREATOR', 'BOOST'] },
                    extensions: {
                        persistedQuery: {
                            version: 1,
                            sha256Hash: '9988086801c220a9bb3d9e3e6cd64ed5bcc9cb3c51d5d47b1bfb432fa7cd6c86',
                        },
                    },
                }], {
                headers: {
                    'Authorization': 'OAuth ' + token,
                    'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
                    'Content-Type': 'application/json',
                },
                timeout: 5000,
            });
            const balance = res.data?.[0]?.data?.community?.channel?.self?.communityPoints?.balance;
            return balance ?? null;
        }
        catch {
            return null;
        }
    }
    stop() {
        this.stopped = true;
        for (const { ws } of this.connections.values()) {
            try {
                ws.close();
            }
            catch { /* ignore */ }
        }
        this.connections.clear();
    }
}
exports.ChannelPointsService = ChannelPointsService;
//# sourceMappingURL=points.js.map