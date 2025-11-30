const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const TopazAPI = require('./topaz-api');
const VideoUtils = require('./video-utils');
const APIManager = require('./api-manager');

const LICENSE_API_URL = 'https://script.google.com/macros/s/AKfycbxfEVh-96a1EE9dJcr1E-jXV86jUb-3EKP4GoMvqN15l23RXRD-f-6qQSxVl6aRbPsY8w/exec';

// Global variables
let appConfig = {};
let mediaFiles = [];
let processingQueue = [];
let activeProcesses = 0;
let maxWorkers = 2;
let apiManager = new APIManager();
let cachedMachineId = null;

// Processing state
let processingState = 'stopped'; // 'stopped', 'running', 'paused'
let pausedProcesses = new Set(); // Track paused process IDs

// Media type state
let currentMediaType = 'video'; // 'video' or 'image'

// DOM elements
const elements = {
    licenseEmail: document.getElementById('licenseEmail'),
    machineIdDisplay: document.getElementById('machineIdDisplay'),
    licenseStatus: document.getElementById('licenseStatus'),
    loginPage: document.getElementById('loginPage'),
    appContainer: document.querySelector('.app-container'),
    loginEnterBtn: document.getElementById('loginEnterBtn'),
    apiKey: document.getElementById('apiKey'),
    addApiKey: document.getElementById('addApiKey'),
    apiKeysList: document.getElementById('apiKeysList'),
    inputFolder: document.getElementById('inputFolder'),
    outputFolder: document.getElementById('outputFolder'),
    selectInputFolder: document.getElementById('selectInputFolder'),
    selectOutputFolder: document.getElementById('selectOutputFolder'),
    // Media type tabs
    videoTab: document.getElementById('videoTab'),
    imageTab: document.getElementById('imageTab'),
    videoOptions: document.getElementById('videoOptions'),
    imageOptions: document.getElementById('imageOptions'),
    // Video options
    slowMotion: document.getElementById('slowMotion'),
    cropToFit: document.getElementById('cropToFit'),
    model: document.getElementById('model'),
    frameInterpolation: document.getElementById('frameInterpolation'),
    resolution: document.getElementById('resolution'),
    removeAudio: document.getElementById('removeAudio'),
    // Image options
    imageModel: document.getElementById('imageModel'),
    outputFormat: document.getElementById('outputFormat'),
    outputWidth: document.getElementById('outputWidth'),
    imageQuality: document.getElementById('imageQuality'),
    qualityValue: document.getElementById('qualityValue'),
    // Common elements
    workers: document.getElementById('workers'),
    refreshFiles: document.getElementById('refreshFiles'),
    startUpscale: document.getElementById('startUpscale'),
    pauseUpscale: document.getElementById('pauseUpscale'),
    resumeUpscale: document.getElementById('resumeUpscale'),
    stopUpscale: document.getElementById('stopUpscale'),
    licenseInfoBtn: document.getElementById('licenseInfoBtn'),
    logoutBtn: document.getElementById('logoutBtn'),
    licenseModal: document.getElementById('licenseModal'),
    licenseModalContent: document.getElementById('licenseModalContent'),
    licenseModalClose: document.getElementById('licenseModalClose'),
    videoFilesList: document.getElementById('videoFilesList'),
    processingList: document.getElementById('processingList'),
    fileCount: document.getElementById('fileCount'),
    statusText: document.getElementById('statusText'),
    activeProcesses: document.getElementById('activeProcesses')
};

async function getMachineId() {
    if (cachedMachineId) {
        return cachedMachineId;
    }
    try {
        const id = await ipcRenderer.invoke('get-machine-id');
        if (id) {
            cachedMachineId = id.trim();
            if (elements.machineIdDisplay) {
                elements.machineIdDisplay.value = cachedMachineId;
            }
            return cachedMachineId;
        }
    } catch (error) {
        console.error('Failed to get machine ID:', error);
    }
    if (elements.machineIdDisplay && !elements.machineIdDisplay.value) {
        elements.machineIdDisplay.value = 'Unknown';
    }
    return null;
}

async function saveLicenseInfo(email, machineId) {
    try {
        const currentConfig = await ipcRenderer.invoke('load-config');
        currentConfig.licenseEmail = email;
        currentConfig.machineId = machineId;
        await ipcRenderer.invoke('save-config', currentConfig);
    } catch (error) {
        console.error('Failed to save license info:', error);
    }
}

function setLicenseStatus(message, type = 'info') {
    if (!elements.licenseStatus) return;
    elements.licenseStatus.textContent = message || '';
    let color = '#00b8a9';
    if (type === 'error') {
        color = '#ff6b6b';
    } else if (type === 'success') {
        color = '#4ecdc4';
    } else if (type === 'warning') {
        color = '#ffd93d';
    }
    elements.licenseStatus.style.color = color;
}

async function autoValidateStoredLicense() {
    try {
        const currentConfig = await ipcRenderer.invoke('load-config');
        const email = currentConfig.licenseEmail;
        const storedMachineId = currentConfig.machineId;
        if (!email || !storedMachineId) {
            return false;
        }

        const response = await axios.get(LICENSE_API_URL, {
            params: { email, machineId: storedMachineId }
        });

        const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;

        if (data && data.status === 'success') {
            setLicenseStatus('', 'info');
            return true;
        }

        setLicenseStatus((data && data.message) || 'License is not valid. Please log in again.', 'error');
        return false;
    } catch (error) {
        console.error('Error auto-validating license:', error);
        setLicenseStatus('Failed to validate license. Please log in again.', 'error');
        return false;
    }
}

async function handleLicenseLogin() {
    if (!elements.loginPage || !elements.appContainer || !elements.loginEnterBtn) {
        localStorage.setItem('hasLoggedIn', 'true');
        if (elements.loginPage) elements.loginPage.style.display = 'none';
        if (elements.appContainer) elements.appContainer.style.display = 'flex';
        initializeApp();
        return;
    }

    const email = elements.licenseEmail ? elements.licenseEmail.value.trim() : '';
    if (!email) {
        setLicenseStatus('License email is required.', 'error');
        return;
    }

    setLicenseStatus('Validating license...', 'warning');

    const machineId = await getMachineId();
    if (!machineId) {
        setLicenseStatus('Failed to get Machine ID.', 'error');
        return;
    }

    try {
        const response = await axios.get(LICENSE_API_URL, {
            params: { email, machineId }
        });

        const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;

        if (data && data.status === 'success') {
            setLicenseStatus(data.message || 'License is valid.', 'success');
            await saveLicenseInfo(email, machineId);
            localStorage.setItem('hasLoggedIn', 'true');
            elements.loginPage.style.display = 'none';
            elements.appContainer.style.display = 'flex';
            initializeApp();
        } else {
            setLicenseStatus((data && data.message) || 'License validation failed.', 'error');
        }
    } catch (error) {
        console.error('Error validating license:', error);
        setLicenseStatus('An error occurred while validating the license.', 'error');
    }
}

