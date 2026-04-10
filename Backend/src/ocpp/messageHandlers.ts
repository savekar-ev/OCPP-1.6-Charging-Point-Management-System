import { prisma } from "../config/database.js";
import { chargerRegistry } from "./chargerRegistry.js";
import { logger } from "../utils/logger.js";
import type { OcppDirection } from "../types/index.js";
import { ocppLogsServer } from "./logsWebSocket.js";

/**
 * Log OCPP message to database and broadcast live
 */
export async function logOcppMessage(
  chargerId: number,
  direction: OcppDirection,
  message: any,
  transactionId?: number
): Promise<void> {
  try {
    const newLog = await prisma.ocppLog.create({
      data: {
        chargerId,
        direction,
        message: JSON.stringify(message ?? {}),
        transactionId,
      },
      include: { charger: true },
    });

    ocppLogsServer.broadcastLog(newLog as any);
  } catch (error) {
    logger.error(`Failed to log OCPP message: ${error}`);
  }
}

/**
 * Handle BootNotification from charger
 */
export async function handleBootNotification(
  chargerId: number,
  payload: any
): Promise<any> {
  logger.info(`BootNotification received from charger ${chargerId}`, payload);

  const { chargePointVendor, chargePointModel, chargePointSerialNumber } = payload;

  try {
    // Check if charger exists in database
    const charger = await prisma.charger.findUnique({
      where: { charger_id: chargerId },
    });

    if (!charger) {
      logger.warn(`Charger ${chargerId} not found in database. Rejecting.`);
      await logOcppMessage(chargerId, "in", payload);
      return {
        status: "Rejected",
        currentTime: new Date().toISOString(),
        interval: 300,
      };
    }

    // Update charger info if needed
    await prisma.charger.update({
      where: { charger_id: chargerId },
      data: { status: "active", last_heartbeat: new Date() },
    });

    // Update registry heartbeat
    chargerRegistry.updateHeartbeat(chargerId);

    const response = {
      status: "Accepted",
      currentTime: new Date().toISOString(),
      interval: 300,
    };

    await logOcppMessage(chargerId, "out", response);
    return response;
  } catch (error) {
    logger.error(`Error handling BootNotification: ${error}`);
    return {
      status: "Rejected",
      currentTime: new Date().toISOString(),
      interval: 300,
    };
  }
}

/**
 * Handle Heartbeat from charger
 */
export async function handleHeartbeat(
  chargerId: number,
  payload: any
): Promise<any> {
  try {
    // Update charger's last heartbeat in database
    await prisma.charger.update({
      where: { charger_id: chargerId },
      data: { last_heartbeat: new Date() },
    });

    // Update registry heartbeat
    chargerRegistry.updateHeartbeat(chargerId);

    const response = { currentTime: new Date().toISOString() };
    await logOcppMessage(chargerId, "out", response);
    return response;
  } catch (error) {
    logger.error(`Error handling Heartbeat: ${error}`);
    return { currentTime: new Date().toISOString() };
  }
}

/**
 * Handle Authorize request from charger
 */
export async function handleAuthorize(
  chargerId: number,
  payload: any
): Promise<any> {
  const { idTag } = payload;

  try {
    // Look up RFID tag in database
    const rfidUser = await prisma.rfidUser.findUnique({
      where: { rfid_tag: idTag },
    });

    if (!rfidUser || !rfidUser.active) {
      logger.warn(`Authorize rejected: RFID tag ${idTag} not found or inactive`);
      const response = {
        idTagInfo: {
          status: "Invalid",
        },
      };
      await logOcppMessage(chargerId, "out", response);
      return response;
    }

    logger.info(`Authorize accepted: RFID tag ${idTag} (${rfidUser.name})`);
    const response = {
      idTagInfo: {
        status: "Accepted",
      },
    };
    await logOcppMessage(chargerId, "out", response);
    return response;
  } catch (error) {
    logger.error(`Error handling Authorize: ${error}`);
    return { idTagInfo: { status: "Invalid" } };
  }
}

/**
 * Handle StartTransaction request from charger
 */
