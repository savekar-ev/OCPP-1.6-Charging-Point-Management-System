import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { prisma } from "../../config/database.js";
import { logger } from "../../utils/logger.js";
import {
  generateMobileToken,
  MobileAuthRequest,
} from "../../middleware/mobileAuth.js";
import {
  remoteStartTransaction,
  remoteStopTransaction,
} from "../../ocpp/remoteControl.js";

// ─────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────

/**
 * POST /api/mobile/auth/set-pin
 * First-time PIN setup (or reset if pin not yet set). No auth required.
 * Body: { rfid_tag, pin (4–6 digits) }
 */
export const setPin = async (req: Request, res: Response): Promise<void> => {
  const { rfid_tag, pin } = req.body;

  if (!rfid_tag || !pin) {
    res.status(400).json({ success: false, error: "rfid_tag and pin are required" });
    return;
  }

  if (!/^\d{4,6}$/.test(pin)) {
    res.status(400).json({ success: false, error: "PIN must be 4–6 digits" });
    return;
  }

  try {
    const rfidUser = await prisma.rfidUser.findUnique({ where: { rfid_tag } });

    if (!rfidUser) {
      res.status(404).json({ success: false, error: "RFID tag not found" });
      return;
    }

    if (!rfidUser.active) {
      res.status(403).json({ success: false, error: "Account is inactive" });
      return;
    }

    if (rfidUser.pin) {
      res.status(400).json({
        success: false,
        error: "PIN already set. Contact admin to reset.",
      });
      return;
    }

    const hashedPin = await bcrypt.hash(pin, 10);
    await prisma.rfidUser.update({
      where: { rfid_user_id: rfidUser.rfid_user_id },
      data: { pin: hashedPin },
    });

    logger.info(`PIN set for RFID user: ${rfidUser.name} (${rfid_tag})`);
    res.json({ success: true, message: "PIN set successfully. You can now log in." });
  } catch (error) {
    logger.error(`Error setting PIN: ${error}`);
    res.status(500).json({ success: false, error: "Failed to set PIN" });
  }
};

/**
 * POST /api/mobile/auth/login
 * Body: { rfid_tag, pin }
 * Returns: { token, user: { id, name, rfid_tag, type, email, phone } }
 */
export const login = async (req: Request, res: Response): Promise<void> => {
  const { rfid_tag, pin } = req.body;

  if (!rfid_tag || !pin) {
    res.status(400).json({ success: false, error: "rfid_tag and pin are required" });
    return;
  }

  try {
    const rfidUser = await prisma.rfidUser.findUnique({ where: { rfid_tag } });

    if (!rfidUser) {
      res.status(401).json({ success: false, error: "Invalid RFID tag or PIN" });
      return;
    }

    if (!rfidUser.active) {
      res.status(403).json({ success: false, error: "Account is inactive" });
      return;
    }

    if (!rfidUser.pin) {
      res.status(400).json({
        success: false,
        error: "PIN not set. Please set your PIN first.",
      });
      return;
    }

    const validPin = await bcrypt.compare(pin, rfidUser.pin);
    if (!validPin) {
      res.status(401).json({ success: false, error: "Invalid RFID tag or PIN" });
      return;
    }

    const token = generateMobileToken(
      rfidUser.rfid_user_id,
      rfidUser.rfid_tag,
      rfidUser.app_token_version
    );

    logger.info(`Mobile login: RFID user ${rfidUser.name} (${rfid_tag})`);
    res.json({
      success: true,
      data: {
        token,
        user: {
          id: rfidUser.rfid_user_id,
          name: rfidUser.name,
          rfid_tag: rfidUser.rfid_tag,
          type: rfidUser.type,
          email: rfidUser.email,
          phone: rfidUser.phone,
        },
      },
    });
  } catch (error) {
    logger.error(`Mobile login error: ${error}`);
    res.status(500).json({ success: false, error: "Login failed" });
  }
};

/**
 * POST /api/mobile/auth/logout  (requires mobileAuth)
 * Increments app_token_version to invalidate all existing tokens
 */
export const logout = async (req: MobileAuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.rfidUser.update({
      where: { rfid_user_id: req.rfidUserId! },
      data: { app_token_version: { increment: 1 } },
    });

    logger.info(`Mobile logout: RFID user ${req.rfidUserId}`);
    res.json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    logger.error(`Mobile logout error: ${error}`);
    res.status(500).json({ success: false, error: "Logout failed" });
  }
};

/**
 * POST /api/mobile/auth/refresh  (requires mobileAuth)
 * Returns a fresh token + latest profile
 */
