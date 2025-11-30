const TopazAPI = require('./topaz-api');

class APIManager {
    constructor() {
        this.apiInstances = [];
        this.currentIndex = 0;
    }

    // Add API key and create instance
    async addApiKey(apiKey) {
        try {
            const api = new TopazAPI(apiKey);
            
            // Test the API key by making a simple request
            const isValid = await this.validateApiKey(api);
            
            if (isValid) {
                // Get initial credit balance
                const creditBalance = await api.getCreditBalance();
                
                this.apiInstances.push({
                    api: api,
                    key: apiKey,
                    isActive: true,
                    requestCount: 0,
                    lastUsed: null,
                    rateLimitReset: null,
                    credits: creditBalance.success ? creditBalance.credits : null,
                    lastCreditCheck: Date.now()
                });
                return { success: true, message: 'API key added successfully' };
            } else {
                return { success: false, message: 'Invalid API key' };
            }
        } catch (error) {
            return { success: false, message: `Error adding API key: ${error.message}` };
        }
    }

    // Validate API key by testing it
    async validateApiKey(api) {
        try {
            // Try to make a simple request to validate the key
            // Since we don't have a simple validation endpoint, we'll try to create a minimal request
            const testVideoInfo = {
                width: 1920,
                height: 1080,
                duration: 1,
                frameRate: 30,
                frameCount: 30,
                size: 1000000,
                container: 'mp4'
            };
            
            const result = await api.createVideoRequest(testVideoInfo, {
                model: 'prob-4',
                resolution: '1920x1080',
                removeAudio: false,
                frameInterpolation: 'chf-3',
                slowMotion: 1,
                cropToFit: false
            });
            
            return result.success;
        } catch (error) {
            console.warn('API key validation failed:', error.message);
            return false;
        }
    }

    // Remove API key
    removeApiKey(index) {
        if (index >= 0 && index < this.apiInstances.length) {
            this.apiInstances.splice(index, 1);
            // Reset current index if needed
            if (this.currentIndex >= this.apiInstances.length) {
                this.currentIndex = 0;
            }
        }
    }

    // Get next available API instance (round-robin with rate limit awareness)
    getNextApi() {
        if (this.apiInstances.length === 0) {
            return null;
        }

        // Filter out rate-limited APIs and APIs with 0 credits
        const availableApis = this.apiInstances.filter(instance => {
            if (!instance.isActive) return false;
            
            // Check if rate limit has reset
            if (instance.rateLimitReset && Date.now() < instance.rateLimitReset) {
                return false;
            }
            
            // Skip APIs with 0 available credits
            if (instance.credits && instance.credits.available <= 0) {
                console.log(`Skipping API key with 0 credits: ${instance.key.substring(0, 8)}...`);
                return false;
            }
            
            return true;
        });

        if (availableApis.length === 0) {
            // All APIs are rate limited, return the one with earliest reset time
            const earliestReset = this.apiInstances.reduce((earliest, current) => {
                if (!current.rateLimitReset) return current;
                if (!earliest.rateLimitReset) return earliest;
                return current.rateLimitReset < earliest.rateLimitReset ? current : earliest;
            });
            return earliestReset;
        }

        let selectedApi;

        // Round-robin selection among available APIs
        selectedApi = availableApis[this.currentIndex % availableApis.length];
        this.currentIndex = (this.currentIndex + 1) % availableApis.length;
        
        selectedApi.requestCount++;
        selectedApi.lastUsed = Date.now();
        
        return selectedApi;
    }

    // Handle rate limit response
    handleRateLimit(apiInstance, retryAfter = 60000) {
        apiInstance.rateLimitReset = Date.now() + retryAfter;
        console.warn(`API key rate limited. Reset at: ${new Date(apiInstance.rateLimitReset)}`);
    }

    // Get API statistics
    getStats() {
        return {
            totalKeys: this.apiInstances.length,
            activeKeys: this.apiInstances.filter(api => api.isActive).length,
            totalRequests: this.apiInstances.reduce((sum, api) => sum + api.requestCount, 0),
            rateLimitedKeys: this.apiInstances.filter(api => 
                api.rateLimitReset && Date.now() < api.rateLimitReset
            ).length
        };
    }

    // Refresh credit balance for all API keys
    async refreshAllCreditBalances() {
        const refreshPromises = this.apiInstances.map(async (instance) => {
            try {
                const creditBalance = await instance.api.getCreditBalance();
                if (creditBalance.success) {
                    instance.credits = creditBalance.credits;
                    instance.lastCreditCheck = Date.now();
                }
            } catch (error) {
                console.warn(`Failed to refresh credits for API key: ${error.message}`);
            }
        });
        
        await Promise.all(refreshPromises);
    }

    // Refresh credit balance for a specific API key
    async refreshCreditBalance(apiInstance) {
        try {
            const creditBalance = await apiInstance.api.getCreditBalance();
            if (creditBalance.success) {
                apiInstance.credits = creditBalance.credits;
                apiInstance.lastCreditCheck = Date.now();
            }
        } catch (error) {
            console.warn(`Failed to refresh credits for API key: ${error.message}`);
        }
    }

    // Get all API keys for UI display
    getApiKeys() {
        return this.apiInstances.map((instance, index) => ({
            index: index,
            key: instance.key,
            isActive: instance.isActive,
            isValid: instance.isActive, // Since only valid keys are stored, isValid = isActive
            requestCount: instance.requestCount,
            lastUsed: instance.lastUsed,
            isRateLimited: instance.rateLimitReset && Date.now() < instance.rateLimitReset,
            credits: instance.credits,
            lastCreditCheck: instance.lastCreditCheck
        }));
    }

    // Update API key status
    setApiKeyStatus(index, isActive) {
        if (index >= 0 && index < this.apiInstances.length) {
            this.apiInstances[index].isActive = isActive;
        }
    }
}

module.exports = APIManager;