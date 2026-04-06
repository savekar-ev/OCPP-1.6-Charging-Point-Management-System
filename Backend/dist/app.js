import express from "express";
import cors from "cors";
import { config } from "./config/index.js";
import { logger } from "./utils/logger.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { authenticateToken } from "./middleware/auth.js";
// Import API routes
import authRoutes from "./api/auth/auth.routes.js";
import chargersRoutes from "./api/chargers/chargers.routes.js";
import stationsRoutes from "./api/stations/stations.routes.js";
import connectorsRoutes from "./api/connectors/connectors.routes.js";
import rfidRoutes from "./api/rfid/rfid.routes.js";
import tariffsRoutes from "./api/tariffs/tariffs.routes.js";
import transactionsRoutes from "./api/transactions/transactions.routes.js";
import ocppRoutes from "./api/ocpp/ocpp.routes.js";
import dashboardRoutes from "./api/dashboard/dashboard.routes.js";
import mobileRoutes from "./api/mobile/mobile.routes.js";
// Import OCPP servers
import { ocppServer } from "./ocpp/ocppServer.js";
import { ocppLogsServer } from "./ocpp/logsWebSocket.js";
/**
 * Create and configure Express application
 */
export function createApp() {
    const app = express();
    // Security middleware
    app.use(cors());
    // Body parser
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    // Request logging
    app.use((req, res, next) => {
        logger.info(`${req.method} ${req.path}`);
        next();
    });
    // Health check endpoint
    app.get("/health", (req, res) => {
        res.json({
            success: true,
            status: "healthy",
            timestamp: new Date().toISOString(),
            version: "1.0.0",
        });
    });
    // API Routes
    app.use("/api/auth", authRoutes);
    app.use("/api/chargers", authenticateToken, chargersRoutes);
    app.use("/api/stations", authenticateToken, stationsRoutes);
    app.use("/api/connectors", authenticateToken, connectorsRoutes);
    app.use("/api/rfid", authenticateToken, rfidRoutes);
    app.use("/api/tariffs", authenticateToken, tariffsRoutes);
    app.use("/api/transactions", authenticateToken, transactionsRoutes);
    app.use("/api/ocpp", authenticateToken, ocppRoutes);
    app.use("/api/dashboard", authenticateToken, dashboardRoutes);
    app.use("/api/mobile", mobileRoutes); // Mobile app — uses its own mobileAuth middleware internally
    // Error handling
    app.use(notFoundHandler);
    app.use(errorHandler);
    return app;
}
/**
 * Start all servers
 */
export function startServers() {
    // Start OCPP WebSocket server
    ocppServer.start();
    // Start OCPP logs WebSocket server
    ocppLogsServer.start();
    // Create and start Express app
    const app = createApp();
    app.listen(config.port, () => {
        logger.info(`Express API server listening on port ${config.port}`);
        logger.info(`OCPP WebSocket server on port ${config.ocppPort}`);
        logger.info(`OCPP logs WebSocket on port ${config.ocppLogsPort}`);
        logger.info("All servers started successfully");
    });
    // Graceful shutdown
    const shutdown = (signal) => {
        logger.info(`Received ${signal}. Shutting down gracefully...`);
        ocppServer.stop();
        ocppLogsServer.stop();
        process.exit(0);
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
}
