const express = require("express");

const cors = require("cors");
const mysql = require("mysql2");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// ============================================================
// AI ENABLED SMART ERGONOMIC CHAIR
// FINAL BACKEND SERVER
//
// ONE PHYSICAL CHAIR ARCHITECTURE
// ------------------------------------------------------------
// Physical chair: CHAIR001
//
// ANY employee can use CHAIR001.
//
// RFID is the PRIMARY employee identification source.
//
// RFID001 -> EMP001 -> MAHENDAR
// RFID002 -> EMP002 -> NAKSHATHRA 
// RFID003 -> EMP003 -> BAHURUTEEN ALI AHAMADU
// RFID004 -> EMP004 -> KARTHIKA
// RFID005 -> EMP005 -> LEGAVARSHINI
// RFID006 -> EMP006 -> MANIISH
//
// Sensor history is stored against employee_id.
// Chair ID is always CHAIR001.
//
// Arduino Mega 2560
// Arduino Port: COM6
// Baud Rate: 9600
//
// Random simulation: DISABLED
// ============================================================


// ============================================================
// SERVER SETTINGS
// ============================================================
const PORT = process.env.PORT || 5000;

// Set transport to "wifi" when ESP32-C3 sends data.
// Use "serial" only when reading directly from Arduino USB.
const DATA_TRANSPORT = process.env.DATA_TRANSPORT || "wifi";

const ARDUINO_PORT = process.env.ARDUINO_PORT || "COM6";
const ARDUINO_BAUD = Number(process.env.ARDUINO_BAUD || 9600);

if (!["wifi", "serial"].includes(DATA_TRANSPORT)) {
    throw new Error('DATA_TRANSPORT must be "wifi" or "serial"');
}

if (!Number.isInteger(ARDUINO_BAUD) || ARDUINO_BAUD <= 0) {
    throw new Error("ARDUINO_BAUD must be a positive integer");
}

const PHYSICAL_CHAIR_ID = "CHAIR001";
// ============================================================
// MYSQL DATABASE CONNECTION
// ============================================================

const dbConfig = {
host: process.env.DB_HOST,
port: Number(process.env.DB_PORT),
user: process.env.DB_USER,
password: process.env.DB_PASSWORD,
database: process.env.DB_NAME,
ssl: {
ca: fs.readFileSync(
path.resolve(__dirname, process.env.DB_CA_PATH),
"utf8"
),
rejectUnauthorized: true
},
connectTimeout: 15000
};

const db = mysql.createPool(dbConfig);

db.getConnection((err, connection) => {
if (err) {
console.error("❌ MySQL connection failed:", err.message);
return;
}

console.log("✅ Connected to Aiven MySQL");
connection.release();

});

// ============================================================
// MIDDLEWARE
// ============================================================
const app = express();

app.use(cors());
app.use(express.json());


// ============================================================
// ARDUINO CONNECTION
// ============================================================


let arduinoConnected = false;

let arduinoPort = null;
let parser = null;

if (DATA_TRANSPORT === "serial") {
    const { SerialPort } = require("serialport");
    const { ReadlineParser } = require("@serialport/parser-readline");

    arduinoPort = new SerialPort({
        path: ARDUINO_PORT,
        baudRate: ARDUINO_BAUD,
        autoOpen: false
    });

    parser = arduinoPort.pipe(
        new ReadlineParser({
            delimiter: "\n"
        })
    );
}



// ============================================================
// CURRENT ARDUINO DATA
// ============================================================

let arduinoData = {};

let collectingArduinoData = false;
// ============================================================
// HYDRATION STATE
// ============================================================
//
// No random/simulated values are used.
//
// These values will be populated when the Arduino/load cell
// sends real hydration data.
//
// ============================================================


    // ============================================================
// HYDRATION STATE
// ============================================================
//
// Real bottle weight comes from the load cell.
//
// Every 30 seconds:
// Previous weight is compared with current weight.
//
// If weight decreases by >= 10 grams:
//     WATER CONSUMED
//
// Otherwise:
//     NO CONSUMPTION
//
// ============================================================

const HYDRATION_CHECK_INTERVAL = 30000; // 30 seconds
const HYDRATION_CONSUMPTION_THRESHOLD = 10; // grams
const BOTTLE_DETECTION_THRESHOLD = 50;
let hydrationData = {
    bottleDetected: false,

    currentWeight: null,
    previousWeight: null,

    consumed: false,
    consumedAmount: 0,

    lastCheck: "--:--",
    nextCheck: null,

    employeeId: null,
    employeeName: null,
    rfidTag: null
};

let hydrationCheckTimer = null;
let hydrationFirstReading = true;
// ============================================================
// HYDRATION CHECK
// ============================================================
//
// Runs every 30 seconds.
//
// Compares the current bottle weight with the previous
// 30-second measurement.
//
// Example:
//
// Previous = 850 g
// Current  = 820 g
//
// Difference = 30 g
//
// Therefore:
// WATER CONSUMED
//
// ============================================================

    function checkHydration() {

    const weight =
        arduinoData.waterWeight ??
        arduinoData.water_weight ??
        arduinoData.currentWeight ??
        null;

    // ========================================================
    // NO VALID LOAD CELL READING
    // ========================================================

    if (
        weight === null ||
        Number.isNaN(Number(weight))
    ) {

        hydrationData.bottleDetected = false;

        hydrationData.currentWeight = null;

        hydrationData.consumed = false;

        hydrationData.consumedAmount = 0;

        hydrationData.lastCheck =
            new Date().toLocaleTimeString();

        return;
    }

    const currentWeight =
        Number(weight);

    hydrationData.currentWeight =
        currentWeight;

    // ========================================================
    // RFID EMPLOYEE
    // ========================================================

    hydrationData.employeeId =
        rfidSessionActive
            ? activeEmployee
            : null;

    hydrationData.employeeName =
        rfidSessionActive
            ? activeEmployeeName
            : null;

    hydrationData.rfidTag =
        rfidSessionActive
            ? activeRFID
            : null;

    // ========================================================
    // BOTTLE DETECTION
    // ========================================================

hydrationData.bottleDetected =
    currentWeight >= BOTTLE_DETECTION_THRESHOLD;
    // ========================================================
// NO BOTTLE
// ========================================================

if (!hydrationData.bottleDetected) {

    hydrationData.previousWeight = null;

    hydrationData.consumed = false;

    hydrationData.consumedAmount = 0;

    hydrationData.lastCheck =
        new Date().toLocaleTimeString();

    return;
}
    // ========================================================
    // FIRST READING
    // ========================================================

    if (hydrationFirstReading) {

        hydrationData.previousWeight =
            currentWeight;

        hydrationData.consumed = false;
        hydrationData.consumedAmount = 0;

        hydrationData.lastCheck =
            new Date().toLocaleTimeString();

        hydrationFirstReading = false;

        console.log("--------------------------------");
        console.log("HYDRATION BASELINE CREATED");
        console.log("Bottle weight:", currentWeight, "g");
        console.log("--------------------------------");

        return;
    }

    // ========================================================
    // COMPARE WEIGHT
    // ========================================================

    const weightDifference =
        hydrationData.previousWeight -
        currentWeight;

    console.log("--------------------------------");
    console.log("HYDRATION CHECK");
    console.log(
        "Previous weight:",
        hydrationData.previousWeight,
        "g"
    );

    console.log(
        "Current weight:",
        currentWeight,
        "g"
    );

    console.log(
        "Weight change:",
        weightDifference,
        "g"
    );

    // ========================================================
    // WATER CONSUMED
    // ========================================================

    if (
        weightDifference >=
        HYDRATION_CONSUMPTION_THRESHOLD
    ) {

        hydrationData.consumed = true;

        hydrationData.consumedAmount =
            weightDifference;

        console.log(
            "💧 WATER CONSUMED"
        );

        console.log(
            "Consumed:",
            weightDifference,
            "g"
        );
    }

    // ========================================================
    // NO CONSUMPTION
    // ========================================================

    else {

        hydrationData.consumed = false;
        hydrationData.consumedAmount = 0;

        console.log(
            "NO WATER CONSUMPTION"
        );
    }

    hydrationData.lastCheck =
        new Date().toLocaleTimeString();

    hydrationData.nextCheck =
        new Date(
            Date.now() +
            HYDRATION_CHECK_INTERVAL
        ).toLocaleTimeString();

    // Current reading becomes the next baseline.
    hydrationData.previousWeight =
        currentWeight;

    console.log("--------------------------------");
}

