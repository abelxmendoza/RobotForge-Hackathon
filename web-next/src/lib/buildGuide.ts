/* Build guide (/build/): a four-wheel starter rover built step by step,
 * for an Arduino UNO or an ESP32, then driven in the browser.
 *
 * Pure and import-free (tests run it under node). It holds:
 *  - the ten steps, the parts list and the pin map for each board;
 *  - the Arduino sketches, generated from the same numbers the
 *    simulator's autopilot uses, so the code walkthrough and the
 *    simulated car always agree;
 *  - the flowchart of the obstacle avoider and which sketch lines each
 *    box stands for;
 *  - the arena (boxes on a 3 × 3 m floor) and the sensor ray;
 *  - the autopilot itself, a step-for-step copy of the sketch's loop().
 *
 * Nothing here was measured on a built car: part sizes and the motor
 * torque are typical catalogue figures, and TURN_MS has to be tuned on
 * the real floor. The page says so. */

export type BoardId = 'uno' | 'esp32';
export const BOARDS: Record<BoardId, { id: BoardId; name: string; chip: string; logic: string }> = {
  uno: { id: 'uno', name: 'Arduino UNO', chip: 'ATmega328P · 16 MHz', logic: '5 V logic' },
  esp32: { id: 'esp32', name: 'ESP32', chip: 'ESP32-WROOM-32 · Wi-Fi', logic: '3.3 V logic' },
};

/** Text that differs by board, or one string for both. */
export type ByBoard<T> = T | { uno: T; esp32: T };
export function pick<T>(v: ByBoard<T>, board: BoardId): T {
  return v && typeof v === 'object' && !Array.isArray(v) && 'uno' in (v as object) && 'esp32' in (v as object)
    ? (v as { uno: T; esp32: T })[board]
    : (v as T);
}

/* ---------- Parts ---------- */

/** Model pieces the 3D view can show and highlight. */
export type PieceId =
  | 'deckBottom' | 'deckMiddle' | 'deckTop' | 'motors' | 'wheels' | 'standoffs'
  | 'driver' | 'controller' | 'servo' | 'sonar' | 'battery' | 'switch' | 'led' | 'buzzer' | 'wires';

export interface BomLine { qty: number; name: ByBoard<string>; pieces: PieceId[]; search: ByBoard<string> }
export const BOM: BomLine[] = [
  { qty: 1, name: '4WD acrylic chassis kit (three decks)', pieces: ['deckBottom', 'deckMiddle', 'deckTop'], search: '4WD acrylic robot car chassis kit' },
  { qty: 4, name: 'TT gear motors (3–6 V, 1:48) with brackets', pieces: ['motors'], search: 'TT gear motor 1:48' },
  { qty: 4, name: 'Wheels, 65 mm', pieces: ['wheels'], search: 'TT motor wheel 65mm' },
  { qty: 1, name: 'L9110S dual motor driver', pieces: ['driver'], search: 'L9110S motor driver module' },
  { qty: 1, name: { uno: 'Arduino UNO R3 + sensor shield', esp32: 'ESP32 DevKit (30-pin) + expansion board' }, pieces: ['controller'], search: { uno: 'Arduino UNO R3 sensor shield v5', esp32: 'ESP32 DevKit V1 30 pin expansion board' } },
  { qty: 1, name: 'HC-SR04 ultrasonic sensor + bracket', pieces: ['sonar'], search: 'HC-SR04 ultrasonic sensor bracket' },
  { qty: 1, name: 'SG90 micro servo', pieces: ['servo'], search: 'SG90 micro servo' },
  { qty: 2, name: '18650 Li-ion cells (protected) + 2-cell holder', pieces: ['battery'], search: 'protected 18650 cell 2 slot holder' },
  { qty: 1, name: { uno: 'Switch, red LED + 220 Ω, 5 V buzzer', esp32: 'Switch, red LED + 220 Ω, 5 V buzzer + NPN transistor, 1 kΩ and 2 kΩ resistors' }, pieces: ['switch', 'led', 'buzzer'], search: 'slide switch LED active buzzer 5V' },
  { qty: 1, name: 'Jumper wires, M3 standoffs and screws', pieces: ['wires', 'standoffs'], search: 'M3 brass standoff kit jumper wires' },
];

export const TOOLS = ['Soldering iron', 'Small screwdrivers', 'Wire strippers', 'Multimeter', 'Li-ion charger', 'Arduino IDE on a computer'];

/* ---------- Pins ---------- */

