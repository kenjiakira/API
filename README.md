# CV Builder API with Custom Prompt Support

This API allows users to generate CV content by providing their own custom prompts to the Gemini AI model.

## Key Features

- Custom prompt support: You control exactly what to ask the AI
- Image support: Attach images to your prompts
- Conversation history: Continue conversations with thread IDs
- Customizable parameters: Adjust temperature and token limits

## API Endpoints

### Generate Content
```
POST /api/generate
```

Request body:
```json
{
  "prompt": "Your custom prompt here",
  "threadID": "optional-thread-id",
  "imageUrl": "optional-image-url",
  "temperature": 0.7,
  "maxTokens": 1500,
  "clearHistory": false
}
```

### Get Conversation History
```
GET /api/conversation/:threadID
```

### Get Prompt Engineering Guide
```
GET /api/prompt-guide
```

## Prompt Engineering Guide

### Basic Structure of an Effective Prompt

1. **Role Definition**: Start by defining the AI's role
2. **Task Description**: Clearly describe what you want
3. **Context**: Provide relevant background information
4. **Output Format**: Specify how you want the response formatted
5. **Constraints**: Include any limitations or requirements

### CV Generation Templates

#### Basic CV Creation
```
You are a professional CV writer. Create a comprehensive CV for a {position} with {years} years of experience in {industry}. Include these sections: Summary, Work Experience, Education, Skills, and Achievements. Format the CV professionally.
```

#### CV Improvement
```
You are a CV optimization expert. Review and improve the following CV content:
{paste CV content here}

Focus on these aspects:
1. Strengthening impact statements
2. Using more action verbs
3. Quantifying achievements
4. Removing unnecessary information
5. Tailoring the content to a {target position} role
```

#### CV Section Enhancement
```
You are a CV section specialist. Rewrite and enhance the following {section_name} section to make it more impactful and professional:
{paste section content}

Use bullet points, focus on achievements rather than responsibilities, and quantify results where possible.
```

### Advanced Tips

1. **Be Specific**: Instead of "Improve my CV", try "Enhance my CV summary to highlight leadership skills for a senior management position in fintech"

2. **Provide Examples**: Include examples of the style or format you prefer

3. **Use Step-by-Step Instructions**: Break down complex requests into clear steps

4. **Specify Output Format**: Request specific formatting like bullet points, paragraphs, or sections

5. **Iterate**: Start with a basic prompt, then refine based on the response

## Sample Use Cases

### Creating a Technical CV
```
You are a technical CV specialist. Create a detailed CV for a Full Stack Developer with 5 years of experience in JavaScript, React, Node.js, and MongoDB. Include sections for Technical Skills (categorized by frontend, backend, and DevOps), Professional Experience, Projects (with GitHub links placeholder), Education, and Certifications. Format the content professionally with bullet points for experiences and achievements. Focus on technical accomplishments and quantify impact where possible.
```

### Enhancing an Executive Summary
```
You are an executive CV expert. Rewrite the following executive summary to make it more impactful for a Chief Technology Officer position:

{paste summary}

Focus on strategic leadership, innovation, digital transformation, and business results. Keep it under 4-5 sentences but make each one powerful and achievement-oriented.
```

### Creating a Career Change CV
```
You are a career transition specialist. Create a CV for someone transitioning from a 10-year teaching career to an entry-level UX/UI design role. Highlight transferable skills like communication, project management, and creativity. Include relevant education (Bachelor's in Education) and a recently completed UX Design certification. Format the CV to emphasize transferable skills and downplay the career change. Include a compelling summary that explains the transition positively.
```

## Best Practices

1. Start with a clear role definition for the AI
2. Be specific about the exact CV content you need
3. Provide context about the target job and industry
4. Specify any formatting requirements
5. Include examples if you have specific preferences
6. Review and iterate with follow-up prompts

## Technical Notes

- Maximum tokens per request: 1500
- Thread IDs are preserved for 24 hours
- Image uploads support JPEG, PNG formats up to 10MB