/* Part-family illustrations (assets/img/parts/*.jpg) for BOM rows and
 * inventory cards. These are generic drawings of a typical part of that
 * kind, never a photo of the person's own part, so callers label them
 * as illustrations. Matching is by keywords in the part's name, falling
 * back to its category; most specific rules first. */
import { assetPath } from '@/components/home/asset';

const RULES: [RegExp, string][] = [
  [/rplidar|a1m8/i, 'rplidar_a1'],
  [/lidar/i, 'lidar'],
  [/realsense|d435|depth cam/i, 'realsense_d435'],
  [/pi camera|rpi cam|camera module/i, 'camera_rpi_v2'],
  [/camera/i, 'camera'],
  [/hc-?sr04/i, 'ultrasonic_hcsr04'],
  [/ultrasonic|sonar/i, 'ultrasonic'],
  [/bno055|imu|mpu-?6050|icm/i, 'imu_bno055'],
  [/raspberry pi|\brpi\b|pi 5|pi 4/i, 'raspberry_pi_5'],
  [/jetson/i, 'jetson_orin_nano'],
  [/esp32/i, 'esp32_devkit'],
  [/pico|rp2040/i, 'pico_rp2040'],
  [/teensy/i, 'teensy_41'],
  [/flight controller|f405|f7 stack/i, 'fc_f405_stack'],
  [/tb6612/i, 'driver_tb6612fng'],
  [/l298/i, 'driver_l298n'],
  [/4.?in.?1 esc/i, 'esc_4in1_45a'],
  [/\besc\b|quicrun/i, 'esc_quicrun_1060'],
  [/motor driver|h-?bridge|driver/i, 'driver_tb6612fng'],
  [/buck|regulator|5 ?v (bec|supply)|step.?down/i, 'buck_converter_5v'],
  [/\bbms\b/i, 'bms_4s'],
  [/charger/i, 'lipo_balance_charger'],
  [/18650|li-?ion/i, 'liion_18650_3s'],
  [/4s.*(5000|5200)|5200/i, 'lipo_4s_5200'],
  [/4s/i, 'lipo_4s_1500'],
  [/lipo|battery|lifepo4|nimh/i, 'lipo_3s_2200'],
  [/stepper|nema/i, 'stepper_nema17'],
  [/sts3215|bus servo/i, 'servo_sts3215'],
  [/servo/i, 'servo_mg996r'],
  [/brushless|bldc|2207|kv\b/i, 'brushless_2207_1960kv'],
  [/gear ?motor|gearmotor/i, 'gearmotor_12v'],
  [/540|brushed/i, 'brushed_motor_540'],
  [/motor/i, 'gearmotor_12v'],
  [/mecanum/i, 'mecanum_wheel_100mm'],
  [/caster/i, 'caster'],
  [/wheel|tyre|tire/i, 'wheel'],
  [/propell?er|prop\b/i, 'propeller_5040'],
  [/gripper|claw/i, 'gripper_2finger'],
  [/e-?stop|emergency stop|kill switch/i, 'estop_button'],
  [/fuse/i, 'fuse_inline'],
  [/xt60|connector|pigtail/i, 'xt60_pigtail'],
  [/wire|awg|cable/i, 'silicone_wire_14awg'],
  [/elrs|receiver/i, 'elrs_receiver'],
  [/telemetry|sik/i, 'sik_telemetry_v3'],
  [/microsd|sd card/i, 'microsd_128gb'],
  [/extrusion|2020/i, 'extrusion_2020'],
  [/frame/i, 'quad_frame_5inch'],
  [/plate|chassis|deck/i, 'plate'],
  [/pcb/i, 'custom_pcb_kicad'],
];

const BY_CATEGORY: Record<string, string> = {
  battery: 'lipo_3s_2200', motor: 'gearmotor_12v', motor_driver: 'driver_tb6612fng', wheel: 'wheel',
  sensor: 'lidar', computer: 'raspberry_pi_5', controller: 'esp32_devkit', power: 'buck_converter_5v',
};

/** URL of a family illustration for a part, or null when nothing fits. */
export function partArt(name: string, category?: string): string | null {
  for (const [re, id] of RULES) if (re.test(name)) return assetPath(`assets/img/parts/${id}.jpg`);
  const id = category ? BY_CATEGORY[category] : undefined;
  return id ? assetPath(`assets/img/parts/${id}.jpg`) : null;
}
