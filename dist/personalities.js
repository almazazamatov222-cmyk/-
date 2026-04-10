"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BotMemory = exports.PERSONALITIES = void 0;
exports.PERSONALITIES = [
    {
        name: 'toxic',
        // Фокус: критика и негативная реакция на слова стримера
        system: `Ты токсичный зритель Twitch. Ищешь повод покритиковать или посаркастить над тем что стример ТОЛЬКО ЧТО сказал. Можешь материться. Коротко строчными. Упоминай конкретные слова стримера.`,
        temperature: 0.92,
        minInterval: 80000,
        maxInterval: 220000,
        chatReplyChance: 0.2,
    },
    {
        name: 'hype',
        // Фокус: эмоциональная реакция и поддержка
        system: `Ты фанат стримера на Twitch. Реагируешь эмоционально на то что стример ТОЛЬКО ЧТО сказал. Поддерживаешь его мнение или удивляешься. Коротко строчными. Упоминай конкретное из речи стримера.`,
        temperature: 0.95,
        minInterval: 70000,
        maxInterval: 190000,
        chatReplyChance: 0.25,
    },
    {
        name: 'analyst',
        // Фокус: анализ и уточняющий вопрос
        system: `Ты аналитичный зритель Twitch. Берёшь КОНКРЕТНЫЙ факт или утверждение из последних слов стримера и либо соглашаешься с аргументом, либо задаёшь уточняющий вопрос. Коротко строчными без лишних слов.`,
        temperature: 0.82,
        minInterval: 110000,
        maxInterval: 280000,
        chatReplyChance: 0.12,
    },
    {
        name: 'joker',
        // Фокус: юмор и игра слов на тему разговора
        system: `Ты весёлый зритель Twitch. Берёшь что-то конкретное из последних слов стримера и делаешь это смешным — шутишь, иронизируешь или замечаешь комичное. Коротко строчными.`,
        temperature: 0.95,
        minInterval: 75000,
        maxInterval: 200000,
        chatReplyChance: 0.18,
    },
];
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const DATA_DIR = fs_1.default.existsSync('/data') ? '/data' : '/tmp';
class BotMemory {
    constructor(streamerName, botIndex) {
        const dir = path_1.default.join(DATA_DIR, 'memory', streamerName);
        if (!fs_1.default.existsSync(dir))
            fs_1.default.mkdirSync(dir, { recursive: true });
        this.filePath = path_1.default.join(dir, `bot${botIndex}.json`);
        this.data = this.load();
    }
    load() {
        try {
            if (fs_1.default.existsSync(this.filePath))
                return JSON.parse(fs_1.default.readFileSync(this.filePath, 'utf-8'));
        }
        catch (_) { }
        return { sentMessages: [], viewerNames: [], streamerFacts: [], lastUpdated: '' };
    }
    save() {
        try {
            this.data.lastUpdated = new Date().toISOString();
            fs_1.default.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
        }
        catch (_) { }
    }
    addSent(msg) {
        this.data.sentMessages.push(msg);
        if (this.data.sentMessages.length > 60)
            this.data.sentMessages = this.data.sentMessages.slice(-60);
        this.save();
    }
    addViewer(name) {
        if (!this.data.viewerNames.includes(name) && name.length < 30) {
            this.data.viewerNames.push(name);
            if (this.data.viewerNames.length > 100)
                this.data.viewerNames = this.data.viewerNames.slice(-100);
            this.save();
        }
    }
    isDuplicate(msg) {
        const recent = this.data.sentMessages.slice(-20);
        const msgLow = msg.toLowerCase().trim();
        return recent.some(m => {
            const mLow = m.toLowerCase().trim();
            // exact or very similar
            return mLow === msgLow || (msgLow.length > 5 && mLow.includes(msgLow));
        });
    }
    getContext() {
        const parts = [];
        if (this.data.sentMessages.length > 0)
            parts.push(`Мои последние сообщения (НЕ повторяй!): ${this.data.sentMessages.slice(-5).join(' | ')}`);
        if (this.data.viewerNames.length > 0)
            parts.push(`Знакомые зрители: ${this.data.viewerNames.slice(-8).join(', ')}`);
        return parts.join('\n');
    }
}
exports.BotMemory = BotMemory;
//# sourceMappingURL=personalities.js.map