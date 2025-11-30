const fs = require('fs-extra');
const path = require('path');
const os = require('os');

class Logger {
    constructor() {
        this.logDir = path.join(os.homedir(), '.pazup-logs');
        this.logFile = path.join(this.logDir, `pazup-${new Date().toISOString().split('T')[0]}.log`);
        this.initializeLogger();
    }

    async initializeLogger() {
        try {
            await fs.ensureDir(this.logDir);
            
            // Clean up old log files (keep only last 7 days)
            const files = await fs.readdir(this.logDir);
            const now = Date.now();
            const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
            
            for (const file of files) {
                const filePath = path.join(this.logDir, file);
                const stats = await fs.stat(filePath);
                if (stats.mtime.getTime() < sevenDaysAgo) {
                    await fs.remove(filePath);
                }
            }
        } catch (error) {
            console.error('Error initializing logger:', error);
        }
    }

    async log(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            data
        };

        const logLine = `[${timestamp}] ${level.toUpperCase()}: ${message}${data ? ` | Data: ${JSON.stringify(data)}` : ''}\n`;

        try {
            await fs.appendFile(this.logFile, logLine);
        } catch (error) {
            console.error('Error writing to log file:', error);
        }

        // Also log to console in development
        if (process.env.NODE_ENV === 'development') {
            console.log(logLine.trim());
        }
    }

    info(message, data) {
        return this.log('info', message, data);
    }

    warn(message, data) {
        return this.log('warn', message, data);
    }

    error(message, data) {
        return this.log('error', message, data);
    }

    debug(message, data) {
        return this.log('debug', message, data);
    }
}

module.exports = new Logger();