export interface Pins { leftIA: string; leftIB: string; rightIA: string; rightIB: string; servo: string; trig: string; echo: string; led: string; buzzer: string }
export const PINS: Record<BoardId, Pins> = {
  // IA pins need PWM. The Servo library takes Timer1, so D9/D10 lose PWM: the servo sits on D9 and the motors use D5/D6.
  uno: { leftIA: '5', leftIB: '4', rightIA: '6', rightIB: '7', servo: '9', trig: '12', echo: '11', led: '13', buzzer: 'A0' },
  // Avoids the boot strapping pins (0, 2, 5, 12, 15). Echo is on an input-only pin behind a 1 kΩ / 2 kΩ divider.
  esp32: { leftIA: '25', leftIB: '26', rightIA: '27', rightIB: '33', servo: '18', trig: '19', echo: '34', led: '4', buzzer: '23' },
};
const pinLabel = (b: BoardId, p: string) => (b === 'uno' ? (p.startsWith('A') ? p : 'D' + p) : 'GPIO ' + p);
export function pinRows(board: BoardId): { what: string; pin: string; pieces: PieceId[] }[] {
  const p = PINS[board], l = (x: string) => pinLabel(board, x);
  return [
    { what: 'Left motors · driver A-IA / A-IB', pin: `${l(p.leftIA)} / ${l(p.leftIB)}`, pieces: ['driver', 'wires'] },
    { what: 'Right motors · driver B-IA / B-IB', pin: `${l(p.rightIA)} / ${l(p.rightIB)}`, pieces: ['driver', 'wires'] },
    { what: 'Servo signal (orange)', pin: l(p.servo), pieces: ['servo', 'wires'] },
    { what: 'HC-SR04 Trig', pin: l(p.trig), pieces: ['sonar', 'wires'] },
    { what: board === 'uno' ? 'HC-SR04 Echo' : 'HC-SR04 Echo, through the 1 kΩ / 2 kΩ divider', pin: l(p.echo), pieces: ['sonar', 'wires'] },
    { what: 'LED (through 220 Ω)', pin: l(p.led), pieces: ['led', 'wires'] },
    { what: board === 'uno' ? 'Buzzer +' : 'Buzzer, through the NPN transistor', pin: l(p.buzzer), pieces: ['buzzer', 'wires'] },
  ];
}

/* ---------- Steps ---------- */

