const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const logger = require('./logger');

class SettingsManager {
    constructor() {
        this.configPath = path.join(os.homedir(), '.pazup-config.json');
        this.advancedConfigPath = path.join(os.homedir(), '.pazup-advanced.json');
        
        this.defaultConfig = {
            apiKey: '',
            inputFolder: '',
            outputFolder: '',
            slowMotion: 1,
            cropToFit: false,
            model: 'prob-4',
            resolution: '1920x1080',
            removeAudio: false,
            workers: 2
        };

        this.defaultAdvancedConfig = {
            maxRetries: 3,
            retryDelay: 5000,
            statusCheckInterval: 10000,
            uploadTimeout: 300000,
            downloadTimeout: 600000,
            logLevel: 'info',
            autoCleanupLogs: true,
            maxLogFiles: 7,
            compressionLevel: 'High',
            videoEncoder: 'H264',
            videoProfile: 'High'
        };
    }

    async loadConfig() {
        try {
            let config = this.defaultConfig;
            
            if (await fs.pathExists(this.configPath)) {
                const savedConfig = await fs.readJson(this.configPath);
                config = { ...this.defaultConfig, ...savedConfig };
            }
            
            logger.info('Configuration loaded successfully');
            return config;
        } catch (error) {
            logger.error('Error loading configuration', { error: error.message });
            return this.defaultConfig;
        }
    }

    async saveConfig(config) {
        try {
            await fs.writeJson(this.configPath, config, { spaces: 2 });
            logger.info('Configuration saved successfully');
            return { success: true };
        } catch (error) {
            logger.error('Error saving configuration', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    async loadAdvancedConfig() {
        try {
            let config = this.defaultAdvancedConfig;
            
            if (await fs.pathExists(this.advancedConfigPath)) {
                const savedConfig = await fs.readJson(this.advancedConfigPath);
                config = { ...this.defaultAdvancedConfig, ...savedConfig };
            }
            
            return config;
        } catch (error) {
            logger.error('Error loading advanced configuration', { error: error.message });
            return this.defaultAdvancedConfig;
        }
    }

    async saveAdvancedConfig(config) {
        try {
            await fs.writeJson(this.advancedConfigPath, config, { spaces: 2 });
            logger.info('Advanced configuration saved successfully');
            return { success: true };
        } catch (error) {
            logger.error('Error saving advanced configuration', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    async resetConfig() {
        try {
            await fs.remove(this.configPath);
            await fs.remove(this.advancedConfigPath);
            logger.info('Configuration reset successfully');
            return { success: true };
        } catch (error) {
            logger.error('Error resetting configuration', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    async exportConfig(exportPath) {
        try {
            const config = await this.loadConfig();
            const advancedConfig = await this.loadAdvancedConfig();
            
            const exportData = {
                version: '1.0.0',
                timestamp: new Date().toISOString(),
                config: { ...config, apiKey: '' }, // Don't export API key for security
                advancedConfig
            };
            
            await fs.writeJson(exportPath, exportData, { spaces: 2 });
            logger.info('Configuration exported successfully', { exportPath });
            return { success: true };
        } catch (error) {
            logger.error('Error exporting configuration', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    async importConfig(importPath) {
        try {
            const importData = await fs.readJson(importPath);
            
            if (importData.config) {
                await this.saveConfig(importData.config);
            }
            
            if (importData.advancedConfig) {
                await this.saveAdvancedConfig(importData.advancedConfig);
            }
            
            logger.info('Configuration imported successfully', { importPath });
            return { success: true };
        } catch (error) {
            logger.error('Error importing configuration', { error: error.message });
            return { success: false, error: error.message };
        }
    }
}

module.exports = new SettingsManager();