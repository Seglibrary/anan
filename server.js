import express from 'express';
import { WebSocketServer } from 'ws';
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import cors from 'cors';

const app = express();
app.use(cors());

const PORT = 3001;

const server = app.listen(PORT, () => {
    console.log('\n════════════════════════════════════════════════════');
    console.log('🚀 Deepgram Nova-3 Real-time Transcription Server');
    console.log('════════════════════════════════════════════════════');
    console.log(`📡 HTTP Server: http://localhost:${PORT}`);
    console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
    console.log('⚡ Model: Nova-3 (Latest)');
    console.log('⚡ Status: Ready for connections');
    console.log('════════════════════════════════════════════════════\n');
});

const wss = new WebSocketServer({ server });

let connectionId = 0;

wss.on('connection', (ws) => {
    const clientId = ++connectionId;
    console.log(`\n👤 [Client ${clientId}] Connected`);
    
    let deepgramConnection = null;
    let keepAliveInterval = null;
    let audioChunkCount = 0;

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message.toString());

            switch (data.type) {
                case 'start':
                    const apiKey = data.apiKey;
                    const language = data.language || 'en-US';

                    if (!apiKey) {
                        ws.send(JSON.stringify({ 
                            type: 'error', 
                            message: 'API Key required' 
                        }));
                        return;
                    }

                    console.log(`🔌 [Client ${clientId}] Starting Deepgram Nova-3 connection...`);
                    console.log(`   Language: ${language}`);
                    console.log(`   Model: Nova-3 (latest)`);

                    // Create Deepgram client
                    const deepgram = createClient(apiKey);

                    // Nova-3 Live connection with optimal settings
                    deepgramConnection = deepgram.listen.live({
                        model: 'nova-3',           // ✅ Nova-3 (latest and best model)
                        version: 'latest',         // Always use latest version
                        language: language,
                        
                        // Audio format (PCM 16-bit, 16kHz, Mono)
                        encoding: 'linear16',
                        sample_rate: 16000,
                        channels: 1,
                        
                        // Real-time streaming features
                        interim_results: true,     // ✅ Word-by-word streaming
                        smart_format: true,        // ✅ Auto formatting & punctuation
                        punctuate: true,           // ✅ Add punctuation
                        
                        // Low latency optimizations
                        endpointing: 300,          // 300ms silence → finalize transcript
                        utterance_end_ms: 1500,    // 1.5s silence → end utterance (Nova-3 recommended)
                        vad_events: true,          // Voice Activity Detection events
                        
                        // Additional quality features
                        filler_words: false,       // Keep "um", "uh" etc
                        profanity_filter: false,   // Don't filter profanity
                        
                        // Metadata options
                        paragraphs: false,         // Don't group into paragraphs (for real-time)
                        utterances: false,         // Don't split into utterances in response
                    });

                    console.log(`✨ [Client ${clientId}] Nova-3 configuration applied`);

                    // Event: Connection opened
                    deepgramConnection.on(LiveTranscriptionEvents.Open, () => {
                        console.log(`✅ [Client ${clientId}] Deepgram Nova-3 connection established`);
                        ws.send(JSON.stringify({ 
                            type: 'status', 
                            message: 'Connected to Deepgram Nova-3',
                            status: 'connected'
                        }));

                        // KeepAlive mechanism (recommended every 3-5 seconds)
                        keepAliveInterval = setInterval(() => {
                            if (deepgramConnection && deepgramConnection.getReadyState() === 1) {
                                deepgramConnection.keepAlive();
                                console.log(`💓 [Client ${clientId}] KeepAlive sent`);
                            }
                        }, 3000); // Every 3 seconds
                    });

                    // Event: Transcript received (MAIN EVENT)
                    deepgramConnection.on(LiveTranscriptionEvents.Transcript, (data) => {
                        const alternatives = data.channel?.alternatives;
                        if (!alternatives || alternatives.length === 0) return;

                        const transcript = alternatives[0].transcript;
                        if (!transcript || transcript.trim().length === 0) return;

                        const isFinal = data.is_final;
                        const speechFinal = data.speech_final;
                        const words = alternatives[0].words || [];

                        // Enhanced logging with word count
                        const wordCount = transcript.trim().split(/\s+/).length;
                        const logPrefix = isFinal ? '📝 FINAL' : '⚡ INTERIM';
                        console.log(`${logPrefix} [Client ${clientId}] (${wordCount} words): "${transcript}"`);

                        // Send to client with enhanced metadata
                        ws.send(JSON.stringify({
                            type: 'transcript',
                            data: {
                                text: transcript,
                                isFinal: isFinal,
                                speechFinal: speechFinal,
                                words: words.map(w => ({
                                    word: w.word,
                                    start: w.start,
                                    end: w.end,
                                    confidence: w.confidence,
                                    punctuated_word: w.punctuated_word
                                })),
                                timestamp: Date.now(),
                                duration: data.duration,
                                start: data.start
                            }
                        }));
                    });

                    // Event: Utterance ended
                    deepgramConnection.on(LiveTranscriptionEvents.UtteranceEnd, (data) => {
                        console.log(`🔚 [Client ${clientId}] Utterance ended`);
                        ws.send(JSON.stringify({ 
                            type: 'utterance_end',
                            timestamp: Date.now()
                        }));
                    });

                    // Event: Speech started
                    deepgramConnection.on(LiveTranscriptionEvents.SpeechStarted, (data) => {
                        console.log(`🎤 [Client ${clientId}] Speech detected`);
                        ws.send(JSON.stringify({ 
                            type: 'speech_started',
                            timestamp: Date.now()
                        }));
                    });

                    // Event: Metadata
                    deepgramConnection.on(LiveTranscriptionEvents.Metadata, (data) => {
                        console.log(`📊 [Client ${clientId}] Metadata:`, {
                            request_id: data.request_id,
                            model_uuid: data.model_uuid,
                            model_name: data.model_info?.name,
                            version: data.model_info?.version
                        });
                        
                        // Send model info to client
                        ws.send(JSON.stringify({
                            type: 'metadata',
                            data: {
                                request_id: data.request_id,
                                model: data.model_info?.name,
                                version: data.model_info?.version
                            }
                        }));
                    });

                    // Event: Error handling
                    deepgramConnection.on(LiveTranscriptionEvents.Error, (error) => {
                        console.error(`❌ [Client ${clientId}] Deepgram Error:`, {
                            message: error.message,
                            statusCode: error.statusCode,
                            requestId: error.requestId,
                            type: error.type
                        });

                        let errorMessage = 'Deepgram error occurred';
                        
                        // Handle specific error codes
                        if (error.statusCode === 401) {
                            errorMessage = 'Invalid API key - Please check your Deepgram API key';
                        } else if (error.statusCode === 429) {
                            errorMessage = 'Rate limit exceeded - Too many requests';
                        } else if (error.type === 'NET-0001') {
                            errorMessage = 'Connection timeout - No audio received for 10 seconds';
                        } else if (error.message) {
                            errorMessage = error.message;
                        }

                        ws.send(JSON.stringify({ 
                            type: 'error', 
                            message: errorMessage,
                            code: error.statusCode,
                            errorType: error.type
                        }));
                    });

                    // Event: Connection closed
                    deepgramConnection.on(LiveTranscriptionEvents.Close, (event) => {
                        console.log(`🔒 [Client ${clientId}] Deepgram connection closed (code: ${event.code})`);
                        
                        if (keepAliveInterval) {
                            clearInterval(keepAliveInterval);
                            keepAliveInterval = null;
                        }

                        ws.send(JSON.stringify({ 
                            type: 'status', 
                            message: 'Deepgram connection closed',
                            status: 'closed'
                        }));
                    });

                    break;

                case 'audio':
                    if (!deepgramConnection) {
                        return;
                    }

                    const readyState = deepgramConnection.getReadyState();
                    if (readyState !== 1) {
                        if (audioChunkCount === 0) {
                            console.warn(`⚠️ [Client ${clientId}] Deepgram not ready (state: ${readyState})`);
                        }
                        return;
                    }

                    // Decode base64 audio to Buffer
                    const audioBuffer = Buffer.from(data.audio, 'base64');
                    
                    // Skip zero-byte payloads (important per Deepgram docs)
                    if (audioBuffer.length === 0) {
                        console.warn(`⚠️ [Client ${clientId}] Skipping zero-byte audio chunk`);
                        return;
                    }

                    // Send to Deepgram
                    deepgramConnection.send(audioBuffer);
                    audioChunkCount++;
                    
                    // Log periodically
                    if (audioChunkCount % 100 === 1) {
                        console.log(`🎵 [Client ${clientId}] Audio streaming (chunk #${audioChunkCount}, ${audioBuffer.length} bytes)`);
                    }
                    break;

                case 'stop':
                    console.log(`⏹️ [Client ${clientId}] Stopping transcription...`);
                    
                    if (deepgramConnection) {
                        // Send CloseStream message to finalize any pending audio
                        deepgramConnection.finish();
                        deepgramConnection = null;
                    }

                    if (keepAliveInterval) {
                        clearInterval(keepAliveInterval);
                        keepAliveInterval = null;
                    }

                    audioChunkCount = 0;

                    ws.send(JSON.stringify({ 
                        type: 'status', 
                        message: 'Stopped',
                        status: 'stopped'
                    }));
                    break;

                default:
                    console.warn(`⚠️ [Client ${clientId}] Unknown message type: ${data.type}`);
            }
        } catch (error) {
            console.error(`❌ [Client ${clientId}] Message handling error:`, error);
            ws.send(JSON.stringify({ 
                type: 'error', 
                message: `Server error: ${error.message}` 
            }));
        }
    });

    ws.on('close', () => {
        console.log(`👋 [Client ${clientId}] Disconnected`);
        
        // Cleanup
        if (deepgramConnection) {
            deepgramConnection.finish();
            deepgramConnection = null;
        }

        if (keepAliveInterval) {
            clearInterval(keepAliveInterval);
            keepAliveInterval = null;
        }
    });

    ws.on('error', (error) => {
        console.error(`❌ [Client ${clientId}] WebSocket error:`, error.message);
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        service: 'Deepgram Real-time Transcription Server',
        version: '2.0.0',
        model: 'nova-3',
        modelVersion: 'latest',
        timestamp: new Date().toISOString()
    });
});

// Graceful shutdown
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function shutdown() {
    console.log('\n🛑 Shutting down gracefully...');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
}
