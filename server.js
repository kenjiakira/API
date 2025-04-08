const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();


const app = express();
const isProd = process.env.NODE_ENV === 'production';


const API_KEY = process.env.APIKEY;
const MODEL_NAME = 'gemini-2.0-flash';


if (!API_KEY) {
  console.error('ERROR: APIKEY environment variable is required');
  process.exit(1);
}


app.use(cors());


app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));


const genAI = new GoogleGenerativeAI(API_KEY);


const cacheDir = isProd ? '/tmp/cache' : path.join(__dirname, 'cache');
if (!isProd && !fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir);
}


const MODEL_CONFIG = {
  name: MODEL_NAME,
  defaultConfig: {
    temperature: 0.7,
    maxOutputTokens: 1500,
  }
};


const conversations = {};


const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function downloadImage(url) {
  try {
    if (isProd) {
      const response = await axios({
        url,
        method: 'GET',
        responseType: 'arraybuffer',
        timeout: 10000,
      });
      return Buffer.from(response.data, 'binary');
    }
    
    const imagePath = path.join(cacheDir, `img_${Date.now()}.jpg`);
    const writer = fs.createWriteStream(imagePath);
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream',
      timeout: 10000,
    });
    
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(imagePath));
      writer.on('error', reject);
    });
  } catch (error) {
    console.error(`Error downloading image from ${url}:`, error.message);
    throw new Error(`Failed to download image: ${error.message}`);
  }
}

async function fileToGenerativePart(imageData) {
  try {
    const imageBuffer = Buffer.isBuffer(imageData) ? imageData : await fs.readFile(imageData);
    return {
      inlineData: {
        data: imageBuffer.toString('base64'),
        mimeType: 'image/jpeg'
      }
    };
  } catch (error) {
    console.error('Error converting image to generative part:', error);
    throw new Error(`Failed to process image: ${error.message}`);
  }
}

async function retryWithExponentialBackoff(fn, maxRetries = 2, initialDelay = 500) {
  let retries = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (retries >= maxRetries) throw error;
      
      const shouldRetry = error.message?.includes('503') || error.message?.includes('overloaded');
      if (!shouldRetry) throw error;
      
      retries++;
      const delay = initialDelay * Math.pow(1.5, retries);
      await wait(delay);
    }
  }
}

const getConversation = (threadID) => {
  if (!threadID) {
    threadID = 'cv-' + Date.now();
  }
  
  if (!conversations[threadID]) {
    conversations[threadID] = [];
  }
  
  return { threadID, history: conversations[threadID] };
};


app.get('/test', (req, res) => {
  res.json({ 
    status: "ok",
    message: "CV Builder API is running",
    timestamp: new Date().toISOString(),
    model: MODEL_NAME
  });
});

app.post('/api/generate', async (req, res) => {
  try {
    const { 
      prompt, 
      threadID, 
      imageUrl,
      temperature = 0.7,
      maxTokens = 1500,
      clearHistory = false
    } = req.body;
    
    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: "Prompt is required"
      });
    }
    
    const generationConfig = {
      temperature: parseFloat(temperature),
      maxOutputTokens: parseInt(maxTokens)
    };
    
    let imageData = null;
    if (imageUrl) {
      try {
        imageData = await downloadImage(imageUrl);
      } catch (error) {
        return res.status(400).json({
          success: false,
          error: `Image processing failed: ${error.message}`
        });
      }
    }
    
    const model = genAI.getGenerativeModel({ 
      model: MODEL_NAME,
      generationConfig
    });
    
    const { threadID: conversationId, history } = getConversation(threadID);
    
    if (clearHistory) {
      conversations[conversationId] = [];
    }
    
    let result;
    if (imageData) {
      const imagePart = await fileToGenerativePart(imageData);
      result = await retryWithExponentialBackoff(async () => {
        return await model.generateContent([prompt, imagePart]);
      });
    } else {
      result = await retryWithExponentialBackoff(async () => {
        return await model.generateContent(prompt);
      });
    }
    
    const response = result.response.text();
    
    conversations[conversationId].push(`User: ${prompt}`);
    conversations[conversationId].push(`AI: ${response}`);
    
    while (conversations[conversationId].length > 20) {
      conversations[conversationId].shift();
    }
    
    if (!isProd && imageData && fs.existsSync(imageData)) {
      fs.unlinkSync(imageData);
    }
    
    res.json({ 
      success: true, 
      response,
      timestamp: new Date().toISOString(),
      threadID: conversationId
    });
    
  } catch (error) {
    console.error("Generation error:", error);
    
    res.status(500).json({ 
      success: false, 
      error: "Generation failed",
      message: error.message 
    });
  }
});

app.get('/api/conversation/:threadID', (req, res) => {
  const { threadID } = req.params;
  
  if (!conversations[threadID]) {
    return res.status(404).json({
      success: false,
      error: "Conversation not found"
    });
  }
  
  res.json({
    success: true,
    threadID,
    history: conversations[threadID]
  });
});

app.get('/api/prompt-guide', (req, res) => {
  res.json({
    success: true,
    guide: {
      title: "Custom Prompt Engineering Guide",
      description: "This guide helps you create effective prompts for CV generation and improvement",
      promptStructure: {
        systemInstruction: "Start your prompt with a clear system instruction to define the AI's role",
        userQuery: "Then provide your specific request for the CV task",
        examples: "Optionally include examples to guide the output format",
        constraints: "Specify any constraints or requirements for the output"
      },
      templates: {
        cvGeneration: "You are a professional CV assistant. Create a CV for a {role} with {years} years of experience in {industry}.",
        cvImprovement: "You are a professional CV reviewer. Improve the following CV section: {section_content}. Focus on {focus_area}.",
        cvFormatting: "You are a CV formatting expert. Format the following CV data into a professional CV layout: {cv_data}."
      },
      tips: [
        "Be specific about the output format you want",
        "Include examples of preferred style or tone",
        "Specify the target job role and industry for better results",
        "Break complex CV tasks into separate prompts for better results",
        "Use clear section markers (SKILLS:, EXPERIENCE:, etc.) in your prompt"
      ]
    }
  });
});

app.use((err, req, res, next) => {
  console.error("Error:", err);
  
  res.status(500).json({
    success: false,
    error: "Server error",
    message: err.message
  });
});


app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found"
  });
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CV Builder API is running on port ${PORT}`);
  console.log(`Environment: ${isProd ? 'Production' : 'Development'}`);
});

module.exports = app;
