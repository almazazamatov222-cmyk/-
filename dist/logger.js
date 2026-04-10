"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.Logger = exports.LogLevel = void 0;
const colors_1 = __importDefault(require("colors"));
var LogLevel;
(function (LogLevel) {
    LogLevel["DEBUG"] = "DEBUG";
    LogLevel["INFO"] = "INFO";
    LogLevel["WARN"] = "WARN";
    LogLevel["ERROR"] = "ERROR";
})(LogLevel = exports.LogLevel || (exports.LogLevel = {}));
class Logger {
    constructor() {
        this.isDebug = process.env.DEBUG === 'true';
    }
    static getInstance() {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }
    formatMessage(level, message, ...args) {
        const timestamp = new Date().toISOString();
        const formattedArgs = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ');
        return `[${timestamp}] [${level}] ${message} ${formattedArgs}`;
    }
    log(level, message, ...args) {
        const formattedMessage = this.formatMessage(level, message, ...args);
        switch (level) {
            case LogLevel.DEBUG:
                if (this.isDebug) {
                    console.debug(colors_1.default.gray(formattedMessage));
                }
                break;
            case LogLevel.INFO:
                console.log(colors_1.default.blue(formattedMessage));
                break;
            case LogLevel.WARN:
                console.warn(colors_1.default.yellow(formattedMessage));
                break;
            case LogLevel.ERROR:
                console.error(colors_1.default.red(formattedMessage));
                break;
        }
    }
    debug(message, ...args) {
        this.log(LogLevel.DEBUG, message, ...args);
    }
    info(message, ...args) {
        this.log(LogLevel.INFO, message, ...args);
    }
    warn(message, ...args) {
        this.log(LogLevel.WARN, message, ...args);
    }
    error(message, ...args) {
        this.log(LogLevel.ERROR, message, ...args);
    }
}
exports.Logger = Logger;
exports.logger = Logger.getInstance();
//# sourceMappingURL=logger.js.map