// ============================================================
// RFID SESSION STATE
// ============================================================

let rfidSessionActive = false;

let activeRFID = "";

let activeEmployee = "";

let activeEmployeeName = "";

let activeDepartment = "";

let rfidStatus = "NOT_TAPPED";

let sensorRecording = false;

let sessionStartedAt = null;

// ============================================================
// RFID -> EMPLOYEE LOOKUP
// ============================================================
//
// This is the MOST IMPORTANT part.
//
// The RFID card determines the employee.
// Chair assignment is NOT used for identification.
//
// ============================================================

function findEmployeeByRFID(rfidTag, callback) {

    if (!rfidTag) {
        return callback(
            new Error("RFID tag is empty"),
            null
        );
    }

    const sql = `
        SELECT
            employee_id,
            name,
            rfid_tag,
            department,
            assigned_chair_id
        FROM employees
        WHERE rfid_tag = ?
        LIMIT 1
    `;

    db.query(
        sql,
        [rfidTag],
        (err, results) => {

            if (err) {
                return callback(err, null);
            }

            if (!results || results.length === 0) {
                return callback(null, null);
            }

            callback(null, results[0]);
        }
    );
}

// ============================================================
// SET ACTIVE EMPLOYEE
// ============================================================

function setActiveEmployee(employee, rfidTag) {

    if (!employee) {
        return;
    }

    activeRFID = rfidTag;

    activeEmployee = employee.employee_id;

    activeEmployeeName = employee.name;

    activeDepartment =
        employee.department || "";

    arduinoData.rfidTag =
        rfidTag;

    arduinoData.employeeId =
        employee.employee_id;

    arduinoData.employeeName =
        employee.name;

    arduinoData.department =
        employee.department || "";

    arduinoData.chairId =
        PHYSICAL_CHAIR_ID;

    console.log("--------------------------------");
    console.log("RFID EMPLOYEE IDENTIFIED");
    console.log("RFID:", rfidTag);
    console.log("EMPLOYEE ID:", employee.employee_id);
    console.log("NAME:", employee.name);
    console.log("DEPARTMENT:", employee.department);
    console.log("CHAIR:", PHYSICAL_CHAIR_ID);
    console.log("--------------------------------");
}

// ============================================================
// UPDATE CURRENT CHAIR USER
// ============================================================

function updateCurrentChair(employee, rfidTag) {

    if (!employee) {
        return;
    }

    const sql = `
        UPDATE chairs
        SET
            status = 'Assigned',
            current_employee_id = ?,
            current_rfid = ?
        WHERE chair_id = ?
    `;

    db.query(
        sql,
        [
            employee.employee_id,
            rfidTag,
            PHYSICAL_CHAIR_ID
        ],
        (err) => {

            if (err) {

                console.error(
                    "Current chair update error:",
                    err.message
                );

                return;
            }

            console.log(
                "CHAIR001 current user:",
                employee.employee_id,
                employee.name
            );
        }
    );
}
// ============================================================
// SESSION HELPERS (ESP32-C3 / Wi-Fi flow)
// ============================================================

function resetHydrationState() {
    hydrationData = {
        bottleDetected: false,

        currentWeight: null,
        previousWeight: null,

        consumed: false,
        consumedAmount: 0,

        lastCheck: "--:--",
        nextCheck: null,

        employeeId: null,
        employeeName: null,
        rfidTag: null
    };

    hydrationFirstReading = true;
}

// Clears the live readings on the CHAIR001 row.
// Text/score values are the same defaults the old WAITING
// packet already wrote, so the table accepts them.
function clearChairLiveReadings(status, employeeId, rfidTag) {

    const sql = `
        UPDATE chairs
        SET
            status = ?,
            current_employee_id = ?,
            current_rfid = ?,

            left_pressure = 0,
            right_pressure = 0,
            fsr_back_center = 0,

            heart_rate = NULL,
            temperature = 0,

            current_posture_score = 0,
            back_angle = 0,

            posture_status = 'Good',
            current_user_state = 'Focused',

            productivity_score = 0,
            chair_action = 'Maintain Settings',

            fan_status = 'OFF',
            vibration_alert = 'OFF',

            tilt = 0,
            tilt_deviation = 0,

            flex = 0,
            flex_deviation = 0,

            mpu_score = 1,
            flex_score = 1,
            fsr_score = 1,
            chair_score = 3

        WHERE chair_id = ?
    `;

    db.query(
        sql,
        [status, employeeId, rfidTag, PHYSICAL_CHAIR_ID],
        (err) => {
            if (err) {
                console.error(
                    "Chair live-reading clear error:",
                    err.message
                );
            }
        }
    );
}

