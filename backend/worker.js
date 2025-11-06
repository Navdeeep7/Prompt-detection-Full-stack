import { pipeline, env } from '@xenova/transformers';
import path from 'path';
import { fileURLToPath } from 'url';
import Redis from 'ioredis';
const UPSTASH_REDIS_URL = process.env.UPSTASH_REDIS_URL || "rediss://default:ARdsAAImcDIxM2RlOGM0ZWY0MzM0OTZkYjkzYjM4ZGFhMTMwNGY0MnAyNTk5Ng@selected-imp-5996.upstash.io:6379";
const MODEL_FOLDER_NAME = 'modell';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
env.localModelPath = __dirname;
env.allowLocalModels = true;
env.allowRemoteModels = false;

const redisBlock = new Redis(UPSTASH_REDIS_URL, {
    tls: { rejectUnauthorized: false },
    lazyConnect: true 
});

const redisPub = new Redis(UPSTASH_REDIS_URL, {
    tls: { rejectUnauthorized: false },
    lazyConnect: true
});

let classifier = null;

async function loadModel() {
    try {
        console.log(`🔄 Loading model from: ${path.join(env.localModelPath, MODEL_FOLDER_NAME)}`);
        classifier = await pipeline('text-classification', MODEL_FOLDER_NAME,{ quantized: false });
        console.log("✅ Model loaded successfully");
    } catch (error) {
        console.error("❌ FATAL: Could not load model:", error.message);
        process.exit(1);
    }
}

const id2label = {
    0: "Benign (0)",
    1: "Low-Medium (1-4)",
    2: "High-Critical (5-10)"
};

async function runInference(systemPrompt, userPrompt) {
    const text = `System: ${systemPrompt}\n\nUser: ${userPrompt}`;
    const output = await classifier(text);
    return output[0];
}

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
            const [queueName, jobDataStr] = await redisBlock.brpop("prompt_queue", 0);
            
            const jobStart = Date.now();
            const jobData = JSON.parse(jobDataStr);
            const { jobId, userId, system_prompt, user_prompt } = jobData;

            console.log(`\n[Job ${jobId}] 📥 Picked up job for user ${userId}`);

            const prediction = await runInference(system_prompt, user_prompt);

            const predId = parseInt(prediction.label.match(/\d+/)[0]);
            const result = {
                label: id2label[predId] || prediction.label,
                score: prediction.score,
                raw_label: prediction.label
            };

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
           
        }
    }
}

startWorker();
process.on('SIGINT', async () => {
    console.log("\n⚠️ Shutting down worker...");
    await redisBlock.quit();
    await redisPub.quit();
    console.log("✅ Worker stopped");
    process.exit(0);
});