export interface Step {
  id: string; label: string; title: ByBoard<string>; say: ByBoard<string>;
  /** Pieces fitted up to and including this step (the 3D view shows these). */
  stage: number;
  focus: PieceId[];
  do: ByBoard<string[]>;
  watch?: ByBoard<string>;
}
export const STEPS: Step[] = [
  { id: 'parts', label: 'Parts', title: 'Gather the parts', stage: 9, focus: [],
    say: 'A four-wheel rover with an ultrasonic head that turns to look around. Tick each part off as you find it.',
    do: [], watch: 'Charge the 18650 cells before you start, and use protected cells.' },
  { id: 'motors', label: 'Motors', title: 'Motors and wheels', stage: 1, focus: ['motors', 'wheels', 'deckBottom'],
    say: 'Each side’s two motors always turn together. The car steers like a tank, by running the sides at different speeds.',
    do: ['Solder a red and a black lead (15 cm) to each motor. Red goes on the tab nearer the middle of the car.', 'Bolt each motor under the bottom deck with two brackets, shafts pointing out.', 'Push a wheel onto each shaft.'],
    watch: 'Tape the leads to the motors. The tabs snap off if a lead is tugged.' },
  { id: 'decks', label: 'Decks', title: 'Stack the decks', stage: 2, focus: ['standoffs', 'deckMiddle'],
    say: 'Brass standoffs lift the middle deck clear of the motors and give the electronics a flat floor.',
    do: ['Screw eight 25 mm standoffs onto the bottom deck.', 'Feed the motor leads up through the middle deck’s slot and screw it down.'],
    watch: 'Acrylic cracks if you over-tighten. Snug is enough.' },
  { id: 'driver', label: 'Driver', title: 'Fit the motor driver', stage: 3, focus: ['driver'],
    say: 'A board pin gives about 20 mA. A TT motor wants hundreds. The L9110S switches battery power through the motors, both ways.',
    do: ['Stick the driver to the front of the middle deck with foam tape.', 'Twist the left motors’ red leads together, and their black leads. Screw them into MOTOR-A. Do the same for the right side in MOTOR-B.'],
    watch: 'Which screw gets red doesn’t matter yet. The wiring test in step 9 shows any side that runs backwards.' },
  { id: 'controller', label: 'Controller', title: { uno: 'Mount the Arduino UNO', esp32: 'Mount the ESP32' }, stage: 4, focus: ['controller'],
    say: { uno: 'The UNO runs your sketch at 5 V. The sensor shield gives every pin its own ground, 5 V and signal pin.', esp32: 'The ESP32 runs your sketch at 3.3 V and has Wi-Fi. The expansion board gives every pin its own ground, power and signal pin.' },
    do: { uno: ['Screw the UNO behind the driver, USB socket to the side.', 'Press the sensor shield on, every pin in its socket.'], esp32: ['Screw the expansion board behind the driver.', 'Seat the DevKit so the pin names match the board’s labels.', 'Set the power jumper to 5 V for the servo, sensor and buzzer.'] },
    watch: { uno: 'The UNO is 5 V, so the sensor and servo plug straight in.', esp32: 'ESP32 pins are not 5 V safe. The sensor’s Echo goes through a divider in step 8.' } },
  { id: 'sensor', label: 'Sensor', title: 'Sensor head', stage: 5, focus: ['servo', 'sonar'],
    say: 'The HC-SR04 times an ultrasonic echo: centimetres ≈ microseconds ÷ 58. On a servo it can look left and right before the car turns.',
    do: ['Screw the servo into the front cut-out of the middle deck, shaft up.', 'Centre the servo, then fit the horn pointing forwards.', 'Screw the bracket to the horn and the sensor to the bracket.'],
    watch: 'Don’t turn the servo shaft by hand. Its plastic gears strip.' },
  { id: 'power', label: 'Power', title: 'Power', stage: 7, focus: ['deckTop', 'battery', 'switch', 'led', 'buzzer'],
    say: 'Two 18650 cells in series give 7.4 V. The switch breaks the + lead. One plug feeds the board, and two wires from it feed the driver.',
    do: ['Screw the top deck onto four 15 mm standoffs.', 'Wire the switch into the battery’s red lead and stick the holder on the top deck.', 'Run red and black from the plug’s terminals to the driver’s VCC and GND.', 'Solder the 220 Ω resistor to the LED’s long leg.', 'Switch on briefly: the board’s and the driver’s power LEDs should light.'],
    watch: 'Check polarity twice before the cells go in. If nothing lights, switch off at once.' },
  { id: 'wiring', label: 'Wiring', title: 'Wire it up', stage: 8, focus: ['wires'],
    say: 'Everything plugs into a ground, power and signal pin on the shield, so all the parts share one ground.',
    do: [], watch: { uno: 'D5 and D6 carry each side’s speed (PWM). The Servo library switches PWM off on D9 and D10, which is why the servo has D9.', esp32: 'Echo is 5 V, so it goes through 1 kΩ then 2 kΩ to ground, and GPIO 34 reads the middle (3.3 V). The buzzer needs 5 V, so an NPN transistor switches it.' } },
  { id: 'code', label: 'Code', title: 'Upload the code', stage: 9, focus: [],
    say: { uno: 'Two sketches. The wiring test checks each part in turn. The obstacle avoider is the car’s program.', esp32: 'Two sketches. The wiring test checks each part in turn. The obstacle avoider is the car’s program.' },
    do: { uno: ['In the Arduino IDE pick Tools → Board → Arduino UNO and your port.', 'Prop the car up, wheels off the table. Upload the wiring test and open the Serial Monitor at 115200.', 'Fix anything that didn’t match, then upload the obstacle avoider and put the car on the floor.', 'Change TURN_MS until each turn is about a quarter turn.'], esp32: ['In the Arduino IDE install “esp32 by Espressif Systems” 3.x and pick ESP32 Dev Module.', 'Prop the car up, wheels off the table. Upload the wiring test and open the Serial Monitor at 115200.', 'Fix anything that didn’t match, then upload the obstacle avoider and put the car on the floor.', 'Change TURN_MS until each turn is about a quarter turn.'] },
    watch: 'A side turning backwards: swap its two wires in the driver’s terminal.' },
  { id: 'drive', label: 'Drive', title: 'Drive it', stage: 9, focus: [],
    say: 'The simulated car runs the same routine as the obstacle avoider. Drive it yourself, switch to Auto, and move the boxes around.',
    do: [] },
];
export const STEP_IDS = STEPS.map((s) => s.id);

/** The step each piece goes on in, for the 3D view. */
export const PIECE_STAGE: Record<PieceId, number> = {
  deckBottom: 1, motors: 1, wheels: 1, standoffs: 2, deckMiddle: 2, driver: 3, controller: 4,
  servo: 5, sonar: 5, deckTop: 7, battery: 7, switch: 7, led: 7, buzzer: 7, wires: 8,
};

/** Things to tick in a step: parts on step 1, actions elsewhere. */
export function checkKeys(step: Step, board: BoardId): string[] {
  if (step.id === 'parts') return BOM.map((_, i) => `${board}/parts/${i}`);
  return pick(step.do, board).map((_, i) => `${board}/${step.id}/${i}`);
}

/* ---------- The autopilot's numbers (also written into the sketch) ---------- */

export const AUTO = {
  STOP_CM: 25,   // stop when something is closer than this
  ROOM_CM: 30,   // a side needs this much room to turn into
  CRUISE: 170,   // forward speed, 0–255
  SPIN: 230,     // turning speed, 0–255
  TURN_MS: 1100, // how long a turn lasts; tune it on your floor
  BACK_MS: 600,  // how long it backs up
  LOOK_MS: 350,  // time for the servo to get there before a reading
  BEEP_MS: 150,
  STUCK_MS: 2500, // the reading hasn't changed for this long: stuck
  STUCK_CM: 2,
  AGAIN_MS: 1500, // blocked this soon after a turn: turn the same way again
  LOOK_RIGHT: 30, LOOK_LEFT: 150, // servo angles (90 = straight ahead)
  NO_ECHO_CM: 400,
};