// Ends the whole employee session. Returns false if the end
// packet belongs to a different employee than the active one
// (late/out-of-order packet), in which case nothing changes.
function endActiveSession(rfidTag) {

    if (
        rfidSessionActive &&
        activeRFID &&
        activeRFID !== rfidTag
    ) {
        console.log(
            "STALE SESSION END IGNORED:",
            rfidTag,
            "| active session is",
            activeRFID
        );

        return false;
    }

    rfidSessionActive = false;
    rfidStatus = "NOT_TAPPED";
    sensorRecording = false;

    activeRFID = "";
    activeEmployee = "";
    activeEmployeeName = "";
    activeDepartment = "";

    arduinoData = {};
    collectingArduinoData = false;

    sessionStartedAt = null;

    resetHydrationState();

    clearChairLiveReadings("Available", null, null);

    console.log("--------------------------------");
    console.log("RFID SESSION ENDED:", rfidTag);
    console.log("ACTIVE EMPLOYEE CLEARED");
    console.log("CHAIR001 AVAILABLE");
    console.log("--------------------------------");

    return true;
}

// ============================================================
// OPEN ARDUINO
// ============================================================
// ============================================================
// OPEN ARDUINO
// ============================================================

if (DATA_TRANSPORT === "serial") {

    arduinoPort.open((err) => {

        if (err) {
            arduinoConnected = false;

            console.error(
                `Arduino ${ARDUINO_PORT} connection failed:`,
                err.message
            );

            return;
        }

        arduinoConnected = true;

        console.log("--------------------------------");
        console.log("ARDUINO CONNECTED");
        console.log("PORT:", ARDUINO_PORT);
        console.log("BAUD:", ARDUINO_BAUD);
        console.log("--------------------------------");
    });
// ============================================================
// ARDUINO ERROR
// ============================================================

arduinoPort.on("error", (err) => {

    arduinoConnected = false;

    console.error(
        "Arduino serial error:",
        err.message
    );
});

// ============================================================
// ARDUINO CLOSE
// ============================================================

arduinoPort.on("close", () => {

    arduinoConnected = false;

    console.log(
        `Arduino ${ARDUINO_PORT} connection closed`
    );
});

// ============================================================
// SERIAL DATA RECEIVER
// ============================================================

parser.on("data", (rawLine) => {

    const line = rawLine.trim();

    if (!line) {
        return;
    }

    console.log(
        "ARDUINO SERIAL:",
        line
    );

    // ========================================================
    // RFID SESSION STARTED
    // ========================================================

    if (
        line === "RFID_SESSION:STARTED"
    ) {

        rfidSessionActive = true;

        rfidStatus = "TAPPED";

        sensorRecording = true;

        sessionStartedAt = new Date();

        console.log("--------------------------------");
        console.log("RFID SESSION STARTED");
        console.log("--------------------------------");

        return;
    }

    // ========================================================
    // RFID SESSION STOPPED
    // ========================================================

    if (
        line === "RFID_SESSION:STOPPED"
    ) {

        rfidSessionActive = false;

        rfidStatus = "NOT_TAPPED";

        sensorRecording = false;

        // Clear active employee
        activeRFID = "";

        activeEmployee = "";

        activeEmployeeName = "";

        activeDepartment = "";

        arduinoData = {};

        collectingArduinoData = false;

        sessionStartedAt = null;
        // ========================================================
// RESET HYDRATION SESSION
// ========================================================

hydrationData = {
    bottleDetected: false,

    currentWeight: null,
    previousWeight: null,

    consumed: false,
    consumedAmount: 0,

    lastCheck: "--:--",
    nextCheck: null,

    employeeId: null,
    employeeName: null,
    rfidTag: null
};

hydrationFirstReading = true;

        // Make physical chair available
        const sql = `
            UPDATE chairs
            SET
                status = 'Available',
                current_employee_id = NULL,
                current_rfid = NULL
            WHERE chair_id = ?
        `;

        db.query(
            sql,
            [PHYSICAL_CHAIR_ID],
            (err) => {

                if (err) {
                    console.error(
                        "Chair logout update error:",
                        err.message
                    );
                }
            }
        );

        console.log("--------------------------------");
        console.log("RFID SESSION STOPPED");
        console.log("ACTIVE EMPLOYEE CLEARED");
        console.log("CHAIR001 AVAILABLE");
        console.log("--------------------------------");

        return;
    }

    // ========================================================
    // RFID SESSION SWITCHED
    // ========================================================

    if (
        line === "RFID_SESSION:SWITCHED"
    ) {

        rfidSessionActive = true;

        rfidStatus = "TAPPED";

        sensorRecording = true;

        sessionStartedAt = new Date();

        console.log("--------------------------------");
        console.log("RFID SESSION SWITCHED");
        console.log("--------------------------------");

        return;
    }

    // ========================================================
    // RFID STATUS
    // ========================================================

    if (
        line.startsWith("RFID_STATUS:")
    ) {

        const status =
            line
                .substring(
                    "RFID_STATUS:".length
                )
                .trim();

        if (
            status === "TAPPED"
        ) {

            rfidStatus = "TAPPED";

            rfidSessionActive = true;
        }

        else if (
            status === "NOT_TAPPED"
        ) {

            rfidStatus = "NOT_TAPPED";

            rfidSessionActive = false;
        }

        return;
    }

    // ========================================================
    // SENSOR RECORDING STATUS
    // ========================================================

    if (
        line.startsWith("SENSOR_RECORDING:")
    ) {

        const recording =
            line
                .substring(
                    "SENSOR_RECORDING:".length
                )
                .trim();

        if (
            recording === "STARTED"
        ) {

            sensorRecording = true;
        }

        else if (
            recording === "STOPPED"
        ) {

            sensorRecording = false;
        }

        return;
    }

    // ========================================================
    // RFID ID
    //
    // THIS IS THE IMPORTANT SECTION.
    //
    // Arduino sends:
    //
    // RFID_ID:RFID001
    //
    // Backend searches:
    //
    // employees.rfid_tag = RFID001
    //
    // Then obtains:
    //
    // EMP001
    // Mahendar
    //
    // ========================================================

    if (
        line.startsWith("RFID_ID:")
    ) {

        const rfidTag =
            line
                .substring(
                    "RFID_ID:".length
                )
                .trim();

        if (
            rfidTag === "UNKNOWN" ||
            rfidTag === ""
        ) {

            console.log(
                "UNKNOWN RFID CARD"
            );

            return;
        }

        console.log(
            "RFID CARD DETECTED:",
            rfidTag
        );

        findEmployeeByRFID(
            rfidTag,
            (err, employee) => {

                if (err) {

                    console.error(
                        "RFID employee lookup error:",
                        err.message
                    );

                    return;
                }

                // ==================================================
                // UNKNOWN RFID
                // ==================================================

                if (!employee) {

                    console.log(
                        "RFID NOT REGISTERED:",
                        rfidTag
                    );

                    activeRFID = rfidTag;

                    activeEmployee = "";

                    activeEmployeeName = "";

                    activeDepartment = "";

                    rfidSessionActive = false;

                    rfidStatus = "UNKNOWN";

                    sensorRecording = false;

                    return;
                }

                // ==================================================
                // VALID RFID
                // ==================================================

                setActiveEmployee(
                    employee,
                    rfidTag
                );

                // Start / switch session
                rfidSessionActive = true;

                rfidStatus = "TAPPED";

                sensorRecording = true;

                sessionStartedAt = new Date();

                // Update physical chair
                updateCurrentChair(
                    employee,
                    rfidTag
                );

                console.log(
                    "RFID SESSION ACTIVE FOR:",
                    employee.employee_id
                );
            }
        );

        return;
    }

    // ========================================================
    // EMPLOYEE ID
    //
    // Arduino may still send this.
    //
    // However, RFID lookup remains the source of truth.
    //
    // ========================================================

    if (
        line.startsWith("EMPLOYEE_ID:")
    ) {

        const employeeId =
            line
                .substring(
                    "EMPLOYEE_ID:".length
                )
                .trim();

        console.log(
            "ARDUINO EMPLOYEE ID:",
            employeeId
        );

        // Do NOT blindly replace active employee.
        // RFID is the authoritative identity.

        if (
            employeeId !== "UNKNOWN" &&
            !activeEmployee
        ) {

            activeEmployee =
                employeeId;

            arduinoData.employeeId =
                employeeId;
        }

        return;
    }

    // ========================================================
    // EMPLOYEE NAME
    // ========================================================

    if (
        line.startsWith("EMPLOYEE_NAME:")
    ) {

        const employeeName =
            line
                .substring(
                    "EMPLOYEE_NAME:".length
                )
                .trim();

        console.log(
            "ARDUINO EMPLOYEE NAME:",
            employeeName
        );

        // Only use Arduino name if backend
        // does not already have the MySQL name.

        if (
            !activeEmployeeName
        ) {

            activeEmployeeName =
                employeeName;

            arduinoData.employeeName =
                employeeName;
        }

        return;
    }

    // ========================================================
    // USER IDENTIFIED
    // ========================================================

    if (
        line === "USER_IDENTIFIED"
    ) {

        rfidSessionActive = true;

        rfidStatus = "TAPPED";

        sensorRecording = true;

        return;
    }

    // ========================================================
    // UNKNOWN RFID
    // ========================================================

    if (
        line === "UNKNOWN_RFID_CARD"
    ) {

        console.log(
            "UNKNOWN RFID CARD"
        );

        rfidSessionActive = false;

        rfidStatus = "UNKNOWN";

        sensorRecording = false;

        return;
    }

    // ========================================================
    // START ARDUINO SENSOR PACKET
    // ========================================================

    if (
        line ===
        "========== ARDUINO DATA =========="
    ) {

        arduinoData = {

            chairId:
                PHYSICAL_CHAIR_ID,

            employeeId:
                activeEmployee,

            rfidTag:
                activeRFID,

            employeeName:
                activeEmployeeName,

            department:
                activeDepartment
        };

        collectingArduinoData = true;

        return;
    }

    // ========================================================
    // END ARDUINO SENSOR PACKET
    // ========================================================

    if (
        line ===
        "==================================="
    ) {

        if (
            collectingArduinoData
        ) {

            console.log("");

            console.log(
                "========== ARDUINO DATA =========="
            );

            console.log(
                arduinoData
            );

            console.log(
                "==================================="
            );

            // ==================================================
            // SAVE ONLY WHEN VALID RFID SESSION EXISTS
            // ==================================================

            if (
                rfidSessionActive &&
                sensorRecording &&
                activeEmployee
            ) {

                saveArduinoData(
                    arduinoData
                );
            }

            else {

                console.log(
                    "Sensor data ignored - no valid RFID employee"
                );
            }
        }

        collectingArduinoData = false;

        return;
    }

    // ========================================================
    // IGNORE NON-DATA MESSAGES
    // ========================================================

    if (
        !collectingArduinoData
    ) {

        return;
    }

    // ========================================================
    // FIND KEY/VALUE SEPARATOR
    // ========================================================

    const separator =
        line.indexOf(":");

    if (
        separator === -1
    ) {

        return;
    }

    const key =
        line
            .substring(
                0,
                separator
            )
            .trim();

    const value =
        line
            .substring(
                separator + 1
            )
            .trim();

    // ========================================================
    // STRING VALUES
    // ========================================================

    if (
        key === "chairId" ||
        key === "employeeId" ||
        key === "rfidTag" ||
        key === "employeeName" ||
        key === "department" ||
        key === "postureStatus" ||
        key === "vibration"
    ) {

        arduinoData[key] =
            value;

        return;
    }

    // ========================================================
    // NUMERIC VALUES
    // ========================================================

    const numberValue =
        Number(value);

    if (
        !Number.isNaN(numberValue)
    ) {

        arduinoData[key] =
            numberValue;
    }
});

}
// ============================================================
// ESP32-C3 WI-FI DATA ENDPOINT
// ============================================================

