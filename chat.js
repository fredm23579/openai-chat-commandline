const readline = require('readline');
const { OpenAI } = require('openai');
require('dotenv').config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const MODELS = [
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'o3-mini'
];

const conversationHistory = [];
let selectedModel = MODELS[0];

async function getResponse(userInput) {
  conversationHistory.push({ role: 'user', content: userInput });
  try {
    const response = await openai.chat.completions.create({
      model: selectedModel,
      messages: conversationHistory,
    });
    const reply = response.choices[0].message.content;
    conversationHistory.push({ role: 'assistant', content: reply });
    return reply;
  } catch (error) {
    console.error('Error during API call:', error);
    conversationHistory.pop(); // remove failed user message
    return 'Failed to fetch response from OpenAI.';
  }
}

function selectModel() {
  return new Promise((resolve) => {
    console.log('\nSelect a model:');
    MODELS.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
    console.log(`  (default: ${MODELS[0]})\n`);
    rl.question('Enter number [1]: ', (input) => {
      const idx = parseInt(input) - 1;
      selectedModel = MODELS[idx] ?? MODELS[0];
      console.log(`\nUsing model: ${selectedModel}`);
      console.log('Commands: "exit" or "quit" to stop, "/clear" to reset history\n');
      resolve();
    });
  });
}

async function chat() {
  rl.question('You: ', async (input) => {
    const trimmed = input.trim();
    if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
      console.log('Goodbye!');
      rl.close();
      return;
    }
    if (trimmed === '/clear') {
      conversationHistory.length = 0;
      console.log('Conversation history cleared.\n');
      return chat();
    }
    if (!trimmed) return chat();
    const response = await getResponse(trimmed);
    console.log(`\nAI: ${response}\n`);
    chat();
  });
}

selectModel().then(chat);
```

---

## File 2: `package.json`

Go to: `https://github.com/fredm23579/openai-chat-commandline/blob/main/package.json` → click ✏️

Change **only this one line** (line 3):
```
"openai": "^4.33.0",
```
→
```
"openai": "^4.85.0",