/* ---------- Sketches ---------- */

const header = (board: BoardId, what: string) =>
  `// RobotForge starter rover · ${what} · ${BOARDS[board].name}\n// From robotforge's build guide (/build/). Serial Monitor: 115200 baud.\n`;

function pinBlock(board: BoardId): string {
  const p = PINS[board], v = (x: string) => (board === 'uno' ? x : x);
  return [
    `const int LEFT_IA = ${v(p.leftIA)}, LEFT_IB = ${v(p.leftIB)};    // left motors, driver MOTOR-A`,
    `const int RIGHT_IA = ${v(p.rightIA)}, RIGHT_IB = ${v(p.rightIB)};  // right motors, driver MOTOR-B`,
    `const int SERVO_PIN = ${p.servo};`,
    `const int TRIG = ${p.trig}, ECHO = ${p.echo};`,
    `const int LED = ${p.led}, BUZZER = ${p.buzzer};`,
  ].join('\n');
}

/* Board-specific helpers: motor sides, the servo, the sensor. On the
 * UNO, speed is analogWrite(); on the ESP32 (core 3.x) it is LEDC. */
function helpers(board: BoardId): string {
  const servo = board === 'uno'
    ? `Servo head;\nvoid look(int deg) { head.write(deg); }`
    : `// 50 Hz, 16-bit: 0.5 ms (0°) to 2.4 ms (180°) pulses\nvoid look(int deg) { ledcWrite(SERVO_PIN, map(deg, 0, 180, 1638, 7864)); }`;
  const pwm = board === 'uno' ? 'analogWrite' : 'ledcWrite';
  return `${servo}

// One side, speed -255…255. Backwards holds IB high and pulses IA low.
void side(int ia, int ib, int v) {
  v = constrain(v, -255, 255);
  digitalWrite(ib, v < 0 ? HIGH : LOW);
  ${pwm}(ia, v < 0 ? 255 + v : v);
}
void drive(int left, int right) { side(LEFT_IA, LEFT_IB, left); side(RIGHT_IA, RIGHT_IB, right); }

// Distance in cm. No echo within 30 ms means nothing in range.
float readCm() {
  digitalWrite(TRIG, LOW); delayMicroseconds(2);
  digitalWrite(TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  unsigned long us = pulseIn(ECHO, HIGH, 30000UL);
  return us == 0 ? ${AUTO.NO_ECHO_CM} : us / 58.0;
}`;
}

function setupPins(board: BoardId): string {
  const common = `  pinMode(LEFT_IB, OUTPUT); pinMode(RIGHT_IB, OUTPUT);
  pinMode(TRIG, OUTPUT); pinMode(ECHO, INPUT);
  pinMode(LED, OUTPUT); pinMode(BUZZER, OUTPUT);
  Serial.begin(115200);`;
  return board === 'uno'
    ? `  pinMode(LEFT_IA, OUTPUT); pinMode(RIGHT_IA, OUTPUT);\n${common}\n  head.attach(SERVO_PIN);`
    : `  ledcAttach(LEFT_IA, 1000, 8); ledcAttach(RIGHT_IA, 1000, 8);\n  ledcAttach(SERVO_PIN, 50, 16);\n${common}`;
}

export function wiringTestSketch(board: BoardId): string {
  return `${header(board, 'wiring test')}// Prop the car up, wheels off the table, then watch each numbered line happen.
${board === 'uno' ? '#include <Servo.h>\n' : ''}
${pinBlock(board)}

${helpers(board)}

void say(const char* line) { Serial.println(line); delay(1200); }

void setup() {
${setupPins(board)}
  look(90);
  delay(1000);
}

void loop() {
  digitalWrite(LED, HIGH); digitalWrite(BUZZER, HIGH);
  say("1  LED on and a beep");
  digitalWrite(LED, LOW); digitalWrite(BUZZER, LOW);
  look(${AUTO.LOOK_RIGHT}); say("2  Head looks right");
  look(${AUTO.LOOK_LEFT}); say("3  Head looks left");
  look(90); say("4  Head looks ahead");
  Serial.print("5  Distance: "); Serial.print(readCm()); Serial.println(" cm"); delay(800);
  drive(${AUTO.CRUISE}, 0); say("6  Left wheels forward");
  drive(-${AUTO.CRUISE}, 0); say("7  Left wheels backward");
  drive(0, ${AUTO.CRUISE}); say("8  Right wheels forward");
  drive(0, -${AUTO.CRUISE}); say("9  Right wheels backward");
  drive(0, 0); say("Done. Starting again in 5 s.");
  delay(5000);
}
`;
}

/* The obstacle avoider. Each block is marked "// ▸ <flow box>" so the
 * code walkthrough can show the lines behind each box of the chart.
 * Keep the state names and numbers in step with Autopilot below. */
