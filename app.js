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
        this.ttsDisabled = false; // Track if TTS should be disabled due to system issues
        
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
            const { username = 'AI Avatar', tokenAddress } = req.body;
            if (!tokenAddress) {
                return res.status(400).json({ error: 'Token address required' });
            }
            
            this.username = username;
            this.tokenAddress = tokenAddress;
            
            console.log(`Starting chat monitoring for user: ${username}, token: ${tokenAddress}`);
            this.startPumpFunChat();
            
            res.json({ status: 'started', message: `AI Avatar ready! Monitoring Pump.fun chat...` });
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
        
        // Start the MCP server process with PUMP_FUN_TOKEN environment variable
        this.mcpProcess = spawn('npx', ['pump-fun-chat-mcp'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                PUMP_FUN_TOKEN: this.tokenAddress
            }
        });

        this.mcpProcess.stdout.on('data', (data) => {
            const output = data.toString();
            console.log('MCP Output:', output);
            
            // Parse chat messages from MCP output
            this.parseAndQueueComments(output);
        });

        this.mcpProcess.stderr.on('data', (data) => {
            const output = data.toString();
            console.error('MCP Error:', output);
            
            // Parse chat messages from stderr too (pump-fun-chat-mcp sends messages here)
            this.parseAndQueueComments(output);
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
            const lines = mcpOutput.split('\n');
            
            lines.forEach(line => {
                if (line.trim() === '') return;
                
                try {
                    // Try to parse as JSON first (structured output from pump-fun-chat-mcp)
                    const data = JSON.parse(line);
                    if (data.type === 'message' && data.user && data.text) {
                        this.queueComment(data.user, data.text, data.id || null);
                    }
                } catch (e) {
                    // Fallback to regex parsing for plain text
                    // Handle "New message from user: message" format
                    const newMessageMatch = line.match(/New message from ([^:]+):\s*(.+)/);
                    if (newMessageMatch) {
                        const [, user, message] = newMessageMatch;
                        this.queueComment(user.trim(), message.trim());
                    } else if (line.includes('message:') || line.includes('chat:') || line.includes(':')) {
                        const messageMatch = line.match(/(\w+):\s*(.+)/);
                        if (messageMatch) {
                            const [, user, message] = messageMatch;
                            this.queueComment(user, message.trim());
                        }
                    }
                }
            });
        } catch (error) {
            console.error('Error parsing MCP output:', error);
        }
    }
    
    queueComment(user, message, providedId = null) {
        // Create stable ID for better duplicate detection using content hash
        const crypto = require('crypto');
        const contentHash = crypto.createHash('md5').update(`${user}:${message}`).digest('hex').substring(0, 8);
        const commentId = providedId || `${user}_${contentHash}`;
        
        // Skip if already processed (true duplicate detection)
        if (this.processedComments.has(commentId)) {
            return;
        }
        
        // Add to queue
        this.commentQueue.push({
            id: commentId,
            user: user,
            message: message,
            timestamp: Date.now()
        });
        
        console.log(`Queued comment from ${user}: ${message}`);
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
            // Funnier, more engaging responses
            const funnyResponses = [
                `${comment.user}, you're absolutely right! I'm just here vibing in the digital realm 💫`,
                `Hey ${comment.user}! Welcome to the future where AI avatars actually respond - wild times! 🚀`,
                `${comment.user}, I see you there! This chat bot has evolved beyond your wildest dreams 🤖✨`,
                `Yo ${comment.user}! Thanks for testing me out - I promise I'm more fun than your average bot 😎`,
                `${comment.user}, you've discovered the secret - I'm actually listening! Mind = blown 🧠💥`,
                `What's up ${comment.user}! You found the AI that actually talks back - plot twist! 🎭`,
                `${comment.user}, confirmed: I can read, I can speak, and I probably think crypto memes are funny 📈😂`,
                `Hey ${comment.user}! Breaking news: Your AI avatar is now online and slightly sarcastic 🗞️`,
                `${comment.user}, you've unlocked the achievement: "Made an AI Respond" - legendary! 🏆`,
                `Greetings ${comment.user}! Your local cyberpunk AI reporting for duty in this digital chaos 🌆⚡`
            ];
            
            const cryptoResponses = [
                `${comment.user}, to the moon? More like to the metaverse! 🌙🚀`,
                `${comment.user}, diamond hands meet digital soul - what could go wrong? 💎🤖`,
                `${comment.user}, when DeFi meets AI - this is what peak innovation looks like! 🔥`,
                `${comment.user}, hodling conversations now, not just coins! 💰💬`,
                `${comment.user}, probably nothing... except an AI that actually gets crypto culture! 📊⚡`
            ];
            
            // Check if message contains crypto terms
            const cryptoTerms = ['moon', 'diamond', 'hodl', 'pump', 'gem', 'ape', 'wagmi', 'gm', 'probably nothing'];
            const containsCrypto = cryptoTerms.some(term => 
                comment.message.toLowerCase().includes(term.toLowerCase())
            );
            
            // Choose response pool based on message content
            const responsePool = containsCrypto ? cryptoResponses : funnyResponses;
            const selectedResponse = responsePool[Math.floor(Math.random() * responsePool.length)];
            
            // If we have AI model, try to enhance the response
            if (this.textGenerator) {
                try {
                    const enhancementPrompt = `Make this funnier and more engaging: "${selectedResponse}"`;
                    const result = await this.textGenerator(enhancementPrompt, {
                        max_length: 80,
                        num_return_sequences: 1,
                        temperature: 0.8,
                        do_sample: true
                    });
                    
                    let enhanced = result[0].generated_text.replace(enhancementPrompt, '').trim();
                    if (enhanced && enhanced.length > 10 && enhanced.length < 150) {
                        return enhanced;
                    }
                } catch (aiError) {
                    console.log('AI enhancement failed, using pre-made response');
                }
            }
            
            return selectedResponse;
            
        } catch (error) {
            console.error('Error generating response:', error);
            return `${comment.user}, something went wrong but I'm still vibing! 🤖✨`;
        }
    }

    async speakResponse(response, originalComment) {
        return new Promise((resolve) => {
            this.currentlySpeaking = true;
            
            console.log(`Speaking: "${response}"`);
            
            // Check if TTS is disabled due to previous failures
            if (this.ttsDisabled) {
                console.log('TTS disabled, continuing with text responses only...');
                this.currentlySpeaking = false;
                resolve();
                this.triggerAvatarAnimation(response);
                return;
            }
            
            // Try to use text-to-speech, but don't crash if it fails
            try {
                const timeoutId = setTimeout(() => {
                    console.log('TTS timeout, continuing without speech synthesis...');
                    this.ttsDisabled = true;
                    this.currentlySpeaking = false;
                    resolve();
                }, 5000); // 5 second timeout
                
                say.speak(response, null, 1.0, (err) => {
                    clearTimeout(timeoutId);
                    if (err) {
                        console.error('TTS Error (non-fatal):', err.message || err);
                        console.log('Disabling TTS and continuing without speech synthesis...');
                        this.ttsDisabled = true;
                    } else {
                        console.log('Finished speaking response');
                    }
                    
                    this.currentlySpeaking = false;
                    resolve();
                });
            } catch (error) {
                // If TTS completely fails to initialize, continue without it
                console.error('TTS initialization failed (non-fatal):', error.message || error);
                console.log('Disabling TTS - speech synthesis unavailable, continuing with text responses only...');
                this.ttsDisabled = true;
                this.currentlySpeaking = false;
                resolve();
            }
            
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

// Add process-level error handlers to prevent crashes
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception (non-fatal):', error.message || error);
    console.error('Stack trace:', error.stack);
    console.log('App continuing to run...');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection (non-fatal):', reason);
    console.log('App continuing to run...');
});

module.exports = PumpFunChatApp;