export async function handleStartTransaction(
  chargerId: number,
  payload: any
): Promise<any> {
  const { connectorId, idTag, meterStart, timestamp } = payload;

  try {
    // Generate transaction ID (timestamp in seconds)
    const transactionId = Math.floor(Date.now() / 1000);

    // Check if RFID tag is valid (if provided)
    let rfidUserId: number | undefined;
    if (idTag) {
      const rfidUser = await prisma.rfidUser.findUnique({
        where: { rfid_tag: idTag },
      });

      if (!rfidUser || !rfidUser.active) {
        const response = {
          transactionId: 0,
          idTagInfo: { status: "Invalid" },
        };
        await logOcppMessage(chargerId, "out", response, transactionId);
        return response;
      }

      rfidUserId = rfidUser.rfid_user_id;

      // Create RfidSession for postpaid users
      if (rfidUser.type === "postpaid") {
        await prisma.rfidSession.create({
          data: {
            transactionId,
            rfidUserId,
            charger_id: chargerId,
            connectorName: `Connector_${connectorId}`,
            initialMeterValue: meterStart,
            startTime: new Date(timestamp),
          },
        });
      }
    }

    // Create basic Transaction record
    await prisma.transaction.create({
      data: {
        transactionId,
        connectorName: `Connector_${connectorId}`,
        charger_id: chargerId,
        startTime: new Date(timestamp),
        initialMeterValue: meterStart,
        status: "initiated",
        idTag: idTag,
      },
    });

    // Register transaction in memory
    chargerRegistry.startTransaction(
      chargerId,
      transactionId,
      `Connector_${connectorId}`,
      idTag
    );

    logger.info(`Transaction ${transactionId} started on charger ${chargerId}, connector ${connectorId}`);
    const response = {
      transactionId,
      idTagInfo: { status: "Accepted" },
    };
    await logOcppMessage(chargerId, "out", response, transactionId);
    return response;
  } catch (error) {
    logger.error(`Error handling StartTransaction: ${error}`);
    return { transactionId: 0, idTagInfo: { status: "Invalid" } };
  }
}

/**
 * Handle StopTransaction request from charger
 */
export async function handleStopTransaction(
  chargerId: number,
  payload: any
): Promise<any> {
  const { transactionId, meterStop, timestamp, idTag } = payload;

  try {
    // End transaction in memory
    const activeTransaction = chargerRegistry.endTransaction(chargerId, transactionId);

    if (!activeTransaction) {
      logger.warn(`Transaction ${transactionId} not found for charger ${chargerId}`);
    }

    // Update Transaction record
    const transaction = await prisma.transaction.findFirst({
      where: { transactionId },
    });

    if (transaction) {
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          finalMeterValue: meterStop,
          endTime: new Date(timestamp),
          status: "completed",
          energyConsumed: meterStop - (transaction.initialMeterValue || 0),
        },
      });
    }

    // Update RfidSession if exists
    const rfidSession = await prisma.rfidSession.findFirst({
      where: { transactionId },
      include: { rfidUser: true },
    });

    if (rfidSession) {
      // Get tariff rate (simplified - get first tariff or use default)
      const tariff = await prisma.tariff.findFirst();
      const tariffRate = tariff?.charge || 10; // Default Rs 10/kWh

      const energyConsumed = meterStop - (rfidSession.initialMeterValue || 0);
      const amountDue = (energyConsumed / 1000) * tariffRate;

      await prisma.rfidSession.update({
        where: { id: rfidSession.id },
        data: {
          finalMeterValue: meterStop,
          endTime: new Date(timestamp),
          energyConsumed,
          tariffRate,
          amountDue,
          status: "completed",
        },
      });

      logger.info(`RfidSession ${rfidSession.id} completed. Amount due: Rs ${(amountDue / 100).toFixed(2)}`);
    }

    const response = {
      idTagInfo: { status: "Accepted" },
    };
    await logOcppMessage(chargerId, "out", response, transactionId);
    return response;
  } catch (error) {
    logger.error(`Error handling StopTransaction: ${error}`);
    return {};
  }
}

/**
 * Handle MeterValues from charger
 */