export function avoiderSketch(board: BoardId): string {
  const a = AUTO;
  return `${header(board, 'obstacle avoider')}${board === 'uno' ? '#include <Servo.h>\n' : ''}
${pinBlock(board)}

const int STOP_CM = ${a.STOP_CM};     // stop when something is closer than this
const int ROOM_CM = ${a.ROOM_CM};     // a side needs this much room to turn into
const int CRUISE = ${a.CRUISE};     // forward speed, 0-255
const int SPIN = ${a.SPIN};       // turning speed, 0-255
const int TURN_MS = ${a.TURN_MS};   // tune until a turn is about a quarter turn
const int BACK_MS = ${a.BACK_MS};
const int LOOK_MS = ${a.LOOK_MS};    // time for the servo to get there
const int BEEP_MS = ${a.BEEP_MS};
const int STUCK_MS = ${a.STUCK_MS};
const int AGAIN_MS = ${a.AGAIN_MS};
const int LOOK_RIGHT = ${a.LOOK_RIGHT}, LOOK_LEFT = ${a.LOOK_LEFT};

${helpers(board)}

enum Step { Drive, Halt, LookRight, LookLeft, Decide, BackUp, Turn };
Step step = Drive;
unsigned long since = 0;        // when the current step began
float rightCm = 0, leftCm = 0;
bool turnLeft = true;           // the way the last turn went
unsigned long turnedAt = 0;     // when the last turn ended
float lastCm = 0;               // to spot a stuck car
unsigned long lastChange = 0;

void go(Step next) { step = next; since = millis(); }

void setup() {
${setupPins(board)}
  look(90);
  delay(2000);                  // time to put the car down
  lastChange = millis();
  go(Drive);
}

void loop() {
  unsigned long t = millis() - since;
  float cm = readCm();
  switch (step) {
    case Drive:
      // ▸ Drive forward
      drive(CRUISE, CRUISE);
      if (fabs(cm - lastCm) > ${a.STUCK_CM}) { lastCm = cm; lastChange = millis(); }
      // ▸ Closer than STOP_CM?
      if (cm < STOP_CM) {
        Serial.print("Obstacle at "); Serial.print(cm); Serial.println(" cm");
        go(Halt);
      }
      // ▸ Not moving?
      else if (millis() - lastChange > STUCK_MS) {
        Serial.println("Stuck: backing up");
        go(BackUp);
      }
      break;

    case Halt:
      // ▸ Stop, LED on, beep
      drive(0, 0);
      digitalWrite(LED, HIGH);
      digitalWrite(BUZZER, t < BEEP_MS ? HIGH : LOW);
      if (t > BEEP_MS) { look(LOOK_RIGHT); go(LookRight); }
      break;

    case LookRight:
      // ▸ Look right, then left
      if (t > LOOK_MS) { rightCm = cm; look(LOOK_LEFT); go(LookLeft); }
      break;
    case LookLeft:
      if (t > LOOK_MS) {
        leftCm = cm; look(90);
        Serial.print("Right "); Serial.print(rightCm);
        Serial.print(" cm, left "); Serial.print(leftCm); Serial.println(" cm");
        go(Decide);
      }
      break;

    case Decide:
      if (t < LOOK_MS / 2) break;  // head back to the middle
      digitalWrite(LED, LOW);
      // ▸ Room on a side?
      if (max(leftCm, rightCm) < ROOM_CM) { Serial.println("Boxed in"); go(BackUp); break; }
      // ▸ Just turned?
      if (millis() - turnedAt < AGAIN_MS) {
        // ▸ Same way again
        Serial.println("Blocked again: same way");
      } else {
        // ▸ Side with more room
        turnLeft = leftCm > rightCm;
      }
      Serial.println(turnLeft ? "Turning left" : "Turning right");
      go(Turn);
      break;

    case BackUp:
      // ▸ Back up
      drive(-CRUISE, -CRUISE);
      if (t > BACK_MS) go(Halt);  // then look again
      break;

    case Turn:
      // ▸ Turn
      if (turnLeft) drive(-SPIN, SPIN); else drive(SPIN, -SPIN);
      if (t > TURN_MS) { turnedAt = millis(); lastChange = millis(); go(Drive); }
      break;
  }
  delay(20);
}
`;
}

export function sketches(board: BoardId): { tab: string; file: string; code: string }[] {
  return [
    { tab: '1 · Wiring test', file: `rover_test_${board}.ino`, code: wiringTestSketch(board) },
    { tab: '2 · Obstacle avoider', file: `rover_avoid_${board}.ino`, code: avoiderSketch(board) },
  ];
}

/* ---------- The code walkthrough's flowchart ---------- */

