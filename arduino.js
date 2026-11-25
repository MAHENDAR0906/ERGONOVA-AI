const { SerialPort } = require("serialport");

const port = new SerialPort({
  path: "COM6",
  baudRate: 9600
});

console.log("Starting raw Arduino serial test...");

port.on("open", () => {
  console.log("COM6 OPENED SUCCESSFULLY");
});

port.on("data", (data) => {
  console.log(
    "RAW DATA RECEIVED:",
    JSON.stringify(data.toString())
  );
});

port.on("error", (err) => {
  console.error(
    "SERIAL ERROR:",
    err.message
  );
});

port.on("close", () => {
  console.log("COM6 CLOSED");
});