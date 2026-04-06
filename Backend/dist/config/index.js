import "dotenv/config";
export const config = {
    // Server Configuration
    port: parseInt(process.env.PORT || "3000", 10),
    nodeEnv: process.env.NODE_ENV || "development",
    // OCPP Configuration
    ocppPort: parseInt(process.env.OCPP_PORT || "9220", 10),
    heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL_SECONDS || "300", 10),
    offlineThreshold: parseInt(process.env.OFFLINE_THRESHOLD_SECONDS || "60", 10),
    ocppProtocolVersion: "1.6",
    // OCPP Logs WebSocket
    ocppLogsPort: parseInt(process.env.OCPP_LOG_WS_PORT || "3001", 10),
    // JWT Authentication
    jwtSecret: process.env.JWT_SECRET || "your-jwt-secret-key-change-in-production",
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "24h",
    // Mobile App JWT (separate secret for RFID users)
    mobileJwtSecret: process.env.MOBILE_JWT_SECRET || "mobile-jwt-secret-change-in-production",
    mobileJwtExpiresIn: process.env.MOBILE_JWT_EXPIRES_IN || "7d",
    // Logging
    logLevel: process.env.LOG_LEVEL || "info",
};
export const logLevels = ["error", "warn", "info", "debug"];