app.post("/api/arduino-data", (req, res) => {
    console.log("ESP32 POST:", req.body?.rfidTag, req.body?.sessionState);

    if (DATA_TRANSPORT !== "wifi") {
        return res.status(409).json({
            error: "Wi-Fi transport is not enabled"
        });
    }

    const incoming = req.body;

    if (!incoming || typeof incoming !== "object") {
        return res.status(400).json({
            error: "Invalid sensor data"
        });
    }

    const rfidTag = String(incoming.rfidTag || "").trim();

    if (!rfidTag) {
        return res.status(400).json({
            error: "rfidTag is required"
        });
    }

    const incomingState =
        String(incoming.sessionState || "").trim().toUpperCase();

    const incomingRfidStatus =
        String(incoming.rfidStatus || "").trim().toUpperCase();

    const sessionEnded =
        incomingState === "ENDED" ||
        incomingRfidStatus === "ENDED";

    // Packets with no sessionState (older firmware) count as ACTIVE.
    const activePacket =
        !sessionEnded &&
        (incomingState === "" || incomingState === "ACTIVE");

    findEmployeeByRFID(rfidTag, (err, employee) => {

        if (err) {
            console.error("RFID lookup failed:", err.message);

            return res.status(500).json({
                error: "Employee lookup failed"
            });
        }

        if (!employee) {
            return res.status(404).json({
                error: "RFID not registered",
                rfidTag: rfidTag
            });
        }

        arduinoConnected = true;

        // ====================================================
        // SESSION ENDED (same card tapped again / card switched)
        // ====================================================

        if (sessionEnded) {

            const ended = endActiveSession(rfidTag);

            return res.json({
                success: true,
                message: ended
                    ? "Session ended"
                    : "Stale session end ignored",
                chairId: PHYSICAL_CHAIR_ID,
                employeeId: employee.employee_id
            });
        }

        // ====================================================
        // WAITING_FOR_SEAT or ACTIVE
        // ====================================================

        const newSession =
            !rfidSessionActive ||
            activeRFID !== rfidTag;

        setActiveEmployee(employee, rfidTag);

        rfidSessionActive = true;
        rfidStatus = "TAPPED";
        sensorRecording = activePacket;

        if (newSession || !sessionStartedAt) {
            sessionStartedAt = new Date();
            resetHydrationState();
        }

        arduinoData = {
            ...incoming,
            chairId: PHYSICAL_CHAIR_ID,
            employeeId: employee.employee_id,
            employeeName: employee.name,
            department: employee.department || "",
            rfidTag: rfidTag
        };

        const weight =
            incoming.waterWeight ??
            incoming.water_weight ??
            incoming.currentWeight;

        if (weight !== undefined && weight !== null) {
            const numericWeight = Number(weight);

            if (Number.isFinite(numericWeight)) {
                arduinoData.waterWeight = numericWeight;
            }
        }

        if (activePacket) {

            updateCurrentChair(employee, rfidTag);

            saveArduinoData(arduinoData);

        } else {

            // WAITING_FOR_SEAT: employee identified, nobody seated.
            // Clear live readings, record no history.
            clearChairLiveReadings(
                "Assigned",
                employee.employee_id,
                rfidTag
            );

            console.log(
                "WAITING FOR SEAT:",
                employee.employee_id,
                employee.name
            );
        }

        return res.json({
            success: true,
            message: activePacket
                ? "Sensor data received"
                : "Waiting for seat",
            chairId: PHYSICAL_CHAIR_ID,
            employeeId: employee.employee_id
        });
    });
});
// ============================================================
// SAVE ARDUINO DATA TO MYSQL
// ============================================================
//
// IMPORTANT:
//
// We resolve the employee AGAIN using RFID before saving.
//
// This prevents:
//
// RFID001 -> accidentally saved as EMP002
//
// The RFID is always authoritative.
//
// ============================================================