async function clearStoredLicenseInfo() {
    try {
        const currentConfig = await ipcRenderer.invoke('load-config');
        if (currentConfig) {
            delete currentConfig.licenseEmail;
            delete currentConfig.machineId;
            await ipcRenderer.invoke('save-config', currentConfig);
        }
    } catch (error) {
        console.error('Failed to clear license info:', error);
    }
}

async function handleLicenseInfoClick() {
    if (!elements.licenseModal || !elements.licenseModalContent) {
        return;
    }

    elements.licenseModal.style.display = 'flex';
    elements.licenseModalContent.textContent = 'Loading license information...';

    try {
        const currentConfig = appConfig && Object.keys(appConfig).length
            ? appConfig
            : await ipcRenderer.invoke('load-config');

        const email = currentConfig.licenseEmail;
        const storedMachineId = currentConfig.machineId || (await getMachineId());

        if (!email) {
            elements.licenseModalContent.textContent = 'No license email found. Please login first.';
            return;
        }

        const response = await axios.get(LICENSE_API_URL, {
            params: {
                email,
                machineId: storedMachineId || '',
                action: 'info'
            }
        });

        const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;

        if (!data || data.status !== 'success' || !data.license) {
            elements.licenseModalContent.textContent = (data && data.message) || 'Failed to load license information.';
            return;
        }

        const lic = data.license;
        const rows = [
            ['Email', lic.email || ''],
            ['Join Date', lic.joinDate || ''],
            ['License Expired Date', lic.licenseExpiredDate || ''],
            ['Machine ID 1', lic.machineId1 || ''],
            ['Machine ID 2', lic.machineId2 || ''],
            ['Machine ID 3', lic.machineId3 || '']
        ];

        const htmlRows = rows.map(([label, value]) => {
            const safeLabel = label;
            const safeValue = value === undefined || value === null || value === '' ? '-' : String(value);
            return `<tr><th>${safeLabel}</th><td>${safeValue}</td></tr>`;
        }).join('');

        elements.licenseModalContent.innerHTML = `<table>${htmlRows}</table>`;
    } catch (error) {
        console.error('Failed to load license info:', error);
        elements.licenseModalContent.textContent = 'Failed to load license information.';
    }
}

function closeLicenseModal() {
    if (elements.licenseModal) {
        elements.licenseModal.style.display = 'none';
    }
}

async function handleLogout() {
    localStorage.removeItem('hasLoggedIn');
    await clearStoredLicenseInfo();
    setLicenseStatus('', 'info');
    if (elements.loginPage && elements.appContainer) {
        elements.loginPage.style.display = 'flex';
        elements.appContainer.style.display = 'none';
        const btn = elements.loginEnterBtn || document.getElementById('loginEnterBtn');
        if (btn) {
            btn.onclick = () => {
                handleLicenseLogin();
            };
        }
    }
}

// Initialize application
async function initializeApp() {
    try {
        // Load saved configuration
        appConfig = await ipcRenderer.invoke('load-config');
        loadConfigToUI();
        
        // Initialize API keys if available
        if (appConfig.apiKeys && Array.isArray(appConfig.apiKeys)) {
            for (const apiKey of appConfig.apiKeys) {
                await apiManager.addApiKey(apiKey);
            }
        } else if (appConfig.apiKey) {
            // Migrate single API key to multiple keys format
            await apiManager.addApiKey(appConfig.apiKey);
            appConfig.apiKeys = [appConfig.apiKey];
            delete appConfig.apiKey;
            await saveConfig();
        }
        
        // Refresh credit balances on app launch
        await apiManager.refreshAllCreditBalances();
        renderApiKeys();
        
        // Set up event listeners
        setupEventListeners();
        
        // Load video files if input folder is set
        if (appConfig.inputFolder) {
            await loadVideoFiles();
        }
        
        updateStatus('Ready');
    } catch (error) {
        console.error('Failed to initialize app:', error);
        updateStatus('Initialization failed');
    }
}

// Load configuration to UI
function loadConfigToUI() {
    elements.apiKey.value = appConfig.apiKey || '';
    elements.inputFolder.value = appConfig.inputFolder || '';
    elements.outputFolder.value = appConfig.outputFolder || '';
    elements.slowMotion.value = appConfig.slowMotion || '1';
    elements.cropToFit.value = appConfig.cropToFit === true ? 'true' : 'false';
    elements.model.value = appConfig.model || 'prob-4';
    elements.frameInterpolation.value = appConfig.frameInterpolation || 'chf-3';
    elements.resolution.value = appConfig.resolution || '1920x1080';
    elements.removeAudio.value = appConfig.removeAudio === true ? 'yes' : 'no';
    maxWorkers = appConfig.workers || 2; // Changed from 1 to 2
    if (elements.workers) {
        elements.workers.value = maxWorkers;
    }
    
    // Load image settings
    if (elements.imageModel) {
        elements.imageModel.value = appConfig.imageModel || 'Standard V2';
    }
    if (elements.outputFormat) {
        elements.outputFormat.value = appConfig.outputFormat || 'jpeg';
    }
    if (elements.outputWidth) {
        elements.outputWidth.value = appConfig.outputWidth || '3840';
    }
    if (elements.imageQuality) {
        elements.imageQuality.value = appConfig.imageQuality || '95';
        if (elements.outputFormat && elements.outputFormat.value === 'png') {
            elements.imageQuality.disabled = true;
            if (elements.qualityValue) {
                elements.qualityValue.textContent = 'N/A';
            }
        } else {
            elements.imageQuality.disabled = false;
            if (elements.qualityValue) {
                elements.qualityValue.textContent = (appConfig.imageQuality || '95') + '%';
            }
        }
    }
}