export const refresh = async (req: MobileAuthRequest, res: Response): Promise<void> => {
  try {
    const rfidUser = await prisma.rfidUser.findUnique({
      where: { rfid_user_id: req.rfidUserId! },
      select: {
        rfid_user_id: true,
        rfid_tag: true,
        name: true,
        type: true,
        email: true,
        phone: true,
        active: true,
        app_token_version: true,
      },
    });

    if (!rfidUser) {
      res.status(404).json({ success: false, error: "User not found" });
      return;
    }

    const token = generateMobileToken(
      rfidUser.rfid_user_id,
      rfidUser.rfid_tag,
      rfidUser.app_token_version
    );

    res.json({ success: true, data: { token, user: rfidUser } });
  } catch (error) {
    logger.error(`Mobile refresh error: ${error}`);
    res.status(500).json({ success: false, error: "Token refresh failed" });
  }
};

// ─────────────────────────────────────────────
// PROFILE
// ─────────────────────────────────────────────

/**
 * GET /api/mobile/profile  (requires mobileAuth)
 */
export const getProfile = async (req: MobileAuthRequest, res: Response): Promise<void> => {
  try {
    const rfidUser = await prisma.rfidUser.findUnique({
      where: { rfid_user_id: req.rfidUserId! },
      select: {
        rfid_user_id: true,
        rfid_tag: true,
        name: true,
        email: true,
        phone: true,
        company_name: true,
        address: true,
        type: true,
        active: true,
        createdAt: true,
      },
    });

    if (!rfidUser) {
      res.status(404).json({ success: false, error: "User not found" });
      return;
    }

    res.json({ success: true, data: rfidUser });
  } catch (error) {
    logger.error(`Mobile getProfile error: ${error}`);
    res.status(500).json({ success: false, error: "Failed to get profile" });
  }
};

// ─────────────────────────────────────────────
// SESSIONS
// ─────────────────────────────────────────────

/**
 * GET /api/mobile/sessions  (requires mobileAuth)
 * Query: page, limit, status
 */
export const getSessions = async (req: MobileAuthRequest, res: Response): Promise<void> => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const where: any = { rfidUserId: req.rfidUserId };
    if (status) where.status = status;

    const [sessions, total] = await Promise.all([
      prisma.rfidSession.findMany({
        where,
        skip,
        take,
        orderBy: { startTime: "desc" },
        include: {
          charger: {
            select: {
              name: true,
              chargingStation: { select: { station_name: true, city: true } },
            },
          },
        },
      }),
      prisma.rfidSession.count({ where }),
    ]);

    res.json({
      success: true,
      data: sessions,
      pagination: {
        page: Number(page),
        limit: take,
        total,
        totalPages: Math.ceil(total / take),
      },
    });
  } catch (error) {
    logger.error(`Mobile getSessions error: ${error}`);
    res.status(500).json({ success: false, error: "Failed to get sessions" });
  }
};

/**
 * GET /api/mobile/sessions/:id  (requires mobileAuth)
 */
export const getSessionById = async (req: MobileAuthRequest, res: Response): Promise<void> => {
  try {
    const sessionId = parseInt(req.params.id as string);

    const session = await prisma.rfidSession.findFirst({
      where: { id: sessionId, rfidUserId: req.rfidUserId },
      include: {
        charger: {
          select: {
            name: true,
            chargingStation: { select: { station_name: true, city: true, latitude: true, longitude: true } },
          },
        },
      },
    });

    if (!session) {
      res.status(404).json({ success: false, error: "Session not found" });
      return;
    }

    res.json({ success: true, data: session });
  } catch (error) {
    logger.error(`Mobile getSessionById error: ${error}`);
    res.status(500).json({ success: false, error: "Failed to get session" });
  }
};

// ─────────────────────────────────────────────
// CHARGERS
// ─────────────────────────────────────────────

/**
 * GET /api/mobile/chargers  (requires mobileAuth)
 * Lists all active/online chargers with location & tariff info
 */
export const getChargers = async (req: MobileAuthRequest, res: Response): Promise<void> => {
  try {
    const chargers = await prisma.charger.findMany({
      where: { status: { in: ["active", "online"] } },
      select: {
        charger_id: true,
        name: true,
        status: true,
        power_capacity: true,
        latitude: true,
        longitude: true,
        chargingStation: {
          select: {
            station_name: true,
            city: true,
            state: true,
            latitude: true,
            longitude: true,
          },
        },
        connectors: {
          select: {
            connector_id: true,
            connector_name: true,
            status: true,
            current_type: true,
            max_power: true,
          },
        },
        tariffs: {
          select: { tariff_name: true, charge: true, electricity_rate: true },
          take: 1,
        },
      },
      orderBy: { name: "asc" },
    });

    res.json({ success: true, data: chargers });
  } catch (error) {
    logger.error(`Mobile getChargers error: ${error}`);
    res.status(500).json({ success: false, error: "Failed to get chargers" });
  }
};

/**
 * GET /api/mobile/chargers/:id  (requires mobileAuth)
 */