function saveArduinoData(data) {
    



    const rfidTag = String(data?.rfidTag || "").trim();

    if (!rfidTag) {
        console.error("Sensor data ignored - missing RFID tag");
        return;
    }

    findEmployeeByRFID(rfidTag, (err, employee) => {
        if (err) {
            console.error("RFID lookup failed:", err.message);
            return;
        }

        if (!employee) {
            console.error("Sensor data ignored - RFID not registered:", rfidTag);
            return;
        }

            // ==================================================
            // AUTHORITATIVE EMPLOYEE
            // ==================================================

            const employeeId =
                employee.employee_id;

            const employeeName =
                employee.name;

            const chairId =
                PHYSICAL_CHAIR_ID;

            // Make sure current backend identity
            // remains synchronized.

            activeRFID =
                rfidTag;

            activeEmployee =
                employeeId;

            activeEmployeeName =
                employeeName;

            activeDepartment =
                employee.department || "";

            // ==================================================
            // SENSOR VALUES
            // ==================================================

            const leftPressure =
                Number(
                    data.fsrLeft ?? 0
                );

            const rightPressure =
                Number(
                    data.fsrRight ?? 0
                );

            const backCenterPressure =
                Number(
                    data.fsrBackCenter ?? 0
                );
            
                // ==================================================
// USER PRESENCE DETECTION
// ==================================================
//
// RFID identifies the employee.
// FSR determines whether the employee is actually
// sitting on the chair.
//
// Empty chair example:
// LEFT        = 0
// RIGHT       = 0
// BACK CENTER = 20
//
// Presence threshold = 100
// ==================================================

const FSR_PRESENCE_THRESHOLD = 100;
// The Mega's calibrated seat detection (ON 300 / OFF 260 on the
// combined FSR total, plus the 5 s absence timer) is authoritative.
// The per-sensor threshold is only a fallback for packets with
// no sessionState.
const reportedState =
    String(data.sessionState || "").trim().toUpperCase();

const reportedPresence =
    String(data.personPresent || "").trim().toUpperCase();

const userPresent =
    reportedState !== ""
        ? (reportedState === "ACTIVE" && reportedPresence !== "NO")
        : (
            leftPressure >= FSR_PRESENCE_THRESHOLD ||
            rightPressure >= FSR_PRESENCE_THRESHOLD ||
            backCenterPressure >= FSR_PRESENCE_THRESHOLD
        );
const chairStatus =
    userPresent
        ? "OCCUPIED"
        : "AVAILABLE";

console.log(
    "CHAIR STATUS:",
    chairStatus,
    "| LEFT:",
    leftPressure,
    "| RIGHT:",
    rightPressure,
    "| BACK:",
    backCenterPressure
);

            const tilt =
                Number(
                    data.tilt ?? 0
                );

            const tiltDeviation =
                Number(
                    data.tiltDeviation ?? 0
                );

            const flex =
                Number(
                    data.flex ?? 0
                );

            const flexDeviation =
                Number(
                    data.flexDeviation ?? 0
                );

            const mpuScore =
                Number(
                    data.mpuScore ?? 1
                );

            const flexScore =
                Number(
                    data.flexScore ?? 1
                );

            const fsrScore =
                Number(
                    data.fsrScore ?? 1
                );

            const chairScore =
                Number(
                    data.chairScore ?? 3
                );

            const postureStatus =
                data.postureStatus ||
                "Good";

            const vibration =
                data.vibration ||
                "OFF";

            // ==================================================
            // HEART RATE
            // Currently not connected
            // ==================================================

            // ==================================================
// HEART RATE
// ==================================================
//
// Arduino sends:
// heartRate:74
//
// Until the MAX30102 sends a valid value,
// keep it as null rather than displaying 0.
//
// ==================================================

const heartRateRaw =
    data.heartRate ??
    data.heart_rate ??
    null;

const heartRate =
    heartRateRaw !== null &&
    !Number.isNaN(Number(heartRateRaw)) &&
    Number(heartRateRaw) > 0
        ? Number(heartRateRaw)
        : null;

            // ==================================================
            // TEMPERATURE
            // Currently not connected
            // ==================================================

            const temperature = 0;

            // ==================================================
            // POSTURE PERCENTAGE
            //
            // 3 = Good
            // 5 = Moderate
            // 7 = Bad
            // ==================================================

            let posturePercentage = 0;

            if (
                chairScore <= 3
            ) {

                posturePercentage = 100;
            }

            else if (
                chairScore <= 5
            ) {

                posturePercentage = 67;
            }

            else {

                posturePercentage = 33;
            }

            // ==================================================
            // USER STATE
            // ==================================================

            let userState =
                "Focused";

            if (
                postureStatus === "Moderate"
            ) {

                userState =
                    "Relaxed";
            }

            else if (
                postureStatus === "Bad"
            ) {

                userState =
                    "Strained";
            }

            // ==================================================
            // CHAIR ACTION
            // ==================================================

            let chairAction =
                "Maintain Settings";

            if (
                postureStatus === "Moderate"
            ) {

                chairAction =
                    "Posture Warning";
            }

            else if (
                postureStatus === "Bad"
            ) {

                chairAction =
                    "Posture Alert Triggered";
            }

            // ==================================================
            // PRODUCTIVITY SCORE
            // ==================================================

            let productivityScore = 0;

            if (
                postureStatus === "Good"
            ) {

                productivityScore = 90;
            }

            else if (
                postureStatus === "Moderate"
            ) {

                productivityScore = 75;
            }

            else {

                productivityScore = 60;
            }

            // ==================================================
            // UPDATE SINGLE PHYSICAL CHAIR
            // ==================================================

            const chairSQL = `
                UPDATE chairs
                SET

                    status = 'Assigned',

                    current_employee_id = ?,
                    current_rfid = ?,

                    left_pressure = ?,
                    right_pressure = ?,
                    fsr_back_center = ?,

                    heart_rate = ?,
                    temperature = ?,

                    current_posture_score = ?,
                    back_angle = ?,

                    posture_status = ?,
                    current_user_state = ?,

                    productivity_score = ?,
                    chair_action = ?,

                    fan_status = 'OFF',
                    vibration_alert = ?,

                    tilt = ?,
                    tilt_deviation = ?,

                    flex = ?,
                    flex_deviation = ?,

                    mpu_score = ?,
                    flex_score = ?,
                    fsr_score = ?,
                    chair_score = ?

                WHERE chair_id = ?
            `;

            db.query(
                chairSQL,
                [

                    employeeId,
                    rfidTag,

                    leftPressure,
                    rightPressure,
                    backCenterPressure,

                    heartRate,
                    temperature,

                    posturePercentage,
                    tilt,

                    postureStatus,
                    userState,

                    productivityScore,
                    chairAction,

                    vibration,

                    tilt,
                    tiltDeviation,

                    flex,
                    flexDeviation,

                    mpuScore,
                    flexScore,
                    fsrScore,
                    chairScore,

                    chairId
                ],

                (err) => {

                    if (err) {

                        console.error(
                            "Chair table update error:",
                            err.message
                        );
                    }

                    else {

                        console.log(
                            "CHAIR001 CURRENT USER:",
                            employeeId,
                            employeeName
                        );
                    }
                }
            );

           
// ==================================================
// DO NOT RECORD SENSOR HISTORY WHILE CHAIR IS EMPTY
// ==================================================
 // ==================================================
            // INSERT EMPLOYEE SENSOR HISTORY
            // ==================================================
if (!userPresent) {

    console.log(
        "CHAIR EMPTY - SENSOR HISTORY NOT RECORDED"
    );

    return;
}
            const sensorSQL = `
                INSERT INTO sensor_readings
                (
                    chair_id,
                    employee_id,
                    rfid_tag,

                    left_pressure,
                    right_pressure,
                    heart_rate,
                    temperature,

                    posture_score,
                    posture_status,

                    user_state,
                    chair_action,

                    productivity_score,

                    tilt,
                    tilt_deviation,

                    flex,
                    flex_deviation,

                    fsr_back_center,

                    mpu_score,
                    flex_score,
                    fsr_score,

                    chair_score,

                    vibration
                )

                VALUES
                (
                    ?, ?, ?,

                    ?, ?, ?, ?,

                    ?, ?,

                    ?, ?,

                    ?,

                    ?, ?,

                    ?, ?,

                    ?,

                    ?, ?, ?,

                    ?,

                    ?
                )
            `;

            db.query(
                sensorSQL,
                [

                    chairId,
                    employeeId,
                    rfidTag,

                    leftPressure,
                    rightPressure,
                    heartRate,
                    temperature,

                    posturePercentage,
                    postureStatus,

                    userState,
                    chairAction,

                    productivityScore,

                    tilt,
                    tiltDeviation,

                    flex,
                    flexDeviation,

                    backCenterPressure,

                    mpuScore,
                    flexScore,
                    fsrScore,

                    chairScore,

                    vibration
                ],

                (err) => {

                    if (err) {

                        console.error(
                            "Sensor history insert error:",
                            err.message
                        );
                    }

                    else {

                        console.log(
                            "========================================"
                        );

                        console.log(
                            "SENSOR HISTORY SAVED"
                        );

                        console.log(
                            "RFID:",
                            rfidTag
                        );

                        console.log(
                            "EMPLOYEE:",
                            employeeId
                        );

                        console.log(
                            "NAME:",
                            employeeName
                        );

                        console.log(
                            "CHAIR:",
                            chairId
                        );

                        console.log(
                            "POSTURE:",
                            postureStatus
                        );

                        console.log(
                            "PRODUCTIVITY:",
                            productivityScore
                        );

                        console.log(
                            "========================================"
                        );
                    }
                }
            );
        }
    );
}