// Setup event listeners
function setupEventListeners() {
    elements.addApiKey.addEventListener('click', addNewApiKey);
    elements.selectInputFolder.addEventListener('click', () => selectFolder('input'));
    elements.selectOutputFolder.addEventListener('click', () => selectFolder('output'));
    
    // Media type tabs
    elements.videoTab.addEventListener('click', () => switchMediaType('video'));
    elements.imageTab.addEventListener('click', () => switchMediaType('image'));
    
    // Video options
    elements.model.addEventListener('change', saveConfig);
    elements.frameInterpolation.addEventListener('change', saveConfig);
    elements.resolution.addEventListener('change', saveConfig);
    elements.removeAudio.addEventListener('change', saveConfig);
    elements.slowMotion.addEventListener('change', saveConfig);
    elements.cropToFit.addEventListener('change', saveConfig);
    
    // Image options
    elements.imageModel.addEventListener('change', saveConfig);
    elements.outputFormat.addEventListener('change', handleOutputFormatChange);
    elements.outputWidth.addEventListener('change', handleOutputWidthChange);
    elements.imageQuality.addEventListener('input', handleQualityChange);
    
    // Common controls
    elements.workers.addEventListener('change', handleWorkersChange);
    elements.refreshFiles.addEventListener('click', loadVideoFiles);
    elements.startUpscale.addEventListener('click', startUpscaleProcess);
    elements.pauseUpscale.addEventListener('click', pauseUpscaleProcess);
    elements.resumeUpscale.addEventListener('click', resumeUpscaleProcess);
    elements.stopUpscale.addEventListener('click', stopUpscaleProcess);

    if (elements.licenseInfoBtn) {
        elements.licenseInfoBtn.addEventListener('click', handleLicenseInfoClick);
    }
    if (elements.logoutBtn) {
        elements.logoutBtn.addEventListener('click', handleLogout);
    }

    if (elements.licenseModalClose) {
        elements.licenseModalClose.addEventListener('click', closeLicenseModal);
    }

    const sidebarLogo = document.querySelector('.sidebar-logo-container');
    if (sidebarLogo) {
        sidebarLogo.addEventListener('click', () => {
            localStorage.removeItem('hasLoggedIn');
            if (elements.loginPage && elements.appContainer) {
                elements.loginPage.style.display = 'flex';
                elements.appContainer.style.display = 'none';
            }
            showLoginIfNeeded();
        });
    }
}

// Switch between video and image processing modes
function switchMediaType(type) {
    currentMediaType = type;
    
    // Update tab appearance
    elements.videoTab.classList.toggle('active', type === 'video');
    elements.imageTab.classList.toggle('active', type === 'image');
    
    // Show/hide appropriate options
    elements.videoOptions.style.display = type === 'video' ? 'block' : 'none';
    elements.imageOptions.style.display = type === 'image' ? 'block' : 'none';
    
    // Update file list to show appropriate file types
    loadVideoFiles();
    
    // Save current media type to config
    saveConfig();
}

// Handle output width selection for images
function handleOutputWidthChange() {
    // No custom width functionality needed since it was removed
    saveConfig();
}

// Handle image quality slider
function handleQualityChange() {
    elements.qualityValue.textContent = elements.imageQuality.value + '%';
    saveConfig();
}

function handleOutputFormatChange() {
    if (elements.outputFormat.value === 'png') {
        elements.imageQuality.disabled = true;
        elements.qualityValue.textContent = 'N/A';
    } else {
        elements.imageQuality.disabled = false;
        elements.qualityValue.textContent = elements.imageQuality.value + '%';
    }
    saveConfig();
}

// Select folder
async function selectFolder(type) {
    const title = type === 'input' ? 'Select Input Folder' : 'Select Output Folder';
    const result = await ipcRenderer.invoke('select-folder', title);
    
    if (result.success) {
        if (type === 'input') {
            elements.inputFolder.value = result.path;
            appConfig.inputFolder = result.path;
            await loadVideoFiles();
        } else {
            elements.outputFolder.value = result.path;
            appConfig.outputFolder = result.path;
        }
        await saveConfig();
    }
}

// Handle simultaneous processing change
// Handle workers change
function handleWorkersChange() {
    const workers = parseInt(elements.workers.value);
    if (workers >= 1 && workers <= 50) {
        maxWorkers = workers;
        appConfig.workers = workers;
        saveConfig();
    }
}

// Save configuration
async function saveConfig() {
    appConfig.slowMotion = parseInt(elements.slowMotion.value);
    appConfig.cropToFit = elements.cropToFit.value === 'true';
    appConfig.model = elements.model.value;
    appConfig.frameInterpolation = elements.frameInterpolation.value;
    appConfig.resolution = elements.resolution.value;
    appConfig.removeAudio = elements.removeAudio.value === 'yes';
    appConfig.workers = parseInt(elements.workers.value);
    
    // Save image settings
    appConfig.imageModel = elements.imageModel.value;
    appConfig.outputFormat = elements.outputFormat.value;
    appConfig.outputWidth = elements.outputWidth.value;
    appConfig.imageQuality = elements.imageQuality.value;
    
    await ipcRenderer.invoke('save-config', appConfig);
}

// Load media files from input folder
async function loadVideoFiles() {
    if (!appConfig.inputFolder) {
        elements.fileCount.textContent = '0 files found';
        elements.videoFilesList.innerHTML = '<div class="empty-state"><p>Select an input folder to see media files</p></div>';
        return;
    }
    
    updateStatus('Loading media files...');
    
    try {
        const result = await ipcRenderer.invoke('get-media-files', appConfig.inputFolder);
        
        if (result.success) {
            // Filter files based on current media type
            const filteredFiles = result.files.filter(file => {
                if (currentMediaType === 'video') {
                    return file.type === 'video';
                } else if (currentMediaType === 'image') {
                    return file.type === 'image';
                }
                return true; // Show all if no specific type
            });
            
            mediaFiles = filteredFiles.map(file => ({
                ...file,
                status: 'pending',
                progress: 0,
                processId: null
            }));
            
            renderVideoFiles();
            
            // Count total files and current type files
            const totalFiles = result.files.length;
            const videoCount = result.files.filter(f => f.type === 'video').length;
            const imageCount = result.files.filter(f => f.type === 'image').length;
            
            let countText = `${filteredFiles.length} ${currentMediaType} files`;
            if (totalFiles > filteredFiles.length) {
                countText += ` (${totalFiles} total: ${videoCount} video, ${imageCount} image)`;
            }
            
            elements.fileCount.textContent = countText;
            updateStatus('Media files loaded');
        } else {
            console.error('Error loading media files:', result.error);
            elements.fileCount.textContent = '0 files found';
            elements.videoFilesList.innerHTML = '<div class="empty-state"><p>Error loading media files</p></div>';
            updateStatus('Error loading media files');
        }
    } catch (error) {
        console.error('Error loading media files:', error);
        updateStatus('Error loading media files');
    }
}

// Render media files list
function renderVideoFiles() {
    if (mediaFiles.length === 0) {
        const mediaType = currentMediaType === 'video' ? 'video' : 'image';
        elements.videoFilesList.innerHTML = `<div class="empty-state"><p>No ${mediaType} files found</p></div>`;
        return;
    }
    
    const html = mediaFiles.map((file, index) => `
        <div class="video-file-item fade-in" data-file-index="${index}">
            <div class="file-info">
                <div class="file-name">${file.name}</div>
                <div class="file-details">
                    ${formatFileSize(file.size)} • ${file.extension.toUpperCase()} • ${file.type.toUpperCase()}
                </div>
            </div>
            <div class="file-status status-${file.status}">
                ${file.status}
            </div>
        </div>
    `).join('');
    
    elements.videoFilesList.innerHTML = html;
}

