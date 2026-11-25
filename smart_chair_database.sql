-- ============================================================
-- AI ENABLED SMART ERGONOMIC CHAIR
-- FINAL DATABASE CONFIGURATION
--
-- ONE PHYSICAL CHAIR
-- CHAIR001
--
-- ANY EMPLOYEE CAN USE CHAIR001
-- RFID identifies the employee
-- Historical sensor data is separated by employee_id
-- ============================================================

CREATE DATABASE IF NOT EXISTS defaultdb;

USE defaultdb;


-- ============================================================
-- 1. EMPLOYEES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS employees (
    employee_id VARCHAR(10) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    rfid_tag VARCHAR(20) UNIQUE,
    department VARCHAR(100),
    assigned_chair_id VARCHAR(10)
);


-- ============================================================
-- 2. CHAIRS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS chairs (
    chair_id VARCHAR(10) PRIMARY KEY,

    status VARCHAR(20),

    current_employee_id VARCHAR(10),
    current_rfid VARCHAR(20),

    left_pressure INT DEFAULT 0,
    right_pressure INT DEFAULT 0,
    fsr_back_center INT DEFAULT 0,

    heart_rate INT DEFAULT 0,
    temperature INT DEFAULT 0,

    current_posture_score INT DEFAULT 0,
    back_angle INT DEFAULT 0,

    tilt DECIMAL(8,2) DEFAULT 0,
    tilt_deviation DECIMAL(8,2) DEFAULT 0,

    flex INT DEFAULT 0,
    flex_deviation DECIMAL(8,2) DEFAULT 0,

    mpu_score INT DEFAULT 1,
    flex_score INT DEFAULT 1,
    fsr_score INT DEFAULT 1,
    chair_score INT DEFAULT 3,

    posture_status VARCHAR(20),
    current_user_state VARCHAR(30),

    productivity_score INT DEFAULT 0,

    chair_action VARCHAR(100),

    fan_status VARCHAR(10),
    vibration_alert VARCHAR(10)
);


-- ============================================================
-- 3. SENSOR READINGS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS sensor_readings (
    id INT AUTO_INCREMENT PRIMARY KEY,

    chair_id VARCHAR(10),
    employee_id VARCHAR(10),
    rfid_tag VARCHAR(20),

    left_pressure INT,
    right_pressure INT,
    fsr_back_center INT,

    heart_rate INT,
    temperature INT,

    tilt DECIMAL(8,2),
    tilt_deviation DECIMAL(8,2),

    flex INT,
    flex_deviation DECIMAL(8,2),

    mpu_score INT,
    flex_score INT,
    fsr_score INT,
    chair_score INT,

    posture_score INT,
    posture_status VARCHAR(20),

    user_state VARCHAR(30),
    chair_action VARCHAR(100),

    productivity_score INT,

    vibration VARCHAR(10),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- 4. REMOVE UNIQUE CHAIR ASSIGNMENT
--
-- Multiple employees must be allowed to have CHAIR001.
-- ============================================================

SET @index_exists = (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = 'defaultdb'
      AND TABLE_NAME = 'employees'
      AND INDEX_NAME = 'assigned_chair_id'
);

SET @sql = IF(
    @index_exists > 0,
    'ALTER TABLE employees DROP INDEX assigned_chair_id',
    'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- ============================================================
-- 5. ENSURE CHAIR001 EXISTS
-- ============================================================

INSERT INTO chairs (
    chair_id,
    status,
    current_employee_id,
    current_rfid
)
VALUES (
    'CHAIR001',
    'Available',
    NULL,
    NULL
)
ON DUPLICATE KEY UPDATE
    chair_id = chair_id;


-- ============================================================
-- 6. ALL EMPLOYEES CAN USE CHAIR001
--
-- WHERE employee_id IS NOT NULL is important because
-- MySQL Safe Update Mode may reject an UPDATE without WHERE.
-- employee_id is the PRIMARY KEY.
-- ============================================================

UPDATE employees
SET assigned_chair_id = 'CHAIR001'
WHERE employee_id = 'EMP001';

UPDATE employees
SET assigned_chair_id = 'CHAIR001'
WHERE employee_id = 'EMP002';

UPDATE employees
SET assigned_chair_id = 'CHAIR001'
WHERE employee_id = 'EMP003';

UPDATE employees
SET assigned_chair_id = 'CHAIR001'
WHERE employee_id = 'EMP004';

UPDATE employees
SET assigned_chair_id = 'CHAIR001'
WHERE employee_id = 'EMP005';

UPDATE employees
SET assigned_chair_id = 'CHAIR001'
WHERE employee_id = 'EMP006';

-- ============================================================
-- 7. VERIFY EMPLOYEES
-- ============================================================

SELECT
    employee_id,
    name,
    rfid_tag,
    department,
    assigned_chair_id
FROM employees
ORDER BY employee_id;


-- ============================================================
-- 8. VERIFY ONLY ONE PHYSICAL CHAIR
-- ============================================================

SELECT
    chair_id,
    status,
    current_employee_id,
    current_rfid,
    left_pressure,
    right_pressure,
    fsr_back_center,
    heart_rate,
    temperature,
    current_posture_score,
    posture_status,
    productivity_score
FROM chairs
WHERE chair_id = 'CHAIR001';


-- ============================================================
-- 9. VERIFY EMP001 HISTORY
-- ============================================================

SELECT
    id,
    chair_id,
    employee_id,
    rfid_tag,

    left_pressure,
    right_pressure,
    fsr_back_center,

    tilt,
    flex,

    mpu_score,
    flex_score,
    fsr_score,
    chair_score,

    posture_score,
    posture_status,

    productivity_score,
    vibration,

    created_at

FROM sensor_readings

WHERE employee_id = 'EMP001'

ORDER BY created_at DESC

LIMIT 20;


-- ============================================================
-- 10. VERIFY ALL EMPLOYEE HISTORY COUNTS
-- ============================================================

SELECT
    employee_id,
    COUNT(*) AS total_sensor_readings
FROM sensor_readings
GROUP BY employee_id
ORDER BY employee_id;