// ============================================================
// ROOT
// ============================================================
// ============================================================
// HYDRATION
// ============================================================
//
// GET:
// /api/hydration
//
// Returns the current real hydration state.
//
// No random values are generated.
//
// ============================================================
// ============================================================
// HYDRATION API
// ============================================================
//
// GET:
// /api/hydration
//
// Returns the LAST 30-second hydration check.
//
// ============================================================

app.get(
    "/api/hydration",
    (req, res) => {

        res.json({

            bottleDetected:
                hydrationData.bottleDetected,

            currentWeight:
                hydrationData.currentWeight,

            previousWeight:
                hydrationData.previousWeight,

            consumed:
                hydrationData.consumed,

            consumedAmount:
                hydrationData.consumedAmount,

            lastCheck:
                hydrationData.lastCheck,

            nextCheck:
                hydrationData.nextCheck,

            checkInterval:
                HYDRATION_CHECK_INTERVAL / 1000,

            threshold:
                HYDRATION_CONSUMPTION_THRESHOLD,

            // ==================================================
            // RFID EMPLOYEE
            // ==================================================

            employeeId:
                hydrationData.employeeId,

            employeeName:
                hydrationData.employeeName,

            rfidTag:
                hydrationData.rfidTag,

            rfidActive:
                rfidSessionActive
        });
    }
);


app.get(
    "/",
    (req, res) => {

        res.json({

            message:
                "Smart Ergonomic Chair API is running",

            status:
                "online",

            arduino:
                arduinoConnected
                    ? "connected"
                    : "disconnected",

            port:
                ARDUINO_PORT,

            physicalChair:
                PHYSICAL_CHAIR_ID
        });
    }
);

// ============================================================
// HEALTH
// ============================================================