// Format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Start upscale process
async function startUpscaleProcess() {
    if (!validateConfiguration()) {
        return;
    }
    
    const pendingFiles = mediaFiles.filter(file => file.status === 'pending');
    if (pendingFiles.length === 0) {
        alert('No pending files to process');
        return;
    }
    
    processingState = 'running';
    updateControlButtons();
    updateStatus(`Starting ${currentMediaType} upscale process...`);
    
    // Refresh credit balances before starting
    await apiManager.refreshAllCreditBalances();
    renderApiKeys();
    
    // Add only the first maxWorkers files to processing queue initially
    const filesToAdd = pendingFiles.slice(0, maxWorkers);
    
    filesToAdd.forEach(file => {
        processingQueue.push({
            id: Date.now() + Math.random(),
            file: file,
            status: 'queued',
            progress: 0,
            startTime: null,
            requestId: null,
            phase: 'queued',
            mediaType: currentMediaType
        });
    });
    
    renderProcessingQueue();
    
    // Start processing
    processQueue();
}

function pauseUpscaleProcess() {
    processingState = 'paused';
    updateControlButtons();
    updateStatus('Processing paused...');
    
    // Mark currently processing items as paused
    processingQueue.forEach(item => {
        if (item.status === 'processing') {
            pausedProcesses.add(item.id);
        }
    });
}

function resumeUpscaleProcess() {
    processingState = 'running';
    updateControlButtons();
    updateStatus('Resuming processing...');
    
    // Clear paused processes set
    pausedProcesses.clear();
    
    // Resume processing queue
    processQueue();
}

function stopUpscaleProcess() {
    processingState = 'stopped';
    updateControlButtons();
    updateStatus('Processing stopped');
    
    // Clear paused processes
    pausedProcesses.clear();
    
    // Mark all queued items as pending again
    processingQueue.forEach(item => {
        if (item.status === 'queued') {
            item.file.status = 'pending';
        }
    });
    
    // Keep ALL processing items in queue, just mark them as stopped
    processingQueue.forEach(item => {
        if (item.status === 'processing') {
            // Mark as stopped but keep in queue
            item.status = 'error';
            item.phase = 'Stopped';
            item.error = 'Processing stopped by user';
            item.file.status = 'error';
        }
    });
    
    // Reset active processes counter for UI
    activeProcesses = processingQueue.filter(item => item.status === 'processing').length;
    updateActiveProcesses();
    
    // Refresh credit balances when stopping
    apiManager.refreshAllCreditBalances().then(() => {
        renderApiKeys();
    });
    
    renderVideoFiles();
    renderProcessingQueue();
}

function updateControlButtons() {
    switch (processingState) {
        case 'stopped':
            elements.startUpscale.style.display = 'inline-block';
            elements.pauseUpscale.style.display = 'none';
            elements.resumeUpscale.style.display = 'none';
            elements.stopUpscale.style.display = 'none';
            elements.startUpscale.disabled = false;
            break;
        case 'running':
            elements.startUpscale.style.display = 'none';
            elements.pauseUpscale.style.display = 'inline-block';
            elements.resumeUpscale.style.display = 'none';
            elements.stopUpscale.style.display = 'inline-block';
            break;
        case 'paused':
            elements.startUpscale.style.display = 'none';
            elements.pauseUpscale.style.display = 'none';
            elements.resumeUpscale.style.display = 'inline-block';
            elements.stopUpscale.style.display = 'inline-block';
            break;
    }
}

// Validate configuration
function validateConfiguration() {
    const apiKeys = apiManager.getApiKeys();
    if (apiKeys.length === 0) {
        updateStatus('Please add at least one API key');
        return false;
    }
    
    if (!appConfig.inputFolder) {
        updateStatus('Please select an input folder');
        return false;
    }
    
    if (!appConfig.outputFolder) {
        updateStatus('Please select an output folder');
        return false;
    }
    
    return true;
}

// Process queue
async function processQueue() {
    // Don't start new processes if paused
    if (processingState === 'paused') {
        return;
    }
    
    // Start processing items up to maxWorkers limit
    while (activeProcesses < maxWorkers && processingState === 'running') {
        // Find next queued item in processing queue
        const item = processingQueue.find(item => item.status === 'queued');
        if (!item) {
            // No queued items, try to add more from pending files
            const nextPendingFile = mediaFiles.find(file => 
                file.status === 'pending' && 
                !processingQueue.some(queueItem => queueItem.file === file)
            );
            
            if (nextPendingFile) {
                // Add new item to queue
                const newItem = {
                    id: Date.now() + Math.random(),
                    file: nextPendingFile,
                    status: 'queued',
                    progress: 0,
                    startTime: null,
                    requestId: null,
                    phase: 'queued'
                };
                processingQueue.push(newItem);
                renderProcessingQueue();
                continue; // Try to process this new item
            } else {
                // No more pending files
                break;
            }
        }
        
        // Start processing the item
        activeProcesses++;
        updateActiveProcesses();
        
        item.status = 'processing';
        item.startTime = Date.now();
        item.file.status = 'processing';
        
        // Update individual file status in DOM without full refresh
        const fileIndex = mediaFiles.indexOf(item.file);
        if (fileIndex !== -1) {
            const fileElement = document.querySelector(`[data-file-index="${fileIndex}"] .file-status`);
            if (fileElement) {
                fileElement.textContent = 'processing';
                fileElement.className = 'file-status status-processing';
            }
        }
        
        renderProcessingQueue();
        
        // Start processing asynchronously
        processVideoFile(item).finally(() => {
            activeProcesses--;
            updateActiveProcesses();
            
            // Remove the completed item from queue
            const itemIndex = processingQueue.indexOf(item);
            if (itemIndex > -1) {
                processingQueue.splice(itemIndex, 1);
                renderProcessingQueue();
            }
            
            // Continue processing if there are more files
            if (processingState === 'running') {
                processQueue();
            }
        });
    }
    
    // Check if all processing is complete
    const hasMorePendingFiles = mediaFiles.some(file => file.status === 'pending');
    
    if (activeProcesses === 0 && processingQueue.length === 0 && !hasMorePendingFiles) {
        processingState = 'stopped';
        updateControlButtons();
        updateStatus('All processing completed');
        
        // Refresh credit balances after all processing is finished
        await apiManager.refreshAllCreditBalances();
        renderApiKeys();
        
        // Show completion stats
        const stats = apiManager.getStats();
        console.log('Processing completed. API Stats:', stats);
    }
}