export const getChargerById = async (req: MobileAuthRequest, res: Response): Promise<void> => {
  try {
    const chargerId = parseInt(req.params.id as string);

    const charger = await prisma.charger.findUnique({
      where: { charger_id: chargerId },
      select: {
        charger_id: true,
        name: true,
        model: true,
        manufacturer: true,
        status: true,
        power_capacity: true,
        latitude: true,
        longitude: true,
        last_heartbeat: true,
        chargingStation: {
          select: { station_name: true, city: true, state: true, latitude: true, longitude: true },
        },
        connectors: {
          select: {
            connector_id: true,
            connector_name: true,
            status: true,
            current_type: true,
            max_power: true,
          },
        },
        tariffs: {
          select: { tariff_name: true, charge: true, electricity_rate: true },
          take: 1,
        },
      },
    });

    if (!charger) {
      res.status(404).json({ success: false, error: "Charger not found" });
      return;
    }

    res.json({ success: true, data: charger });
  } catch (error) {
    logger.error(`Mobile getChargerById error: ${error}`);
    res.status(500).json({ success: false, error: "Failed to get charger" });
  }
};

// ─────────────────────────────────────────────
// REMOTE CONTROL
// ─────────────────────────────────────────────

/**
 * POST /api/mobile/remote-start  (requires mobileAuth)
 * Body: { chargerId, connectorId }
 * Uses the authenticated user's own RFID tag as idTag
 */
export const mobileRemoteStart = async (req: MobileAuthRequest, res: Response): Promise<void> => {
  const { chargerId, connectorId } = req.body;

  if (!chargerId || !connectorId) {
    res.status(400).json({ success: false, error: "chargerId and connectorId are required" });
    return;
  }

  try {
    // Verify charger exists and is online
    const charger = await prisma.charger.findUnique({
      where: { charger_id: Number(chargerId) },
      select: { charger_id: true, name: true, status: true },
    });

    if (!charger) {
      res.status(404).json({ success: false, error: "Charger not found" });
      return;
    }

    if (charger.status === "offline") {
      res.status(400).json({ success: false, error: "Charger is offline" });
      return;
    }

    // Verify connector is available
    const connector = await prisma.connector.findFirst({
      where: { charger_id: Number(chargerId), connector_id: Number(connectorId) },
    });

    if (!connector) {
      res.status(404).json({ success: false, error: "Connector not found" });
      return;
    }

    if (connector.status !== "Available") {
      res.status(400).json({
        success: false,
        error: `Connector is ${connector.status}, not Available`,
      });
      return;
    }

    // Send RemoteStartTransaction using own RFID tag
    const result = await remoteStartTransaction({
      chargerId: Number(chargerId),
      connectorId: Number(connectorId),
      idTag: req.rfidTag!,
    });

    if (result.status === "Rejected") {
      res.status(400).json({ success: false, error: result.error || "Remote start rejected" });
      return;
    }

    logger.info(`Mobile RemoteStart: user ${req.rfidUserId} → charger ${chargerId}`);
    res.json({
      success: true,
      message: "Remote start sent to charger",
      data: { chargerId, connectorId, idTag: req.rfidTag },
    });
  } catch (error) {
    logger.error(`Mobile remoteStart error: ${error}`);
    res.status(500).json({ success: false, error: "Failed to send remote start" });
  }
};

/**
 * POST /api/mobile/remote-stop  (requires mobileAuth)
 * Body: { transactionId }
 * Only allowed if the session belongs to the authenticated user
 */
export const mobileRemoteStop = async (req: MobileAuthRequest, res: Response): Promise<void> => {
  const { transactionId } = req.body;

  if (!transactionId) {
    res.status(400).json({ success: false, error: "transactionId is required" });
    return;
  }

  try {
    // Look up the active session and verify ownership
    const session = await prisma.rfidSession.findFirst({
      where: {
        transactionId: Number(transactionId),
        rfidUserId: req.rfidUserId,
        status: { in: ["charging", "initiated"] },
      },
    });

    if (!session) {
      res.status(404).json({
        success: false,
        error: "Active session not found or does not belong to you",
      });
      return;
    }

    const result = await remoteStopTransaction({
      chargerId: session.charger_id,
      transactionId: Number(transactionId),
    });

    if (result.status === "Rejected") {
      res.status(400).json({ success: false, error: result.error || "Remote stop rejected" });
      return;
    }

    logger.info(`Mobile RemoteStop: user ${req.rfidUserId} → transaction ${transactionId}`);
    res.json({
      success: true,
      message: "Remote stop sent to charger",
      data: { transactionId },
    });
  } catch (error) {
    logger.error(`Mobile remoteStop error: ${error}`);
    res.status(500).json({ success: false, error: "Failed to send remote stop" });
  }
};
