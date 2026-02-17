import cors from '@fastify/cors';
import fastify from 'fastify';
import { Server } from 'socket.io';

const app = fastify({ logger: true });
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// Register CORS
app.register(cors, {
    origin: '*',
});

// Root Route for Verification
app.get('/', async () => {
    return { status: 'Telemetry Hub is Running', version: '1.0.0' };
});

// Setup WebSocket Server
const io = new Server(app.server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});

// Store active sessions: { enumeratorId: { socketId, projectId, location: { lat, lng }, status: 'active' | 'idle' } }
const sessions = new Map<string, any>();

io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    // Authentication & Join Project Room
    socket.on('join', ({ enumeratorId, projectId, role }) => {
        socket.join(projectId);
        if (role === 'enumerator') {
            sessions.set(enumeratorId, { socketId: socket.id, projectId, status: 'active', lastPing: Date.now() });
            io.to(projectId).emit('enumerator_online', { enumeratorId, status: 'active' });
        }
    });

    // Telemetry: Keystroke/Input Mirroring
    socket.on('telemetry', ({ projectId, enumeratorId, data }) => {
        // Broadcast to supervisors in the same project
        socket.to(projectId).emit('live_update', { enumeratorId, data, timestamp: Date.now() });

        // Update session status
        if (sessions.has(enumeratorId)) {
            sessions.get(enumeratorId).lastPing = Date.now();
        }
    });

    // Location Updates
    socket.on('location_ping', ({ projectId, enumeratorId, location }) => {
        socket.to(projectId).emit('location_update', { enumeratorId, location });
        if (sessions.has(enumeratorId)) {
            sessions.get(enumeratorId).location = location;
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

const start = async () => {
    try {
        await app.listen({ port: Number(PORT), host: HOST });
        console.log(`Telemetry Hub running on ${HOST}:${PORT}`);
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
};

start();
