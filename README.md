# Sedona Court Travellers Inn — Property Management System

A property management system built for Sedona Court Travellers Inn, covering room status, bookings, point-of-sale billing, reporting, and real-time updates across the front desk.

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Database Setup](#database-setup)
- [Running the Application](#running-the-application)
- [WebSocket Real-Time Updates](#websocket-real-time-updates)
- [Database Migrations](#database-migrations)
- [API Endpoints](#api-endpoints)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)
- [Development](#development)
- [Troubleshooting](#troubleshooting)

## Features

- Room management with live status tracking (available, occupied, cleaning, overdue, maintenance)
- Booking calendar with conflict detection for reservations
- Point-of-sale system for F&B and amenity billing
- Receipt generation with support for multiple payment methods
- Weekly reporting — shift entries, expense tracking, GCash audit trail, Excel export
- Real-time updates via WebSockets, so all connected clients stay in sync
- Analytics dashboard for revenue, occupancy, and performance metrics
- Shift handoff tools for task management between shifts
- Audit logging for administrative actions
- Role-based access control (Kitchen, Cashier, Admin, Owner)
- Dynamic pricing with weekday/weekend/seasonal rate overrides

## Tech Stack

**Frontend**
- React 19 with TypeScript
- Vite
- Tailwind CSS 4
- Framer Motion
- Lucide React (icons)

**Backend**
- Node.js + Express
- TypeScript
- Socket.IO for WebSocket communication
- PostgreSQL with connection pooling
- bcrypt for password hashing

**Other**
- XLSX for Excel export
- Google Gemini AI API integration

## Prerequisites

- Node.js v18+
- PostgreSQL v14+
- npm or yarn
- A Gemini API key, if you want the AI features

## Installation

Clone the repo and install dependencies:

```bash
git clone <repository-url>
cd sedona-court-travellers-inn-property-management-system
npm install
```

Copy the example environment file and fill it in:

```bash
cp .env.example .env.local
```

```env
# Required
DATABASE_URL="postgresql://postgres:yourpassword@localhost:5432/sedona_court"

# Optional
API_PORT=4000
GEMINI_API_KEY="your-gemini-api-key"
APP_URL="http://localhost:3000"
```

## Database Setup

Create the database:

```bash
createdb sedona_court
```

Or manually via psql:

```bash
psql -U postgres
CREATE DATABASE sedona_court;
\q
```

Run migrations and seed data in one step:

```bash
npm run db:setup
```

Or run them separately:

```bash
npm run migrate
npm run seed
```

Check that everything ran correctly:

```bash
npm run migrate:status
```

You should see the initial schema migration marked as executed.

## Running the Application

Run frontend and backend together:

```bash
npm run dev:all
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:4000
- WebSocket: ws://localhost:4000

Or run them separately:

```bash
npm run dev      # frontend only
npm run server   # backend only
```

Production build:

```bash
npm run build
npm run preview
```

## WebSocket Real-Time Updates

The app uses WebSockets to keep all connected clients in sync.

**Client → Server**
- `subscribe:room` — subscribe to updates for a specific room
- `unsubscribe:room` — unsubscribe from room updates

**Server → Client**
- `connected` — connection established
- `room:updated` — room state changed
- `room:detail-updated` — detailed update for subscribed clients
- `alarm:triggered` — checkout alarm fired
- `booking:updated` — booking created, updated, or cancelled
- `receipt:created` — new receipt generated
- `system:notification` — system-wide announcement

Example usage on the frontend:

```typescript
import { io } from 'socket.io-client';

const socket = io('http://localhost:4000');

socket.on('room:updated', (event) => {
  console.log('Room updated:', event.roomNumber, event.state);
});

socket.on('alarm:triggered', (event) => {
  console.log('Alarm:', event.alarmType, event.roomNumber);
});

socket.emit('subscribe:room', '101');
```

## Database Migrations

```bash
npm run migrate            # run all pending migrations
npm run migrate:status     # check status
npm run migrate:create "add user preferences table"   # scaffold a new migration
```

To add a migration, generate the file, edit the SQL, then run it:

```sql
-- server/db/migrations/<timestamp>_add-email-column.sql
ALTER TABLE users ADD COLUMN email VARCHAR(255);
CREATE INDEX idx_users_email ON users(email);
```

```bash
npm run migrate
```

Migrations run inside a transaction (so a failure rolls back cleanly), are tracked in a `schema_migrations` table, are timestamp-ordered, and are safe to re-run.

## API Endpoints

**Auth**
- `POST /api/auth/login`

**Rooms**
- `GET /api/rooms`
- `PUT /api/rooms/:number`
- `POST /api/rooms/reset` (admin/owner only)

**Bookings**
- `GET /api/bookings`
- `POST /api/bookings`
- `PUT /api/bookings/:id`
- `DELETE /api/bookings/:id`

**Receipts**
- `GET /api/receipts` (filter with `?cashier=&date=`)
- `POST /api/receipts`

**Billable Services**
- `GET /api/services`
- `POST /api/services` (admin/owner)
- `PUT /api/services/:id` (admin/owner)
- `DELETE /api/services/:id` (soft delete, admin/owner)

**Audit Logs**
- `GET /api/audit-logs`

**Tasks**
- `GET /api/tasks`
- `POST /api/tasks`
- `PUT /api/tasks/:id`
- `DELETE /api/tasks/:id`

**POS Revenue**
- `GET /api/pos-revenue`
- `POST /api/pos-revenue`

**Health**
- `GET /api/health`

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `API_PORT` | No | `4000` | Backend API server port |
| `GEMINI_API_KEY` | No | — | Google Gemini AI API key |
| `APP_URL` | No | — | Application URL, used for CORS |
| `NODE_ENV` | No | `development` | Environment mode |

## Project Structure

```
sedona-court-pms/
├── server/                      # Backend
│   ├── db/
│   │   ├── migrations/
│   │   ├── migration-runner.ts
│   │   ├── pool.ts
│   │   ├── schema.sql
│   │   └── seed.ts
│   ├── middleware/
│   │   └── auth.ts
│   ├── routes/
│   │   ├── auth.ts
│   │   ├── rooms.ts
│   │   ├── bookings.ts
│   │   ├── receipts.ts
│   │   ├── billable-services.ts
│   │   ├── audit-logs.ts
│   │   ├── tasks.ts
│   │   └── pos-revenue.ts
│   ├── utils/
│   │   └── env-validator.ts
│   ├── websocket/
│   │   └── socket-manager.ts
│   └── index.ts
├── src/                         # Frontend
│   ├── api/
│   ├── components/
│   ├── utils/
│   ├── App.tsx
│   ├── types.ts
│   └── main.tsx
├── .env.example
├── package.json
├── tsconfig.json
├── tsconfig.server.json
└── vite.config.ts
```

## Development

| Command | Description |
|---|---|
| `npm run dev` | Start frontend dev server |
| `npm run server` | Start backend API server |
| `npm run dev:all` | Run frontend + backend together |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run lint` | TypeScript type checking |
| `npm run seed` | Seed database with initial data |
| `npm run migrate` | Run pending migrations |
| `npm run migrate:status` | Check migration status |
| `npm run migrate:create` | Create a new migration file |
| `npm run db:setup` | Run migrations + seed |

Default accounts after seeding:

| Username | Password | Role | Access |
|---|---|---|---|
| `kitchen` | `kitchen123` | Kitchen | Limited POS access |
| `cashier` | `cashier123` | Cashier | Room management, checkout |
| `admin` | `admin123` | Admin | Full system access |
| `owner` | `owner123` | Owner | All permissions + analytics |

Both frontend and backend support hot reload — Vite HMR on the frontend, `tsx watch` on the backend.

Run type checking without emitting files:

```bash
npm run lint
```

## Troubleshooting

**"DATABASE_URL environment variable is not set"**
Make sure `.env.local` exists in the project root and `DATABASE_URL` is formatted correctly. Test the connection directly with `psql -U postgres -d sedona_court`.

**Port already in use**
Change `API_PORT` in `.env.local`, and update the frontend proxy in `vite.config.ts` if needed.

**WebSocket connection fails**
Confirm the backend is running on the expected port, check CORS settings in `server/index.ts`, and make sure your firewall allows WebSocket connections.

## License

Part of Google AI Studio.

## Acknowledgments

Built with [Google AI Studio](https://ai.studio/), powered by Gemini AI.
