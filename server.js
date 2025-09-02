// server.js - Backend server for video upload and real-time updates

const express = require('express');
const multer = require('multer');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

// Create Express app
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve static files
app.use('/uploads', express.static('uploads')); // Serve uploaded videos

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for video upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        // Create unique filename with timestamp
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB limit
    },
    fileFilter: (req, file, cb) => {
        // Check if file is video
        if (file.mimetype.startsWith('video/')) {
            cb(null, true);
        } else {
            cb(new Error('Only video files are allowed'));
        }
    }
});

// Store video metadata in memory (in production, use a database)
let videos = [];

// WebSocket connections
let clients = new Set();

// WebSocket connection handler
wss.on('connection', (ws) => {
    console.log('New client connected');
    clients.add(ws);
    
    ws.on('close', () => {
        console.log('Client disconnected');
        clients.delete(ws);
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clients.delete(ws);
    });
});

// Function to broadcast to all clients
function broadcast(data) {
    const message = JSON.stringify(data);
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// API endpoint to get all videos
app.get('/api/videos', (req, res) => {
    res.json(videos);
});

// API endpoint to upload video
app.post('/api/upload-video', upload.single('video'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No video file uploaded' });
        }

        // Create video metadata
        const videoData = {
            id: Date.now().toString(),
            name: req.file.originalname,
            filename: req.file.filename,
            url: `/uploads/${req.file.filename}`,
            size: req.file.size,
            mimetype: req.file.mimetype,
            timestamp: req.body.timestamp || new Date().toISOString()
        };

        // Add to videos array (at the beginning for newest first)
        videos.unshift(videoData);

        // Keep only last 20 videos to prevent memory issues
        if (videos.length > 20) {
            const oldVideo = videos.pop();
            // Optionally delete old video file
            const oldFilePath = path.join(__dirname, 'uploads', oldVideo.filename);
            if (fs.existsSync(oldFilePath)) {
                fs.unlinkSync(oldFilePath);
            }
        }

        // Broadcast new video to all connected clients
        broadcast({
            type: 'new_video',
            video: videoData
        });

        console.log(`New video uploaded: ${videoData.name}`);
        res.json({ 
            success: true, 
            message: 'Video uploaded successfully',
            video: videoData 
        });

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Failed to upload video' });
    }
});

// API endpoint to delete video (optional)
app.delete('/api/videos/:id', (req, res) => {
    const videoId = req.params.id;
    const videoIndex = videos.findIndex(v => v.id === videoId);
    
    if (videoIndex === -1) {
        return res.status(404).json({ error: 'Video not found' });
    }

    const video = videos[videoIndex];
    
    // Delete file
    const filePath = path.join(__dirname, 'uploads', video.filename);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }

    // Remove from array
    videos.splice(videoIndex, 1);

    // Broadcast deletion to all clients
    broadcast({
        type: 'video_deleted',
        videoId: videoId
    });

    res.json({ success: true, message: 'Video deleted successfully' });
});

// Error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 100MB.' });
        }
    }
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Access your website at: http://localhost:${PORT}`);
    console.log(`Chat page at: http://localhost:${PORT}/chat`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
    });
});