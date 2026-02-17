import cors from '@fastify/cors';
import fastify from 'fastify';
import { Socket, Server as SocketIOServer } from 'socket.io';

const app = fastify({ logger: true });
const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// Register CORS
app.register(cors, {
    origin: '*',
});

// Root Route for Verification (Health Check)
app.get('/', async () => {
    return { status: 'Telemetry Hub is Online', version: '1.1.0' };
});

// Store active sessions
interface SessionData {
    socketId: string;
    projectId: string;
    status: 'active' | 'offline';
    lastPing: number;
    location?: { lat: number; lng: number };
}

const sessions = new Map<string, SessionData>();

const start = async () => {
    try {
        await app.listen({ port: PORT, host: HOST });
        console.log(`Telemetry Hub running on ${HOST}:${PORT}`);

        // Attach Socket.IO directly to Fastify's underlying HTTP server
        const io = new SocketIOServer(app.server, {
            cors: {
                origin: '*',
                methods: ['GET', 'POST'],
            },
        });

        io.on('connection', (socket: Socket) => {
            console.log('New client connected:', socket.id);

            // Authentication & Join Project Room
            socket.on('join', (data: { enumeratorId: string; projectId: string; role: string }) => {
                const { enumeratorId, projectId, role } = data;
                socket.join(projectId);
                if (role === 'enumerator') {
                    sessions.set(enumeratorId, { socketId: socket.id, projectId, status: 'active', lastPing: Date.now() });
                    io.to(projectId).emit('enumerator_online', { enumeratorId, status: 'active' });
                }
            });

            // Telemetry: Keystroke/Input Mirroring
            socket.on('telemetry', (data: { projectId: string; enumeratorId: string; data: any }) => {
                const { projectId, enumeratorId, data: telemetryData } = data;
                // Broadcast to supervisors in the same project
                socket.to(projectId).emit('live_update', { enumeratorId, data: telemetryData, timestamp: Date.now() });

                // Update session status
                const session = sessions.get(enumeratorId);
                if (session) {
                    session.lastPing = Date.now();
                }
            });

            // Location Updates
            socket.on('location_ping', (data: { projectId: string; enumeratorId: string; location: any }) => {
                const { projectId, enumeratorId, location } = data;
                socket.to(projectId).emit('location_update', { enumeratorId, location });
                const session = sessions.get(enumeratorId);
                if (session) {
                    session.location = location;
                }
            });

            socket.on('disconnect', () => {
                // Cleanup sessions
                for (const [id, session] of sessions) {
                    if (session.socketId === socket.id) {
                        io.to(session.projectId).emit('enumerator_offline', { enumeratorId: id });
                        sessions.delete(id);
                        break;
                    }
                }
                console.log('Client disconnected:', socket.id);
            });
        });
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
};

start();