app.get(
    "/health",
    (req, res) => {

        res.json({

            backend:
                "online",

            database:
                "connected",

            arduino:
                arduinoConnected
                    ? "connected"
                    : "disconnected",

            port:
                ARDUINO_PORT,

            physicalChair:
                PHYSICAL_CHAIR_ID,

            rfidSession:
                rfidSessionActive
                    ? "active"
                    : "inactive",

            activeEmployee:
                activeEmployee || null,

            activeRFID:
                activeRFID || null
        });
    }
);

// ============================================================
// RFID STATUS
// ============================================================

app.get(
    "/rfid-status",
    (req, res) => {

        res.json({

            tapped:
                rfidSessionActive,

            status:
                rfidStatus,

            recording:
                sensorRecording,

            rfidTag:
                activeRFID,

            employeeId:
                activeEmployee,

            employeeName:
                activeEmployeeName,

            department:
                activeDepartment,

            chairId:
                PHYSICAL_CHAIR_ID,

            sessionStartedAt:
                sessionStartedAt
        });
    }
);

// ============================================================
// CURRENT ARDUINO DATA
// ============================================================

app.get(
    "/arduino-data",
    (req, res) => {

        res.json({

            connected:
                arduinoConnected,

            rfid: {

                tapped:
                    rfidSessionActive,

                status:
                    rfidStatus,

                recording:
                    sensorRecording,

                rfidTag:
                    activeRFID,

                employeeId:
                    activeEmployee,

                employeeName:
                    activeEmployeeName,

                department:
                    activeDepartment,

                chairId:
                    PHYSICAL_CHAIR_ID
            },

            sensor:
                arduinoData
        });
    }
);

// ============================================================
// GET CHAIRS
// ============================================================

app.get(
    "/chairs",
    (req, res) => {

        db.query(
            "SELECT * FROM chairs ORDER BY chair_id",

            (err, results) => {

                if (err) {

                    return res.status(500).json({

                        error:
                            err.message
                    });
                }

                res.json(
                    results
                );
            }
        );
    }
);

// ============================================================
// GET EMPLOYEES
// ============================================================

app.get(
    "/employees",
    (req, res) => {

        db.query(
            "SELECT * FROM employees ORDER BY employee_id",

            (err, results) => {

                if (err) {

                    return res.status(500).json({

                        error:
                            err.message
                    });
                }

                res.json(
                    results
                );
            }
        );
    }
);

// ============================================================
// ADD EMPLOYEE
//
// IMPORTANT:
// There is NO chair-assignment restriction.
//
// Every employee can use CHAIR001.
// ============================================================

app.post(
    "/employees",
    (req, res) => {

        const name =
            req.body.name;

        const department =
            req.body.department;

        if (
            !name ||
            !department
        ) {

            return res.status(400).json({

                error:
                    "Name and department are required"
            });
        }

        // ====================================================
        // GENERATE EMPLOYEE NUMBER
        // ====================================================

        db.query(
            `
            SELECT
                COALESCE(
                    MAX(
                        CAST(
                            SUBSTRING(employee_id, 4)
                            AS UNSIGNED
                        )
                    ),
                    0
                ) AS maxNo
            FROM employees
            `,

            (err, result) => {

                if (err) {

                    return res.status(500).json({

                        error:
                            err.message
                    });
                }

                const nextNo =
                    Number(
                        result[0].maxNo
                    ) + 1;

                const employeeId =
                    `EMP${String(nextNo).padStart(3, "0")}`;

                const rfidTag =
                    `RFID${String(nextNo).padStart(3, "0")}`;

                // =================================================
                // INSERT EMPLOYEE
                //
                // ALL EMPLOYEES USE CHAIR001
                // =================================================

                const employeeSQL = `
                    INSERT INTO employees
                    (
                        employee_id,
                        name,
                        rfid_tag,
                        department,
                        assigned_chair_id
                    )
                    VALUES
                    (
                        ?, ?, ?, ?, ?
                    )
                `;

                db.query(
                    employeeSQL,

                    [
                        employeeId,
                        name,
                        rfidTag,
                        department,
                        PHYSICAL_CHAIR_ID
                    ],

                    (err) => {

                        if (err) {

                            return res.status(500).json({

                                error:
                                    err.message
                            });
                        }

                        res.json({

                            message:
                                "Employee added successfully",

                            employee_id:
                                employeeId,

                            rfid_tag:
                                rfidTag,

                            assigned_chair_id:
                                PHYSICAL_CHAIR_ID
                        });
                    }
                );
            }
        );
    }
);

// ============================================================
// SENSOR HISTORY
//
// GET:
// /sensor-history/EMP001
//
// Returns only EMP001's records.
// ============================================================

app.get(
    "/sensor-history/:employeeId",
    (req, res) => {

        const employeeId =
            req.params.employeeId;

        const sql = `
            SELECT *
            FROM sensor_readings
            WHERE employee_id = ?
            ORDER BY created_at ASC
            LIMIT 100
        `;

        db.query(
            sql,
            [employeeId],

            (err, results) => {

                if (err) {

                    return res.status(500).json({

                        error:
                            err.message
                    });
                }

                res.json(
                    results
                );
            }
        );
    }
);

// ============================================================
// LATEST SENSOR
// ============================================================

app.get(
    "/latest-sensor/:employeeId",
    (req, res) => {

        const employeeId =
            req.params.employeeId;

        const sql = `
            SELECT *
            FROM sensor_readings
            WHERE employee_id = ?
            ORDER BY created_at DESC
            LIMIT 1
        `;

        db.query(
            sql,
            [employeeId],

            (err, results) => {

                if (err) {

                    return res.status(500).json({

                        error:
                            err.message
                    });
                }

                res.json(
                    results[0] || null
                );
            }
        );
    }
);

// ============================================================
// LATEST ACTIVE EMPLOYEE SENSOR
// ============================================================

app.get(
    "/latest-active-sensor",
    (req, res) => {

        if (
            !rfidSessionActive ||
            !activeEmployee
        ) {

            return res.json({

                active:
                    false,

                message:
                    "No RFID session is active",

                data:
                    null
            });
        }

        const sql = `
            SELECT *
            FROM sensor_readings
            WHERE employee_id = ?
            ORDER BY created_at DESC
            LIMIT 1
        `;

        db.query(
            sql,
            [activeEmployee],

            (err, results) => {

                if (err) {

                    return res.status(500).json({

                        error:
                            err.message
                    });
                }

                res.json({

                    active:
                        true,

                    employeeId:
                        activeEmployee,

                    rfidTag:
                        activeRFID,

                    employeeName:
                        activeEmployeeName,

                    department:
                        activeDepartment,

                    chairId:
                        PHYSICAL_CHAIR_ID,

                    data:
                        results[0] || null
                });
            }
        );
    }
);