export type FlowId = 'drive' | 'near' | 'stuck' | 'halt' | 'look' | 'room' | 'back' | 'again' | 'same' | 'side' | 'turn';
export interface FlowNode { id: FlowId; kind: 'do' | 'ask'; label: string; marker: string; say: string; col: number; row: number }
export const FLOW: FlowNode[] = [
  { id: 'drive', kind: 'do', label: 'Drive forward', marker: 'Drive forward', col: 0, row: 0, say: 'Both sides at CRUISE. It reads the distance every pass of loop(), about 50 times a second.' },
  { id: 'near', kind: 'ask', label: `Closer than ${AUTO.STOP_CM} cm?`, marker: 'Closer than STOP_CM?', col: 1, row: 0, say: `Anything nearer than STOP_CM (${AUTO.STOP_CM} cm) straight ahead stops the car.` },
  { id: 'stuck', kind: 'ask', label: 'Not moving?', marker: 'Not moving?', col: 1, row: 1, say: `The narrow beam can miss a corner. If the reading hasn’t changed for ${AUTO.STUCK_MS / 1000} s while the wheels push, the car is stuck.` },
  { id: 'halt', kind: 'do', label: 'Stop · LED · beep', marker: 'Stop, LED on, beep', col: 2, row: 0, say: `Motors off, LED on and a ${AUTO.BEEP_MS} ms beep, then the head turns right.` },
  { id: 'look', kind: 'do', label: 'Look right, then left', marker: 'Look right, then left', col: 2, row: 1, say: `The head turns to ${AUTO.LOOK_RIGHT}° and ${AUTO.LOOK_LEFT}°. Each reading waits ${AUTO.LOOK_MS} ms for the servo to get there.` },
  { id: 'room', kind: 'ask', label: `Room on a side?`, marker: 'Room on a side?', col: 2, row: 2, say: `A side needs ROOM_CM (${AUTO.ROOM_CM} cm) to turn into. Neither has it: the car is boxed in.` },
  { id: 'back', kind: 'do', label: 'Back up', marker: 'Back up', col: 1, row: 2, say: `Reverse for ${AUTO.BACK_MS} ms, then stop and look again.` },
  { id: 'again', kind: 'ask', label: 'Just turned?', marker: 'Just turned?', col: 2, row: 3, say: `Blocked within ${AUTO.AGAIN_MS / 1000} s of the last turn: keep turning the same way, or it would rock left, right, left in a corner.` },
  { id: 'same', kind: 'do', label: 'Same way again', marker: 'Same way again', col: 1, row: 4, say: 'Keeps the last direction.' },
  { id: 'side', kind: 'do', label: 'Side with more room', marker: 'Side with more room', col: 2, row: 4, say: 'Turns toward the larger of the two readings.' },
  { id: 'turn', kind: 'do', label: 'Turn', marker: 'Turn', col: 0, row: 4, say: `Spins on the spot for TURN_MS (${AUTO.TURN_MS} ms), then drives on.` },
];
export const FLOW_EDGES: { from: FlowId; to: FlowId; label?: string }[] = [
  { from: 'drive', to: 'near' }, { from: 'near', to: 'halt', label: 'yes' }, { from: 'near', to: 'stuck', label: 'no' },
  { from: 'stuck', to: 'drive', label: 'no' }, { from: 'stuck', to: 'back', label: 'yes' },
  { from: 'halt', to: 'look' }, { from: 'look', to: 'room' }, { from: 'room', to: 'back', label: 'no' }, { from: 'back', to: 'halt' },
  { from: 'room', to: 'again', label: 'yes' }, { from: 'again', to: 'same', label: 'yes' }, { from: 'again', to: 'side', label: 'no' },
  { from: 'same', to: 'turn' }, { from: 'side', to: 'turn' }, { from: 'turn', to: 'drive' },
];

/** The sketch lines behind one flow box: from its marker to the next
 * marker or the end of its case. Line numbers count from 1. */
export function flowLines(code: string, id: FlowId): { first: number; lines: { n: number; text: string }[] } {
  const node = FLOW.find((f) => f.id === id);
  const lines = code.split('\n');
  const start = node ? lines.findIndex((l) => l.trim() === `// ▸ ${node.marker}`) : -1;
  if (start < 0) throw new Error(`flow: no marker for ${id}`);
  // A box runs to the next marker, a blank line, or the switch's closing brace.
  let end = start + 1;
  while (end < lines.length && !lines[end].includes('// ▸') && lines[end].trim() !== '' && !/^ {2}\}\s*$/.test(lines[end])) end++;
  return { first: start + 1, lines: lines.slice(start, end).map((text, i) => ({ n: start + i + 1, text })) };
}

/* ---------- The arena ---------- */

