# PazUp - Video Upscale Using Topaz API

A powerful Electron application for upscaling videos using the Topaz Labs Video AI API.

## Features

- 🎬 **Multiple Video Format Support** - MP4, AVI, MOV, MKV, WMV, FLV, WebM, M4V
- 🚀 **Batch Processing** - Process multiple videos simultaneously
- 🎨 **Beautiful Dark UI** - Modern purple/black themed interface
- ⚙️ **Multiple AI Models** - Support for all Topaz Video AI models
- 📊 **Real-time Progress** - Live processing status and progress tracking
- 🔄 **Smart Retry System** - Automatic retry with exponential backoff
- 💾 **Settings Persistence** - Remembers your preferences between sessions
- 🎯 **Resolution Options** - Full HD, 2K, and 4K output options
- 🔇 **Audio Control** - Option to remove audio from processed videos
- 👥 **Concurrent Processing** - Configurable worker threads (1-10)

## Prerequisites

1. **Node.js** (v14 or higher)
2. **Topaz Labs API Key** - Get one from [Topaz Labs Developer Portal](https://developer.topazlabs.com/)
3. **FFmpeg** (optional but recommended) - For advanced video analysis and audio removal

### Installing FFmpeg (Optional)

**Windows:**
1. Download FFmpeg from [https://ffmpeg.org/download.html](https://ffmpeg.org/download.html)
2. Extract to a folder (e.g., `C:\ffmpeg`)
3. Add `C:\ffmpeg\bin` to your system PATH

**macOS:**
```bash
brew install ffmpeg
```

**Linux:**
```bash
sudo apt update
sudo apt install ffmpeg
```

## Installation

1. **Clone or download** this repository
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Create application icon** (optional):
   ```bash
   node create-icon.js
   ```

## Usage

### Development Mode
```bash
npm start
```

### Building for Production
```bash
npm run build
```

### Creating Distributable
```bash
npm run dist
```

## Configuration

### Basic Setup
1. Launch the application
2. Enter your Topaz Labs API key and click "Save"
3. Select your input folder containing video files
4. Select your output folder for processed videos
5. Choose your preferred AI model and resolution
6. Click "Start Upscale" to begin processing

### Available AI Models

| Model | Best For | Description |
|-------|----------|-------------|
| **Proteus (prob-4)** | General use | Recommended for most videos |
| **Artemis (ahq-12)** | High quality | Best for denoise and sharpen |
| **Nyx (nyx-3)** | Noise reduction | Dedicated denoising |
| **Rhea (rhea-1)** | 4x upscaling | Advanced 4x upscaling |
| **Gaia (ghq-5)** | AI/CG content | Best for GenAI/CG/Animation |
| **Apollo (apo-8)** | Slow motion | Up to 8x slowmo enhancement |
| **Chronos (chr-2)** | Frame rate | General framerate conversion |

### Resolution Options
- **Full HD**: 1920x1080
- **2K**: 2560x1440  
- **4K**: 3840x2160

### Advanced Features

#### Concurrent Processing
- Enable "Simultaneous Processing" to process multiple videos at once
- Adjust worker count (1-10) based on your system capabilities and API limits
- Higher worker counts require more system resources and API quota

#### Smart Retry System
- Automatically retries failed uploads/downloads up to 3 times
- Uses exponential backoff to handle temporary network issues
- Detailed error reporting and logging

#### Audio Handling
- Option to remove audio from processed videos
- Uses FFmpeg for local audio removal if API doesn't support it
- Preserves original video quality during audio removal

## File Structure