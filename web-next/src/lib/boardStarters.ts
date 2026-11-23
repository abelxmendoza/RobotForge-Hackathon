/* Multi-board starter robots for the Workshop's Add panel (Abel,
 * 2026-11-23): a Jetson or Raspberry Pi paired with a microcontroller.
 * Each is a spec file in examples/ (served under /examples/), so the
 * CLI, the tests and the app read the same file. Pure data, zero imports. */
export interface BoardStarter { file: string; name: string; blurb: string }

export const BOARD_STARTERS: BoardStarter[] = [
  { file: 'jetson-stm32-rover.json', name: 'Jetson + STM32', blurb: 'Jetson Orin Nano for vision, STM32 Nucleo for motors. Linked over USB.' },
  { file: 'jetson-mega-rover.json', name: 'Jetson + Arduino Mega', blurb: 'Linked over UART through a 3.3 V to 5 V level shifter.' },
  { file: 'pi5-esp32-rover.json', name: 'Raspberry Pi 5 + ESP32', blurb: 'Both 3.3 V, linked over UART. ESP32 runs the motors and IMU.' },
];
