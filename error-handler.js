const logger = require('./logger');

class ErrorHandler {
    static handleError(error, context = 'Unknown') {
        const errorInfo = {
            message: error.message,
            stack: error.stack,
            context: context,
            timestamp: new Date().toISOString()
        };

        logger.error(`Error in ${context}`, errorInfo);

        // Return user-friendly error message
        return this.getUserFriendlyMessage(error, context);
    }

    static getUserFriendlyMessage(error, context) {
        const message = error.message.toLowerCase();

        // API-related errors
        if (message.includes('api key') || message.includes('unauthorized')) {
            return 'Invalid API key. Please check your Topaz API key and try again.';
        }

        if (message.includes('network') || message.includes('timeout') || message.includes('econnrefused')) {
            return 'Network error. Please check your internet connection and try again.';
        }

        if (message.includes('quota') || message.includes('limit')) {
            return 'API quota exceeded. Please check your Topaz account limits.';
        }

        // File-related errors
        if (message.includes('enoent') || message.includes('file not found')) {
            return 'File not found. The video file may have been moved or deleted.';
        }

        if (message.includes('eacces') || message.includes('permission')) {
            return 'Permission denied. Please check file permissions and try again.';
        }

        if (message.includes('enospc') || message.includes('disk full')) {
            return 'Insufficient disk space. Please free up space and try again.';
        }

        // Processing errors
        if (context === 'video-processing' && message.includes('ffmpeg')) {
            return 'Video processing error. Please ensure FFmpeg is installed or try a different video file.';
        }

        if (context === 'upload' && message.includes('size')) {
            return 'File too large. Please try with a smaller video file.';
        }

        // Generic error
        return `An error occurred: ${error.message}. Please try again or check the logs for more details.`;
    }

    static async showErrorDialog(error, context = 'Unknown') {
        const userMessage = this.handleError(error, context);
        
        // In Electron, we can show a native dialog
        const { dialog } = require('electron');
        
        if (dialog) {
            await dialog.showErrorBox('PazUp Error', userMessage);
        } else {
            // Fallback for renderer process
            alert(`Error: ${userMessage}`);
        }
    }
}

module.exports = ErrorHandler;