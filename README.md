# ChatGPT Command-Line Chat Application

## Description
A command-line chat application powered by OpenAI's latest models (gpt-4o, gpt-4.1, o3-mini and more), with multi-turn conversation memory. Runs in any terminal.

## Features
- Model selection at startup (gpt-4o, gpt-4o-mini, gpt-4.1, gpt-4.1-mini, gpt-4.1-nano, o3-mini)
- Multi-turn conversation history (AI remembers context within a session)
- `/clear` command to reset conversation history
- `exit` or `quit` to stop the session
- Simple and intuitive text-based chat interface.
- Leverages the powerful GPT-3.5 Turbo model for generating responses.
- Runs on any command-line interface across different operating systems.

## Prerequisites

Before you begin, ensure you have met the following requirements:
- Node.js (v14.0 or newer recommended)
- npm (Node Package Manager)
- An API key from OpenAI (see [OpenAI API](https://platform.openai.com/signup))

## Installation

To install ChatGPT Command-Line Chat, follow these steps:

```bash
git clone https://github.com/yourusername/openai-chat-commandline.git
cd openai-chat-commandline
npm install
```
## Configuration
 Create a ```.env``` file in the root directory.
 Add your OpenAI API key to the ```.env``` file:
```bash
 OPENAI_API_KEY=Your-OpenAI-API-Key-Here
```
## Usage
 To start the chat application, run the following command in your terminal:

```bash
 node chat.js
```
 You will be prompted to enter your questions or statements. After each input, the application will generate and display a response from ChatGPT.

## Contributing
 Contributions to the ChatGPT Command-Line Chat application are welcome. Please adhere to this project's code of conduct while participating.

## License
 This project is licensed under the MIT License - see the LICENSE file for details.

## Contact
 If you have any questions or want to contact me, please email me at motta@g.ucla.edu or file an issue here on GitHub.
