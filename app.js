const express = require('express');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const say = require('say');
const { pipeline } = require('@xenova/transformers');

class PumpFunChatApp {
    constructor() {
        this.app = express();
        this.port = 5000;
        this.commentQueue = [];
        this.processedComments = new Set(); // Track processed comments to avoid duplicates
        this.isProcessing = false;
        this.username = null;
        this.tokenAddress = null;
        this.mcpProcess = null;
        this.textGenerator = null;
        this.currentlySpeaking = false;
        
        this.setupExpress();
    }

    async initialize() {
        await this.initializeAI();
        return this;
    }

    setupExpress() {
        this.app.use(express.static('public'));
        this.app.use(express.json());
        
        // Serve the main HTML page
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });
        
        // API endpoint to start chat monitoring
        this.app.post('/start', (req, res) => {
            const { username, tokenAddress } = req.body;
            if (!username || !tokenAddress) {
                return res.status(400).json({ error: 'Username and token address required' });
            }
            
            this.username = username;
            this.tokenAddress = tokenAddress;
            
            console.log(`Starting chat monitoring for user: ${username}, token: ${tokenAddress}`);
            this.startPumpFunChat();
            
            res.json({ status: 'started', message: `Hi ${username}! Starting to monitor Pump.fun chat...` });
        });
        
        // API endpoint to get queue status
        this.app.get('/status', (req, res) => {
            res.json({
                queueLength: this.commentQueue.length,
                isProcessing: this.isProcessing,
                currentlySpeaking: this.currentlySpeaking,
                processedCount: this.processedComments.size
            });
        });
    }

    async initializeAI() {
        try {
            console.log('Initializing local AI model...');
            // Use a small, fast model for quick responses
            this.textGenerator = await pipeline('text-generation', 'Xenova/gpt2');
            console.log('AI model loaded successfully!');
        } catch (error) {
            console.error('Error loading AI model:', error);
            // Fallback to simple responses if AI fails
            this.textGenerator = null;
        }
    }

    startPumpFunChat() {
        if (this.mcpProcess) {
            this.mcpProcess.kill();
        }

        console.log(`Starting pump-fun-chat-mcp for token: ${this.tokenAddress}`);
        
        // Start the MCP server process
        this.mcpProcess = spawn('npx', ['pump-fun-chat-mcp', this.tokenAddress], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        this.mcpProcess.stdout.on('data', (data) => {
            const output = data.toString();
            console.log('MCP Output:', output);
            
            // Parse chat messages from MCP output
            this.parseAndQueueComments(output);
        });

        this.mcpProcess.stderr.on('data', (data) => {
            console.error('MCP Error:', data.toString());
        });

        this.mcpProcess.on('close', (code) => {
            console.log(`MCP process closed with code ${code}`);
            // Auto-restart if it crashes
            setTimeout(() => {
                if (this.tokenAddress) {
                    console.log('Restarting MCP process...');
                    this.startPumpFunChat();
                }
            }, 5000);
        });

        // Start processing queue
        this.startQueueProcessor();
    }

    parseAndQueueComments(mcpOutput) {
        try {
            // Parse MCP output to extract chat messages
            // This is a simplified parser - real implementation would depend on MCP format
            const lines = mcpOutput.split('\n');
            
            lines.forEach(line => {
                if (line.includes('message:') || line.includes('chat:')) {
                    // Extract username and message from the line
                    const messageMatch = line.match(/(\w+):\s*(.+)/);
                    if (messageMatch) {
                        const [, user, message] = messageMatch;
                        const commentId = `${user}_${message}_${Date.now()}`;
                        
                        // Check for duplicates
                        if (!this.processedComments.has(commentId)) {
                            this.commentQueue.push({
                                id: commentId,
                                user: user,
                                message: message.trim(),
                                timestamp: Date.now()
                            });
                            console.log(`Queued comment from ${user}: ${message.trim()}`);
                        }
                    }
                }
            });
        } catch (error) {
            console.error('Error parsing MCP output:', error);
        }
    }

    startQueueProcessor() {
        setInterval(() => {
            if (!this.isProcessing && this.commentQueue.length > 0) {
                this.processNextComment();
            }
        }, 1000); // Check queue every second
    }

    async processNextComment() {
        if (this.isProcessing || this.commentQueue.length === 0) return;
        
        this.isProcessing = true;
        const comment = this.commentQueue.shift();
        
        try {
            console.log(`Processing comment from ${comment.user}: ${comment.message}`);
            
            // Mark as processed
            this.processedComments.add(comment.id);
            
            // Generate AI response
            const response = await this.generateResponse(comment);
            
            // Convert to speech and trigger avatar animation
            await this.speakResponse(response, comment);
            
        } catch (error) {
            console.error('Error processing comment:', error);
        } finally {
            this.isProcessing = false;
        }
    }

    async generateResponse(comment) {
        try {
            if (this.textGenerator) {
                // Create a prompt for the AI
                const prompt = `User ${comment.user} says: "${comment.message}". Reply briefly and friendly:`;
                
                const result = await this.textGenerator(prompt, {
                    max_length: 50,
                    num_return_sequences: 1,
                    temperature: 0.7,
                    do_sample: true
                });
                
                // Extract just the generated part after the prompt
                let response = result[0].generated_text.replace(prompt, '').trim();
                
                // Clean up and limit response length
                response = response.split('.')[0] + '.';
                if (response.length > 100) {
                    response = response.substring(0, 97) + '...';
                }
                
                return response || `Thanks for the message, ${comment.user}!`;
            } else {
                // Fallback responses if AI model fails
                const fallbackResponses = [
                    `Thanks for sharing, ${comment.user}!`,
                    `Interesting point, ${comment.user}!`,
                    `I hear you, ${comment.user}!`,
                    `Cool message, ${comment.user}!`,
                    `Nice one, ${comment.user}!`
                ];
                return fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)];
            }
        } catch (error) {
            console.error('Error generating response:', error);
            return `Thanks for the comment, ${comment.user}!`;
        }
    }

    async speakResponse(response, originalComment) {
        return new Promise((resolve) => {
            this.currentlySpeaking = true;
            
            console.log(`Speaking: "${response}"`);
            
            // Use the 'say' library for text-to-speech
            say.speak(response, null, 1.0, (err) => {
                if (err) {
                    console.error('TTS Error:', err);
                } else {
                    console.log('Finished speaking response');
                }
                
                this.currentlySpeaking = false;
                resolve();
            });
            
            // Also trigger avatar animation via WebSocket (if connected)
            this.triggerAvatarAnimation(response);
        });
    }

    triggerAvatarAnimation(text) {
        // This will be implemented with WebSocket communication to the frontend
        // For now, just log the animation trigger
        console.log(`Triggering avatar animation for: "${text}"`);
    }

    start() {
        this.app.listen(this.port, '0.0.0.0', () => {
            console.log(`🎤 Pump.fun Chat Response App running on http://0.0.0.0:${this.port}`);
            console.log(`📝 Ready to monitor Pump.fun chats and generate AI responses!`);
            
            if (this.username) {
                console.log(`👋 Hi ${this.username}! Waiting for token address to start monitoring...`);
            }
        });
    }
}

// Create and start the application
async function startApp() {
    const app = new PumpFunChatApp();
    await app.initialize();
    app.start();
}

startApp().catch(console.error);

module.exports = PumpFunChatApp;