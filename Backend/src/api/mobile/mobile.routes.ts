import { Router, Request, Response } from "express";
import { authenticateMobileToken } from "../../middleware/mobileAuth.js";
import {
  setPin,
  login,
  logout,
  refresh,
  getProfile,
  getSessions,
  getSessionById,
  getChargers,
  getChargerById,
  mobileRemoteStart,
  mobileRemoteStop,
} from "./mobile.controller.js";

const router = Router();

// ─── Public Auth Routes (no token required) ───────────────────────────────────
router.post("/auth/set-pin", setPin);
router.post("/auth/login", login);

// ─── Protected Auth Routes ──────────────────────────────────────────────────
router.post("/auth/logout", authenticateMobileToken, (req, res) =>
  logout(req as any, res)
);
router.post("/auth/refresh", authenticateMobileToken, (req, res) =>
  refresh(req as any, res)
);

// ─── Profile ────────────────────────────────────────────────────────────────
router.get("/profile", authenticateMobileToken, (req, res) =>
  getProfile(req as any, res)
);

// ─── Sessions ───────────────────────────────────────────────────────────────
router.get("/sessions", authenticateMobileToken, (req, res) =>
  getSessions(req as any, res)
);
router.get("/sessions/:id", authenticateMobileToken, (req, res) =>
  getSessionById(req as any, res)
);

// ─── Chargers ───────────────────────────────────────────────────────────────
router.get("/chargers", authenticateMobileToken, (req, res) =>
  getChargers(req as any, res)
);
router.get("/chargers/:id", authenticateMobileToken, (req, res) =>
  getChargerById(req as any, res)
);

// ─── Remote Control ─────────────────────────────────────────────────────────
router.post("/remote-start", authenticateMobileToken, (req, res) =>
  mobileRemoteStart(req as any, res)
);
router.post("/remote-stop", authenticateMobileToken, (req, res) =>
  mobileRemoteStop(req as any, res)
);

export default router;
