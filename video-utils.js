const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');

class VideoUtils {
    // Get FFmpeg path for Windows with bundled binaries
    static getFFmpegPath() {
        // Check if we're in a packaged app by looking for the resources folder
        const isPackaged = process.resourcesPath && fs.existsSync(process.resourcesPath);
        
        if (isPackaged) {
            // In packaged app, use bundled FFmpeg for Windows
            const resourcesPath = process.resourcesPath;
            const ffmpegPath = path.join(resourcesPath, 'ffmpeg', 'win', 'ffmpeg.exe');
            const ffprobePath = path.join(resourcesPath, 'ffmpeg', 'win', 'ffprobe.exe');
            
            // Check if bundled FFmpeg exists
            if (fs.existsSync(ffmpegPath) && fs.existsSync(ffprobePath)) {
                return {
                    ffmpeg: ffmpegPath,
                    ffprobe: ffprobePath
                };
            }
        }
        
        // In development or fallback, use system FFmpeg
        return {
            ffmpeg: 'ffmpeg',
            ffprobe: 'ffprobe'
        };
    }

    // Get video information using ffprobe (if available)
    static async getVideoInfo(filePath) {
        try {
            // Basic file info
            const stats = await fs.stat(filePath);
            const ext = path.extname(filePath).toLowerCase().replace('.', '');
            
            // Default video info (will be enhanced if ffprobe is available)
            const videoInfo = {
                width: 1920,
                height: 1080,
                duration: 10,
                frameRate: 30,
                frameCount: 300,
                size: stats.size,
                container: ext === 'mp4' ? 'mp4' : ext
            };

            // Try to get detailed info with ffprobe if available
            try {
                const detailedInfo = await this.getDetailedVideoInfo(filePath);
                return { ...videoInfo, ...detailedInfo };
            } catch (error) {
                console.log('ffprobe not available, using default values');
                return videoInfo;
            }
        } catch (error) {
            throw new Error(`Error getting video info: ${error.message}`);
        }
    }

    // Get detailed video info using ffprobe
    static async getDetailedVideoInfo(filePath) {
        return new Promise((resolve, reject) => {
            const ffprobe = spawn('ffprobe', [
                '-v', 'quiet',
                '-print_format', 'json',
                '-show_format',
                '-show_streams',
                filePath
            ]);

            let output = '';
            let error = '';

            ffprobe.stdout.on('data', (data) => {
                output += data.toString();
            });

            ffprobe.stderr.on('data', (data) => {
                error += data.toString();
            });

            ffprobe.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`ffprobe failed: ${error}`));
                    return;
                }

                try {
                    const info = JSON.parse(output);
                    const videoStream = info.streams.find(stream => stream.codec_type === 'video');
                    
                    if (!videoStream) {
                        reject(new Error('No video stream found'));
                        return;
                    }

                    const duration = parseFloat(info.format.duration) || 10;
                    const frameRate = this.parseFrameRate(videoStream.r_frame_rate) || 30;

                    resolve({
                        width: videoStream.width,
                        height: videoStream.height,
                        duration: Math.round(duration),
                        frameRate: frameRate,
                        frameCount: Math.round(duration * frameRate),
                        container: info.format.format_name.split(',')[0]
                    });
                } catch (parseError) {
                    reject(new Error(`Error parsing ffprobe output: ${parseError.message}`));
                }
            });

            ffprobe.on('error', (err) => {
                reject(new Error(`ffprobe error: ${err.message}`));
            });
        });
    }

    // Parse frame rate from ffprobe format (e.g., "30/1" -> 30)
    static parseFrameRate(frameRateString) {
        if (!frameRateString) return 30;
        
        const parts = frameRateString.split('/');
        if (parts.length === 2) {
            const numerator = parseInt(parts[0]);
            const denominator = parseInt(parts[1]);
            return Math.round(numerator / denominator);
        }
        
        return parseInt(frameRateString) || 30;
    }

    // Remove audio from video file using ffmpeg
    static async removeAudio(inputPath, outputPath, onProgress) {
        return new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', [
                '-i', inputPath,
                '-c:v', 'copy',
                '-an',
                '-y',
                outputPath
            ]);

            let error = '';

            ffmpeg.stderr.on('data', (data) => {
                const output = data.toString();
                error += output;
                
                // Try to parse progress from ffmpeg output
                if (onProgress) {
                    const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2})/);
                    if (timeMatch) {
                        const hours = parseInt(timeMatch[1]);
                        const minutes = parseInt(timeMatch[2]);
                        const seconds = parseInt(timeMatch[3]);
                        const currentTime = hours * 3600 + minutes * 60 + seconds;
                        
                        // This is approximate - we'd need the total duration for accurate progress
                        onProgress(Math.min(90, Math.round(currentTime * 2))); // Rough estimate
                    }
                }
            });

            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    resolve({ success: true });
                } else {
                    reject(new Error(`ffmpeg failed with code ${code}: ${error}`));
                }
            });

            ffmpeg.on('error', (err) => {
                reject(new Error(`ffmpeg error: ${err.message}`));
            });
        });
    }

    // Check if ffmpeg/ffprobe is available
    static async checkFFmpegAvailability() {
        try {
            await new Promise((resolve, reject) => {
                const ffmpeg = spawn('ffmpeg', ['-version']);
                ffmpeg.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject();
                });
                ffmpeg.on('error', reject);
            });
            return true;
        } catch {
            return false;
        }
    }
}

module.exports = VideoUtils;