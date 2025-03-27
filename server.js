const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
require('dotenv').config();

const app = express();
const isProd = process.env.NODE_ENV === 'production';

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Security-Policy', "default-src 'self'; worker-src 'self' blob:;");
    next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const API_KEY = process.env.APIKEY;
const genAI = new GoogleGenerativeAI(API_KEY);

const cacheDir = isProd ? '/tmp/cache' : path.join(__dirname, 'cache');
if (!isProd && !fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir);
}

const conversations = {};
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function downloadImage(url) {
    if (isProd) {
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'arraybuffer'
        });
        return Buffer.from(response.data, 'binary');
    }
    const imagePath = path.join(cacheDir, `img_${Date.now()}.jpg`);
    const writer = fs.createWriteStream(imagePath);
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
    });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(imagePath));
        writer.on('error', reject);
    });
}

async function fileToGenerativePart(imageData) {
    const imageBuffer = Buffer.isBuffer(imageData) ? imageData : await fs.readFile(imageData);
    return {
        inlineData: {
            data: imageBuffer.toString('base64'),
            mimeType: 'image/jpeg'
        }
    };
}

async function retryWithExponentialBackoff(fn, maxRetries = 2, initialDelay = 500) {
    let retries = 0;
    while (retries < maxRetries) {
        try {
            return await fn();
        } catch (error) {
            if (error.message?.includes('503') || error.message?.includes('overloaded')) {
                retries++;
                if (retries === maxRetries) throw error;
                await wait(initialDelay * Math.pow(1.5, retries));
                continue;
            }
            throw error;
        }
    }
}

app.get('/test', (req, res) => {
    res.json({ 
        status: "ok",
        message: "API is running",
        timestamp: new Date().toISOString()
    });
});

app.post('/api/generate', async (req, res) => {
    try {
        const { prompt, threadID, imageUrl } = req.body;
        let imageData = null;

        if (imageUrl) {
            imageData = await downloadImage(imageUrl);
        }

        const model = genAI.getGenerativeModel({ 
            model: imageData ? "gemini-1.5-pro" : "gemini-1.5-flash",
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 1000,
            }
        });

        const history = conversations[threadID] || [];
        const context = history.join("\n");

        const systemPrompt = `Bạn là AI PIXEL BOT, một AI với kiến thức uyên bác và khả năng tư duy sắc bén:
`;

        let result;
        if (imageData) {
            const imagePart = await fileToGenerativePart(imageData);
            result = await retryWithExponentialBackoff(async () => {
                return await model.generateContent([systemPrompt, imagePart, prompt || "Hãy mô tả hình ảnh này"]);
            });
        } else {
            const fullPrompt = `${systemPrompt}\n${context}\nUser: ${prompt}\nPIXEL:`;
            result = await retryWithExponentialBackoff(async () => {
                return await model.generateContent(fullPrompt);
            });
        }

        const response = result.response.text();

        if (!conversations[threadID]) conversations[threadID] = [];
        conversations[threadID].push(`User: ${prompt}`);
        conversations[threadID].push(`PIXEL: ${response}`);

        while (conversations[threadID].length > 100) {
            conversations[threadID].shift();
        }

        if (!isProd && imageData && fs.existsSync(imageData)) {
            fs.unlinkSync(imageData);
        }

        res.json({ 
            success: true, 
            response,
            timestamp: new Date().toISOString(),
            threadID,
            historyLength: conversations[threadID].length
        });

    } catch (error) {
        console.error("Generation error:", error);
        if (error.message?.includes('503') || error.message?.includes('overloaded')) {
            return res.status(503).json({
                success: false,
                error: "Service temporarily overloaded. Please try again."
            });
        }
        res.status(500).json({ 
            success: false, 
            error: "Internal server error",
            details: error.message 
        });
    }
});

app.get('/api/prompt=:prompt', async (req, res) => {
    const threadID = 'default';
    req.body = { prompt: req.params.prompt, threadID };
    await app.post('/api/generate', req, res);
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        error: 'Something broke!'
    });
});

app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Route not found'
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
