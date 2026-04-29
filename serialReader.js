const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");

const PORT_NAME = "COM7"; // ⚠️ change if needed
const BAUD_RATE = 9600;

let port = null;
let parser = null;

/* CONNECT FUNCTION */
function connectSerial() {

  console.log("🔌 Connecting to", PORT_NAME, "...");

  port = new SerialPort({
    path: PORT_NAME,
    baudRate: BAUD_RATE,
    autoOpen: false
  });

  port.open((err) => {
    if (err) {
      console.log("❌ Connection failed:", err.message);
      console.log("🔁 Retrying in 2 seconds...");
      setTimeout(connectSerial, 2000);
      return;
    }

    console.log("✅ Serial connected:", PORT_NAME);

    parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

    parser.on("data", (data) => {
      const clean = data.toString().trim();
      console.log("RAW:", clean);
    });
  });

  /* HANDLE DISCONNECT */
  port.on("close", () => {
    console.log("⚠️ Serial disconnected");
    console.log("🔁 Reconnecting in 2 seconds...");
    setTimeout(connectSerial, 2000);
  });

  port.on("error", (err) => {
    console.log("⚠️ Serial error:", err.message);
  });
}

/* START */
connectSerial();