async function processVideoFile(item) {
    // Route to appropriate processing function based on media type
    if (item.type === 'image' || item.mediaType === 'image') {
        return await processImageFile(item);
    } else {
        return await processVideoFileOriginal(item);
    }
}

async function processImageFile(item) {
    const maxRetries = apiManager.getApiKeys().length * 2;
    let retryCount = 0;
    
    while (retryCount < maxRetries) {
        // Check if process should be stopped BEFORE any processing
        if (processingState === 'stopped') {
            item.status = 'stopped';
            item.phase = 'Stopped';
            renderProcessingQueue();
            return { success: false, error: 'Process stopped by user' };
        }
        
        try {
            // Check if process should be paused
            if (pausedProcesses.has(item.id) || processingState === 'paused') {
                item.status = 'paused';
                item.phase = 'Paused';
                renderProcessingQueue();
                
                // Wait until resumed or stopped
                while ((pausedProcesses.has(item.id) || processingState === 'paused') && processingState !== 'stopped') {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                
                if (processingState === 'stopped') {
                    item.status = 'stopped';
                    item.phase = 'Stopped';
                    renderProcessingQueue();
                    return { success: false, error: 'Process stopped by user' };
                }
                
                item.status = 'processing';
                renderProcessingQueue();
            }
            
            const result = await processImageFileAttempt(item);
            
            if (result.success) {
                return result;
            } else {
                retryCount++;
                item.retryCount = retryCount;
                
                if (retryCount >= maxRetries) {
                    return result;
                }
                
                // Check if stopped before waiting for retry
                if (processingState === 'stopped') {
                    item.status = 'stopped';
                    item.phase = 'Stopped';
                    renderProcessingQueue();
                    return { success: false, error: 'Process stopped by user' };
                }
                
                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        } catch (error) {
            retryCount++;
            item.retryCount = retryCount;
            
            if (retryCount >= maxRetries) {
                return { success: false, error: error.message };
            }
            
            // Check if stopped before waiting for retry
            if (processingState === 'stopped') {
                item.status = 'stopped';
                item.phase = 'Stopped';
                renderProcessingQueue();
                return { success: false, error: 'Process stopped by user' };
            }
            
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

async function processVideoFileOriginal(item) {
    const maxRetries = apiManager.getApiKeys().length * 2; // Try each API key twice
    let retryCount = 0;
    
    while (retryCount < maxRetries) {
        try {
            // Check if process should be paused
            if (pausedProcesses.has(item.id) || processingState === 'paused') {
                item.status = 'paused';
                item.phase = 'Paused';
                renderProcessingQueue();
                
                // Wait until resumed or stopped
                while (processingState === 'paused' && pausedProcesses.has(item.id)) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                
                // If stopped during pause, keep all items in queue
                if (processingState === 'stopped') {
                    // Always keep items in queue when stopped, just mark them appropriately
                    item.status = 'error';
                    item.phase = 'Stopped';
                    item.error = 'Processing stopped by user';
                    item.file.status = 'error';
                    renderProcessingQueue();
                    return;
                }
                
                // Resume processing
                item.status = 'processing';
                item.phase = 'Resuming...';
                renderProcessingQueue();
            }
            
            // Check if stopped
            if (processingState === 'stopped') {
                // Always keep items in queue when stopped, just mark them appropriately
                item.status = 'error';
                item.phase = 'Stopped';
                item.error = 'Processing stopped by user';
                item.file.status = 'error';
                renderProcessingQueue();
                return;
            }
            
            await processVideoFileAttempt(item);
            
            // Only proceed if the item is actually completed (not removed by stop/pause)
            if (item.status !== 'completed') {
                return; // Item was stopped/paused or failed
            }
            
            // Refresh credit balances after processing to get updated values
            await apiManager.refreshAllCreditBalances();
            
            // Calculate credits used if we have the API key info
            let creditsUsed = 0;
            if (item.usedApiKey && item.creditsBefore !== undefined) {
                const usedApiInstance = apiManager.apiInstances.find(instance => 
                    instance.key.substring(0, 8) + '...' === item.usedApiKey
                );
                const creditsAfter = usedApiInstance && usedApiInstance.credits ? usedApiInstance.credits.available : 0;
                creditsUsed = Math.max(0, item.creditsBefore - creditsAfter);
            }
            
            // Update completion info with credit tracking
            item.progress = 100;
            item.phase = `Completed (${creditsUsed} credits used)`;
            item.creditsUsed = creditsUsed; // Store for future reference
            
            // Keep completed items in queue - they can be removed manually by user
            
            renderApiKeys();
            
            renderProcessingQueue();
            return;
            
        } catch (error) {
            retryCount++;
            console.error(`Processing attempt ${retryCount} failed:`, error);
            
            // Check if this is a credit refill error
            const isCreditError = error.message.toLowerCase().includes('credit refill in progress') || 
                                error.message.toLowerCase().includes('insufficient credits') ||
                                error.message.toLowerCase().includes('no credits');
            
            if (isCreditError) {
                // For credit errors, try switching to next API key immediately
                item.phase = `Switching API key (${retryCount}/${maxRetries})`;
                renderProcessingQueue();
                
                // Refresh credit balances to get latest status
                await apiManager.refreshAllCreditBalances();
                renderApiKeys();
                
                // Short delay before trying next API key
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else if (retryCount >= maxRetries) {
                // Final failure for non-credit errors - remove from queue automatically
                item.status = 'error';
                item.error = error.message;
                item.file.status = 'error';
                
                // Update individual file status in DOM without full refresh
                const fileIndex = mediaFiles.indexOf(item.file);
                if (fileIndex !== -1) {
                    const fileElement = document.querySelector(`[data-file-index="${fileIndex}"] .file-status`);
                    if (fileElement) {
                        fileElement.textContent = 'error';
                        fileElement.className = 'file-status status-error';
                    }
                }
                
                // Remove error item from processing queue automatically
                const itemIndex = processingQueue.indexOf(item);
                if (itemIndex > -1) {
                    processingQueue.splice(itemIndex, 1);
                }
                
                renderProcessingQueue();
                return;
            } else {
                // Regular retry for non-credit errors
                item.phase = `Retrying (${retryCount}/${maxRetries})`;
                renderProcessingQueue();
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
            }
            
            // If we've exhausted all retries - remove from queue automatically
        if (retryCount >= maxRetries) {
            item.status = 'error';
            item.error = error.message;
            item.file.status = 'error';
            
            // Update individual file status in DOM without full refresh
            const fileIndex = mediaFiles.indexOf(item.file);
            if (fileIndex !== -1) {
                const fileElement = document.querySelector(`[data-file-index="${fileIndex}"] .file-status`);
                if (fileElement) {
                    fileElement.textContent = 'error';
                    fileElement.className = 'file-status status-error';
                }
            }
            
            // Remove error item from processing queue automatically
            const itemIndex = processingQueue.indexOf(item);
            if (itemIndex > -1) {
                processingQueue.splice(itemIndex, 1);
            }
            
            renderProcessingQueue();
            return;
        }
        }
    }
}

// Single attempt to process video file
// Update this function to refresh credits after processing completion
async function processImageFileAttempt(item) {
    try {
        // Get an available API instance
        const apiInstance = apiManager.getNextApi();
        if (!apiInstance) {
            throw new Error('No API keys available');
        }
        const topazAPI = apiInstance.api;
        
        // Store API instance info for credit tracking
        item.usedApiKey = apiInstance.key.substring(0, 8) + '...';
        
        // Store credits before processing for tracking
        item.creditsBefore = apiInstance.credits ? apiInstance.credits.available : 0;

        // Phase 1: Preparing image
        item.phase = 'Preparing image';
        item.progress = 10;
        renderProcessingQueue();
        
        // Phase 2: Enhancing image
        item.phase = 'Enhancing image';
        item.progress = 30;
        renderProcessingQueue();
        
        console.log('Processing image with config:', {
            inputPath: item.file.path,
            model: appConfig.imageModel || 'Standard V2',
            outputFormat: appConfig.outputFormat || 'jpeg',
            outputWidth: appConfig.outputWidth || '3840',
            apiKey: apiInstance.key.substring(0, 8) + '...'
        });
        
        const enhanceResult = await topazAPI.createImageRequest({
            inputPath: item.file.path,
            model: appConfig.imageModel || 'Standard V2',
            outputFormat: appConfig.outputFormat || 'jpeg',
            outputWidth: appConfig.outputWidth || '3840'
        });
        
        console.log('Enhancement result:', enhanceResult);
        
        if (!enhanceResult.success) {
            throw new Error(`Failed to enhance image: ${enhanceResult.error}`);
        }
        
        // Phase 3: Saving enhanced image
        item.phase = 'Saving enhanced image';
        item.progress = 80;
        renderProcessingQueue();
        
        // Generate output filename
        const inputPath = item.file.path;
        const inputName = path.parse(inputPath).name;
        const outputFormat = appConfig.outputFormat || 'jpeg';
        const outputExtension = outputFormat === 'jpeg' ? 'jpeg' : 'png';
        const outputFilename = `${inputName}_enhanced.${outputExtension}`;
        const outputPath = path.join(appConfig.outputFolder, outputFilename);
        
        // Save the enhanced image
        await fs.writeFile(outputPath, enhanceResult.imageData);
        
        // Phase 4: Complete
        item.phase = 'Complete';
        item.progress = 100;
        item.status = 'completed';
        item.outputPath = outputPath;
        
        // Update credits after processing
        await apiManager.refreshCreditBalance(apiInstance);
        item.creditsAfter = apiInstance.credits ? apiInstance.credits.available : 0;
        item.creditsUsed = Math.max(0, item.creditsBefore - item.creditsAfter);
        
        renderProcessingQueue();
        
        return { 
            success: true, 
            outputPath: outputPath,
            creditsUsed: item.creditsUsed
        };
        
    } catch (error) {
        console.error('Error processing image:', error);
        
        item.status = 'error';
        item.phase = 'Error';
        item.error = error.message;
        item.progress = 0;
        
        renderProcessingQueue();
        
        return { 
            success: false, 
            error: error.message 
        };
    }
}

async function processVideoFileAttempt(item) {
    try {
        // Get an available API instance
        const apiInstance = apiManager.getNextApi();
        if (!apiInstance) {
            throw new Error('No API keys available');
        }
        const topazAPI = apiInstance.api;
        
        // Store API instance info for credit tracking
        item.usedApiKey = apiInstance.key.substring(0, 8) + '...';
        
        // Store credits before processing for tracking
        item.creditsBefore = apiInstance.credits ? apiInstance.credits.available : 0;

        // Phase 1: Get video information
        item.phase = 'Analyzing video';
        item.progress = 5;
        renderProcessingQueue();
        
        const videoInfo = await VideoUtils.getVideoInfo(item.file.path);
        
        // Phase 2: Create Topaz request
        item.phase = 'Creating request';
        item.progress = 10;
        renderProcessingQueue();
        
        const createResult = await topazAPI.createVideoRequest(videoInfo, {
            model: appConfig.model,
            resolution: appConfig.resolution,
            removeAudio: appConfig.removeAudio,
            frameInterpolation: appConfig.frameInterpolation,
            slowMotion: parseInt(appConfig.slowMotion) || 1,
            cropToFit: appConfig.cropToFit === 'true' || appConfig.cropToFit === true
        });
        
        if (!createResult.success) {
            throw new Error(`Failed to create request: ${createResult.error}`);
        }
        
        item.requestId = createResult.requestId;
        
        // Phase 3: Accept request and get upload URL
        item.phase = 'Getting upload URL';
        item.progress = 15;
        renderProcessingQueue();
        
        const acceptResult = await topazAPI.acceptVideoRequest(item.requestId);
        
        if (!acceptResult.success) {
            throw new Error(`Failed to accept request: ${acceptResult.error}`);
        }
        
        // Debug: Log the accept result to understand the structure
        console.log('Accept result:', acceptResult);
        
        // Phase 4: Upload video - Fixed error handling
        item.phase = 'Uploading video';
        item.progress = 20;
        renderProcessingQueue();
        
        // Extract upload URL from the response
        let uploadUrl = null;
        
        // Check for the correct response structure based on the error message
        if (acceptResult.data && acceptResult.data.urls && Array.isArray(acceptResult.data.urls) && acceptResult.data.urls.length > 0) {
            uploadUrl = acceptResult.data.urls[0];
        } else if (acceptResult.uploadUrls && Array.isArray(acceptResult.uploadUrls) && acceptResult.uploadUrls.length > 0) {
            uploadUrl = acceptResult.uploadUrls[0];
        } else if (acceptResult.data && acceptResult.data.uploadUrls && Array.isArray(acceptResult.data.uploadUrls) && acceptResult.data.uploadUrls.length > 0) {
            uploadUrl = acceptResult.data.uploadUrls[0];
        } else if (acceptResult.data && acceptResult.data.uploadUrl) {
            uploadUrl = acceptResult.data.uploadUrl;
        } else if (acceptResult.uploadUrl) {
            uploadUrl = acceptResult.uploadUrl;
        } else {
            throw new Error(`No upload URL found in response. Response structure: ${JSON.stringify(acceptResult)}`);
        }
        
        const uploadResult = await topazAPI.uploadVideoFile(item.file.path, uploadUrl);
        
        if (!uploadResult.success) {
            throw new Error(`Failed to upload video: ${uploadResult.error}`);
        }
        
        // Phase 5: Complete upload
        item.phase = 'Starting processing';
        item.progress = 30;
        renderProcessingQueue();
        
        const completeResult = await topazAPI.completeUpload(item.requestId, [{
            partNum: 1,
            eTag: uploadResult.eTag
        }]);
        
        if (!completeResult.success) {
            throw new Error(`Failed to complete upload: ${completeResult.error}`);
        }
        
        // Phase 6: Monitor processing
        item.phase = 'Processing on Topaz servers';
        let processingComplete = false;
        let downloadUrl = null;
        let statusCheckCount = 0;
        const maxStatusChecks = 180; // 30 minutes maximum (180 * 10 seconds)
        
        while (!processingComplete && statusCheckCount < maxStatusChecks) {
            await new Promise(resolve => setTimeout(resolve, 10000)); // Check every 10 seconds
            statusCheckCount++;
            
            const statusResult = await topazAPI.checkStatus(item.requestId);
            
            // Debug: Log the full status response
            console.log(`Status check ${statusCheckCount} for ${item.file.name}:`, statusResult);
            
            if (!statusResult.success) {
                throw new Error(`Failed to check status: ${statusResult.error}`);
            }
            
            // Update the status display with more details
            item.status = `${statusResult.status || 'unknown'} (check ${statusCheckCount}/${maxStatusChecks})`;
            
            if (statusResult.status === 'complete') {
                // Check for download URL in the correct location
                if (statusResult.data && statusResult.data.download && statusResult.data.download.url) {
                    processingComplete = true;
                    downloadUrl = statusResult.data.download.url;
                    item.progress = 80;
                } else if (statusResult.downloadUrl) {
                    // Fallback to direct downloadUrl field
                    processingComplete = true;
                    downloadUrl = statusResult.downloadUrl;
                    item.progress = 80;
                } else if (statusResult.data && statusResult.data.downloadUrl) {
                    // Another fallback
                    processingComplete = true;
                    downloadUrl = statusResult.data.downloadUrl;
                    item.progress = 80;
                } else {
                    // Log the complete response to see what download URL field is available
                    console.log('Complete status but no download URL found. Full response:', JSON.stringify(statusResult, null, 2));
                    if (statusResult.status === 'failed' || statusResult.status === 'error') {
                        throw new Error(`Processing failed on Topaz servers: ${statusResult.data?.message || 'Unknown error'}`);
                    } else if (statusResult.status === 'processing' || statusResult.status === 'queued' || statusResult.status === 'postprocessing' || statusResult.status === 'initializing') {
                        // Update progress based on server response
                        item.progress = Math.min(75, 30 + (statusResult.progress || 0) * 0.45);
                    } else {
                        // Log unexpected status
                        console.warn(`Unexpected status: ${statusResult.status}`, statusResult);
                        item.progress = Math.min(75, 30 + (statusResult.progress || 0) * 0.45);
                    }
                    renderProcessingQueue();
                }
            } else if (statusResult.status === 'completed') {
                // Also check for 'completed' in case API uses both
                if (statusResult.data && statusResult.data.download && statusResult.data.download.url) {
                    processingComplete = true;
                    downloadUrl = statusResult.data.download.url;
                    item.progress = 80;
                } else if (statusResult.downloadUrl) {
                    processingComplete = true;
                    downloadUrl = statusResult.downloadUrl;
                    item.progress = 80;
                }
            } else if (statusResult.status === 'failed' || statusResult.status === 'error') {
                throw new Error(`Processing failed on Topaz servers: ${statusResult.data?.message || 'Unknown error'}`);
            } else if (statusResult.status === 'processing' || statusResult.status === 'queued' || statusResult.status === 'postprocessing' || statusResult.status === 'initializing' || statusResult.status === 'preprocessing') {
                // Update progress based on server response
                item.progress = Math.min(75, 30 + (statusResult.progress || 0) * 0.45);
            } else {
                // Log unexpected status
                console.warn(`Unexpected status: ${statusResult.status}`, statusResult);
                item.progress = Math.min(75, 30 + (statusResult.progress || 0) * 0.45);
            }
            
            renderProcessingQueue();
        }
        
        // Check if we timed out
        if (!processingComplete) {
            throw new Error(`Processing timeout after ${maxStatusChecks} status checks (${maxStatusChecks * 10 / 60} minutes). Last status: ${item.status}`);
        }
        
        // Phase 7: Download processed video
        item.phase = 'Downloading result';
        item.progress = 85;
        renderProcessingQueue();
        
        const outputFileName = `${path.parse(item.file.name).name}_upscaled${path.extname(item.file.name)}`;
        const outputPath = path.join(appConfig.outputFolder, outputFileName);
        
        const downloadResult = await topazAPI.downloadVideo(downloadUrl, outputPath, (progress) => {
            item.progress = 85 + (progress * 0.1); // 85-95%
            renderProcessingQueue();
        });
        
        if (!downloadResult.success) {
            throw new Error(`Failed to download result: ${downloadResult.error}`);
        }
        
        // Phase 8: Post-processing (remove audio if needed and not handled by API)
        if (appConfig.removeAudio) {
            item.phase = 'Removing audio';
            item.progress = 95;
            renderProcessingQueue();
            
            try {
                const tempPath = outputPath + '.temp';
                await fs.move(outputPath, tempPath);
                
                await VideoUtils.removeAudio(tempPath, outputPath, (progress) => {
                    item.progress = 95 + (progress * 0.05); // 95-100%
                    renderProcessingQueue();
                });
                
                await fs.remove(tempPath);
            } catch (audioError) {
                console.warn('Failed to remove audio locally:', audioError.message);
                // Continue anyway - the file is still processed
            }
        }
        
        // Success!
        item.status = 'completed';
        item.file.status = 'completed'; // Mark as completed in file list
        item.progress = 100;
        item.phase = 'Completed';
        
        // Update individual file status in DOM without full refresh
        const fileIndex = mediaFiles.indexOf(item.file);
        if (fileIndex !== -1) {
            const fileElement = document.querySelector(`[data-file-index="${fileIndex}"] .file-status`);
            if (fileElement) {
                fileElement.textContent = 'completed';
                fileElement.className = 'file-status status-completed';
            }
        }
        
        renderProcessingQueue();
        
        // Don't remove from queue or decrement activeProcesses here - let the finally block handle it
        
    } catch (error) {
        throw error; // Re-throw for retry logic
    }
}

// Render processing queue
function renderProcessingQueue() {
    // Show all items in processing queue except queued items
    const processingItems = processingQueue.filter(item => item.status !== 'queued');
    
    if (processingItems.length === 0) {
        elements.processingList.innerHTML = '<div class="empty-state"><p>No processing tasks</p></div>';
        return;
    }
    
    const html = processingItems.map((item, index) => `
        <div class="processing-item ${item.status === 'error' ? 'error-item' : ''}">
            <div class="processing-header">
                <div class="processing-name">${item.file.name}</div>
                <div class="processing-actions">
                    <div class="processing-progress">${Math.round(item.progress)}%</div>
                    ${item.status === 'error' ? `<button class="btn btn-remove btn-small" onclick="removeErrorItem(${index})">Remove</button>` : ''}
                    ${item.status === 'completed' ? `<button class="btn btn-remove btn-small" onclick="removeCompletedItem(${index})">Remove</button>` : ''}
                </div>
            </div>
            <div class="progress-bar">
                <div class="progress-fill ${item.status === 'error' ? 'error-fill' : ''}" style="width: ${item.progress}%"></div>
            </div>
            <div class="processing-details">
                Phase: ${item.phase} • Status: ${item.status}
                ${item.startTime ? ` • Started: ${new Date(item.startTime).toLocaleTimeString()}` : ''}
                ${item.requestId ? ` • Request ID: ${item.requestId.substring(0, 8)}...` : ''}
                ${item.usedApiKey ? ` • API: ${item.usedApiKey}` : ''}
                ${item.creditsUsed !== undefined ? ` • Credits: ${item.creditsUsed}` : ''}
            </div>
        </div>
    `).join('');
    
    elements.processingList.innerHTML = html;
}

// Remove completed item from processing queue
function removeCompletedItem(index) {
    const processingItems = processingQueue.filter(item => 
        item.status === 'processing' || 
        item.status === 'error' || 
        item.status === 'paused' || 
        item.status === 'completed'
    );
    
    if (index >= 0 && index < processingItems.length) {
        const item = processingItems[index];
        if (item.status === 'completed') {
            // Find the actual index in the full processingQueue
            const actualIndex = processingQueue.indexOf(item);
            if (actualIndex > -1) {
                // Remove from processing queue
                processingQueue.splice(actualIndex, 1);
                
                // Re-render the queue
                renderProcessingQueue();
                
                updateStatus(`Removed completed item: ${item.file.name}`);
            }
        }
    }
}

// Remove error item from processing queue
function removeErrorItem(index) {
    if (index >= 0 && index < processingQueue.length) {
        const item = processingQueue[index];
        if (item.status === 'error') {
            // Remove from processing queue
            processingQueue.splice(index, 1);
            
            // Reset file status to allow reprocessing
            item.file.status = 'ready';
            
            // Re-render both queues
            renderProcessingQueue();
            renderVideoFiles();
            
            updateStatus(`Removed error item: ${item.file.name}`);
        }
    }
}

// Update status
function updateStatus(status) {
    elements.statusText.textContent = status;
}

// Update active processes count
function updateActiveProcesses() {
    elements.activeProcesses.textContent = `${activeProcesses} active processes`;
}

async function showLoginIfNeeded() {
    const loginPage = elements.loginPage || document.getElementById('loginPage');
    const appContainer = elements.appContainer || document.querySelector('.app-container');
    let hasLoggedIn = localStorage.getItem('hasLoggedIn') === 'true';

    await getMachineId();

    if (hasLoggedIn) {
        const stillValid = await autoValidateStoredLicense();
        if (!stillValid) {
            localStorage.removeItem('hasLoggedIn');
            hasLoggedIn = false;
        }
    }

    if (!hasLoggedIn) {
        if (loginPage) loginPage.style.display = 'flex';
        if (appContainer) appContainer.style.display = 'none';
        const btn = elements.loginEnterBtn || document.getElementById('loginEnterBtn');
        if (btn) {
            btn.onclick = () => {
                handleLicenseLogin();
            };
        }
    } else {
        if (loginPage) loginPage.style.display = 'none';
        if (appContainer) appContainer.style.display = 'flex';
        initializeApp();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    showLoginIfNeeded();
});

// Make functions globally accessible for onclick handlers
window.removeErrorItem = removeErrorItem;
window.removeCompletedItem = removeCompletedItem;
window.removeApiKey = removeApiKey;

// API Key Management Functions
async function addNewApiKey() {
    const apiKeyInput = elements.apiKey;
    const apiKey = apiKeyInput.value.trim();
    
    if (!apiKey) {
        updateStatus('Please enter an API key');
        return;
    }
    
    try {
        updateStatus('Validating API key...');
        const result = await apiManager.addApiKey(apiKey);
        
        if (result.success) {
            // Save only the API key strings to config
            appConfig.apiKeys = apiManager.getApiKeys().map(keyInfo => keyInfo.key);
            await saveConfig();
            
            // Clear input and update UI
            apiKeyInput.value = '';
            renderApiKeys();
            updateStatus('API key added successfully');
        } else {
            updateStatus(result.message || 'Invalid API key');
        }
    } catch (error) {
        console.error('Error adding API key:', error);
        updateStatus('Error adding API key');
    }
}

async function removeApiKey(index) {
    try {
        apiManager.removeApiKey(index);
        
        // Save only the API key strings to config
        appConfig.apiKeys = apiManager.getApiKeys().map(keyInfo => keyInfo.key);
        await saveConfig();
        
        // Update UI
        renderApiKeys();
        updateStatus('API key removed');
    } catch (error) {
        console.error('Error removing API key:', error);
        updateStatus('Error removing API key');
    }
}

function renderApiKeys() {
    const apiKeysList = elements.apiKeysList;
    const apiKeys = apiManager.getApiKeys();
    
    if (!apiKeys || apiKeys.length === 0) {
        apiKeysList.innerHTML = '<div class="api-key-item">No API keys configured</div>';
        return;
    }
    
    apiKeysList.innerHTML = apiKeys.map((keyInfo, index) => {
        const maskedKey = keyInfo.key.substring(0, 8) + '...';
        const statusClass = keyInfo.isActive ? 'valid' : 'invalid';
        const statusText = keyInfo.isActive ? 'Valid' : 'Invalid';
        
        // Format credit balance
        let creditText = '';
        if (keyInfo.credits) {
            creditText = `<span class="api-key-credits">${keyInfo.credits.available} credits</span>`;
        } else {
            creditText = '<span class="api-key-credits">Loading...</span>';
        }
        
        return `
            <div class="api-key-item">
                <span class="api-key-text">${maskedKey}</span>
                ${creditText}
                <span class="api-key-status ${statusClass}">${statusText}</span>
                <button class="btn-remove" onclick="removeApiKey(${index})" title="Remove API Key">🗑️</button>
            </div>
        `;
    }).join('');
}
