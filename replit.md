# Pump.fun Chat Response Bot

## Overview

This is a real-time chat monitoring and AI response bot for Pump.fun token communities. The application monitors live chat streams for specific tokens, processes incoming messages using AI transformers, and provides automated responses with text-to-speech capabilities. It combines web scraping, natural language processing, and real-time communication to create an interactive chat bot experience for cryptocurrency token communities.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Static HTML/CSS/JavaScript**: Simple single-page application served from the `public` directory
- **WebSocket Client**: Real-time communication with the backend for live chat updates
- **Responsive Design**: Modern CSS with gradient backgrounds and responsive layout

### Backend Architecture
- **Express.js Server**: RESTful API server handling HTTP requests and serving static files
- **WebSocket Integration**: Real-time bidirectional communication using the `ws` library
- **Child Process Management**: Spawns and manages external MCP (Model Context Protocol) processes
- **Queue-based Processing**: Comment queue system with duplicate detection to prevent reprocessing
- **Asynchronous AI Pipeline**: Non-blocking AI text generation and speech synthesis

### Core Components
- **PumpFunChatApp Class**: Main application controller managing all system components
- **Comment Queue System**: FIFO queue with processed comment tracking to avoid duplicates
- **AI Text Generation**: Xenova Transformers pipeline for natural language processing
- **Text-to-Speech**: Native system TTS using the `say` library
- **State Management**: Centralized state for username, token address, and processing status

### Data Flow
1. User initiates monitoring via REST API with token address
2. MCP process spawns to monitor Pump.fun chat streams
3. Comments are queued and processed sequentially
4. AI generates contextual responses
5. Responses are converted to speech and broadcast via WebSocket

## External Dependencies

### Core Libraries
- **@xenova/transformers**: Client-side machine learning models for text generation
- **express**: Web framework for HTTP server and API endpoints
- **ws**: WebSocket library for real-time communication
- **say**: Text-to-speech synthesis library

### Third-party Integrations
- **pump-fun-chat-mcp**: Specialized MCP client for Pump.fun chat stream integration
- **Pump.fun Platform**: External cryptocurrency platform for live chat monitoring
- **Hugging Face Models**: AI models via Xenova Transformers for natural language processing

### System Dependencies
- **Node.js Child Processes**: For spawning and managing MCP processes
- **System TTS**: Platform-native text-to-speech capabilities
- **File System**: Static file serving and asset management