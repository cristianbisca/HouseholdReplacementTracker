# 🏠 Household Replacement Tracker

A **local-first**, self-hosted web application for tracking household item replacements with dual-interval monitoring (time-based and usage/counter-based) and real-time multi-device synchronization over your local network.

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Usage](#usage)
- [API Reference](#api-reference)
- [WebSocket Events](#websocket-events)
- [Database Schema](#database-schema)
- [Configuration](#configuration)
- [Development](#development)
- [Deployment](#deployment)
- [License](#license)

---

## Features

### Dual-Interval Tracking
- **Time-Based Tracking**: Schedule replacements by days, weeks, months, or years. The app calculates the next due date and shows overdue warnings.
- **Usage/Counter-Based Tracking**: Track items by usage count (e.g., coffee machine shots, printer pages, HVAC filter cycles). Auto-resets when the threshold is reached.

### One-Tap Replacement Recording
- Record a replacement with a single tap. Automatically resets counters, updates dates, and logs the event to history.

### Real-Time Multi-Device Sync
- WebSocket-based real-time synchronization across all devices connected to the same local network.
- All clients see instant updates when any device creates, modifies, or deletes items.

### Multi-User Household Support
- Add multiple household members and track who performed each replacement.
- User selection is persisted per browser via `localStorage`.

### Replacement History
- Complete audit trail of all replacements with dates, notes, and the person who performed them.

### Part & Order Information
- Store part numbers, manufacturer details, specifications, and direct reorder links for quick reordering.

### Smart Filtering
- Filter items by: **All**, **Overdue**, **Due Soon** (within 7 days), or **Usage-Based**.

### Mobile-First Responsive Design
- Fully responsive UI that works on phones, tablets, and desktops.

### Local-First & Private
- All data is stored locally in an SQLite database — no cloud dependencies, no accounts required.
- Runs entirely on your local network.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Client Browsers                    │
│  (Phone / Tablet / Desktop on local network)         │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │  Device 1│  │  Device 2│  │  Device 3│  ...     │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘          │
│       │              │             │                 │
│       └──────────────┼─────────────┘                │
│                      │                               │
│         ┌────────────▼────────────┐                  │
│         │   HTTP + WebSocket      │                  │
│         │   (REST API + Real-time)│                  │
│         └────────────┬────────────┘                  │
│                      │                               │
│         ┌────────────▼────────────┐                  │
│         │    Express.js Server    │                  │
│         │    (server/index.js)    │                  │
│         └────────────┬────────────┘                  │
│                      │                               │
│         ┌────────────▼────────────┐                  │
│         │   SQLite Database       │                  │
│         │   (sql.js / data/hrt.db)│                  │
│         └─────────────────────────┘                  │
└─────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Node.js with Express.js |
| **Database** | SQLite via sql.js (JavaScript SQLite) |
| **Real-Time** | WebSocket via `ws` library |
| **Frontend** | Vanilla JavaScript (no framework) |
| **Styling** | Pure CSS with CSS Custom Properties |
| **UUID Generation** | `uuid` v1 library |

---

## Project Structure

```
HouseholdReplacementTracker/
├── package.json              # Project metadata and dependencies
├── package-lock.json         # Dependency lock file
├── README.md                 # This documentation
├── data/
│   └── hrt.db               # SQLite database (auto-created, .gitignore recommended)
├── public/
│   ├── index.html           # Single-page application HTML
│   ├── css/
│   │   └── styles.css       # All application styles (mobile-first responsive)
│   └── js/
│       └── app.js           # Frontend application logic (IIFE pattern)
└── server/
    ├── index.js             # Express server, REST API routes, WebSocket handler
    └── database.js          # Database initialization, CRUD operations, query helpers
```

---

## Prerequisites

- **Node.js** >= 16.x (LTS recommended)
- **npm** >= 8.x (bundled with Node.js)

---

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/cristianbisca/HouseholdReplacementTracker.git
cd HouseholdReplacementTracker
```

### 2. Install Dependencies

```bash
npm install
```

This installs the following dependencies:
- `express` — Web framework for routing and static file serving
- `sql.js` — SQLite compiled to JavaScript/WebAssembly
- `ws` — WebSocket library for real-time communication
- `uuid` — UUID v1 generator for unique record IDs

### 3. Start the Server

```bash
npm start
```

The server will start on port **3000** (or the `$PORT` environment variable) and bind to all network interfaces (`0.0.0.0`).

```
🏠 Household Replacement Tracker
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Server running on port 3000
Local:   http://localhost:3000
Network: http://192.168.1.x:3000
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 4. Access the Application

- **Locally**: Open `http://localhost:3000` in your browser
- **On the network**: Open `http://<server-ip>:3000` from any device on the same local network

---

## Usage

### Adding an Item

1. Click the **+** button in the header
2. Fill in the item details:
   - **Basic Info**: Name (required), Category, Description
   - **Time-Based Tracking**: Replace interval (e.g., every 6 months), last replaced date
   - **Usage-Based Tracking**: Enable counter tracking with a reset threshold and unit
   - **Part & Order Info**: Part number, manufacturer, specs, reorder URL
   - **Notes**: Installation tips or special instructions
3. Click **Save Item**

### Recording a Replacement

1. On any item card, click **✓ Replaced Today**
2. Confirm the replacement (optionally add notes)
3. The app automatically:
   - Updates the last replaced date to today
   - Recalculates the next due date based on the interval
   - Resets the usage counter if enabled
   - Logs the event in replacement history

### Adding Usage Count

For items with usage-based tracking:
1. Click **+ Add Usage** on the item card or detail view
2. Enter the amount to add
3. The counter increments; auto-resets when reaching the threshold

### Filtering Items

Use the filter tabs to view:
- **All Items**: Every tracked item
- **Overdue**: Items past their due date
- **Due Soon**: Items due within 7 days
- **Usage-Based**: Items with counter tracking enabled

### Managing Household Members

1. Click **+ Add** next to the "Tracking as:" selector
2. Enter a name for the household member
3. Select yourself from the dropdown before recording replacements

---

## API Reference

All API endpoints return JSON in the format:

```json
{ "success": true, "data": { ... } }
// or
{ "success": false, "error": "Error message" }
```

### Items

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/items` | Get all items |
| `GET` | `/api/items/:id` | Get a single item by ID |
| `POST` | `/api/items` | Create a new item |
| `PUT` | `/api/items/:id` | Update an existing item |
| `DELETE` | `/api/items/:id` | Delete an item and its history |

### Replacement & Usage

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/items/:id/replace` | Record a replacement (resets dates/counters) |
| `POST` | `/api/items/:id/usage` | Increment usage counter by amount |
| `GET` | `/api/items/:id/history` | Get replacement history for an item |

### Settings & Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/settings` | Get all application settings |
| `PUT` | `/api/settings/:key` | Update a setting value |
| `GET` | `/api/health` | Health check (status, client count, uptime) |

### Example: Create an Item

```bash
curl -X POST http://localhost:3000/api/items \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Fridge Water Filter",
    "category": "appliance",
    "time_interval_type": "months",
    "time_interval_value": 6,
    "part_number": "LF3000",
    "manufacturer": "Samsung"
  }'
```

### Example: Record a Replacement

```bash
curl -X POST http://localhost:3000/api/items/<item-id>/replace \
  -H "Content-Type: application/json" \
  -d '{
    "notes": "Replaced during monthly maintenance",
    "replaced_by": "John"
  }'
```

---

## WebSocket Events

Connect to the WebSocket at `ws://<host>:3000?user=<username>`.

### Server → Client Messages

| Type | Description | Payload |
|------|-------------|---------|
| `state_update` | Full item list (sent on connect) | `{ items: [...] }` |
| `item_created` | New item added | `{ item: {...} }` |
| `item_updated` | Item modified | `{ item: {...} }` |
| `item_deleted` | Item removed | `{ id: "...", name: "..." }` |
| `replacement_recorded` | Replacement logged | `{ item: {...}, notes: "...", replaced_by: "..." }` |
| `usage_incremented` | Usage counter updated | `{ item: {...}, amount: 1 }` |
| `client_disconnected` | Another client left | `{ clientId: "...", user: "..." }` |

### Client → Server Messages

| Type | Description |
|------|-------------|
| `ping` | Keep-alive ping (server responds with `pong`) |

---

## Database Schema

The application uses SQLite with three main tables:

### `items` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT (PK) | UUID v1 unique identifier |
| `name` | TEXT | Item display name |
| `category` | TEXT | Category (appliance, hvac, kitchen, etc.) |
| `description` | TEXT | Optional description |
| `time_interval_type` | TEXT | Time unit: days, weeks, months, years |
| `time_interval_value` | INTEGER | Number of intervals between replacements |
| `last_replaced_date` | TEXT | ISO date of last replacement |
| `next_due_date` | TEXT | Calculated next due date |
| `is_overdue` | INTEGER | Boolean flag (0/1) |
| `days_until_due` | INTEGER | Days remaining until due |
| `usage_enabled` | INTEGER | Boolean flag for counter tracking |
| `usage_interval_value` | INTEGER | Counter reset threshold |
| `usage_unit` | TEXT | Unit label (shots, cycles, pages...) |
| `current_usage_count` | REAL | Current counter value |
| `last_reset_date` | TEXT | Date of last counter reset |
| `usage_percentage` | REAL | Percentage of threshold used |
| `part_number` | TEXT | Part/SKU number |
| `manufacturer` | TEXT | Brand/manufacturer name |
| `specifications` | TEXT | Size, dimensions, specs |
| `reorder_url` | TEXT | Direct reorder link URL |
| `notes` | TEXT | Free-form notes |
| `created_at` | TEXT | Creation timestamp |
| `updated_at` | TEXT | Last update timestamp |

### `replacement_history` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT (PK) | UUID v1 unique identifier |
| `item_id` | TEXT (FK) | Reference to items.id (CASCADE DELETE) |
| `replaced_date` | TEXT | ISO date of replacement |
| `notes` | TEXT | Optional notes about the replacement |
| `replaced_by` | TEXT | Name of person who performed it |
| `created_at` | TEXT | Record creation timestamp |

### `settings` Table

| Column | Type | Description |
|--------|------|-------------|
| `key` | TEXT (PK) | Setting key name |
| `value` | TEXT | Setting value |

**Default settings:**
- `app_name`: "Household Replacement Tracker"
- `default_time_interval_value`: "6"
- `default_time_interval_type`: "months"
- `warning_days_before`: "7"

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |

### Database Location

The SQLite database is stored at `data/hrt.db`. The file is auto-created on first run. The data directory is also created automatically if it does not exist.

### Auto-Save

The database is persisted to disk:
- On every write operation (create, update, delete)
- Every 30 seconds as a periodic safety save
- On graceful shutdown (SIGINT/SIGTERM)

---

## Development

### Watch Mode

```bash
npm run dev
```

Uses Node.js `--watch` flag for automatic server restart on file changes.

### Adding a .gitignore

It is recommended to add the database file to `.gitignore`:

```
node_modules/
data/hrt.db
data/*.db-wal
data/*.db-shm
```

---

## Deployment

### Running as a Background Service

#### Using PM2 (recommended)

```bash
npm install -g pm2
pm2 start server/index.js --name "hrt"
pm2 save
pm2 startup
```

#### Using systemd (Linux)

Create `/etc/systemd/system/hrt.service`:

```ini
[Unit]
Description=Household Replacement Tracker
After=network.target

[Service]
Type=simple
User=<your-user>
WorkingDirectory=/path/to/HouseholdReplacementTracker
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl enable hrt
sudo systemctl start hrt
```

### Docker Deployment

A production-ready `Dockerfile` is included in the repository. It uses a **multi-stage build** with Node.js 18 Alpine, runs as a **non-root user**, and includes a **health check**.

#### Build the Image

```bash
docker build -t household-replacement-tracker:latest .
```

#### Run the Container

```bash
docker run -d \
  --name hrt \
  -p 3000:3000 \
  -v ./data:/app/data \
  -e PORT=3000 \
  --restart unless-stopped \
  household-replacement-tracker:latest
```

| Flag | Description |
|------|-------------|
| `-d` | Run in detached (background) mode |
| `--name hrt` | Assign a name to the container |
| `-p 3000:3000` | Map host port 3000 to container port 3000 |
| `-v ./data:/app/data` | Persist SQLite database on the host |
| `--restart unless-stopped` | Auto-restart on crash or docker daemon restart |

#### Docker Compose

Create a `docker-compose.yml`:

```yaml
version: '3.8'

services:
  hrt:
    build: .
    container_name: household-replacement-tracker
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    environment:
      - NODE_ENV=production
      - PORT=3000
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

Then run:

```bash
docker compose up -d
```

#### Push to a Registry

To push the image to a container registry (e.g., GitHub Container Registry, Docker Hub):

```bash
# Tag the image for your registry
docker tag household-replacement-tracker:latest <registry>/<username>/household-replacement-tracker:latest

# Login to the registry
docker login <registry>

# Push the image
docker push <registry>/<username>/household-replacement-tracker:latest
```

**Example — GitHub Container Registry (ghcr.io):**

```bash
docker tag household-replacement-tracker:latest ghcr.io/cristianbisca/household-replacement-tracker:latest
docker login ghcr.io
docker push ghcr.io/cristianbisca/household-replacement-tracker:latest
```

**Example — Docker Hub:**

```bash
docker tag household-replacement-tracker:latest dockerhub-username/household-replacement-tracker:latest
docker login
docker push dockerhub-username/household-replacement-tracker:latest
```

#### Docker Image Details

| Property | Value |
|----------|-------|
| Base image | `node:18-alpine` |
| Multi-stage build | Yes (builder + runtime stages) |
| Non-root user | `appuser` in `appgroup` |
| Health check | `/api/health` endpoint every 30s |
| Exposed port | `3000` |
| Data volume | `/app/data` (SQLite database) |

#### `.dockerignore`

The repository includes a `.dockerignore` file that excludes unnecessary files from the build context:

```
.git
.gitignore
node_modules
npm-debug.log
data/*.db
data/*.sqlite
README.md
.env
.DS_Store
Thumbs.db
```

---

## Browser Compatibility

The frontend uses modern JavaScript (ES6+) and CSS features. Supported browsers:

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile Safari (iOS 14+)
- Chrome for Android

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `N` | Open "Add New Item" modal |
| `Escape` | Close any open modal |

---

## License

This project is provided as-is for personal and household use.