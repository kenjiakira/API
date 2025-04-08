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
const DEFAULT_SYSTEM_PROMPT = "You are a professional CV assistant that helps create and format excellent resumes and CVs.";


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

app.post('/api/generate-cv', async (req, res) => {
  try {
    const { 
      prompt, 
      threadID, 
      imageUrl,
      cvData,
      customPromptTemplate,
      temperature = 0.7,
      maxTokens = 1500,
      systemPrompt = DEFAULT_SYSTEM_PROMPT,
      clearHistory = false
    } = req.body;
    
    if (!prompt && !cvData) {
      return res.status(400).json({
        success: false,
        error: "Either prompt or cvData is required"
      });
    }
    
    
    const generationConfig = {
      ...MODEL_CONFIG.defaultConfig,
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
    
    const context = history.join("\n");
    
    
    let result;
    if (imageData) {
      const imagePart = await fileToGenerativePart(imageData);
      result = await retryWithExponentialBackoff(async () => {
        return await model.generateContent([systemPrompt, imagePart, prompt || "Parse this CV/resume image"]);
      });
    } else {
      let fullPrompt;
      
      
      const userInput = cvData 
        ? `Please format and improve this CV/resume data:\n${JSON.stringify(cvData)}\n${prompt || ""}` 
        : prompt;
      
      if (customPromptTemplate) {
        fullPrompt = customPromptTemplate
          .replace('{context}', context)
          .replace('{system_prompt}', systemPrompt)
          .replace('{prompt}', userInput);
      } else {
        fullPrompt = `${systemPrompt}\n${context}\nUser: ${userInput}\nResponse:`;
      }
      
      result = await retryWithExponentialBackoff(async () => {
        return await model.generateContent(fullPrompt);
      });
    }
    
    const response = result.response.text();
    
    
    conversations[conversationId].push(`User: ${prompt || JSON.stringify(cvData)}`);
    conversations[conversationId].push(`CV Assistant: ${response}`);
    
    
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
    console.error("CV generation error:", error);
    
    res.status(500).json({ 
      success: false, 
      error: "Generation failed",
      message: error.message 
    });
  }
});

app.post('/api/format-cv', async (req, res) => {
  try {
    const { cvData, style = "professional" } = req.body;
    
    if (!cvData) {
      return res.status(400).json({
        success: false,
        error: "CV data is required"
      });
    }
    
    
    const model = genAI.getGenerativeModel({ 
      model: MODEL_NAME,
      generationConfig: MODEL_CONFIG.defaultConfig
    });
    
    const prompt = `I need to format a CV/resume in a ${style} style. Here's the data:\n${JSON.stringify(cvData)}\n\nPlease provide formatting suggestions and improvements to make this CV stand out.`;
    
    const result = await retryWithExponentialBackoff(async () => {
      return await model.generateContent(`${DEFAULT_SYSTEM_PROMPT}\n\nUser: ${prompt}\nResponse:`);
    });
    
    const response = result.response.text();
    
    res.json({ 
      success: true, 
      response,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error("CV formatting error:", error);
    
    res.status(500).json({ 
      success: false, 
      error: "Formatting failed",
      message: error.message 
    });
  }
});

app.post('/api/improve-cv', async (req, res) => {
  try {
    const { cvSection, currentContent, jobTitle, industry } = req.body;
    
    if (!cvSection || !currentContent) {
      return res.status(400).json({
        success: false,
        error: "CV section and current content are required"
      });
    }
    
    
    const model = genAI.getGenerativeModel({ 
      model: MODEL_NAME,
      generationConfig: {
        ...MODEL_CONFIG.defaultConfig,
        temperature: 0.8 
      }
    });
    
    const prompt = `I need to improve the "${cvSection}" section of my CV/resume.
Current content: "${currentContent}"
${jobTitle ? `Target job title: ${jobTitle}` : ''}
${industry ? `Industry: ${industry}` : ''}

Please provide an improved version that is more impactful and professional.`;
    
    const result = await retryWithExponentialBackoff(async () => {
      return await model.generateContent(`${DEFAULT_SYSTEM_PROMPT}\n\nUser: ${prompt}\nResponse:`);
    });
    
    const response = result.response.text();
    
    res.json({ 
      success: true, 
      response,
      timestamp: new Date().toISOString(),
      section: cvSection
    });
    
  } catch (error) {
    console.error("CV improvement error:", error);
    
    res.status(500).json({ 
      success: false, 
      error: "Improvement failed",
      message: error.message 
    });
  }
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