export const ARENA_HALF = 1.5; // a 3 × 3 m floor, metres
export const WALL_H = 0.12;
export const START_CLEAR_M = 0.3; // keep the start spot free
export interface ArenaBox { id: string; x: number; y: number; w: number; d: number; h: number; tone: 'card' | 'wood' | 'blue' }
export const BOX_LIMITS = { w: [0.04, 1.2], d: [0.04, 1.2], h: [0.05, 0.4] } as const;
export const MAX_BOXES = 24;
export const DEFAULT_ARENA: ArenaBox[] = [
  { id: 'b1', x: 0.75, y: 0.05, w: 0.22, d: 0.3, h: 0.16, tone: 'card' },
  { id: 'b2', x: 0.55, y: -0.85, w: 0.3, d: 0.2, h: 0.14, tone: 'wood' },
  { id: 'b3', x: -0.7, y: -0.5, w: 0.24, d: 0.24, h: 0.18, tone: 'card' },
  { id: 'b4', x: -0.2, y: 1.0, w: 0.7, d: 0.12, h: 0.12, tone: 'blue' },
  { id: 'b5', x: -1.0, y: 0.7, w: 0.16, d: 0.16, h: 0.2, tone: 'wood' },
  { id: 'b6', x: 1.05, y: 0.95, w: 0.2, d: 0.2, h: 0.12, tone: 'blue' },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 1000) / 1000;

/** A box made safe: size within limits, footprint inside the floor. */
export function fitBox(b: ArenaBox): ArenaBox {
  const w = clamp(b.w, ...BOX_LIMITS.w), d = clamp(b.d, ...BOX_LIMITS.d), h = clamp(b.h, ...BOX_LIMITS.h);
  return { ...b, w: round(w), d: round(d), h: round(h), x: round(clamp(b.x, -ARENA_HALF + w / 2, ARENA_HALF - w / 2)), y: round(clamp(b.y, -ARENA_HALF + d / 2, ARENA_HALF - d / 2)) };
}

/** True when a box covers the car's start spot (the origin). */
export function coversStart(b: ArenaBox): boolean {
  const dx = Math.max(Math.abs(b.x) - b.w / 2, 0), dy = Math.max(Math.abs(b.y) - b.d / 2, 0);
  return Math.hypot(dx, dy) < START_CLEAR_M;
}

/** Read a saved arena; anything malformed gives null (use the default). */
export function parseArena(raw: string | null): ArenaBox[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (v?.v !== 1 || !Array.isArray(v.boxes) || v.boxes.length > MAX_BOXES) return null;
    const out: ArenaBox[] = [];
    for (const b of v.boxes) {
      if (!b || typeof b.id !== 'string' || !/^[a-z0-9]{1,12}$/.test(b.id)) return null;
      for (const k of ['x', 'y', 'w', 'd', 'h']) if (typeof b[k] !== 'number' || !Number.isFinite(b[k])) return null;
      out.push(fitBox({ id: b.id, x: b.x, y: b.y, w: b.w, d: b.d, h: b.h, tone: ['card', 'wood', 'blue'].includes(b.tone) ? b.tone : 'card' }));
    }
    return out;
  } catch { return null; }
}
export const serializeArena = (boxes: ArenaBox[]) => JSON.stringify({ v: 1, boxes });

/** Floor walls plus boxes, as centre + half-extents (metres, z up). */
export function arenaSolids(boxes: ArenaBox[]): { x: number; y: number; z: number; hx: number; hy: number; hz: number; wall: boolean }[] {
  const t = 0.04, H = ARENA_HALF;
  const walls = [
    { x: H + t / 2, y: 0, hx: t / 2, hy: H + t }, { x: -H - t / 2, y: 0, hx: t / 2, hy: H + t },
    { x: 0, y: H + t / 2, hx: H + t, hy: t / 2 }, { x: 0, y: -H - t / 2, hx: H + t, hy: t / 2 },
  ].map((w) => ({ ...w, z: WALL_H / 2, hz: WALL_H / 2, wall: true }));
  return [...walls, ...boxes.map((b) => ({ x: b.x, y: b.y, z: b.h / 2, hx: b.w / 2, hy: b.d / 2, hz: b.h / 2, wall: false }))];
}

/** The HC-SR04 as one straight ray from (x, y) along heading (degrees,
 * 0 = +x). Returns cm to the first face, or NO_ECHO_CM past 4 m. The
 * real beam is a cone about 15° wide; the page says so. The sensor sits
 * about 11 cm up, so boxes lower than SONAR_MIN_TOP_M aren't seen. */
export const SONAR_MIN_TOP_M = 0.08; // lower than this, a box slips under the beam
export function sonarCm(x: number, y: number, headingDeg: number, solids: { x: number; y: number; hx: number; hy: number; z?: number; hz?: number }[]): number {
  const a = (headingDeg * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a);
  let best = Infinity;
  for (const s of solids) {
    if (s.z !== undefined && s.hz !== undefined && s.z + s.hz < SONAR_MIN_TOP_M) continue;
    let t0 = -Infinity, t1 = Infinity;
    for (const [p, d, c, h] of [[x, dx, s.x, s.hx], [y, dy, s.y, s.hy]] as const) {
      if (Math.abs(d) < 1e-12) { if (p < c - h || p > c + h) { t0 = Infinity; break; } continue; }
      let ta = (c - h - p) / d, tb = (c + h - p) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    }
    if (t0 <= t1 && t1 >= 0) best = Math.min(best, Math.max(0, t0));
  }
  const cm = best * 100;
  return cm > 400 ? AUTO.NO_ECHO_CM : Math.max(2, cm);
}