// ============================================================
// DAILY REPORT
//
// GET:
// /daily-report/EMP001
//
// Returns today's employee-specific statistics.
//
// IMPORTANT:
// Data is filtered by employee_id, NOT chair_id.
// Therefore all employees can share CHAIR001.
// ============================================================

app.get(
    "/daily-report/:employeeId",
    (req, res) => {

        const employeeId =
            req.params.employeeId;

        const sql = `
            SELECT

                employee_id,

                COUNT(*) AS total_readings,

                ROUND(
                    AVG(posture_score),
                    1
                ) AS average_posture_score,

                ROUND(
                    AVG(productivity_score),
                    1
                ) AS average_productivity_score,

                ROUND(
                    AVG(chair_score),
                    2
                ) AS average_chair_score,

                SUM(
                    CASE
                        WHEN posture_status = 'Good'
                        THEN 1
                        ELSE 0
                    END
                ) AS good_readings,

                SUM(
                    CASE
                        WHEN posture_status = 'Moderate'
                        THEN 1
                        ELSE 0
                    END
                ) AS moderate_readings,

                SUM(
                    CASE
                        WHEN posture_status = 'Bad'
                        THEN 1
                        ELSE 0
                    END
                ) AS bad_readings,

                MIN(created_at) AS first_reading,

                MAX(created_at) AS last_reading

            FROM sensor_readings

            WHERE employee_id = ?

            AND DATE(created_at) = CURDATE()

            GROUP BY employee_id
        `;

        db.query(
            sql,
            [employeeId],

            (err, results) => {

                if (err) {

                    return res.status(500).json({

                        error:
                            err.message
                    });
                }

                if (
                    results.length === 0
                ) {

                    return res.json({

                        employeeId:
                            employeeId,

                        date:
                            new Date()
                                .toISOString()
                                .slice(0, 10),

                        total_readings:
                            0,

                        average_posture_score:
                            0,

                        average_productivity_score:
                            0,

                        average_chair_score:
                            0,

                        good_readings:
                            0,

                        moderate_readings:
                            0,

                        bad_readings:
                            0,

                        first_reading:
                            null,

                        last_reading:
                            null
                    });
                }

                res.json(
                    results[0]
                );
            }
        );
    }
);

// ============================================================
// DAILY HISTORY
//
// Useful if dashboard wants all today's readings.
// ============================================================

app.get(
    "/daily-history/:employeeId",
    (req, res) => {

        const employeeId =
            req.params.employeeId;

        const sql = `
            SELECT *
            FROM sensor_readings
            WHERE employee_id = ?
            AND DATE(created_at) = CURDATE()
            ORDER BY created_at ASC
        `;

        db.query(
            sql,
            [employeeId],

            (err, results) => {

                if (err) {

                    return res.status(500).json({

                        error:
                            err.message
                    });
                }

                res.json(
                    results
                );
            }
        );
    }
);

// ============================================================
// EMPLOYEE DAILY SUMMARY
//
// Returns employee name + today's report.
// ============================================================

app.get(
    "/employee-dashboard/:employeeId",
    (req, res) => {

        const employeeId =
            req.params.employeeId;

        const employeeSQL = `
            SELECT
                employee_id,
                name,
                rfid_tag,
                department,
                assigned_chair_id
            FROM employees
            WHERE employee_id = ?
            LIMIT 1
        `;

        db.query(
            employeeSQL,
            [employeeId],

            (err, employeeResults) => {

                if (err) {

                    return res.status(500).json({

                        error:
                            err.message
                    });
                }

                if (
                    employeeResults.length === 0
                ) {

                    return res.status(404).json({

                        error:
                            "Employee not found"
                    });
                }

                const employee =
                    employeeResults[0];

                const reportSQL = `
                    SELECT

                        COUNT(*) AS total_readings,

                        ROUND(
                            AVG(posture_score),
                            1
                        ) AS average_posture_score,

                        ROUND(
                            AVG(productivity_score),
                            1
                        ) AS average_productivity_score,

                        ROUND(
                            AVG(chair_score),
                            2
                        ) AS average_chair_score,

                        SUM(
                            CASE
                                WHEN posture_status = 'Good'
                                THEN 1
                                ELSE 0
                            END
                        ) AS good_readings,

                        SUM(
                            CASE
                                WHEN posture_status = 'Moderate'
                                THEN 1
                                ELSE 0
                            END
                        ) AS moderate_readings,

                        SUM(
                            CASE
                                WHEN posture_status = 'Bad'
                                THEN 1
                                ELSE 0
                            END
                        ) AS bad_readings

                    FROM sensor_readings

                    WHERE employee_id = ?

                    AND DATE(created_at) = CURDATE()
                `;

                db.query(
                    reportSQL,
                    [employeeId],

                    (err, reportResults) => {

                        if (err) {

                            return res.status(500).json({

                                error:
                                    err.message
                            });
                        }

                        res.json({

                            employee:
                                employee,

                            chair:
                                PHYSICAL_CHAIR_ID,

                            date:
                                new Date()
                                    .toISOString()
                                    .slice(0, 10),

                            report:
                                reportResults[0]
                        });
                    }
                );
            }
        );
    }
);

// ============================================================
// START SERVER
// ============================================================
// ============================================================
// START HYDRATION MONITOR
// ============================================================
//
// Hydration is checked independently every 30 seconds.
//
// ============================================================

hydrationCheckTimer =
    setInterval(
        checkHydration,
        HYDRATION_CHECK_INTERVAL
    );

console.log(
    "Hydration monitoring: ENABLED"
);

console.log(
    "Hydration check interval: 30 seconds"
);

console.log(
    "Hydration consumption threshold:",
    HYDRATION_CONSUMPTION_THRESHOLD,
    "grams"
);
app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("");

        console.log(
            "============================================"
        );

        console.log(
            "SMART ERGONOMIC CHAIR BACKEND"
        );

        console.log(
            "============================================"
        );

        console.log(
            `Server running on port ${PORT}`
        );

        console.log(
            `Arduino: ${ARDUINO_PORT} @ ${ARDUINO_BAUD}`
        );

        console.log(
            `Physical Chair: ${PHYSICAL_CHAIR_ID}`
        );

        console.log(
             "Data transport:",
    DATA_TRANSPORT.toUpperCase()
        );

        console.log(
            "Random simulation: DISABLED"
        );

        console.log(
            "RFID employee lookup: ENABLED"
        );

        console.log(
            "Employee switching: ENABLED"
        );

        console.log(
            "One-chair multi-employee mode: ENABLED"
        );

        console.log(
            "Employee-specific sensor history: ENABLED"
        );

        console.log(
            "Daily employee reports: ENABLED"
        );

        console.log(
            "============================================"
        );
    }
);
