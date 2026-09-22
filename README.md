<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Sedona Court Travellers Inn - Property Management System

Professional front-desk property management system and analytics dashboard for room booking, real-time status tracking, POS operations, and weekly performance reporting.

View your app in AI Studio: https://ai.studio/apps/0b016dae-5a1a-4bba-9e95-d27954cf6583

---

## 📋 Table of Contents

- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Prerequisites](#-prerequisites)
- [Installation](#-installation)
- [Database Setup](#-database-setup)
- [Running the Application](#-running-the-application)
- [WebSocket Real-Time Updates](#-websocket-real-time-updates)
- [Database Migrations](#-database-migrations)
- [API Endpoints](#-api-endpoints)
- [Environment Variables](#-environment-variables)
- [Project Structure](#-project-structure)
- [Development](#-development)

---

## ✨ Features

- **Room Management**: Real-time room status tracking (available, occupied, cleaning, overdue, maintenance)
- **Booking Calendar**: Advanced reservation scheduling with conflict detection
- **Point of Sale**: Integrated F&B and amenity billing system
- **Receipt Generation**: Professional receipt printing with multiple payment methods
- **Weekly Reporting**: Auto-populated shift entries, expense tracking, GCash audit trail, Excel exports
- **Real-Time Updates**: WebSocket-powered live notifications and state synchronization
- **Analytics Dashboard**: Performance metrics, revenue reports, and occupancy tracking
- **Shift Handoff**: Task management for seamless shift transitions
- **Audit Logging**: Complete administrative action history
- **Role-Based Access**: Kitchen, Cashier, Admin, and Owner permission levels
- **Dynamic Pricing**: Time-based rates with weekday/weekend/seasonal overrides

---

## 🛠 Tech Stack

**Frontend:**
- React 19 with TypeScript
- Vite for fast development
- Tailwind CSS 4 for styling
- Framer Motion for animations
- Lucide React for icons

**Backend:**
- Node.js with Express
- TypeScript for type safety
- Socket.IO for WebSocket real-time communication
- PostgreSQL database with connection pooling
- bcrypt for password hashing

**Additional:**
- XLSX for Excel export functionality
- Google Gemini AI API integration

---

## 📦 Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v18 or higher) - [Download](https://nodejs.org/)
- **PostgreSQL** (v14 or higher) - [Download](https://www.postgresql.org/download/)
- **npm** or **yarn** package manager
- A **Gemini API key** (optional, for AI features)

---

## 🚀 Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd sedona-court-travellers-inn-property-management-system
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env.local` file from the example:

```bash
cp .env.example .env.local
```

Edit `.env.local` and configure your settings:

```env
# Required: PostgreSQL connection string
DATABASE_URL="postgresql://postgres:yourpassword@localhost:5432/sedona_court"

# Optional: API server port (default: 4000)
API_PORT=4000

# Optional: Gemini AI API key (for AI features)
GEMINI_API_KEY="your-gemini-api-key"

# Optional: Application URL (for production)
APP_URL="http://localhost:3000"
```

---

## 🗄 Database Setup

### 1. Create PostgreSQL Database

```bash
# Using psql
createdb sedona_court

# Or manually in psql console
psql -U postgres
CREATE DATABASE sedona_court;
\q
```

### 2. Run Initial Schema and Seed Data

The easiest way to set up the database:

```bash
npm run db:setup
```

This command will:
1. Run all pending database migrations
2. Seed initial data (users, rooms, services)

**Alternatively**, you can run these steps separately:

```bash
# Run migrations only
npm run migrate

# Seed data only
npm run seed
```

### 3. Verify Database Setup

Check migration status:

```bash
npm run migrate:status
```

You should see the initial schema migration marked as ✅ Executed.

---

## ▶️ Running the Application

### Development Mode (Frontend + Backend)

Run both the frontend and backend concurrently:

```bash
npm run dev:all
```

This will start:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:4000
- **WebSocket**: ws://localhost:4000

### Run Frontend Only

```bash
npm run dev
```

### Run Backend Only

```bash
npm run server
```

### Production Build

```bash
# Build the frontend
npm run build

# Preview production build
npm run preview
```

---

## 🔌 WebSocket Real-Time Updates

The application includes WebSocket support for real-time updates across all connected clients.

### WebSocket Events

**Client → Server:**
- `subscribe:room` - Subscribe to specific room updates
- `unsubscribe:room` - Unsubscribe from room updates

**Server → Client:**
- `connected` - Connection established
- `room:updated` - Room state changed
- `room:detail-updated` - Detailed room update for subscribed clients
- `alarm:triggered` - Checkout alarm notification
- `booking:updated` - Booking created/updated/cancelled
- `receipt:created` - New receipt generated
- `system:notification` - System-wide announcements

### Frontend Integration Example

```typescript
import { io } from 'socket.io-client';

const socket = io('http://localhost:4000');

// Listen for room updates
socket.on('room:updated', (event) => {
  console.log('Room updated:', event.roomNumber, event.state);
});

// Listen for alarm notifications
socket.on('alarm:triggered', (event) => {
  console.log('Alarm:', event.alarmType, event.roomNumber);
});

// Subscribe to specific room
socket.emit('subscribe:room', '101');
```

---

## 🔄 Database Migrations

The project includes a robust migration system for managing schema changes.

### Available Commands

```bash
# Run all pending migrations
npm run migrate

# Check migration status
npm run migrate:status

# Create a new migration file
npm run migrate:create "add user preferences table"
```

### Creating a New Migration

1. Generate a migration file:
   ```bash
   npm run migrate:create "add email column to users"
   ```

2. Edit the generated file in `server/db/migrations/`:
   ```sql
   -- Add your SQL here
   ALTER TABLE users ADD COLUMN email VARCHAR(255);
   CREATE INDEX idx_users_email ON users(email);
   ```

3. Run the migration:
   ```bash
   npm run migrate
   ```

### Migration Features

- ✅ **Transactional**: Each migration runs in a transaction (rollback on failure)
- ✅ **Tracking**: Executed migrations tracked in `schema_migrations` table
- ✅ **Timestamped**: Files named with timestamp for ordering
- ✅ **Idempotent**: Safe to run multiple times

---

## 🔌 API Endpoints

### Authentication
- `POST /api/auth/login` - User login

### Rooms
- `GET /api/rooms` - List all rooms
- `PUT /api/rooms/:number` - Update room state
- `POST /api/rooms/reset` - Reset all rooms (admin/owner only)

### Bookings
- `GET /api/bookings` - List scheduled bookings
- `POST /api/bookings` - Create new booking
- `PUT /api/bookings/:id` - Update booking status
- `DELETE /api/bookings/:id` - Delete booking

### Receipts
- `GET /api/receipts` - List receipts (filter by `?cashier=&date=`)
- `POST /api/receipts` - Create new receipt

### Billable Services
- `GET /api/services` - List all services
- `POST /api/services` - Create new service (admin/owner)
- `PUT /api/services/:id` - Update service (admin/owner)
- `DELETE /api/services/:id` - Soft-delete service (admin/owner)

### Audit Logs
- `GET /api/audit-logs` - List audit entries

### Tasks
- `GET /api/tasks` - List handoff tasks
- `POST /api/tasks` - Create task
- `PUT /api/tasks/:id` - Update task
- `DELETE /api/tasks/:id` - Delete task

### POS Revenue
- `GET /api/pos-revenue` - Get daily POS revenue
- `POST /api/pos-revenue` - Update POS revenue

### Health Check
- `GET /api/health` - Server health status and WebSocket info

---

## 🔐 Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ Yes | - | PostgreSQL connection string |
| `API_PORT` | ❌ No | `4000` | Backend API server port |
| `GEMINI_API_KEY` | ❌ No | - | Google Gemini AI API key |
| `APP_URL` | ❌ No | - | Application URL (for CORS) |
| `NODE_ENV` | ❌ No | `development` | Environment mode |

---

## 📁 Project Structure

```
sedona-court-pms/
├── server/                      # Backend code
│   ├── db/
│   │   ├── migrations/          # Database migration files
│   │   ├── migration-runner.ts  # Migration system
│   │   ├── pool.ts              # PostgreSQL connection pool
│   │   ├── schema.sql           # Initial schema reference
│   │   └── seed.ts              # Database seeding script
│   ├── middleware/
│   │   └── auth.ts              # Authentication middleware
│   ├── routes/                  # API route handlers
│   │   ├── auth.ts
│   │   ├── rooms.ts
│   │   ├── bookings.ts
│   │   ├── receipts.ts
│   │   ├── billable-services.ts
│   │   ├── audit-logs.ts
│   │   ├── tasks.ts
│   │   └── pos-revenue.ts
│   ├── utils/
│   │   └── env-validator.ts    # Environment validation
│   ├── websocket/
│   │   └── socket-manager.ts   # WebSocket manager
│   └── index.ts                 # Express server entry
├── src/                         # Frontend code
│   ├── api/                     # API client functions
│   ├── components/              # React components
│   ├── utils/                   # Utility functions
│   ├── App.tsx                  # Main app component
│   ├── types.ts                 # TypeScript types
│   └── main.tsx                 # React entry point
├── .env.example                 # Environment template
├── package.json                 # Dependencies and scripts
├── tsconfig.json                # TypeScript config (frontend)
├── tsconfig.server.json         # TypeScript config (backend)
└── vite.config.ts               # Vite configuration
```

---

## 💻 Development

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start frontend dev server |
| `npm run server` | Start backend API server |
| `npm run dev:all` | Run frontend + backend concurrently |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run lint` | Run TypeScript type checking |
| `npm run seed` | Seed database with initial data |
| `npm run migrate` | Run pending migrations |
| `npm run migrate:status` | Check migration status |
| `npm run migrate:create` | Create new migration file |
| `npm run db:setup` | Run migrations + seed data |

### Default User Accounts

After seeding, you can login with these accounts:

| Username | Password | Role | Access Level |
|----------|----------|------|--------------|
| `kitchen` | `kitchen123` | Kitchen | Limited POS access |
| `cashier` | `cashier123` | Cashier | Room management, checkout |
| `admin` | `admin123` | Admin | Full system access |
| `owner` | `owner123` | Owner | All permissions + analytics |

### Hot Reload

Both frontend and backend support hot reload during development:
- Frontend: Vite HMR (instant updates)
- Backend: tsx watch mode (auto-restart on changes)

### Type Checking

Run TypeScript type checking without emitting files:

```bash
npm run lint
```

---

## 🐛 Troubleshooting

### Database Connection Issues

If you see `DATABASE_URL environment variable is not set`:
1. Ensure `.env.local` exists in the project root
2. Verify `DATABASE_URL` is correctly formatted
3. Test PostgreSQL connection: `psql -U postgres -d sedona_court`

### Port Already in Use

If port 3000 or 4000 is already in use:
1. Change `API_PORT` in `.env.local`
2. Update frontend proxy in `vite.config.ts` if needed

### WebSocket Connection Failures

1. Ensure backend is running on the correct port
2. Check CORS settings in `server/index.ts`
3. Verify firewall settings allow WebSocket connections

---

## 📄 License

This project is part of Google AI Studio.

---

## 🙏 Acknowledgments

Built with [Google AI Studio](https://ai.studio/) and powered by Gemini AI.