export async function handleMeterValues(
  chargerId: number,
  payload: any
): Promise<void> {
  const { connectorId, meterValue, transactionId } = payload;

  try {
    if (!transactionId) return;

    const energyValue = meterValue?.find((m: any) => m.value)?.value || 0;

    // Update Transaction record
    const transaction = await prisma.transaction.findFirst({
      where: { transactionId },
    });

    if (transaction) {
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          energyConsumed: energyValue,
          status: "charging",
        },
      });
    }

    // Update RfidSession if exists
    const rfidSession = await prisma.rfidSession.findFirst({
      where: { transactionId },
    });

    if (rfidSession) {
      await prisma.rfidSession.update({
        where: { id: rfidSession.id },
        data: {
          energyConsumed: energyValue,
          status: "charging",
        },
      });
    }

    await logOcppMessage(chargerId, "in", payload, transactionId);
  } catch (error) {
    logger.error(`Error handling MeterValues: ${error}`);
  }
}

/**
 * Handle StatusNotification from charger
 */
export async function handleStatusNotification(
  chargerId: number,
  payload: any
): Promise<any> {
  const { connectorId, errorCode, status, timestamp, info } = payload;

  try {
    // Update/Create connector status in database
    const connectorName = `Connector ${connectorId}`;

    // For connectorId 0 (Charge Point itself), we don't usually create a "Connector" record
    // unless the system design requires it. Here we only handle actual connectors (1+).
    if (connectorId > 0) {
      const existingConnector = await prisma.connector.findFirst({
        where: {
          charger_id: chargerId,
          connector_name: connectorName
        }
      });

      if (existingConnector) {
        await prisma.connector.update({
          where: { connector_id: existingConnector.connector_id },
          data: { status, updatedAt: new Date() },
        });
      } else {
        await prisma.connector.create({
          data: {
            charger_id: chargerId,
            connector_name: connectorName,
            status: status,
            current_type: "AC", // Default, can be refined based on charger model
            updatedAt: new Date(),
          }
        });
        logger.info(`Auto-created connector ${connectorName} for charger ${chargerId}`);
      }
    }

    // Update charger status to active if receiving status notifications
    await prisma.charger.update({
      where: { charger_id: chargerId },
      data: { status: "active", last_heartbeat: new Date() },
    });

    logger.info(
      `StatusNotification from charger ${chargerId}: connector ${connectorId} status = ${status}`
    );

    const response = {};
    await logOcppMessage(chargerId, "out", response);
    return response;
  } catch (error) {
    logger.error(`Error handling StatusNotification: ${error}`);
    return {};
  }
}

/**
 * Main message router - dispatch to appropriate handler
 */
export async function handleOcppMessage(
  chargerId: number,
  messageType: number,
  messageId: string,
  actionName: string,
  payload: any
): Promise<any> {
  await logOcppMessage(chargerId, "in", [messageType, messageId, actionName, payload]);

  // In OCPP 1.6, messageType 2 = CALL (all requests)
  // The actionName determines which handler to route to
  let response: any;

  switch (actionName) {
    case "BootNotification":
      logger.debug(`Routing action ${actionName} -> handleBootNotification`);
      response = await handleBootNotification(chargerId, payload);
      break;
    case "Heartbeat":
      logger.debug(`Routing action ${actionName} -> handleHeartbeat`);
      response = await handleHeartbeat(chargerId, payload);
      break;
    case "Authorize":
      logger.debug(`Routing action ${actionName} -> handleAuthorize`);
      response = await handleAuthorize(chargerId, payload);
      break;
    case "StartTransaction":
      logger.debug(`Routing action ${actionName} -> handleStartTransaction`);
      response = await handleStartTransaction(chargerId, payload);
      break;
    case "StopTransaction":
      logger.debug(`Routing action ${actionName} -> handleStopTransaction`);
      response = await handleStopTransaction(chargerId, payload);
      break;
    case "MeterValues":
      logger.debug(`Routing action ${actionName} -> handleMeterValues`);
      await handleMeterValues(chargerId, payload);
      response = {};
      break;
    case "StatusNotification":
      logger.debug(`Routing action ${actionName} -> handleStatusNotification`);
      response = await handleStatusNotification(chargerId, payload);
      break;
    default:
      logger.warn(`Unknown action name: ${actionName}`);
      response = {};
  }

  logger.debug(`Response for action ${actionName}: ${JSON.stringify(response)}`);
  return response;
}
