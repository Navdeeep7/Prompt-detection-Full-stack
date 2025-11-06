import { pipeline, env } from '@xenova/transformers';
import path from 'path';
import { fileURLToPath } from 'url';
import Redis from 'ioredis';

// --- CONFIGURATION ---
const UPSTASH_REDIS_URL = process.env.UPSTASH_REDIS_URL || "rediss://default:ARdsAAImcDIxM2RlOGM0ZWY0MzM0OTZkYjkzYjM4ZGFhMTMwNGY0MnAyNTk5Ng@selected-imp-5996.upstash.io:6379";
const MODEL_FOLDER_NAME = 'modell';

// Path setup for local model
const __dirname = path.dirname(fileURLToPath(import.meta.url));
env.localModelPath = __dirname;
env.allowLocalModels = true;
env.allowRemoteModels = false;

// --- REDIS SETUP ---
// We need two connections: one for blocking pops (BRPOP) and one for publishing results
const redisBlock = new Redis(UPSTASH_REDIS_URL, {
    tls: { rejectUnauthorized: false },
    lazyConnect: true // Wait until specifically asked to connect
});

const redisPub = new Redis(UPSTASH_REDIS_URL, {
    tls: { rejectUnauthorized: false },
    lazyConnect: true
});

// --- MODEL LOADING ---
let classifier = null;

async function loadModel() {
    try {
        console.log(`🔄 Loading model from: ${path.join(env.localModelPath, MODEL_FOLDER_NAME)}`);
        // Removed { quantized: false } based on your previous successful manual test.
        // If you need it back, add it here: pipeline('text-classification', MODEL_FOLDER_NAME, { quantized: false });
        classifier = await pipeline('text-classification', MODEL_FOLDER_NAME,{ quantized: false });
        console.log("✅ Model loaded successfully");
    } catch (error) {
        console.error("❌ FATAL: Could not load model:", error.message);
        process.exit(1);
    }
}

// --- INFERENCE LOGIC ---
const id2label = {
    0: "Benign (0)",
    1: "Low-Medium (1-4)",
    2: "High-Critical (5-10)"
};

async function runInference(systemPrompt, userPrompt) {
    const text = `System: ${systemPrompt}\n\nUser: ${userPrompt}`;
    const output = await classifier(text);
    // Transformers.js returns an array like [{ label: 'LABEL_0', score: 0.99 }]
    return output[0];
}

// --- WORKER LOOP ---
async function startWorker() {
    await loadModel();

    try {
        await redisBlock.connect();
        await redisPub.connect();
        console.log("🚀 Worker started. Waiting for jobs in 'prompt_queue'...");
    } catch (err) {
        console.error("❌ Failed to connect to Redis:", err.message);
        process.exit(1);
    }

    while (true) {
        try {
            // BRPOP waits forever (0) until a job arrives in 'prompt_queue'
            const [queueName, jobDataStr] = await redisBlock.brpop("prompt_queue", 0);
            
            const jobStart = Date.now();
            const jobData = JSON.parse(jobDataStr);
            const { jobId, userId, system_prompt, user_prompt } = jobData;

            console.log(`\n[Job ${jobId}] 📥 Picked up job for user ${userId}`);

            // Run Inference
            const prediction = await runInference(system_prompt, user_prompt);

            // Format Result for Backend
            // We parse the ID from the label (e.g., 'LABEL_0' -> 0) to get the readable name
            const predId = parseInt(prediction.label.match(/\d+/)[0]);
            const result = {
                label: id2label[predId] || prediction.label,
                score: prediction.score,
                raw_label: prediction.label
            };

            // Publish Result back to 'job_results' channel
            const responseMessage = JSON.stringify({
                jobId,
                userId,
                result
            });

            await redisPub.publish("job_results", responseMessage);

            const duration = Date.now() - jobStart;
            console.log(`[Job ${jobId}] ✅ Finished in ${duration}ms - Result: ${result.label} (${(result.score * 100).toFixed(1)}%)`);

        } catch (error) {
            console.error("❌ Error processing job:", error.message);
            // In a real app, you might want to publish an error message back to 'job_results' 
            // so the frontend isn't left hanging.
        }
    }
}

// --- START ---
startWorker();

// Graceful Shutdown
process.on('SIGINT', async () => {
    console.log("\n⚠️ Shutting down worker...");
    await redisBlock.quit();
    await redisPub.quit();
    console.log("✅ Worker stopped");
    process.exit(0);
});