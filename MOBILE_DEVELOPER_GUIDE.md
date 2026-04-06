# 📱 Mobile Developer Guide — OCPP 1.6 CMS

> A complete reference for building the EV Charging mobile app that integrates with the OCPP 1.6 Charging Point Management System (CMS) backend.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Getting Started](#2-getting-started)
3. [Authentication Flow](#3-authentication-flow)
4. [API Reference](#4-api-reference)
   - [Auth Endpoints](#41-auth-endpoints)
   - [Profile Endpoint](#42-profile-endpoint)
   - [Sessions Endpoints](#43-sessions-endpoints)
   - [Chargers Endpoints](#44-chargers-endpoints)
   - [Remote Control Endpoints](#45-remote-control-endpoints)
5. [Data Models](#5-data-models)
6. [Error Handling](#6-error-handling)
7. [User Flows](#7-user-flows)
8. [Security Notes](#8-security-notes)
9. [Recommended App Features](#9-recommended-app-features)

---

## 1. System Overview

This CMS manages EV charging infrastructure using the **OCPP 1.6** protocol. The backend exposes a dedicated REST API namespace (`/api/mobile`) for mobile apps. Mobile users are **RFID-based** — they are physically issued an RFID card/tag by an admin, and the app acts as an extension of that card.

### Architecture at a Glance

```
Mobile App
    │
    ▼
REST API  →  /api/mobile/*   (JWT-authenticated, RFID users)
    │
    ▼
Express Server (Port 3000 by default)
    │
    ├── PostgreSQL Database  (via Prisma ORM)
    │
    └── OCPP WebSocket Server (Port 9220)
            │
            └── Chargers (physical hardware)
```

### Key Concepts for Mobile Developers

| Concept | Explanation |
|---|---|
| **RFID Tag** | A unique string assigned physically to a user by an admin (e.g., `"RFID-001"`). This is used as the user's identity. |
| **PIN** | A 4–6 digit numeric PIN the user sets the first time they log in. Hashed on the server using bcrypt. |
| **JWT Token** | Returned after login. Must be sent in the `Authorization` header for all protected requests. Expires in **7 days** by default. |
| **Token Version** | An integer stored on the server. Incremented on logout. Ensures that old tokens are instantly invalid after logout. |
| **Remote Start** | The mobile app triggers the charger to begin a session via OCPP — no physical card tap needed. |
| **Remote Stop** | The mobile app triggers the charger to end an active session. |
| **RfidSession** | A charging session record linked to the user. Tracks energy consumed, start/end time, and billing. |

---

## 2. Getting Started

### Base URL

```
http://<SERVER_HOST>:3000
```

Default port is `3000`. For production, this will be behind HTTPS (e.g., `https://api.yourservice.com`).

### Health Check

```http
GET /health
```

**Response (200 OK):**
```json
{
  "success": true,
  "status": "healthy",
  "timestamp": "2025-04-04T10:00:00.000Z",
  "version": "1.0.0"
}
```

Use this to verify connectivity to the server before performing any account operations.

---

## 3. Authentication Flow

### 3.1 First-Time Setup (New User)

A new user is created by an admin who assigns them an **RFID tag**. The user downloads the app and sets up their PIN.

```
1. Admin creates RFID user in CMS dashboard
   → User gets their RFID tag string (e.g., "RFID-007")

2. User opens app → enters their RFID tag + chooses a PIN
   → App calls: POST /api/mobile/auth/set-pin

3. PIN is set. User logs in.
   → App calls: POST /api/mobile/auth/login
   → Receives a JWT token

4. App stores token securely (Keychain on iOS / Keystore on Android)

5. All subsequent requests include:
   Authorization: Bearer <token>
```

### 3.2 Returning User

```
1. App has stored token → validate using GET /api/mobile/profile or POST /api/mobile/auth/refresh
2. If token is expired or invalid → redirect to Login screen
3. On Login → POST /api/mobile/auth/login → get new token
```

### 3.3 Logout

```
1. App calls: POST /api/mobile/auth/logout
   → Server increments token version → ALL sessions instantly invalidated
2. App deletes token from secure storage
3. Redirect to Login
```

### Request Header

Every **protected** endpoint requires:
```http
Authorization: Bearer <YOUR_JWT_TOKEN>
```

---

## 4. API Reference

All responses follow this envelope:
```json
{
  "success": true | false,
  "data": { ... },           // present on success
  "error": "error message",  // present on failure
  "pagination": { ... }      // present on paginated list responses
}
```

---

### 4.1 Auth Endpoints

#### `POST /api/mobile/auth/set-pin`

> **Public** — No authentication required.

Sets up the PIN for a first-time user. **This can only be called once per user.** If a PIN already exists, the user must contact the admin to reset it.

**Request Body:**
```json
{
  "rfid_tag": "RFID-007",
  "pin": "1234"
}
```

| Field | Type | Rules |
|---|---|---|
| `rfid_tag` | string | Required. Must exist in the system and be active. |
| `pin` | string | Required. Must be 4–6 digits (numbers only). |

**Success Response (200):**
```json
{
  "success": true,
  "message": "PIN set successfully. You can now log in."
}
```

**Error Responses:**
| Status | Error Message | Cause |
|---|---|---|
| 400 | `rfid_tag and pin are required` | Missing fields |
| 400 | `PIN must be 4–6 digits` | Invalid PIN format |
| 400 | `PIN already set. Contact admin to reset.` | PIN was already configured |
| 403 | `Account is inactive` | Admin deactivated this user |
| 404 | `RFID tag not found` | The RFID tag doesn't exist in the system |

---

#### `POST /api/mobile/auth/login`

> **Public** — No authentication required.

Authenticates a user with their RFID tag and PIN. Returns a JWT token.

**Request Body:**
```json
{
  "rfid_tag": "RFID-007",
  "pin": "1234"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": 5,
      "name": "John Doe",
      "rfid_tag": "RFID-007",
      "type": "postpaid",
      "email": "john@example.com",
      "phone": "+91-9876543210"
    }
  }
}
```

> ⚠️ **Store the `token` securely.** Use iOS Keychain or Android Keystore — never plain SharedPreferences or AsyncStorage.

**Error Responses:**
| Status | Error | Cause |
|---|---|---|
| 400 | `PIN not set. Please set your PIN first.` | User skipped set-pin step |
| 401 | `Invalid RFID tag or PIN` | Wrong credentials (intentionally vague) |
| 403 | `Account is inactive` | Admin deactivated account |

---

#### `POST /api/mobile/auth/logout`

> **Protected** — Requires `Authorization` header.

Logs out the user by incrementing the token version on the server. This instantly invalidates **all** previously issued tokens for this user (including on other devices).

**Request Body:** _(empty)_

**Success Response (200):**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

#### `POST /api/mobile/auth/refresh`

> **Protected** — Requires `Authorization` header.

Issues a new JWT token without requiring the user to re-enter credentials. Use this to silently extend the session before a token expires.

**Request Body:** _(empty)_

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiJ9...",
    "user": {
      "rfid_user_id": 5,
      "rfid_tag": "RFID-007",
      "name": "John Doe",
      "type": "postpaid",
      "email": "john@example.com",
      "phone": "+91-9876543210",
      "active": true,
      "app_token_version": 3
    }
  }
}
```

---

### 4.2 Profile Endpoint

#### `GET /api/mobile/profile`

> **Protected** — Requires `Authorization` header.

Returns the full profile of the logged-in user.

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "rfid_user_id": 5,
    "rfid_tag": "RFID-007",
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+91-9876543210",
    "company_name": "EV Corp",
    "address": "123 Main St, Mumbai",
    "type": "postpaid",
    "active": true,
    "createdAt": "2025-01-15T10:00:00.000Z"
  }
}
```

---

### 4.3 Sessions Endpoints

#### `GET /api/mobile/sessions`

> **Protected** — Requires `Authorization` header.

Returns a **paginated** list of the current user's charging sessions, newest first.

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | number | `1` | Page number |
| `limit` | number | `20` | Records per page (max recommended: 50) |
| `status` | string | _(all)_ | Filter by status: `charging`, `completed`, `initiated` |

**Example Request:**
```
GET /api/mobile/sessions?page=1&limit=10&status=completed
```

**Success Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 42,
      "transactionId": 101,
      "rfidUserId": 5,
      "charger_id": 3,
      "connectorName": "Connector 1",
      "startTime": "2025-04-01T09:00:00.000Z",
      "endTime": "2025-04-01T10:30:00.000Z",
      "initialMeterValue": 1200.0,
      "finalMeterValue": 1230.0,
      "energyConsumed": 30.0,
      "tariffRate": 8.5,
      "amountDue": 255.0,
      "status": "completed",
      "charger": {
        "name": "Charger-01",
        "chargingStation": {
          "station_name": "Downtown Hub",
          "city": "Mumbai"
        }
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 34,
    "totalPages": 4
  }
}
```

**Session Status Values:**
| Status | Meaning |
|---|---|
| `initiated` | Remote start was sent, session pending |
| `charging` | Session actively in progress |
| `completed` | Session ended normally |

---

#### `GET /api/mobile/sessions/:id`

> **Protected** — Requires `Authorization` header.

Returns a single session by its ID. Only returns the session if it belongs to the authenticated user (ownership enforced).

**Example Request:**
```
GET /api/mobile/sessions/42
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 42,
    "transactionId": 101,
    "rfidUserId": 5,
    "charger_id": 3,
    "connectorName": "Connector 1",
    "startTime": "2025-04-01T09:00:00.000Z",
    "endTime": "2025-04-01T10:30:00.000Z",
    "initialMeterValue": 1200.0,
    "finalMeterValue": 1230.0,
    "energyConsumed": 30.0,
    "tariffRate": 8.5,
    "amountDue": 255.0,
    "status": "completed",
    "charger": {
      "name": "Charger-01",
      "chargingStation": {
        "station_name": "Downtown Hub",
        "city": "Mumbai",
        "latitude": 19.076,
        "longitude": 72.877
      }
    }
  }
}
```

**Error Responses:**
| Status | Error | Cause |
|---|---|---|
| 404 | `Session not found` | Session doesn't exist or belongs to another user |

---

### 4.4 Chargers Endpoints

#### `GET /api/mobile/chargers`

> **Protected** — Requires `Authorization` header.

Returns all **active or online** chargers. Use this to show a map or list of available charging points.

**Success Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "charger_id": 3,
      "name": "Charger-01",
      "status": "online",
      "power_capacity": 22.0,
      "latitude": 19.076,
      "longitude": 72.877,
      "chargingStation": {
        "station_name": "Downtown Hub",
        "city": "Mumbai",
        "state": "Maharashtra",
        "latitude": 19.076,
        "longitude": 72.877
      },
      "connectors": [
        {
          "connector_id": 1,
          "connector_name": "Connector 1",
          "status": "Available",
          "current_type": "AC",
          "max_power": 7.4
        }
      ],
      "tariffs": [
        {
          "tariff_name": "Standard",
          "charge": 8.5,
          "electricity_rate": 6.5
        }
      ]
    }
  ]
}
```

**Charger Status Values:**
| Status | Meaning |
|---|---|
| `online` | Connected and ready |
| `active` | Online and potentially in use |
| `offline` | Not connected to OCPP server |

**Connector Status Values (OCPP standard):**
| Status | Meaning for User |
|---|---|
| `Available` | Ready to start charging |
| `Preparing` | Charger is preparing for session |
| `Charging` | Session in progress |
| `SuspendedEV` | Session paused by vehicle |
| `SuspendedEVSE` | Session paused by charger |
| `Finishing` | Session ending |
| `Faulted` | Hardware error |
| `Unavailable` | Taken offline by admin |

---

#### `GET /api/mobile/chargers/:id`

> **Protected** — Requires `Authorization` header.

Returns full details of a single charger, including model and manufacturer info.

**Example Request:**
```
GET /api/mobile/chargers/3
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "charger_id": 3,
    "name": "Charger-01",
    "model": "ABB Terra AC",
    "manufacturer": "ABB",
    "status": "online",
    "power_capacity": 22.0,
    "latitude": 19.076,
    "longitude": 72.877,
    "last_heartbeat": "2025-04-04T09:55:00.000Z",
    "chargingStation": {
      "station_name": "Downtown Hub",
      "city": "Mumbai",
      "state": "Maharashtra",
      "latitude": 19.076,
      "longitude": 72.877
    },
    "connectors": [
      {
        "connector_id": 1,
        "connector_name": "Connector 1",
        "status": "Available",
        "current_type": "AC",
        "max_power": 7.4
      }
    ],
    "tariffs": [
      {
        "tariff_name": "Standard",
        "charge": 8.5,
        "electricity_rate": 6.5
      }
    ]
  }
}
```

**Error Responses:**
| Status | Error | Cause |
|---|---|---|
| 404 | `Charger not found` | Invalid charger ID |

---

### 4.5 Remote Control Endpoints

> ⚡ These endpoints send OCPP commands to physical charger hardware. Handle responses carefully.

#### `POST /api/mobile/remote-start`

> **Protected** — Requires `Authorization` header.

Sends a **RemoteStartTransaction** OCPP command to a charger on behalf of the user. The RFID tag from the user's token is automatically used as the `idTag`, so no physical card tap is needed.

**Pre-conditions the server checks:**
- Charger must exist and not be offline
- Connector must be in `Available` status

**Request Body:**
```json
{
  "chargerId": 3,
  "connectorId": 1
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `chargerId` | number | ✅ | ID of the charger (`charger_id` from `/chargers`) |
| `connectorId` | number | ✅ | ID of the connector (`connector_id` from charger details) |

**Success Response (200):**
```json
{
  "success": true,
  "message": "Remote start sent to charger",
  "data": {
    "chargerId": 3,
    "connectorId": 1,
    "idTag": "RFID-007"
  }
}
```

> ⚠️ **Important:** A `200 OK` means the OCPP command was **sent and accepted** by the charger. The actual charging session starts asynchronously. Poll `/api/mobile/sessions?status=charging` or `/api/mobile/sessions?status=initiated` to verify the session has started.

**Error Responses:**
| Status | Error | Cause |
|---|---|---|
| 400 | `chargerId and connectorId are required` | Missing body fields |
| 400 | `Charger is offline` | Charger not connected |
| 400 | `Connector is Charging, not Available` | Connector busy |
| 400 | `Remote start rejected` | Charger hardware rejected the command |
| 404 | `Charger not found` | Invalid charger ID |
| 404 | `Connector not found` | Invalid connector ID |

---

#### `POST /api/mobile/remote-stop`

> **Protected** — Requires `Authorization` header.

Sends a **RemoteStopTransaction** OCPP command. Only works for sessions **belonging to the authenticated user** that are in `charging` or `initiated` status.

**Request Body:**
```json
{
  "transactionId": 101
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `transactionId` | number | ✅ | The `transactionId` from an active session |

**Success Response (200):**
```json
{
  "success": true,
  "message": "Remote stop sent to charger",
  "data": {
    "transactionId": 101
  }
}
```

**Error Responses:**
| Status | Error | Cause |
|---|---|---|
| 400 | `transactionId is required` | Missing body field |
| 400 | `Remote stop rejected` | Charger hardware rejected the command |
| 404 | `Active session not found or does not belong to you` | Wrong ID or session belongs to another user |

---

## 5. Data Models

### RfidUser (Mobile App User)

```typescript
{
  rfid_user_id:  number;    // Primary key
  rfid_tag:       string;    // Unique RFID identifier (e.g., "RFID-007")
  name:           string;    // Display name
  email:          string | null;
  phone:          string | null;
  company_name:   string | null;
  address:        string | null;
  type:           "postpaid" | string;  // billing type
  active:         boolean;   // false = account disabled by admin
  createdAt:      string;    // ISO 8601 datetime
}
```

### RfidSession (Charging Session)

```typescript
{
  id:                number;    // Session primary key
  transactionId:     number;    // OCPP transaction ID (use for remote-stop)
  rfidUserId:        number;    // Owner of this session
  charger_id:        number;
  connectorName:     string;
  startTime:         string;    // ISO 8601
  endTime:           string | null;  // null if session is ongoing
  initialMeterValue: number | null;  // Wh at start
  finalMeterValue:   number | null;  // Wh at end
  energyConsumed:    number;    // kWh consumed
  tariffRate:        number | null;  // ₹ per kWh
  amountDue:         number;    // Total bill amount
  status:            "initiated" | "charging" | "completed";
  charger: {
    name: string;
    chargingStation: {
      station_name: string;
      city: string;
      latitude?: number;
      longitude?: number;
    }
  }
}
```

### Charger

```typescript
{
  charger_id:      number;
  name:            string;
  model:           string;
  manufacturer:    string;
  status:          "online" | "active" | "offline" | "faulted";
  power_capacity:  number;   // kW
  latitude:        number | null;
  longitude:       number | null;
  last_heartbeat:  string;   // ISO 8601
  chargingStation: {
    station_name: string;
    city:         string;
    state:        string;
    latitude:     number;
    longitude:    number;
  };
  connectors: Array<{
    connector_id:    number;
    connector_name:  string;
    status:          string;  // OCPP status
    current_type:    "AC" | "DC";
    max_power:       number | null;  // kW
  }>;
  tariffs: Array<{
    tariff_name:      string;
    charge:           number;  // flat charge (₹)
    electricity_rate: number;  // per kWh rate (₹)
  }>;
}
```

---

## 6. Error Handling

### Standard Error Response

Every error from the API follows this shape:
```json
{
  "success": false,
  "error": "Human-readable error message"
}
```

### HTTP Status Codes

| Code | Meaning | App Behaviour |
|---|---|---|
| `200` | Success | Process the `data` field |
| `400` | Bad Request | Show validation error to user |
| `401` | Unauthorized | Token missing, expired, or invalidated → redirect to Login |
| `403` | Forbidden | Account inactive or wrong token type → show account status message |
| `404` | Not Found | Resource doesn't exist → show appropriate empty state |
| `500` | Server Error | Retry or show generic error message |

### Token Invalidation (401)

When the server returns `401` with `"Token has been invalidated. Please log in again."`, it means:
- The user logged out from another device
- An admin reset the token
- The server was restarted with a new secret

**Action:** Clear stored token and redirect to login.

---

## 7. User Flows

### Flow 1: First-Time Login

```
App Launch
    │
    ├──▶ User has no stored token
    │
    ▼
"Welcome" Screen
    │
    ├──▶ Enter RFID Tag (received from admin)
    ├──▶ Choose a 4–6 digit PIN
    │
    ▼
POST /api/mobile/auth/set-pin
    │
    ├── 200 OK  ──▶ Show "PIN set! Now log in" ──▶ Login Screen
    ├── 400 (PIN already set) ──▶ "Already registered. Please log in."
    └── 404 ──▶ "RFID tag not recognized. Contact support."
```

### Flow 2: Login

```
Login Screen
    │
    ├──▶ Enter RFID Tag + PIN
    │
    ▼
POST /api/mobile/auth/login
    │
    ├── 200 OK  ──▶ Store token securely ──▶ Home Screen
    ├── 401 ──▶ "Invalid credentials"
    ├── 400 (PIN not set) ──▶ Navigate to set-pin screen
    └── 403 ──▶ "Account inactive. Contact support."
```

### Flow 3: Start a Charging Session

```
Home / Map Screen
    │
    ├──▶ GET /api/mobile/chargers  →  Show charger map pins
    │
    ▼
User taps a charger pin
    │
    ├──▶ GET /api/mobile/chargers/:id  →  Show charger detail
    │       (status, connectors, tariff)
    │
    ├──▶ User selects an "Available" connector
    │
    ▼
POST /api/mobile/remote-start
    { chargerId, connectorId }
    │
    ├── 200 OK ──▶ Show "Starting..." with a loader
    │       │
    │       └──▶ Poll GET /api/mobile/sessions?status=charging
    │               │
    │               └── Session found ──▶ Show "Charging" live screen
    │
    ├── 400 (offline/busy) ──▶ Show specific error
    └── 500 ──▶ "Failed to start. Please try again."
```

### Flow 4: Stop a Charging Session

```
Active Session Screen
    │
    ├── Display: time elapsed, energy used (estimated), current session info
    │
    ├──▶ User taps "Stop Charging"
    │
    ▼
POST /api/mobile/remote-stop
    { transactionId: <from active session> }
    │
    ├── 200 OK ──▶ "Session stopping..." loader
    │       │
    │       └──▶ Poll session status until "completed"
    │               └──▶ Show Session Summary screen
    │
    └── 400 ──▶ Show error message
```

### Flow 5: View History

```
History / Sessions Screen
    │
    ▼
GET /api/mobile/sessions?page=1&limit=20
    │
    ├──▶ Display paginated list
    │
    ├──▶ User taps a session
    │
    ▼
GET /api/mobile/sessions/:id
    │
    └──▶ Show session detail (energy, cost, location, time)
```

---

## 8. Security Notes

### Token Storage
- **iOS:** Use `SecureEnclave` / `Keychain`
- **Android:** Use `EncryptedSharedPreferences` / `Android Keystore`
- **React Native:** Use `react-native-keychain` or `expo-secure-store`
- **Flutter:** Use `flutter_secure_storage`
- **Never** store tokens in plain `SharedPreferences`, `localStorage`, or `AsyncStorage`

### Token Expiry
- Token expires in **7 days** by default
- Implement silent refresh: call `POST /api/mobile/auth/refresh` when the token is within 24 hours of expiry

### PIN Security
- PIN is hashed server-side using **bcrypt** (10 rounds) — never stored in plaintext
- The app should mask PIN input (standard password field)
- Consider adding PIN attempt limiting client-side to prevent brute force

### Network Security
- Always use **HTTPS** in production
- Pin the SSL certificate if distributing the app in high-security environments
- Include a `User-Agent` header identifying your app version for server-side logging

---

## 9. Recommended App Features

Based on the available API, here's a suggested feature set for the mobile app:

### Core Features
- [ ] **Onboarding / PIN Setup** (set-pin flow for new users)
- [ ] **Login / Logout** with secure token storage
- [ ] **Home Screen** with nearby chargers on a map (using lat/lng from API)
- [ ] **Charger Detail** page with connector availability and pricing
- [ ] **Remote Start** — one-tap start charging
- [ ] **Remote Stop** — stop active session with confirmation
- [ ] **Active Session Screen** — live view of ongoing charge
- [ ] **Session History** — paginated list with filter by status
- [ ] **Session Detail** — energy, cost, location, duration
- [ ] **Profile Screen** — user info (name, email, phone, RFID tag)

### Nice-to-Have Features
- [ ] **Push Notifications** — session started / stopped (requires backend webhook/push integration)
- [ ] **Map clustering** for charger pins
- [ ] **Offline Mode** — cache last-known charger list
- [ ] **Cost Estimate** — calculate cost per minute using tariff rate
- [ ] **Session Timer** — elapsed time display for active session
- [ ] **Filter Chargers** by availability / connector type
- [ ] **Dark Mode** support

---

## Environment Variables Reference

These are the server-side variables that affect mobile behavior. Contact your backend team for production values:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | API server port |
| `MOBILE_JWT_SECRET` | _(change in prod)_ | JWT signing secret for mobile tokens |
| `MOBILE_JWT_EXPIRES_IN` | `7d` | Token expiry duration |

---

## Contact & Support

For API issues, schema changes, or new feature requests, reach out to the backend team and reference:
- API namespace: `/api/mobile`
- Backend source: `Backend/src/api/mobile/`
- Auth middleware: `Backend/src/middleware/mobileAuth.ts`
- GitHub: [https://github.com/savekar-ev/OCPP-1.6-Charging-Point-Management-System](https://github.com/savekar-ev/OCPP-1.6-Charging-Point-Management-System)

---

*This document reflects the current state of the `/api/mobile` namespace as of April 2025.*
