// server.js - Backend server with Cloudinary for video upload

const express = require('express');
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const cors = require('cors');

// --- Cloudinary Configuration ---
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// --- Multer Configuration for Cloudinary ---
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'harsh-resource-hub-videos',
    resource_type: 'video',
    allowed_formats: ['mp4', 'mov', 'avi', 'mkv'],
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
});

// --- Express App Setup ---
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- WebSocket Setup ---
const clients = new Set();
wss.on('connection', (ws) => {
  console.log('New client connected');
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clients.delete(ws);
  });
});

function broadcast(data) {
  const message = JSON.stringify(data);
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// --- API Routes ---

// API endpoint to get all recent videos from Cloudinary
app.get('/api/videos', async (req, res) => {
  try {
    const result = await cloudinary.search
      .expression('resource_type:video AND folder=harsh-resource-hub-videos')
      .sort_by('created_at', 'desc')
      .max_results(30)
      .execute();

    const videos = result.resources.map(v => ({
      id: v.public_id,
      name: v.filename,
      url: v.secure_url,
      size: v.bytes,
      mimetype: `video/${v.format}`,
      timestamp: v.created_at,
    }));

    res.json(videos);
  } catch (error) {
    console.error('Error fetching videos from Cloudinary:', error);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

// API endpoint to upload a new video
app.post('/api/upload-video', upload.single('video'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    const videoData = {
      id: req.file.filename, // Cloudinary public_id
      name: req.file.originalname,
      url: req.file.path, // This is the Cloudinary URL
      size: req.file.size,
      mimetype: req.file.mimetype,
      timestamp: new Date().toISOString(),
    };

    broadcast({
      type: 'new_video',
      video: videoData,
    });

    console.log(`New video uploaded to Cloudinary: ${videoData.name}`);
    res.json({
      success: true,
      message: 'Video uploaded successfully',
      video: videoData,
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload video' });
  }
});

// API endpoint to delete a video
app.delete('/api/videos/:id(*)', async (req, res) => {
  try {
    const videoId = req.params.id;
    console.log(`Attempting to delete video with public_id: ${videoId}`);

    const result = await cloudinary.uploader.destroy(videoId, { resource_type: 'video' });

    if (result.result === 'ok' || result.result === 'not found') {
      broadcast({
        type: 'video_deleted',
        videoId: videoId,
      });
      console.log(`Successfully deleted or did not find video: ${videoId}`);
      res.json({ success: true, message: 'Video deleted successfully' });
    } else {
      throw new Error(result.result);
    }

  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete video' });
  }
});

// --- Server Initialization ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});