/* ---------- The autopilot: the sketch's loop(), step for step ---------- */

export type AutoStep = 'Drive' | 'Halt' | 'LookRight' | 'LookLeft' | 'Decide' | 'BackUp' | 'Turn';
export interface AutoOut {
  left: number; right: number; // −255…255 per side, as drive() gets them
  servo: number; led: boolean; buzzer: boolean;
  step: AutoStep; node: FlowId;
  /** Boxes the last decision passed through, for the chart to light. */
  trail: FlowId[];
  log: string[];
}

/** One autopilot. Call tick() every simulated 20 ms with the time in
 * ms and the sensor's reading where the head points now. */
export function createAutopilot(startMs = 0) {
  const a = AUTO;
  let step: AutoStep = 'Drive', since = startMs, rightCm = 0, leftCm = 0, turnLeft = true;
  let turnedAt = -1e9, lastCm = 0, lastChange = startMs, servo = 90, led = false;
  let trail: FlowId[] = [];
  const go = (next: AutoStep, now: number) => { step = next; since = now; };
  return {
    get step() { return step; },
    tick(now: number, cm: number): AutoOut {
      const t = now - since, log: string[] = [];
      let left = 0, right = 0, buzzer = false, node: FlowId = 'drive';
      switch (step) {
        case 'Drive':
          left = right = a.CRUISE; node = 'drive';
          if (Math.abs(cm - lastCm) > a.STUCK_CM) { lastCm = cm; lastChange = now; }
          if (cm < a.STOP_CM) { log.push(`Obstacle at ${cm.toFixed(1)} cm`); trail = ['drive', 'near', 'halt']; go('Halt', now); }
          else if (now - lastChange > a.STUCK_MS) { log.push('Stuck: backing up'); trail = ['drive', 'near', 'stuck', 'back']; go('BackUp', now); }
          break;
        case 'Halt':
          node = 'halt'; led = true; buzzer = t < a.BEEP_MS;
          if (t > a.BEEP_MS) { servo = a.LOOK_RIGHT; go('LookRight', now); }
          break;
        case 'LookRight':
          node = 'look';
          if (t > a.LOOK_MS) { rightCm = cm; servo = a.LOOK_LEFT; go('LookLeft', now); }
          break;
        case 'LookLeft':
          node = 'look';
          if (t > a.LOOK_MS) { leftCm = cm; servo = 90; log.push(`Right ${rightCm.toFixed(1)} cm, left ${leftCm.toFixed(1)} cm`); go('Decide', now); }
          break;
        case 'Decide':
          node = 'look';
          if (t < a.LOOK_MS / 2) break;
          led = false;
          if (Math.max(leftCm, rightCm) < a.ROOM_CM) { log.push('Boxed in'); trail = ['look', 'room', 'back']; go('BackUp', now); break; }
          if (now - turnedAt < a.AGAIN_MS) { log.push('Blocked again: same way'); trail = ['look', 'room', 'again', 'same', 'turn']; }
          else { turnLeft = leftCm > rightCm; trail = ['look', 'room', 'again', 'side', 'turn']; }
          log.push(turnLeft ? 'Turning left' : 'Turning right');
          go('Turn', now);
          break;
        case 'BackUp':
          node = 'back'; left = right = -a.CRUISE;
          if (t > a.BACK_MS) go('Halt', now);
          break;
        case 'Turn':
          node = 'turn';
          [left, right] = turnLeft ? [-a.SPIN, a.SPIN] : [a.SPIN, -a.SPIN];
          if (t > a.TURN_MS) { turnedAt = now; lastChange = now; go('Drive', now); }
          break;
      }
      return { left, right, servo, led, buzzer, step, node, trail, log };
    },
  };
}

/** Side speeds (−255…255) as the drive sandbox's throttle and turn
 * (both −1…1; turn > 0 is left). */
export function sidesToInput(left: number, right: number): { throttle: number; turn: number } {
  const l = left / 255, r = right / 255;
  return { throttle: (l + r) / 2, turn: (r - l) / 2 };
}

/* ---------- The car the simulator drives ---------- */

/** A spec the drive sandbox runs. Typical figures for this kit, not
 * measured: 65 mm wheels, four TT motors (≈0.08 N·m stall at 6 V). */
export function starterRoverSpec() {
  return {
    name: 'Starter rover', drivetrain: 'skid_steer',
    length_m: 0.24, width_m: 0.13, height_m: 0.13, mass_kg: 0.75, ground_clearance_m: 0.012,
    wheel: { count: 4, diameter_m: 0.065, width_m: 0.027, driven: true },
    motor: { count: 4, kind: 'dc_gearmotor', stall_torque_nm: 0.08 },
  };
}
