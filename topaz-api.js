const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

class TopazAPI {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseURL = 'https://api.topazlabs.com';
        this.axios = axios.create({
            baseURL: this.baseURL,
            headers: {
                'X-API-Key': apiKey,
                'accept': 'application/json'
            }
        });
    }

    // Create image enhancement request
    async createImageRequest(options) {
        // Validate input file exists
        if (!fs.existsSync(options.inputPath)) {
            throw new Error(`Input file does not exist: ${options.inputPath}`);
        }

        // Get file stats to ensure it's readable
        const fileStats = fs.statSync(options.inputPath);
        console.log('File stats:', {
            size: fileStats.size,
            path: options.inputPath,
            exists: fs.existsSync(options.inputPath)
        });

        const filename = path.basename(options.inputPath);
        const contentType = this.getImageContentType(options.inputPath);
        
        console.log('File metadata:', {
            filename: filename,
            contentType: contentType,
            size: fileStats.size
        });

        // Add parameters in the exact order and format as n8n workflow / working curl
        const outputWidth = options.outputWidth || '3840';
        // Decide output format based on requested format; default to jpeg
        const requestedFormat = (options.outputFormat || 'jpeg').toLowerCase();
        const outputFormat = requestedFormat === 'png' ? 'png' : 'jpeg';
        const acceptHeader = outputFormat === 'png' ? 'image/png' : 'image/jpeg';

        console.log('Using curl with parameters:', {
            inputPath: options.inputPath,
            output_width: outputWidth,
            crop_to_fill: 'false',
            output_format: outputFormat,
            model: options.model || 'Standard V2',
            filename: filename,
            contentType: contentType,
            fileSize: fileStats.size
        });

        try {
            // Use system curl to exactly match the working manual curl request
            const tempOutputPath = path.join(
                os.tmpdir(),
                `topaz_image_${Date.now()}_${Math.random().toString(36).slice(2)}.jpeg`
            );

            const curlCmd = process.platform === 'win32' ? 'curl.exe' : 'curl';
            const curlArgs = [
                '-X', 'POST',
                'https://api.topazlabs.com/image/v1/enhance',
                '-H', `X-API-Key: ${this.apiKey}`,
                '-H', `accept: ${acceptHeader}`,
                '-F', `model=${options.model || 'Standard V2'}`,
                '-F', `output_width=${outputWidth}`,
                '-F', 'crop_to_fill=false',
                '-F', `output_format=${outputFormat}`,
                '-F', `image=@${options.inputPath}`,
                '--output', tempOutputPath,
                '--fail-with-body'
            ];

            console.log('Running curl for image enhance:', { cmd: curlCmd, args: curlArgs });

            const result = await new Promise((resolve) => {
                const child = spawn(curlCmd, curlArgs);
                let stderr = '';

                child.stderr.on('data', (data) => {
                    stderr += data.toString();
                });

                child.on('error', (err) => {
                    resolve({ success: false, error: `Failed to start curl: ${err.message}` });
                });

                child.on('close', async (code) => {
                    if (code === 0) {
                        try {
                            const imageData = await fs.readFile(tempOutputPath);
                            try {
                                await fs.unlink(tempOutputPath);
                            } catch (e) {
                                // Ignore temp file cleanup errors
                            }
                            resolve({ success: true, imageData, headers: {} });
                        } catch (readErr) {
                            resolve({
                                success: false,
                                error: `Curl succeeded but failed to read output file: ${readErr.message}`
                            });
                        }
                    } else {
                        const message = stderr || `curl exited with code ${code}`;
                        resolve({ success: false, error: message });
                    }
                });
            });

            return result;
        } catch (error) {
            console.error('Error creating image request via curl:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Get image content type based on file extension
    getImageContentType(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const contentTypes = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png'
        };
        return contentTypes[ext] || 'image/jpeg';
    }
    async createVideoRequest(videoInfo, options) {
        const { width: baseWidth, height: baseHeight } = this.parseResolution(options.resolution);

        // Detect input orientation from actual video dimensions when available
        const inputWidth = Number(videoInfo.width) || baseWidth;
        const inputHeight = Number(videoInfo.height) || baseHeight;
        const inputIsPortrait = inputHeight > inputWidth;
        const baseIsPortrait = baseHeight > baseWidth;

        // Start from the configured resolution, but swap if needed to match input orientation
        let outputWidth = baseWidth;
        let outputHeight = baseHeight;
        if (inputIsPortrait !== baseIsPortrait) {
            // Swap width/height so the output stays portrait/landscape like the input
            outputWidth = baseHeight;
            outputHeight = baseWidth;
        }
        
        const requestData = {
            source: {
                // Use actual input video resolution when available
                resolution: {
                    width: inputWidth,
                    height: inputHeight
                },
                container: "mp4",
                size: 1,
                duration: 1,
                frameCount: 1,
                frameRate: 30
            },
            output: {
                resolution: {
                    width: outputWidth,
                    height: outputHeight
                },
                frameRate: 30,
                audioTransfer: "None",
                audioCodec: "AAC",
                videoEncoder: "H264",
                videoProfile: "High",
                dynamicCompressionLevel: "High"
            },
            filters: this.getFilterConfig(options.model, options.frameInterpolation, options.slowMotion, options.cropToFit)
        };

        try {
            const response = await this.axios.post('/video/', requestData, {
                headers: {
                    'content-type': 'application/json'
                }
            });
            
            return {
                success: true,
                requestId: response.data.requestId,
                data: response.data
            };
        } catch (error) {
            console.error('Error creating video request:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.message || error.message
            };
        }
    }

    // Accept the video request and get upload URLs
    async acceptVideoRequest(requestId) {
        try {
            const response = await this.axios.patch(`/video/${requestId}/accept`);
            
            return {
                success: true,
                uploadUrls: response.data.uploadUrls,
                data: response.data
            };
        } catch (error) {
            console.error('Error accepting video request:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.message || error.message
            };
        }
    }

    // Upload video file to S3
    async uploadVideoFile(filePath, uploadUrl) {
        try {
            const fileBuffer = await fs.readFile(filePath);
            
            const response = await axios.put(uploadUrl, fileBuffer, {
                headers: {
                    'Content-Type': 'video/mp4'
                    // Removed Content-Length - it's automatically set by axios
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                onUploadProgress: (progressEvent) => {
                    const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                    // This will be handled by the calling function
                }
            });

            return {
                success: true,
                eTag: response.headers.etag?.replace(/"/g, ''),
                data: response.data
            };
        } catch (error) {
            console.error('Error uploading video file:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.message || error.message
            };
        }
    }

    // Complete upload and start processing
    async completeUpload(requestId, uploadResults) {
        try {
            const response = await this.axios.patch(`/video/${requestId}/complete-upload`, {
                uploadResults: uploadResults
            }, {
                headers: {
                    'content-type': 'application/json'
                }
            });

            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            console.error('Error completing upload:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.message || error.message
            };
        }
    }

    // Check processing status
    async checkStatus(requestId) {
        try {
            const response = await this.axios.get(`/video/${requestId}/status`);
            
            return {
                success: true,
                status: response.data.status,
                progress: response.data.progress,
                downloadUrl: response.data.downloadUrl,
                data: response.data
            };
        } catch (error) {
            console.error('Error checking status:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.message || error.message
            };
        }
    }

    // Download processed video
    async downloadVideo(downloadUrl, outputPath, onProgress) {
        try {
            const response = await axios.get(downloadUrl, {
                responseType: 'arraybuffer',
                onDownloadProgress: (progressEvent) => {
                    if (onProgress && progressEvent.total) {
                        const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                        onProgress(progress);
                    }
                }
            });

            // Convert ArrayBuffer to Buffer for Node.js fs.writeFile
            const buffer = Buffer.from(response.data);
            await fs.writeFile(outputPath, buffer);

            return { success: true };
        } catch (error) {
            console.error('Error downloading video:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Parse resolution string
    parseResolution(resolutionString) {
        const [width, height] = resolutionString.split('x').map(Number);
        return { width, height };
    }

    // Get filter configuration based on model and frame interpolation
    getFilterConfig(model, frameInterpolation = 'chf-3', slowMotion = 1, cropToFit = false) {
        const filterConfigs = {
            // Upscale models only
            'prob-4': [{ model: 'prob-4' }],
            'ahq-12': [{ model: 'ahq-12' }],
            'amq-13': [{ model: 'amq-13' }],
            'alq-13': [{ model: 'alq-13' }],
            'nyx-3': [{ model: 'nyx-3' }],
            'nxf-1': [{ model: 'nxf-1' }],
            'rhea-1': [{ model: 'rhea-1' }],
            'ghq-5': [{ model: 'ghq-5' }],
            'gcg-5': [{ model: 'gcg-5' }]
        };

        // Frame interpolation configurations
        const frameInterpolationConfigs = {
            'apo-8': { model: 'apo-8', slowmo: slowMotion, fps: 60, duplicate: false },
            'apf-2': { model: 'apf-2', slowmo: slowMotion, fps: 60, duplicate: false },
            'chr-2': { model: 'chr-2', slowmo: slowMotion, fps: 60, duplicate: false },
            'chf-3': { model: 'chf-3', slowmo: slowMotion, fps: 60, duplicate: false }
        };

        // Get base upscale model configuration
        let baseConfig = filterConfigs[model] || filterConfigs['prob-4'];
        
        // Apply cropToFit to upscale models if enabled
        if (cropToFit) {
            baseConfig = baseConfig.map(filter => ({
                ...filter,
                cropToFit: true
            }));
        }
        
        // Add frame interpolation if specified
        if (frameInterpolation && frameInterpolationConfigs[frameInterpolation]) {
            return [...baseConfig, frameInterpolationConfigs[frameInterpolation]];
        }
        
        return baseConfig;
    }

    // Get credit balance for this API key
    async getCreditBalance() {
        try {
            const response = await this.axios.get('/account/v1/credits/balance');
            
            if (response.data) {
                return {
                    success: true,
                    credits: {
                        available: response.data.available_credits || 0,
                        reserved: response.data.reserved_credits || 0,
                        total: response.data.total_credits || 0
                    }
                };
            }
            
            return { success: false, error: 'Invalid response format' };
        } catch (error) {
            console.error('Error fetching credit balance:', error.message);
            return { 
                success: false, 
                error: error.response?.data?.message || error.message 
            };
        }
    }
}

module.exports = TopazAPI;
