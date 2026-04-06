import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config/index.js";
import { prisma } from "../config/database.js";
import { logger } from "../utils/logger.js";

export interface MobileAuthRequest extends Request {
  rfidUserId?: number;
  rfidTag?: string;
}

export interface MobileTokenPayload {
  rfidUserId: number;
  rfidTag: string;
  tokenVersion: number;
  role: "rfid_user";
  iat?: number;
  exp?: number;
}

/**
 * Generate JWT token for a mobile RFID user
 */
export function generateMobileToken(
  rfidUserId: number,
  rfidTag: string,
  tokenVersion: number
): string {
  const payload: Omit<MobileTokenPayload, "iat" | "exp"> = {
    rfidUserId,
    rfidTag,
    tokenVersion,
    role: "rfid_user",
  };
  return jwt.sign(payload, config.mobileJwtSecret, {
    expiresIn: config.mobileJwtExpiresIn as any,
  });
}

/**
 * Middleware to verify mobile JWT token and validate token version (supports logout)
 */
export async function authenticateMobileToken(
  req: MobileAuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    res.status(401).json({ success: false, error: "Access token required" });
    return;
  }

  let decoded: MobileTokenPayload;
  try {
    decoded = jwt.verify(token, config.mobileJwtSecret) as MobileTokenPayload;
  } catch (error) {
    logger.error(`Mobile JWT verification failed: ${error}`);
    res.status(403).json({ success: false, error: "Invalid or expired token" });
    return;
  }

  if (decoded.role !== "rfid_user") {
    res.status(403).json({ success: false, error: "Invalid token type" });
    return;
  }

  // Validate token version against DB to support instant logout
  const rfidUser = await prisma.rfidUser.findUnique({
    where: { rfid_user_id: decoded.rfidUserId },
    select: { rfid_user_id: true, active: true, app_token_version: true },
  });

  if (!rfidUser) {
    res.status(401).json({ success: false, error: "User not found" });
    return;
  }

  if (!rfidUser.active) {
    res.status(403).json({ success: false, error: "Account is inactive" });
    return;
  }

  if (rfidUser.app_token_version !== decoded.tokenVersion) {
    res.status(401).json({
      success: false,
      error: "Token has been invalidated. Please log in again.",
    });
    return;
  }

  req.rfidUserId = decoded.rfidUserId;
  req.rfidTag = decoded.rfidTag;
  next();
}
