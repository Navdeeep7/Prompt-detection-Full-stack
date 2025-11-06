import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import Redis from "ioredis";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";

const UPSTASH_REDIS_URL = process.env.UPSTASH_REDIS_URL || "rediss://default:ARdsAAImcDIxM2RlOGM0ZWY0MzM0OTZkYjkzYjM4ZGFhMTMwNGY0MnAyNTk5Ng@selected-imp-5996.upstash.io:6379";
const PORT = process.env.PORT || 3001;
// const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const FRONTEND_URL = process.env.FRONTEND_URL || "https://prompt-detection-full-stack.vercel.app";


const app = express();
app.use(cors()); 
app.use(express.json());

const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL, 
    methods: ["GET", "POST"],
  },
});

const redisPub = new Redis(UPSTASH_REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  tls: {
    rejectUnauthorized: false
  }
});

const redisSub = new Redis(UPSTASH_REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  tls: {
    rejectUnauthorized: false
  }
});

redisPub.on('connect', () => console.log('📡 Redis publisher connected'));
redisPub.on('error', (err) => console.error('❌ Redis publisher error:', err.message));

redisSub.on('connect', () => console.log('📡 Redis subscriber connected'));
redisSub.on('error', (err) => console.error('❌ Redis subscriber error:', err.message));

const userSockets = new Map();

redisSub.subscribe("job_results", (err, count) => {
  if (err) {
    console.error("Failed to subscribe to 'job_results'", err);
    return;
  }
  console.log(`✅ Subscribed to ${count} channel(s). Listening for results...`);
});

redisSub.on("message", (channel, message) => {
  if (channel === "job_results") {
    try {
      const { jobId, userId, result } = JSON.parse(message);
      
      console.log(`[Job ${jobId}]: Received result for user ${userId} - Label: ${result.label}, Score: ${result.score.toFixed(4)}`);

      const socket = userSockets.get(userId);
      if (socket) {
        socket.emit("classification_result", { jobId, result });
      } else {
        console.log(`[Job ${jobId}]: User ${userId} not connected. Discarding result.`);
      }
    } catch (error) {
      console.error('Error processing result message:', error.message);
    }
  }
});

io.on("connection", (socket) => {
  const userId = socket.id;
  userSockets.set(userId, socket);
  console.log(`👤 User connected: ${userId} (Total: ${userSockets.size})`);

  socket.on("classify_prompt", async (data) => {
    const jobId = uuidv4();
    const { system_prompt, user_prompt } = data;

    console.log(`[Job ${jobId}]: Received job from user ${userId}`);
    console.log(`  System: ${system_prompt.substring(0, 50)}...`);
    console.log(`  User: ${user_prompt.substring(0, 50)}...`);

    try {
      const jobData = JSON.stringify({
        jobId,
        userId,
        system_prompt,
        user_prompt,
      });

      await redisPub.lpush("prompt_queue", jobData);
      console.log(`[Job ${jobId}]: Queued successfully`);

      socket.emit("job_queued", { jobId });
    } catch (error) {
      console.error(`[Job ${jobId}]: Failed to queue job:`, error.message);
      socket.emit("job_error", { jobId, error: "Failed to queue job" });
    }
  });

  socket.on("disconnect", () => {
    userSockets.delete(userId);
    console.log(`👋 User disconnected: ${userId} (Total: ${userSockets.size})`);
  });
});

app.get("/health", async (req, res) => {
  try {
    await redisPub.ping();
    res.json({ 
      status: "ok", 
      redis: "connected",
      connections: userSockets.size,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({ 
      status: "error", 
      redis: "disconnected",
      error: error.message 
    });
  }
});

app.post("/api/classify", async (req, res) => {
  try {
    const { system_prompt, user_prompt, userId } = req.body;
    
    if (!system_prompt || !user_prompt) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const jobId = uuidv4();
    const jobData = JSON.stringify({
      jobId,
      userId: userId || "api-user",
      system_prompt,
      user_prompt,
    });

    await redisPub.lpush("prompt_queue", jobData);
    
    res.json({ 
      success: true, 
      jobId,
      message: "Job queued successfully" 
    });
  } catch (error) {
    console.error("API error:", error);
    res.status(500).json({ error: error.message });
  }
});


const shutdown = async () => {
  console.log("\n⚠️ Shutting down gracefully...");
  
  io.close(() => {
    console.log("✅ Socket.IO closed");
  });
  
  await redisPub.quit();
  await redisSub.quit();
  console.log("✅ Redis connections closed");
  
  server.close(() => {
    console.log("✅ HTTP server closed");
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, () => {
  console.log(`🚀 Main backend server running on http://localhost:${PORT}`);
  console.log(`🔗 Redis: ${UPSTASH_REDIS_URL.split('@')[1]}`);
  console.log(`🌐 CORS enabled for: ${FRONTEND_URL}`);
});