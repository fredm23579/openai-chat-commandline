const readline = require('readline');
const { OpenAI } = require('openai');
require('dotenv').config();

//console.log(process.env.OPENAI_API_KEY);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Assuming the new method is named differently, replace 'createChatCompletion' with the correct method name

async function getResponse(prompt) {
  try {
    const response = await openai.chat.completions.create({
      messages: [{role: "user", content: prompt}],
      model: "gpt-3.5-turbo",
    });
    //console.log(response.choices[0]);  // Correct logging to show the complete choice
    return response.choices[0].message.content; // Adjusted to correctly access the message content
  } catch (error) {
    console.error("Error during API call:", error);
    return "Failed to fetch response from OpenAI.";
  }
}


async function chat() {
  rl.question('You: ', async function (input) {
    const response = await getResponse(input);
    console.log(`AI: ${response}`);
    chat();
  });
}

chat();
